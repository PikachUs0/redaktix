/**
 * Investigation + desired-behavior tests for five OCR lines.
 * Uses real exported suppressShadowedDetections / calculateOverlap.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blackoutDetections } from "../src/js/app.js";
import { loadCustomRules } from "../src/js/custom-rules.js";
import {
  calculateOverlap,
  suppressShadowedDetections,
} from "../src/js/detection-suppression.js";
import {
  CUSTOM_ID_REVIEW_WARNING,
  buildOcrCharacterIndex,
  detectionsForAutomaticRedaction,
  detectGroupedSecretsInScan,
  detectPhonesInScan,
  matchCustomRules,
} from "../src/js/sensitive-detectors.js";
import {
  detectStructuredDataFromLines,
  extractPhoneCandidatesForLines,
} from "../src/js/structured-lines.js";
import {
  fixtureDeChecksumFailIban,
  fixtureDeValidIban,
  fixtureGbValidIban,
  fixtureOrderAndReferenceNumbers,
  fixtureSqlIdEquals1000,
  fixtureSqlIdSpace1000Ocr,
} from "./fixtures/regression-ocr-lines.js";

const PROFILE = "global-turkey";

function wordIndicesForSpan(words, span) {
  const indexed = buildOcrCharacterIndex(words);
  const search = indexed.text.replace(/\n/g, " ");
  const start = search.indexOf(span);
  if (start < 0) return [];
  const end = start + span.length;
  const indices = [];
  const seen = new Set();
  for (let index = start; index < end; index += 1) {
    const entry = indexed.chars[index];
    if (!entry?.word || seen.has(entry.word)) continue;
    seen.add(entry.word);
    indices.push(words.indexOf(entry.word));
  }
  return indices;
}

function covers(rect, box, epsilon = 0.5) {
  const x0 = Number(rect.x0 ?? rect.x);
  const y0 = Number(rect.y0 ?? rect.y);
  const x1 = Number.isFinite(Number(rect.x1)) ? Number(rect.x1) : x0 + Number(rect.width);
  const y1 = Number.isFinite(Number(rect.y1)) ? Number(rect.y1) : y0 + Number(rect.height);
  return x0 <= box.x0 + epsilon
    && y0 <= box.y0 + epsilon
    && x1 >= box.x1 - epsilon
    && y1 >= box.y1 - epsilon;
}

/** Editor-equivalent scan: grouped + phones + structured lines, then suppressShadowed. */
function runEditorLikeScan(fixture) {
  const imageSize = { width: fixture.imageWidth, height: fixture.imageHeight };
  const linesById = new Map(fixture.lines.map((line) => [line.id, line]));
  const structured = detectStructuredDataFromLines(fixture.lines, {
    profileId: PROFILE,
    imageSize,
    linesById,
    extractPhoneCandidates: extractPhoneCandidatesForLines,
  });
  const grouped = detectGroupedSecretsInScan(
    fixture.words,
    fixture.imageWidth,
    fixture.imageHeight
  );
  const phones = detectPhonesInScan(
    fixture.words,
    fixture.imageWidth,
    fixture.imageHeight
  );
  const beforeSuppress = [...grouped, ...phones, ...structured];
  const afterSuppress = suppressShadowedDetections(beforeSuppress);
  const automatic = detectionsForAutomaticRedaction(afterSuppress);
  const autoSet = new Set(automatic);

  const listDetection = (detection, stage) => ({
    stage,
    type: detection.type,
    ruleId: detection.ruleId ?? null,
    span: detection.text,
    wordIndices: wordIndicesForSpan(fixture.words, detection.text),
    needsReview: Boolean(detection.review?.needsReview),
    autoApplied: autoSet.has(detection),
    warnings: detection.review?.warnings || [],
  });

  return {
    beforeSuppress: beforeSuppress.map((detection) => listDetection(detection, "before-suppress")),
    detections: afterSuppress.map((detection) => listDetection(detection, "after-suppress")),
    rawDetections: afterSuppress,
    automatic,
    rects: blackoutDetections(afterSuppress, fixture.imageWidth, fixture.imageHeight),
    customOnLineText: fixture.lines.flatMap((line) =>
      matchCustomRules(loadCustomRules(), line.text)
    ),
  };
}

describe("regression OCR lines investigation", () => {
  it("exports real suppressShadowedDetections and calculateOverlap", () => {
    assert.equal(typeof suppressShadowedDetections, "function");
    assert.equal(typeof calculateOverlap, "function");
  });

  it("lists every detection for the five requested lines", () => {
    const cases = [
      fixtureDeValidIban(),
      fixtureGbValidIban(),
      fixtureDeChecksumFailIban(),
      fixtureSqlIdEquals1000(),
      fixtureSqlIdSpace1000Ocr(),
      fixtureOrderAndReferenceNumbers(),
    ];
    const report = cases.map((fixture) => {
      const result = runEditorLikeScan(fixture);
      return {
        id: fixture.id,
        lineText: fixture.lineText,
        customOnLineText: result.customOnLineText,
        beforeSuppress: result.beforeSuppress,
        afterSuppress: result.detections,
      };
    });
    console.log("\n===== REGRESSION OCR LINES REPORT =====");
    console.log(JSON.stringify(report, null, 2));
    assert.ok(report.length >= 5);
  });
});

describe("desired outcomes (expected to fail until fixed)", () => {
  it("covers every DE IBAN word after editor suppress (valid checksum)", () => {
    const fixture = fixtureDeValidIban();
    const result = runEditorLikeScan(fixture);
    const missing = fixture.ibanWordIndices
      .filter((index) => !result.rects.some((rect) => covers(rect, fixture.words[index].bbox)))
      .map((index) => `${index}:${fixture.words[index].text}`);
    assert.deepEqual(
      missing,
      [],
      `DE IBAN words left uncovered after phone suppress: ${missing.join(", ")}`
    );
  });

  it("covers every DE IBAN word after editor suppress (checksum fail)", () => {
    const fixture = fixtureDeChecksumFailIban();
    const result = runEditorLikeScan(fixture);
    const missing = fixture.ibanWordIndices
      .filter((index) => !result.rects.some((rect) => covers(rect, fixture.words[index].bbox)))
      .map((index) => `${index}:${fixture.words[index].text}`);
    assert.deepEqual(
      missing,
      [],
      `DE checksum-fail IBAN words left uncovered: ${missing.join(", ")}`
    );
  });

  it("covers every GB IBAN word including WEST letter block", () => {
    const fixture = fixtureGbValidIban();
    const result = runEditorLikeScan(fixture);
    const missing = fixture.ibanWordIndices
      .filter((index) => !result.rects.some((rect) => covers(rect, fixture.words[index].bbox)))
      .map((index) => `${index}:${fixture.words[index].text}`);
    assert.deepEqual(
      missing,
      [],
      `GB IBAN words left uncovered: ${missing.join(", ")}`
    );
  });

  it("still detects a phone that is not inside an IBAN", () => {
    const phoneLine = {
      id: "0-0-0",
      text: "Tel : 0555 123 4567",
      confidence: 92,
      bbox: { x0: 10, y0: 20, x1: 250, y1: 36, x: 10, y: 20, width: 240, height: 16 },
      words: [
        { text: "Tel", confidence: 92, bbox: { x0: 10, y0: 20, x1: 40, y1: 36 }, lineId: "0-0-0", lineIndex: 0, wordIndex: 0 },
        { text: ":", confidence: 92, bbox: { x0: 48, y0: 20, x1: 56, y1: 36 }, lineId: "0-0-0", lineIndex: 0, wordIndex: 1 },
        { text: "0555", confidence: 92, bbox: { x0: 64, y0: 20, x1: 112, y1: 36 }, lineId: "0-0-0", lineIndex: 0, wordIndex: 2 },
        { text: "123", confidence: 92, bbox: { x0: 120, y0: 20, x1: 156, y1: 36 }, lineId: "0-0-0", lineIndex: 0, wordIndex: 3 },
        { text: "4567", confidence: 92, bbox: { x0: 164, y0: 20, x1: 212, y1: 36 }, lineId: "0-0-0", lineIndex: 0, wordIndex: 4 },
      ],
      blockIndex: 0,
      paragraphIndex: 0,
      lineIndex: 0,
    };
    const fixture = {
      id: "standalone-phone",
      imageWidth: 900,
      imageHeight: 160,
      lines: [phoneLine],
      words: phoneLine.words,
    };
    const result = runEditorLikeScan(fixture);
    const phones = result.detections.filter((item) => item.type === "phone");
    assert.ok(phones.length >= 1, "expected a standalone phone detection");
    assert.ok(phones.some((item) => item.autoApplied), "standalone phone should auto-apply");
  });

  it("does not auto-redact id=1000; in SQL (glued equals form)", () => {
    const fixture = fixtureSqlIdEquals1000();
    const result = runEditorLikeScan(fixture);
    const autoSpans = result.detections
      .filter((item) => item.autoApplied)
      .map((item) => item.span);
    assert.equal(
      autoSpans.some((span) => /1000/.test(span)),
      false,
      `SQL id=1000; was auto-applied via: ${autoSpans.join(" | ")}`
    );
  });

  it("does not auto-redact OCR-spaced SQL id 1000 via custom-id", () => {
    const fixture = fixtureSqlIdSpace1000Ocr();
    const result = runEditorLikeScan(fixture);
    const autoSpans = result.detections
      .filter((item) => item.autoApplied)
      .map((item) => `${item.ruleId || item.type}:${item.span}`);
    assert.equal(
      autoSpans.length,
      0,
      `SQL id 1000 OCR variant was auto-applied via: ${autoSpans.join(" | ")}`
    );
    const customId = result.detections.find((item) =>
      item.ruleId === "custom-id" || /id 1000/i.test(item.span)
    );
    assert.ok(customId, "custom-id should still be emitted for review");
    assert.equal(customId.needsReview, true);
    assert.ok(customId.warnings.includes(CUSTOM_ID_REVIEW_WARNING));
  });

  it("lets the user redact a review-only custom-id from the review list", () => {
    const fixture = fixtureSqlIdSpace1000Ocr();
    const result = runEditorLikeScan(fixture);
    const customId = result.rawDetections.find((item) =>
      item.ruleId === "custom-id" || /id 1000/i.test(item.text)
    );
    assert.ok(customId);
    assert.equal(customId.review?.needsReview, true);
    assert.deepEqual(detectionsForAutomaticRedaction([customId]), []);
    // confirmed=true is the review-list path when the user accepts a suggestion.
    const confirmed = detectionsForAutomaticRedaction([customId], true);
    assert.deepEqual(confirmed, [customId]);
    const reviewRects = confirmed.map((detection) => ({
      x: detection.normX * fixture.imageWidth,
      y: detection.normY * fixture.imageHeight,
      width: detection.normWidth * fixture.imageWidth,
      height: detection.normHeight * fixture.imageHeight,
    })).filter((rect) => rect.width > 0 && rect.height > 0);
    assert.ok(reviewRects.length >= 1, "review confirmation must produce a redaction rect");
  });

  it("keeps unlabeled Sipariş No / Referans 10-digit numbers as needsReview only", () => {
    const fixture = fixtureOrderAndReferenceNumbers();
    const result = runEditorLikeScan(fixture);
    const digitDetections = result.detections.filter((item) =>
      /1111111111|5432109876/.test(item.span)
    );
    assert.ok(digitDetections.length >= 2, "expected VKN detections for both numbers");
    for (const detection of digitDetections) {
      assert.equal(detection.needsReview, true, detection.span);
      assert.equal(detection.autoApplied, false, detection.span);
    }
    assert.equal(result.automatic.length, 0);
  });
});
