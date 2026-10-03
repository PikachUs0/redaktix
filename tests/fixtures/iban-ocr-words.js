/**
 * OCR word/line fixtures matching src/js/ocr.js createOcrWord / collectLinesFromBlocks.
 *
 * Word shape:
 *   { text, confidence, bbox:{x0,y0,x1,y1,x,y,width,height,w,h}, symbols:[],
 *     lineId:`${blockIndex}-${paragraphIndex}-${lineIndex}`,
 *     blockIndex, paragraphIndex, lineIndex, wordIndex }
 *
 * Line shape:
 *   { id:lineId, text, confidence, bbox, words:[...], blockIndex, paragraphIndex, lineIndex }
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

function layoutLine(tokens, {
  y0 = 20,
  height = 16,
  startX = 10,
  gap = 8,
  wideGaps = {},
  widths = null,
  confidences = null,
  lineIndex = 0,
  charWidth = 12,
} = {}) {
  let x = startX;
  const words = tokens.map((text, wordIndex) => {
    if (wordIndex > 0) x += Number.isFinite(wideGaps[wordIndex]) ? wideGaps[wordIndex] : gap;
    const width = widths?.[wordIndex] ?? Math.max(8, String(text).length * charWidth);
    const confidence = confidences?.[wordIndex] ?? 92;
    const word = makeWord(text, x, y0, width, height, confidence, lineIndex, wordIndex);
    x += width;
    return word;
  });
  const lineBbox = bbox(
    Math.min(...words.map((word) => word.bbox.x0)),
    Math.min(...words.map((word) => word.bbox.y0)),
    Math.max(...words.map((word) => word.bbox.x1)) - Math.min(...words.map((word) => word.bbox.x0)),
    Math.max(...words.map((word) => word.bbox.y1)) - Math.min(...words.map((word) => word.bbox.y0))
  );
  const confidence = words.reduce((sum, word) => sum + word.confidence, 0) / words.length;
  return {
    id: `0-0-${lineIndex}`,
    text: tokens.join(" "),
    confidence,
    bbox: lineBbox,
    words,
    blockIndex: 0,
    paragraphIndex: 0,
    lineIndex,
  };
}

const TR_LABEL = ["IBAN", "(TR)", ":"];
const TR_BLOCKS = ["TR33", "0006", "1005", "1978", "6457", "8413", "26"];
const TR_TOKENS = [...TR_LABEL, ...TR_BLOCKS];
const TR_INVALID_TOKENS = ["IBAN", "(TR)", ":", "TR33", "0006", "1005", "1978", "6457", "9012", "34"];
const EU_TOKENS = ["IBAN", "(EU)", ":", "DE89", "3704", "0044", "0532", "0130", "00"];

/** Fixture 1: one line, wider gap before "6457" (token index 7). */
export function fixtureTrOneLineWideGap() {
  const line = layoutLine(TR_TOKENS, {
    wideGaps: { 7: 50 },
  });
  return {
    id: "tr-one-line-wide-gap",
    imageWidth: 800,
    imageHeight: 120,
    lines: [line],
    words: line.words.slice(),
    ibanWordIndices: [3, 4, 5, 6, 7, 8, 9],
    expectedIban: "TR33 0006 1005 1978 6457 8413 26",
  };
}

/** Fixture 2: split after "6457"; "8413 26" on the next line, slightly indented. */
export function fixtureTrTwoLineSplit() {
  const line0 = layoutLine([...TR_LABEL, "TR33", "0006", "1005", "1978", "6457"], {
    lineIndex: 0,
  });
  const line1 = layoutLine(["8413", "26"], {
    y0: 44,
    startX: 30,
    lineIndex: 1,
  });
  return {
    id: "tr-two-line-split",
    imageWidth: 800,
    imageHeight: 120,
    lines: [line0, line1],
    words: [...line0.words, ...line1.words],
    ibanWordIndices: [3, 4, 5, 6, 7, 8, 9],
    expectedIban: "TR33 0006 1005 1978 6457 8413 26",
  };
}

/** Fixture 3: EU IBAN on one line. */
export function fixtureEuOneLine() {
  const line = layoutLine(EU_TOKENS);
  return {
    id: "eu-one-line",
    imageWidth: 800,
    imageHeight: 120,
    lines: [line],
    words: line.words.slice(),
    ibanWordIndices: [3, 4, 5, 6, 7, 8],
    expectedIban: "DE89 3704 0044 0532 0130 00",
  };
}

/** Fixture 4: same as 1, lower confidence on TR33/26, monospace widths. */
export function fixtureTrMonospaceConfidence() {
  const mono = 10;
  const widths = TR_TOKENS.map((token) => token.length * mono);
  const confidences = TR_TOKENS.map((token) => (token === "TR33" || token === "26" ? 61 : 93));
  const line = layoutLine(TR_TOKENS, {
    wideGaps: { 7: 50 },
    widths,
    confidences,
    charWidth: mono,
  });
  return {
    id: "tr-monospace-confidence",
    imageWidth: 800,
    imageHeight: 120,
    lines: [line],
    words: line.words.slice(),
    ibanWordIndices: [3, 4, 5, 6, 7, 8, 9],
    expectedIban: "TR33 0006 1005 1978 6457 8413 26",
  };
}

/** Fixture 5: valid-looking TR groups but last blocks make mod-97 fail (9012 34). */
export function fixtureTrOneLineMod97Fail() {
  const line = layoutLine(TR_INVALID_TOKENS);
  return {
    id: "tr-one-line-mod97-fail",
    imageWidth: 800,
    imageHeight: 120,
    lines: [line],
    words: line.words.slice(),
    ibanWordIndices: [3, 4, 5, 6, 7, 8, 9],
    expectedIban: "TR33 0006 1005 1978 6457 9012 34",
  };
}

/** Fixture 6: EU IBAN on one line (same tokens as fixture 3, dedicated id for editor-path tests). */
export function fixtureEuOneLineEditorCase() {
  const base = fixtureEuOneLine();
  return { ...base, id: "eu-one-line-editor-case" };
}

export const IBAN_OCR_FIXTURES = [
  fixtureTrOneLineWideGap(),
  fixtureTrTwoLineSplit(),
  fixtureEuOneLine(),
  fixtureTrMonospaceConfidence(),
  fixtureTrOneLineMod97Fail(),
  fixtureEuOneLineEditorCase(),
];
