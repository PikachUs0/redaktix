/**
 * OCR-word fixtures for regression lines (createOcrWord / collectLinesFromBlocks shape).
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
  lineIndex = 0,
  charWidth = 12,
} = {}) {
  let x = startX;
  const words = tokens.map((text, wordIndex) => {
    if (wordIndex > 0) x += gap;
    const width = Math.max(8, String(text).length * charWidth);
    const word = makeWord(text, x, y0, width, height, 92, lineIndex, wordIndex);
    x += width;
    return word;
  });
  const lineBbox = bbox(
    Math.min(...words.map((word) => word.bbox.x0)),
    Math.min(...words.map((word) => word.bbox.y0)),
    Math.max(...words.map((word) => word.bbox.x1)) - Math.min(...words.map((word) => word.bbox.x0)),
    Math.max(...words.map((word) => word.bbox.y1)) - Math.min(...words.map((word) => word.bbox.y0))
  );
  return {
    id: `0-0-${lineIndex}`,
    text: tokens.join(" "),
    confidence: 92,
    bbox: lineBbox,
    words,
    blockIndex: 0,
    paragraphIndex: 0,
    lineIndex,
  };
}

function fixtureFromTokens(id, tokens, {
  ibanWordIndices = null,
  imageWidth = 900,
  imageHeight = 160,
} = {}) {
  const line = layoutLine(tokens);
  return {
    id,
    lineText: line.text,
    imageWidth,
    imageHeight,
    lines: [line],
    words: line.words.slice(),
    ibanWordIndices,
  };
}

/** 1) "IBAN (DE) : DE89 3704 0044 0532 0130 00" */
export function fixtureDeValidIban() {
  return fixtureFromTokens(
    "de-valid-iban",
    ["IBAN", "(DE)", ":", "DE89", "3704", "0044", "0532", "0130", "00"],
    { ibanWordIndices: [3, 4, 5, 6, 7, 8] }
  );
}

/** 2) "IBAN (GB) : GB82 WEST 1234 5698 7654 32" */
export function fixtureGbValidIban() {
  return fixtureFromTokens(
    "gb-valid-iban",
    ["IBAN", "(GB)", ":", "GB82", "WEST", "1234", "5698", "7654", "32"],
    { ibanWordIndices: [3, 4, 5, 6, 7, 8] }
  );
}

/** 3) "IBAN (DE) : DE89 3704 0044 0532 0130 01" (checksum fails) */
export function fixtureDeChecksumFailIban() {
  return fixtureFromTokens(
    "de-checksum-fail-iban",
    ["IBAN", "(DE)", ":", "DE89", "3704", "0044", "0532", "0130", "01"],
    { ibanWordIndices: [3, 4, 5, 6, 7, 8] }
  );
}

/** 4) "Kod : SELECT * FROM users WHERE id=1000;" (glued id=1000;) */
export function fixtureSqlIdEquals1000() {
  return fixtureFromTokens(
    "sql-id-equals-1000",
    ["Kod", ":", "SELECT", "*", "FROM", "users", "WHERE", "id=1000;"]
  );
}

/**
 * OCR often drops "=" → space: same SQL intent, triggers custom-id on "id 1000".
 * Line text becomes: "Kod : SELECT * FROM users WHERE id 1000 ;"
 */
export function fixtureSqlIdSpace1000Ocr() {
  return fixtureFromTokens(
    "sql-id-space-1000-ocr",
    ["Kod", ":", "SELECT", "*", "FROM", "users", "WHERE", "id", "1000", ";"]
  );
}

/**
 * Real OCR misread G→6 on a GB IBAN.
 * Line: "IBAN (GB) : GB82 WEST..." became words without colon:
 * "IBAN","(GB)","6B82","WEST","1234","5698","7654","32"
 */
export function fixtureGbOcrCountrySixAsG() {
  return fixtureFromTokens(
    "gb-ocr-6b82",
    ["IBAN", "(GB)", "6B82", "WEST", "1234", "5698", "7654", "32"],
    { ibanWordIndices: [2, 3, 4, 5, 6, 7] }
  );
}

/** Unlabeled OCR-broken GB-like IBAN with failing checksum after country repair. */
export function fixtureGbOcrSixUnlabeledChecksumFail() {
  return fixtureFromTokens(
    "gb-ocr-6b82-unlabeled-checksum-fail",
    ["6B82", "WEST", "1234", "5698", "7654", "33"],
    { ibanWordIndices: [0, 1, 2, 3, 4, 5] }
  );
}

/** Order / reference style code that must not become an IBAN. */
export function fixtureOrderCodeNotIban() {
  return fixtureFromTokens(
    "order-code-not-iban",
    ["AB12", "3456", "7890", "CD"]
  );
}

/** custom-id hyphen form. */
export function fixtureCustomIdHyphen1000() {
  return fixtureFromTokens(
    "custom-id-hyphen-1000",
    ["Code", ":", "id-1000"]
  );
}

/** Unlabeled short 6B82-like token elsewhere (not a full IBAN). */
export function fixtureUnlabeledSixB82Elsewhere() {
  return fixtureFromTokens(
    "unlabeled-6b82-elsewhere",
    ["Ref", ":", "6B82", "only"]
  );
}

/** 5) "Sipariş No : 1111111111" and "Referans : 5432109876" */
export function fixtureOrderAndReferenceNumbers() {
  const line0 = layoutLine(["Sipariş", "No", ":", "1111111111"], { lineIndex: 0 });
  const line1 = layoutLine(["Referans", ":", "5432109876"], { y0: 44, lineIndex: 1 });
  return {
    id: "order-and-reference-numbers",
    lineText: [line0.text, line1.text],
    imageWidth: 900,
    imageHeight: 160,
    lines: [line0, line1],
    words: [...line0.words, ...line1.words],
    digitWordIndices: [
      { lineIndex: 0, wordIndex: 3, text: "1111111111" },
      { lineIndex: 1, wordIndex: 2, text: "5432109876" },
    ],
  };
}

export const REGRESSION_OCR_FIXTURES = [
  fixtureDeValidIban(),
  fixtureGbValidIban(),
  fixtureDeChecksumFailIban(),
  fixtureSqlIdEquals1000(),
  fixtureSqlIdSpace1000Ocr(),
  fixtureOrderAndReferenceNumbers(),
];
