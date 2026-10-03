export const OCR_ADAPTIVE_DEFAULTS = Object.freeze({
  scale: 3,
  window: 25,
  k: 0.18,
  R: 128,
});

export function grayscaleFromRgba(data, width, height) {
  const gray = new Float32Array(width * height);
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    gray[index] = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
  }
  return gray;
}

export function grayscaleStats(gray, width, height) {
  const count = Math.max(0, width * height);
  if (!count || !gray?.length) {
    return {
      width,
      height,
      min: 0,
      max: 0,
      mean: 0,
      standardDeviation: 0,
      foregroundRatio: 0,
      zeroSized: !(width > 0 && height > 0),
      nonTransparent: false,
    };
  }
  let min = 255;
  let max = 0;
  let sum = 0;
  let sumSquares = 0;
  let foreground = 0;
  const limit = Math.min(count, gray.length);
  for (let index = 0; index < limit; index += 1) {
    const value = gray[index];
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
    sumSquares += value * value;
    if (value < 128) foreground += 1;
  }
  const mean = sum / limit;
  const variance = Math.max(0, sumSquares / limit - mean * mean);
  return {
    width,
    height,
    min,
    max,
    mean,
    standardDeviation: Math.sqrt(variance),
    foregroundRatio: foreground / limit,
    zeroSized: false,
    nonTransparent: true,
  };
}

export function warnIfCollapsed(stats, label) {
  const ratio = Number(stats?.foregroundRatio);
  if (ratio <= 0.005 || ratio >= 0.995) {
    console.warn(`[OCR WARNING] preprocessing may have collapsed the image into near-uniform pixels (${label})`, stats);
    return true;
  }
  return false;
}

function integralImages(gray, width, height) {
  const stride = width + 1;
  const sum = new Float64Array(stride * (height + 1));
  const square = new Float64Array(stride * (height + 1));
  for (let y = 1; y <= height; y += 1) {
    let row = 0;
    let rowSquare = 0;
    for (let x = 1; x <= width; x += 1) {
      const value = gray[(y - 1) * width + (x - 1)];
      row += value;
      rowSquare += value * value;
      const index = y * stride + x;
      sum[index] = sum[(y - 1) * stride + x] + row;
      square[index] = square[(y - 1) * stride + x] + rowSquare;
    }
  }
  return { sum, square, stride };
}

function areaSum(table, stride, x0, y0, x1, y1) {
  return table[y1 * stride + x1] - table[y0 * stride + x1] - table[y1 * stride + x0] + table[y0 * stride + x0];
}

export function localContrastNormalize(gray, width, height, options = {}) {
  const settings = { ...OCR_ADAPTIVE_DEFAULTS, ...options };
  const radius = Math.max(1, Math.floor(settings.window / 2));
  const { sum, square, stride } = integralImages(gray, width, height);
  const output = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      const area = (x1 - x0) * (y1 - y0);
      const mean = areaSum(sum, stride, x0, y0, x1, y1) / area;
      const variance = Math.max(0, areaSum(square, stride, x0, y0, x1, y1) / area - mean * mean);
      const deviation = Math.sqrt(variance);
      const centered = 128 + ((gray[y * width + x] - mean) * 48) / (deviation + 4);
      output[y * width + x] = Math.max(0, Math.min(255, centered));
    }
  }
  return output;
}

export function preferDarkGlyphs(gray) {
  let bright = 0;
  let dark = 0;
  for (let index = 0; index < gray.length; index += 1) {
    if (gray[index] >= 168) bright += 1;
    else if (gray[index] <= 88) dark += 1;
  }
  if (bright > dark) return invertGray(gray);
  return gray;
}

export function adaptiveThresholdGray(gray, width, height, options = {}) {
  const settings = { ...OCR_ADAPTIVE_DEFAULTS, ...options };
  const normalized = preferDarkGlyphs(localContrastNormalize(gray, width, height, settings));
  return sauvolaThreshold(normalized, width, height, settings);
}

export function contrastForOcr(gray, width, height) {
  const normalized = preferDarkGlyphs(localContrastNormalize(gray, width, height));
  return contrastStretch(normalized);
}

function columnSpan(scores, pad) {
  const radius = 22;
  const smoothed = new Float32Array(scores.length);
  for (let index = 0; index < scores.length; index += 1) {
    let sum = 0;
    let count = 0;
    for (let offset = index - radius; offset <= index + radius; offset += 1) {
      if (offset < 0 || offset >= scores.length) continue;
      sum += scores[offset];
      count += 1;
    }
    smoothed[index] = count ? sum / count : 0;
  }
  let peak = 0;
  let peakIndex = 0;
  for (let index = 0; index < smoothed.length; index += 1) {
    if (smoothed[index] > peak) {
      peak = smoothed[index];
      peakIndex = index;
    }
  }
  if (peak < 12) return null;
  const cutoff = peak * 0.16;
  let start = peakIndex;
  let end = peakIndex;
  let dead = 0;
  for (let index = peakIndex - 1; index >= 0; index -= 1) {
    if (smoothed[index] >= cutoff) {
      start = index;
      dead = 0;
    } else {
      dead += 1;
      if (dead > 48) break;
    }
  }
  dead = 0;
  for (let index = peakIndex + 1; index < smoothed.length; index += 1) {
    if (smoothed[index] >= cutoff) {
      end = index;
      dead = 0;
    } else {
      dead += 1;
      if (dead > 48) break;
    }
  }
  return {
    start: Math.max(0, start - pad),
    end: Math.min(scores.length - 1, end + pad),
  };
}

function strongestBand(scores, peakFloor, radius = 6) {
  const smoothed = new Float32Array(scores.length);
  for (let index = 0; index < scores.length; index += 1) {
    let sum = 0;
    let count = 0;
    for (let offset = index - radius; offset <= index + radius; offset += 1) {
      if (offset < 0 || offset >= scores.length) continue;
      sum += scores[offset];
      count += 1;
    }
    smoothed[index] = count ? sum / count : 0;
  }
  let peak = 0;
  for (let index = 0; index < smoothed.length; index += 1) if (smoothed[index] > peak) peak = smoothed[index];
  if (peak < peakFloor) return null;
  const cutoff = peak * 0.45;
  let best = null;
  let start = -1;
  for (let index = 0; index <= smoothed.length; index += 1) {
    const active = index < smoothed.length && smoothed[index] >= cutoff;
    if (active && start < 0) start = index;
    if (!active && start >= 0) {
      const end = index - 1;
      let energy = 0;
      for (let cursor = start; cursor <= end; cursor += 1) energy += smoothed[cursor];
      if (!best || energy > best.energy) best = { start, end, energy };
      start = -1;
    }
  }
  return best;
}

export function forceBadgeRoiPadding(boundingBox, imageWidth) {
  const boxX = Number(boundingBox.x) || 0;
  const boxWidth = Number(boundingBox.width) || 0;
  const left = Math.max(0, boxX - 120);
  const right = Math.min(imageWidth, boxX + boxWidth + 120);
  return {
    x: left,
    y: Number(boundingBox.y) || 0,
    width: Math.max(1, right - left),
    height: Number(boundingBox.height) || 0,
  };
}

export function cropTextBand(gray, width, height) {
  if (height < 8 || width < 8) return { gray, width, height, x: 0, y: 0 };
  const activityAt = (x, y) => {
    const value = gray[y * width + x];
    return Math.min(14, Math.abs(value - gray[y * width + (x - 1)]) + Math.abs(value - gray[(y - 1) * width + x]));
  };
  const rowScores = new Float32Array(height);
  for (let y = 1; y < height; y += 1) {
    const samples = [];
    for (let x = 1; x < width; x += 4) samples.push(activityAt(x, y));
    samples.sort((first, second) => first - second);
    const median = samples.length ? samples[Math.floor(samples.length / 2)] : 0;
    let score = 0;
    samples.forEach((sample) => {
      score += Math.max(0, sample - median);
    });
    rowScores[y] = score;
  }
  const rows = strongestBand(rowScores, 8, 3);
  const top = Math.max(0, (rows?.start ?? 0) - 8);
  const bottom = Math.min(height - 1, (rows?.end ?? height - 1) + 8);
  const columnScores = new Float32Array(width);
  for (let y = Math.max(1, top); y <= bottom; y += 1) {
    for (let x = 1; x < width; x += 1) columnScores[x] += activityAt(x, y);
  }
  const horizontal = columnSpan(columnScores, 40);
  if (!rows && !horizontal) return { gray, width, height, x: 0, y: 0 };
  const left = horizontal?.start ?? 0;
  const right = horizontal?.end ?? width - 1;
  const nextWidth = right - left + 1;
  const nextHeight = bottom - top + 1;
  if (nextWidth >= width - 2 && nextHeight >= height - 2) return { gray, width, height, x: 0, y: 0 };
  const output = new Float32Array(nextWidth * nextHeight);
  for (let y = 0; y < nextHeight; y += 1) {
    for (let x = 0; x < nextWidth; x += 1) {
      output[y * nextWidth + x] = gray[(top + y) * width + (left + x)];
    }
  }
  return { gray: output, width: nextWidth, height: nextHeight, x: left, y: top };
}

export function sauvolaThreshold(gray, width, height, options = {}) {
  const settings = { ...OCR_ADAPTIVE_DEFAULTS, ...options };
  const radius = Math.max(1, Math.floor(settings.window / 2));
  const { sum, square, stride } = integralImages(gray, width, height);
  const output = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      const area = (x1 - x0) * (y1 - y0);
      const mean = areaSum(sum, stride, x0, y0, x1, y1) / area;
      const variance = Math.max(0, areaSum(square, stride, x0, y0, x1, y1) / area - mean * mean);
      const deviation = Math.sqrt(variance);
      const threshold = mean * (1 + settings.k * (deviation / settings.R - 1));
      output[y * width + x] = gray[y * width + x] < threshold ? 0 : 255;
    }
  }
  return output;
}

export function contrastStretch(gray) {
  const samples = [];
  for (let index = 0; index < gray.length; index += 8) samples.push(gray[index]);
  samples.sort((first, second) => first - second);
  const low = samples.length ? samples[Math.floor(samples.length * 0.05)] : 0;
  const high = samples.length ? samples[Math.floor(samples.length * 0.95)] : 255;
  const span = Math.max(24, high - low);
  const output = new Uint8Array(gray.length);
  for (let index = 0; index < gray.length; index += 1) {
    output[index] = Math.max(0, Math.min(255, Math.round(((gray[index] - low) / span) * 255)));
  }
  return output;
}

export function rgbaFromGray(gray) {
  const data = new Uint8ClampedArray(gray.length * 4);
  for (let index = 0; index < gray.length; index += 1) {
    const value = gray[index];
    const offset = index * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  return data;
}

export function invertGray(gray) {
  const output = new Uint8Array(gray.length);
  for (let index = 0; index < gray.length; index += 1) output[index] = 255 - gray[index];
  return output;
}

export function upscaleGray(gray, width, height, scale) {
  const nextWidth = Math.max(1, Math.round(width * scale));
  const nextHeight = Math.max(1, Math.round(height * scale));
  const output = new Float32Array(nextWidth * nextHeight);
  for (let y = 0; y < nextHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < nextWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor(x / scale));
      output[y * nextWidth + x] = gray[sourceY * width + sourceX];
    }
  }
  return { gray: output, width: nextWidth, height: nextHeight };
}

export function cropRgba(data, width, roi) {
  const x0 = Math.max(0, Math.floor(roi.x));
  const y0 = Math.max(0, Math.floor(roi.y));
  const cropWidth = Math.max(1, Math.floor(roi.width));
  const cropHeight = Math.max(1, Math.floor(roi.height));
  const output = new Uint8ClampedArray(cropWidth * cropHeight * 4);
  for (let y = 0; y < cropHeight; y += 1) {
    for (let x = 0; x < cropWidth; x += 1) {
      const source = ((y0 + y) * width + (x0 + x)) * 4;
      const target = (y * cropWidth + x) * 4;
      output[target] = data[source];
      output[target + 1] = data[source + 1];
      output[target + 2] = data[source + 2];
      output[target + 3] = data[source + 3];
    }
  }
  return { data: output, width: cropWidth, height: cropHeight };
}

function coveredByBox(x, y, boxes) {
  return boxes.some((box) => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1);
}

function pixelLuminance(data, width, x, y) {
  const offset = (y * width + x) * 4;
  return data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
}

export function expandRoiToBadgeLine(data, width, height, roi) {
  const x0 = Math.max(0, Math.floor(roi.x));
  const y0 = Math.max(0, Math.floor(roi.y));
  const x1 = Math.min(width, x0 + Math.max(1, Math.floor(roi.width)));
  const y1 = Math.min(height, y0 + Math.max(1, Math.floor(roi.height)));
  const samples = [];
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const value = pixelLuminance(data, width, x, y);
      if (value >= 28 && value <= 170) samples.push(value);
    }
  }
  if (!samples.length) return roi;
  samples.sort((first, second) => first - second);
  const median = samples[Math.floor(samples.length / 2)];
  const columnMatches = (x) => {
    let hits = 0;
    let count = 0;
    for (let y = y0; y < y1; y += 2) {
      count += 1;
      const value = pixelLuminance(data, width, x, y);
      if (Math.abs(value - median) <= 36 && value >= 20 && value <= 180) hits += 1;
    }
    return count > 0 && hits / count >= 0.5;
  };
  let left = x0;
  let right = x1 - 1;
  while (left > 0 && columnMatches(left - 1)) left -= 1;
  while (right < width - 1 && columnMatches(right + 1)) right += 1;
  const horizontalPad = 48;
  left = Math.max(0, left - horizontalPad);
  right = Math.min(width - 1, right + horizontalPad);
  const expanded = {
    x: left,
    y: y0,
    width: right - left + 1,
    height: y1 - y0,
  };
  if (expanded.width * expanded.height > width * height * 0.5) return roi;
  return expanded;
}

export function discoverSuspiciousRois(data, width, height, coveredBoxes = []) {
  const cell = 8;
  const columns = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const marked = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x0 = column * cell;
      const y0 = row * cell;
      const x1 = Math.min(width, x0 + cell);
      const y1 = Math.min(height, y0 + cell);
      let sum = 0;
      let square = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const offset = (y * width + x) * 4;
          const value = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
          sum += value;
          square += value * value;
          count += 1;
        }
      }
      if (!count) continue;
      const mean = sum / count;
      const deviation = Math.sqrt(Math.max(0, square / count - mean * mean));
      const centerX = (x0 + x1) / 2;
      const centerY = (y0 + y1) / 2;
      const grayBadge = mean >= 28 && mean <= 150 && deviation >= 1.2 && deviation <= 36;
      if (grayBadge && !coveredByBox(centerX, centerY, coveredBoxes)) marked[row * columns + column] = 1;
    }
  }

  const dilated = new Uint8Array(marked.length);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let on = 0;
      for (let offsetY = -2; offsetY <= 2 && !on; offsetY += 1) {
        for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
          const nextRow = row + offsetY;
          const nextColumn = column + offsetX;
          if (nextRow < 0 || nextColumn < 0 || nextRow >= rows || nextColumn >= columns) continue;
          if (marked[nextRow * columns + nextColumn]) on = 1;
        }
      }
      dilated[row * columns + column] = on;
    }
  }
  marked.set(dilated);

  const seen = new Uint8Array(marked.length);
  const rois = [];
  for (let start = 0; start < marked.length; start += 1) {
    if (!marked[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let minColumn = columns;
    let minRow = rows;
    let maxColumn = 0;
    let maxRow = 0;
    let cells = 0;
    while (stack.length) {
      const index = stack.pop();
      const column = index % columns;
      const row = Math.floor(index / columns);
      cells += 1;
      minColumn = Math.min(minColumn, column);
      minRow = Math.min(minRow, row);
      maxColumn = Math.max(maxColumn, column);
      maxRow = Math.max(maxRow, row);
      const neighbors = [index - 1, index + 1, index - columns, index + columns];
      neighbors.forEach((next) => {
        if (next < 0 || next >= marked.length || seen[next] || !marked[next]) return;
        const nextColumn = next % columns;
        const currentColumn = index % columns;
        if (Math.abs(nextColumn - currentColumn) > 1) return;
        seen[next] = 1;
        stack.push(next);
      });
    }
    if (cells < 4) continue;
    const rawWidth = (maxColumn - minColumn + 1) * cell;
    const rawHeight = (maxRow - minRow + 1) * cell;
    if (rawWidth < 36 || rawHeight < 16 || rawWidth * rawHeight > width * height * 0.35) continue;
    const pad = 28;
    const x = Math.max(0, minColumn * cell - pad);
    const y = Math.max(0, minRow * cell - pad);
    const right = Math.min(width, (maxColumn + 1) * cell + pad);
    const bottom = Math.min(height, (maxRow + 1) * cell + pad);
    const roiWidth = right - x;
    const roiHeight = bottom - y;
    rois.push(expandRoiToBadgeLine(data, width, height, { x, y, width: roiWidth, height: roiHeight }));
  }
  
  const unique = [];
  rois
    .sort((first, second) => second.width * second.height - first.width * first.height)
    .forEach((roi) => {
      const duplicate = unique.some((kept) => {
        // KRİTİK DÜZELTME: Eğer iki ROI farklı satırlardalarsa (dikeyde aralarında mesafe varsa), 
        // asla mükerrer sayma ve ikisini de ayrı birer bölge olarak tut!
        const verticalDistance = Math.abs(kept.y - roi.y);
        if (verticalDistance > 15) {
          return false; // Farklı satırlardaki şeritler silinmeyecek
        }

        const overlapWidth = Math.max(0, Math.min(kept.x + kept.width, roi.x + roi.width) - Math.max(kept.x, roi.x));
        const overlapHeight = Math.max(0, Math.min(kept.y + kept.height, roi.y + roi.height) - Math.max(kept.y, roi.y));
        const overlap = overlapWidth * overlapHeight;
        const smaller = Math.min(kept.width * kept.height, roi.width * roi.height);
        return smaller > 0 && overlap / smaller > 0.6;
      });
      if (!duplicate) unique.push(roi);
    });
    
  return unique.slice(0, 3);
}

export function mapRoiBoxToOriginal(bbox, roi, scale) {
  const safeScale = scale > 0 ? scale : 1;
  const x0 = roi.x + Number(bbox.x0 ?? bbox.x) / safeScale;
  const y0 = roi.y + Number(bbox.y0 ?? bbox.y) / safeScale;
  const x1 = roi.x + Number(bbox.x1 ?? (Number(bbox.x) + Number(bbox.width))) / safeScale;
  const y1 = roi.y + Number(bbox.y1 ?? (Number(bbox.y) + Number(bbox.height))) / safeScale;
  return {
    x0,
    y0,
    x1,
    y1,
    x: x0,
    y: y0,
    width: x1 - x0,
    height: y1 - y0,
    w: x1 - x0,
    h: y1 - y0,
  };
}

export function intersectionOverUnion(first, second) {
  const width = Math.max(0, Math.min(first.x1, second.x1) - Math.max(first.x0, second.x0));
  const height = Math.max(0, Math.min(first.y1, second.y1) - Math.max(first.y0, second.y0));
  const overlap = width * height;
  const firstArea = Math.max(0, (first.x1 - first.x0) * (first.y1 - first.y0));
  const secondArea = Math.max(0, (second.x1 - second.x0) * (second.y1 - second.y0));
  const union = firstArea + secondArea - overlap;
  return union > 0 ? overlap / union : 0;
}

function boxEdges(box) {
  if (!box) return null;
  const x0 = Number(box.x0 ?? box.x);
  const y0 = Number(box.y0 ?? box.y);
  const x1 = Number(box.x1 ?? (x0 + Number(box.width ?? box.w ?? 0)));
  const y1 = Number(box.y1 ?? (y0 + Number(box.height ?? box.h ?? 0)));
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  return { x0, y0, x1, y1 };
}

export function spatiallyDuplicate(first, second) {
  const a = boxEdges(first?.bbox || first);
  const b = boxEdges(second?.bbox || second);
  if (!a || !b) return false;
  const dx = (a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2;
  const dy = (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2;
  const overlapY = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  const shorter = Math.max(1, Math.min(a.y1 - a.y0, b.y1 - b.y0));
  if (Math.abs(dy) > 10 && overlapY < shorter * 0.5) return false;
  if (intersectionOverUnion(a, b) > 0.5) return true;
  return Math.hypot(dx, dy) < 20;
}

export function sameTcknGlyph(first, second) {
  const a = boxEdges(first?.bbox || first);
  const b = boxEdges(second?.bbox || second);
  if (!a || !b) return false;
  const dy = Math.abs((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  if (dy >= 4) return false;
  return intersectionOverUnion(a, b) > 0.8;
}

export function mergeSpatialCandidates(candidates) {
  const merged = [];
  candidates.forEach((candidate) => {
    const duplicate = merged.some((kept) => spatiallyDuplicate(kept.bbox, candidate.bbox));
    if (!duplicate) merged.push(candidate);
  });
  return merged;
}

export function normalizeNumericCandidate(value) {
  return String(value || "")
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[Ss]/g, "5")
    .replace(/[Bb]/g, "8");
}
