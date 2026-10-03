/**
 * Shared OCR cross-line join helper (no DOM).
 * Builds 2–3 line windows when a wrap is geometrically plausible, with a
 * char-offset → (line, word) map for per-line boxing.
 */

function lineCorners(line) {
  const bbox = line?.bbox;
  if (bbox && Number.isFinite(Number(bbox.x0 ?? bbox.x))) {
    const x0 = Number(bbox.x0 ?? bbox.x);
    const y0 = Number(bbox.y0 ?? bbox.y);
    const x1 = Number.isFinite(Number(bbox.x1)) ? Number(bbox.x1) : x0 + Number(bbox.width || 0);
    const y1 = Number.isFinite(Number(bbox.y1)) ? Number(bbox.y1) : y0 + Number(bbox.height || 0);
    if (x1 > x0 && y1 > y0) return { x0, y0, x1, y1, width: x1 - x0, height: y1 - y0 };
  }
  const words = Array.isArray(line?.words) ? line.words : [];
  const boxes = words
    .map((word) => {
      const box = word?.bbox;
      if (!box) return null;
      const x0 = Number(box.x0 ?? box.x);
      const y0 = Number(box.y0 ?? box.y);
      const x1 = Number.isFinite(Number(box.x1)) ? Number(box.x1) : x0 + Number(box.width || 0);
      const y1 = Number.isFinite(Number(box.y1)) ? Number(box.y1) : y0 + Number(box.height || 0);
      if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) return null;
      return { x0, y0, x1, y1 };
    })
    .filter(Boolean);
  if (!boxes.length) return null;
  const x0 = Math.min(...boxes.map((box) => box.x0));
  const y0 = Math.min(...boxes.map((box) => box.y0));
  const x1 = Math.max(...boxes.map((box) => box.x1));
  const y1 = Math.max(...boxes.map((box) => box.y1));
  return { x0, y0, x1, y1, width: x1 - x0, height: y1 - y0 };
}

function endsWithSentencePunctuation(text) {
  return /[.!?:]\s*$/.test(String(text || "").trim());
}

/**
 * Whether `next` can continue `prev` as wrapped OCR text.
 */
export function isPlausibleLineWrap(prev, next, options = {}) {
  const prevBox = lineCorners(prev);
  const nextBox = lineCorners(next);
  if (!prevBox || !nextBox) return false;
  if (endsWithSentencePunctuation(prev?.text)) return false;

  const height = Math.max(prevBox.height, nextBox.height, 1);
  const gap = nextBox.y0 - prevBox.y1;
  const maxGap = Number.isFinite(Number(options.maxGapFactor))
    ? Number(options.maxGapFactor) * height
    : 1.5 * height;
  if (gap < -height * 0.35 || gap > maxGap) return false;

  const leftAlignTol = Number.isFinite(Number(options.leftAlignTol))
    ? Number(options.leftAlignTol)
    : Math.max(12, height * 1.2);
  const leftAligned = Math.abs(nextBox.x0 - prevBox.x0) <= leftAlignTol;

  const blockRight = Number.isFinite(Number(options.blockRight))
    ? Number(options.blockRight)
    : Math.max(prevBox.x1, nextBox.x1);
  const rightReachTol = Number.isFinite(Number(options.rightReachTol))
    ? Number(options.rightReachTol)
    : Math.max(24, height * 2.5);
  const prevReachesRight = prevBox.x1 >= blockRight - rightReachTol;

  return leftAligned || prevReachesRight;
}

function appendLineToJoined(joined, line, lineIndex) {
  const text = String(line?.text || "");
  const words = Array.isArray(line?.words) ? line.words : [];
  if (joined.text.length) {
    joined.text += " ";
    joined.charMap.push({ lineIndex, word: null, separator: true });
  }
  if (!words.length) {
    const start = joined.text.length;
    joined.text += text;
    for (let index = 0; index < text.length; index += 1) {
      joined.charMap.push({ lineIndex, word: null, charIndex: start + index });
    }
    joined.lines.push(line);
    return;
  }

  // Prefer walking words so the map points at real OCR word boxes.
  let cursor = 0;
  words.forEach((word, wordIndex) => {
    const token = String(word.text ?? "");
    if (wordIndex > 0) {
      joined.text += " ";
      joined.charMap.push({ lineIndex, word: null, separator: true });
      cursor += 1;
    }
    // Skip leading spaces in line.text between words when present.
    while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
    for (let index = 0; index < token.length; index += 1) {
      joined.text += token[index];
      joined.charMap.push({ lineIndex, word, charIndex: joined.text.length - 1 });
      cursor += 1;
    }
  });
  joined.lines.push(line);
}

/**
 * Build joined windows of 2–3 consecutive OCR lines when wrap is plausible.
 *
 * @param {object[]} lines ordered OCR lines ({ text, bbox, words })
 * @param {{ maxLines?: number }} [options]
 * @returns {Array<{ text: string, lines: object[], lineIndexes: number[], charMap: object[] }>}
 */
export function buildCrossLineWindows(lines, options = {}) {
  const list = Array.isArray(lines) ? lines : [];
  const maxLines = Math.min(3, Math.max(2, Number(options.maxLines) || 3));
  const windows = [];
  if (list.length < 2) return windows;

  const blockRight = Math.max(
    ...list.map((line) => lineCorners(line)?.x1).filter((value) => Number.isFinite(value)),
    0
  );

  for (let start = 0; start < list.length - 1; start += 1) {
    const chain = [list[start]];
    const indexes = [start];
    for (let cursor = start; cursor < list.length - 1 && chain.length < maxLines; cursor += 1) {
      const prev = list[cursor];
      const next = list[cursor + 1];
      if (!isPlausibleLineWrap(prev, next, { ...options, blockRight })) break;
      chain.push(next);
      indexes.push(cursor + 1);
    }
    if (chain.length < 2) continue;

    // Emit the full plausible chain (2 or 3 lines).
    const joined = { text: "", charMap: [], lines: [] };
    chain.forEach((line, offset) => appendLineToJoined(joined, line, indexes[offset]));
    windows.push({
      text: joined.text,
      lines: joined.lines.slice(),
      lineIndexes: indexes.slice(),
      charMap: joined.charMap.slice(),
    });
  }

  return windows;
}

/**
 * Map a [start, end) char range in joined window text to the OCR words it covers.
 */
export function wordsForJoinedRange(window, start, end) {
  if (!window?.charMap?.length) return [];
  const from = Math.max(0, Number(start) || 0);
  const to = Math.min(window.charMap.length, Number(end) || 0);
  const seen = new Set();
  const words = [];
  for (let index = from; index < to; index += 1) {
    const entry = window.charMap[index];
    if (!entry?.word || seen.has(entry.word)) continue;
    seen.add(entry.word);
    words.push(entry.word);
  }
  return words;
}

/**
 * Group words from a joined match by lineIndex (for one-rect-per-line detections).
 */
export function groupWordsByLine(words) {
  const groups = new Map();
  for (const word of Array.isArray(words) ? words : []) {
    const lineIndex = Number.isFinite(Number(word?.lineIndex)) ? Number(word.lineIndex) : 0;
    if (!groups.has(lineIndex)) groups.set(lineIndex, []);
    groups.get(lineIndex).push(word);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([lineIndex, lineWords]) => ({ lineIndex, words: lineWords }));
}
