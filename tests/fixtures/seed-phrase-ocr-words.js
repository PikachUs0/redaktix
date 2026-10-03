/**
 * OCR fixtures for seed-phrase wrap bugs (Tesseract word/line shape).
 * Real editor case: 12 lowercase words split 10 + 2 across two lines.
 */

function bbox(x0, y0, width, height) {
  const x1 = x0 + width;
  const y1 = y0 + height;
  return { x0, y0, x1, y1, x: x0, y: y0, width, height, w: width, h: height };
}

function makeWord(text, x0, y0, width, height, confidence, lineIndex, wordIndex) {
  return {
    text,
    confidence,
    bbox: bbox(x0, y0, width, height),
    symbols: [],
    lineId: `0-0-${lineIndex}`,
    blockIndex: 0,
    paragraphIndex: 0,
    lineIndex,
    wordIndex,
  };
}

function layoutLine(tokens, { y0, lineIndex, gap = 5, charWidth = 7, height = 14, startX = 12 } = {}) {
  let x = startX;
  const words = tokens.map((text, wordIndex) => {
    if (wordIndex > 0) x += gap;
    const width = Math.max(12, String(text).length * charWidth);
    const word = makeWord(text, x, y0, width, height, 90, lineIndex, wordIndex);
    x += width;
    return word;
  });
  return {
    id: `0-0-${lineIndex}`,
    text: tokens.join(" "),
    confidence: 88,
    bbox: bbox(
      Math.min(...words.map((word) => word.bbox.x0)),
      y0,
      Math.max(...words.map((word) => word.bbox.x1)) - Math.min(...words.map((word) => word.bbox.x0)),
      height
    ),
    words,
    blockIndex: 0,
    paragraphIndex: 0,
    lineIndex,
  };
}

/** Exact 12-word run from the reported editor screenshot (wrap 10 + 2). */
export const SEED_12_WORDS = [
  "abandon", "ability", "able", "about", "above", "absent",
  "absorb", "abstract", "absurd", "access", "accident", "account",
];

export const SEED_24_WORDS = [
  ...SEED_12_WORDS,
  "accuse", "achieve", "acid", "acoustic", "acquire", "across",
  "act", "action", "actor", "actress", "actual", "adapt",
];

/**
 * Real wrap: line0 = first 10 words, line1 = last 2 ("accident account").
 */
export function fixtureSeedPhraseTwoLine12() {
  const line0Words = SEED_12_WORDS.slice(0, 10);
  const line1Words = SEED_12_WORDS.slice(10);
  const lines = [
    layoutLine(line0Words, { y0: 20, lineIndex: 0 }),
    layoutLine(line1Words, { y0: 40, lineIndex: 1 }),
  ];
  return {
    id: "seed-12-two-line",
    imageWidth: 900,
    imageHeight: 80,
    lines,
    words: lines.flatMap((line) => line.words),
    expectedWordCount: 12,
    line0WordCount: 10,
    line1WordCount: 2,
  };
}

/**
 * 24-word wrap across two lines (11 + 13) so NEITHER line alone has a 12/24 run.
 */
export function fixtureSeedPhraseTwoLine24() {
  const lines = [
    layoutLine(SEED_24_WORDS.slice(0, 11), { y0: 20, lineIndex: 0 }),
    layoutLine(SEED_24_WORDS.slice(11), { y0: 40, lineIndex: 1 }),
  ];
  return {
    id: "seed-24-two-line",
    imageWidth: 1100,
    imageHeight: 80,
    lines,
    words: lines.flatMap((line) => line.words),
    expectedWordCount: 24,
    line0WordCount: 11,
    line1WordCount: 13,
  };
}

/** Control: full 12-word phrase on one OCR line (should already detect). */
export function fixtureSeedPhraseSingleLine12() {
  const line = layoutLine(SEED_12_WORDS, { y0: 24, lineIndex: 0 });
  return {
    id: "seed-12-one-line",
    imageWidth: 1000,
    imageHeight: 60,
    lines: [line],
    words: line.words.slice(),
    expectedWordCount: 12,
  };
}
