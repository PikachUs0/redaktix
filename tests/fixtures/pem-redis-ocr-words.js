/**
 * OCR fixtures shaped like Tesseract splits for PEM + Redis coverage bugs
 * observed in the real editor (BEGIN/END may stay uncovered; body gaps are bugs).
 *
 * Word/line shapes match src/js/ocr.js createOcrWord / collectLinesFromBlocks.
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

function layoutLine(tokens, { y0, lineIndex, gap = 6, charWidth = 9, height = 14, startX = 12 } = {}) {
  let x = startX;
  const words = tokens.map((text, wordIndex) => {
    if (wordIndex > 0) x += gap;
    const width = Math.max(10, String(text).length * charWidth);
    const word = makeWord(text, x, y0, width, height, 90, lineIndex, wordIndex);
    x += width;
    return word;
  });
  return {
    id: `0-0-${lineIndex}`,
    // Prefer Tesseract-like line.text without inventing spaces inside URLs/base64 tails
    // when the caller passes a continuous lineText override.
    text: tokens.join(" "),
    confidence: 90,
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

/** Real first PEM body line from the reported screenshot. */
export const PEM_BODY_LINE_1 =
  "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7";

/**
 * Second body line: long base64 + trailing "Nb" as its own OCR word.
 */
export const PEM_BODY_LINE_2_PREFIX =
  "xYz0123456789ABCDEFGHIJKLMNOPQRSTUVWabcdefghijklmnopqrstuv";
export const PEM_BODY_LINE_2_TAIL = "Nb";

/**
 * Reproduce observed editor gaps:
 * - Body line 1 OCR-split into two sub-40 chunks (high-entropy api_token misses it)
 * - Body line 2 = long prefix word + separate "Nb"
 * - private_key still matches BEGIN..END via word index; final collapsed
 *   blackout rect is asserted separately from per-word gaps users see on
 *   api_token overlays. Coverage tests use the full structured-lines pipeline
 *   and require every body word inside the union of final rects — and also
 *   require Nb inside the matched private_key character span / per-line boxes.
 *
 * Additional "tight" fixture below drops private_key header recognition to
 * isolate the api_token-only path that matches the screenshot (BEGIN uncovered).
 */
export function fixturePemPrivateKeyOcrSplit() {
  // Split the reported first body line like a harsh Tesseract break (< 40 chars each
  // so extractHighEntropyTokens will not cover either chunk alone).
  const body1a = PEM_BODY_LINE_1.slice(0, 28);
  const body1b = PEM_BODY_LINE_1.slice(28);
  const lines = [
    layoutLine(["-----BEGIN", "RSA", "PRIVATE", "KEY-----"], { y0: 20, lineIndex: 0 }),
    // Spaced line.text (Tesseract word join) so each chunk is <40 and api_token misses body1.
    layoutLine([body1a, body1b], { y0: 40, lineIndex: 1, charWidth: 8 }),
    layoutLine([PEM_BODY_LINE_2_PREFIX, PEM_BODY_LINE_2_TAIL], { y0: 60, lineIndex: 2, charWidth: 8 }),
    layoutLine(["-----END", "RSA", "PRIVATE", "KEY-----"], { y0: 80, lineIndex: 3 }),
  ];
  const words = lines.flatMap((line) => line.words);
  const body1Indices = words
    .map((word, index) => (word.lineIndex === 1 ? index : -1))
    .filter((index) => index >= 0);
  const body2PrefixIndex = words.findIndex((word) => word.text === PEM_BODY_LINE_2_PREFIX);
  const body2TailIndex = words.findIndex((word) => word.text === PEM_BODY_LINE_2_TAIL);
  return {
    id: "pem-ocr-split-body-tail",
    imageWidth: 900,
    imageHeight: 120,
    lines,
    words,
    mustCoverWordIndices: [...body1Indices, body2PrefixIndex, body2TailIndex],
    body1WordIndices: body1Indices,
    body2PrefixWordIndex: body2PrefixIndex,
    body2TailWordIndex: body2TailIndex,
  };
}

/**
 * Same body splits, but BEGIN line is OCR-broken so extractPrivateKeyBlocks
 * finds nothing — matches a screenshot where only body api_token boxes paint
 * (BEGIN/END uncovered) and the first body line / Nb are missed.
 */
export function fixturePemBodyOnlyApiTokenPath() {
  const body1a = PEM_BODY_LINE_1.slice(0, 28);
  const body1b = PEM_BODY_LINE_1.slice(28);
  const lines = [
    // Broken header: missing "PRIVATE KEY" shape → no private_key detection
    layoutLine(["-----BEGIN", "RSA", "KEY-----"], { y0: 20, lineIndex: 0 }),
    // Spaced OCR line.text: neither chunk reaches extractHighEntropyTokens' 40-char floor.
    layoutLine([body1a, body1b], { y0: 40, lineIndex: 1, charWidth: 8 }),
    layoutLine([PEM_BODY_LINE_2_PREFIX, PEM_BODY_LINE_2_TAIL], { y0: 60, lineIndex: 2, charWidth: 8 }),
    layoutLine(["-----END", "RSA", "KEY-----"], { y0: 80, lineIndex: 3 }),
  ];
  const words = lines.flatMap((line) => line.words);
  const body1Indices = words
    .map((word, index) => (word.lineIndex === 1 ? index : -1))
    .filter((index) => index >= 0);
  const body2PrefixIndex = words.findIndex((word) => word.text === PEM_BODY_LINE_2_PREFIX);
  const body2TailIndex = words.findIndex((word) => word.text === PEM_BODY_LINE_2_TAIL);
  return {
    id: "pem-body-api-token-only",
    imageWidth: 900,
    imageHeight: 120,
    lines,
    words,
    mustCoverWordIndices: [...body1Indices, body2PrefixIndex, body2TailIndex],
    body1WordIndices: body1Indices,
    body2PrefixWordIndex: body2PrefixIndex,
    body2TailWordIndex: body2TailIndex,
  };
}

/**
 * Redis URL where port is a separate OCR word ":6379".
 * line.text joins words with a space before the port (Tesseract word boxes).
 */
export function fixtureRedisUrlPortSplit() {
  const host = "REDIS_URL=redis://default:p4ssw0rd@cache.example.com";
  const port = ":6379";
  const line = layoutLine([host, port], { y0: 24, lineIndex: 0, charWidth: 8, gap: 4 });
  return {
    id: "redis-url-port-split",
    imageWidth: 820,
    imageHeight: 60,
    lines: [line],
    words: line.words.slice(),
    urlWordIndices: [0, 1],
    hostWordIndex: 0,
    portWordIndex: 1,
    expectedUrl: "redis://default:p4ssw0rd@cache.example.com:6379",
    lineTextWithSpace: line.text,
  };
}
