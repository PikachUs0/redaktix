/**
 * Temporary OCR debug logger. Enable with ?debugOcr=1 (console only, no network).
 * Loaded only from DEV builds via dynamic import(import.meta.env.DEV).
 */
import { buildOcrCharacterIndex } from "./sensitive-detectors.js";

export function isDebugOcrEnabled() {
  if (!import.meta.env.DEV) return false;
  try {
    return new URLSearchParams(window.location.search).get("debugOcr") === "1";
  } catch {
    return false;
  }
}

function pixelBoxFromBbox(bbox) {
  if (!bbox) return null;
  const x0 = Number(bbox.x0 ?? bbox.x);
  const y0 = Number(bbox.y0 ?? bbox.y);
  const x1 = Number.isFinite(Number(bbox.x1))
    ? Number(bbox.x1)
    : x0 + Number(bbox.width ?? bbox.w);
  const y1 = Number.isFinite(Number(bbox.y1))
    ? Number(bbox.y1)
    : y0 + Number(bbox.height ?? bbox.h);
  if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) return null;
  return { x0, y0, x1, y1 };
}

function detectionPixelBox(detection, imageWidth, imageHeight) {
  if (!(imageWidth > 0) || !(imageHeight > 0)) return null;
  const x0 = Number(detection?.normX) * imageWidth;
  const y0 = Number(detection?.normY) * imageHeight;
  const x1 = x0 + Number(detection?.normWidth) * imageWidth;
  const y1 = y0 + Number(detection?.normHeight) * imageHeight;
  if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) return null;
  return { x0, y0, x1, y1 };
}

function boxesOverlap(first, second) {
  if (!first || !second) return false;
  return !(
    first.x1 <= second.x0
    || second.x1 <= first.x0
    || first.y1 <= second.y0
    || second.y1 <= first.y0
  );
}

function inferImageSize(lines, words) {
  let width = 0;
  let height = 0;
  for (const item of [...(lines || []), ...(words || [])]) {
    const box = pixelBoxFromBbox(item?.bbox);
    if (!box) continue;
    width = Math.max(width, box.x1);
    height = Math.max(height, box.y1);
  }
  return { width, height };
}

/** Word indices on this line covered by the detection span (empty = no word overlap). */
function wordIndicesForSpanOnLine(lineWords, span) {
  if (!Array.isArray(lineWords) || !lineWords.length || !span) return [];
  const indexed = buildOcrCharacterIndex(lineWords);
  const search = indexed.text.replace(/\n/g, " ");
  const needle = String(span);
  let start = search.indexOf(needle);
  if (start < 0) {
    // Compact match (spaces ignored), then keep only words that sit inside that run.
    const map = [];
    let compact = "";
    for (let index = 0; index < search.length; index += 1) {
      if (/\s/.test(search[index])) continue;
      compact += search[index];
      map.push(index);
    }
    const compactNeedle = needle.replace(/\s+/g, "");
    const compactStart = compact.indexOf(compactNeedle);
    if (compactStart < 0 || !compactNeedle) return [];
    start = map[compactStart];
    const end = map[compactStart + compactNeedle.length - 1] + 1;
    const indices = [];
    const seen = new Set();
    for (let index = start; index < end; index += 1) {
      const entry = indexed.chars[index];
      if (!entry?.word || seen.has(entry.word)) continue;
      seen.add(entry.word);
      const wordIndex = lineWords.indexOf(entry.word);
      if (wordIndex >= 0) indices.push(wordIndex);
    }
    return indices;
  }
  const end = start + needle.length;
  const indices = [];
  const seen = new Set();
  for (let index = start; index < end; index += 1) {
    const entry = indexed.chars[index];
    if (!entry?.word || seen.has(entry.word)) continue;
    seen.add(entry.word);
    const wordIndex = lineWords.indexOf(entry.word);
    if (wordIndex >= 0) indices.push(wordIndex);
  }
  return indices;
}

function lineWordsFor(line, allWords) {
  if (Array.isArray(line?.words) && line.words.length) return line.words;
  return (Array.isArray(allWords) ? allWords : []).filter((word) =>
    word.lineId === line.id
    || (Number.isFinite(Number(word.lineIndex))
      && Number(word.lineIndex) === Number(line.lineIndex))
  );
}

/**
 * True only when the detection's span hits this line's words, or its bbox
 * intersects this line's bbox (not loose page-wide text matching).
 */
function detectionOverlapsLine(detection, line, lineWords, imageWidth, imageHeight) {
  const wordIndices = wordIndicesForSpanOnLine(lineWords, detection?.text);
  if (wordIndices.length > 0) return true;

  const lineBox = pixelBoxFromBbox(line?.bbox);
  const detBox = detectionPixelBox(detection, imageWidth, imageHeight);
  return boxesOverlap(lineBox, detBox);
}

function summarizeLine(line, lineWords, detections, imageWidth, imageHeight) {
  const overlapping = detections.filter((detection) =>
    detectionOverlapsLine(detection, line, lineWords, imageWidth, imageHeight)
  );
  return {
    lineText: line.text,
    words: lineWords.map((word) => ({
      text: word.text,
      confidence: word.confidence,
    })),
    detections: overlapping.map((detection) => ({
      type: detection.type,
      ruleId: detection.ruleId ?? null,
      needsReview: Boolean(detection.review?.needsReview),
      span: detection.text,
    })),
  };
}

function isCompactTargetLine(lineText) {
  const text = String(lineText || "");
  return text.includes("GB") || text.includes("SELECT") || text.includes("id");
}

/**
 * @param {object[]} lines
 * @param {object[]} words
 * @param {object[]} _beforeSuppress unused (call-site compatibility)
 * @param {object[]} afterSuppress detections after suppressShadowedDetections
 */
export function logDebugOcrTargetLines(lines, words, _beforeSuppress, afterSuppress) {
  if (!import.meta.env.DEV || !isDebugOcrEnabled()) return;

  const detections = Array.isArray(afterSuppress) ? afterSuppress : [];
  const allWords = Array.isArray(words) ? words : [];
  const lineList = Array.isArray(lines) ? lines : [];
  const { width: imageWidth, height: imageHeight } = inferImageSize(lineList, allWords);

  const full = lineList.map((line) => {
    const lineWords = lineWordsFor(line, allWords);
    const summary = summarizeLine(line, lineWords, detections, imageWidth, imageHeight);
    // Full dump: keep previous shape without span required, but span is useful; user asked
    // full lines with overlapping detections — include type/ruleId/needsReview (span ok extra).
    return {
      lineText: summary.lineText,
      words: summary.words,
      detections: summary.detections.map(({ type, ruleId, needsReview }) => ({
        type,
        ruleId,
        needsReview,
      })),
    };
  });

  const compact = lineList
    .filter((line) => isCompactTargetLine(line?.text))
    .map((line) => {
      const lineWords = lineWordsFor(line, allWords);
      return summarizeLine(line, lineWords, detections, imageWidth, imageHeight);
    });

  console.log(`[debugOcr] Copy this JSON:\n${JSON.stringify(full, null, 2)}`);
  console.log(`[debugOcr] COMPACT\n${JSON.stringify(compact)}`);
}
