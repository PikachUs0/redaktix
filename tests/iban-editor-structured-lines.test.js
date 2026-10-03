import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blackoutDetections } from "../src/js/app.js";
import {
  IBAN_CHECKSUM_FAILED_WARNING,
  detectionsForAutomaticRedaction,
  extractCreditCardCandidates,
  extractIpv6Candidates,
  extractPhoneCandidates,
  getMatchBoundingBoxes,
  buildOcrCharacterIndex,
} from "../src/js/sensitive-detectors.js";
import {
  createDetection,
  detectStructuredDataFromLines,
  extractCreditCardCandidates as extractLineCards,
  extractPhoneCandidatesForLines,
} from "../src/js/structured-lines.js";
import {
  fixtureEuOneLineEditorCase,
  fixtureTrMonospaceConfidence,
  fixtureTrOneLineMod97Fail,
  fixtureTrOneLineWideGap,
  fixtureTrTwoLineSplit,
  IBAN_OCR_FIXTURES,
} from "./fixtures/iban-ocr-words.js";

const PROFILE = "global-turkey";

function wordIndicesForSpan(line, spanText) {
  const indexed = buildOcrCharacterIndex(line.words || []);
  const start = indexed.text.indexOf(spanText);
  if (start < 0) return [];
  const end = start + spanText.length;
  const indices = [];
  const seen = new Set();
  for (let index = start; index < end; index += 1) {
    const entry = indexed.chars[index];
    if (!entry?.word || seen.has(entry.word)) continue;
    seen.add(entry.word);
    indices.push(line.words.indexOf(entry.word));
  }
  return indices;
}

function rectFromDetection(detection, imageWidth, imageHeight) {
  return {
    x: detection.normX * imageWidth,
    y: detection.normY * imageHeight,
    width: detection.normWidth * imageWidth,
    height: detection.normHeight * imageHeight,
    x0: detection.normX * imageWidth,
    y0: detection.normY * imageHeight,
    x1: (detection.normX + detection.normWidth) * imageWidth,
    y1: (detection.normY + detection.normHeight) * imageHeight,
  };
}

function covers(rect, box, epsilon = 0.5) {
  return rect.x0 <= box.x0 + epsilon &&
    rect.y0 <= box.y0 + epsilon &&
    rect.x1 >= box.x1 - epsilon &&
    rect.y1 >= box.y1 - epsilon;
}

function summarizeFixture(fixture) {
  const imageSize = { width: fixture.imageWidth, height: fixture.imageHeight };
  const linesById = new Map(fixture.lines.map((line) => [line.id, line]));
  const detections = detectStructuredDataFromLines(fixture.lines, {
    profileId: PROFILE,
    imageSize,
    linesById,
  });
  const autoKept = detectionsForAutomaticRedaction(detections);
  const autoRects = blackoutDetections(detections, fixture.imageWidth, fixture.imageHeight);

  const listed = detections.map((detection) => {
    const line = fixture.lines.find((entry) => entry.lineIndex === detection.lineIndex) || fixture.lines[0];
    const span = detection.text;
    return {
      type: detection.type,
      emittedRuleId: detection.ruleId ?? null,
      span,
      wordIndices: wordIndicesForSpan(line, span),
      needsReview: Boolean(detection.review?.needsReview),
      ibanPatternOnly: Boolean(detection.review?.patternMatched),
      reviewValidation: detection.review?.validation ?? null,
      reviewWarnings: detection.review?.warnings || [],
      autoApplied: autoKept.includes(detection),
      rect: rectFromDetection(detection, fixture.imageWidth, fixture.imageHeight),
    };
  });

  const uncovered = fixture.ibanWordIndices.filter((index) => {
    const box = fixture.words[index].bbox;
    return !autoRects.some((rect) => covers({
      x0: rect.x,
      y0: rect.y,
      x1: rect.x + rect.width,
      y1: rect.y + rect.height,
    }, box));
  }).map((index) => ({
    index,
    text: fixture.words[index].text,
  }));

  return {
    fixture: fixture.id,
    detections: listed,
    autoAppliedRects: autoRects,
    uncoveredIbanWords: uncovered,
    subRunProbes: {
      credit_card_on_line: extractLineCards(fixture.lines.map((line) => line.text).join("\n")),
      credit_card_on_0006_group: extractCreditCardCandidates("0006 1005 1978 6457"),
      phone_editor_strip_on_line: extractPhoneCandidatesForLines(fixture.lines.map((line) => line.text).join("\n")),
      phone_raw_on_line: extractPhoneCandidates(fixture.lines.map((line) => line.text).join("\n")),
      ipv6_on_line: extractIpv6Candidates(fixture.lines.map((line) => line.text).join("\n")),
    },
  };
}

const FOCUS = [
  fixtureTrOneLineWideGap(),
  fixtureTrTwoLineSplit(),
  fixtureTrMonospaceConfidence(),
  fixtureTrOneLineMod97Fail(),
  fixtureEuOneLineEditorCase(),
];

describe("editor detectStructuredDataFromLines IBAN behavior", () => {
  it("exports the real createDetection and detectStructuredDataFromLines", () => {
    assert.equal(typeof createDetection, "function");
    assert.equal(typeof detectStructuredDataFromLines, "function");
  });

  it("auto-applies checksum-valid IBANs from structured lines", () => {
    for (const fixture of [fixtureTrOneLineWideGap(), fixtureEuOneLineEditorCase(), fixtureTrMonospaceConfidence()]) {
      const report = summarizeFixture(fixture);
      assert.equal(report.uncoveredIbanWords.length, 0, fixture.id);
      const iban = report.detections.find((item) => item.emittedRuleId === "iban" || /TR33|DE89/.test(item.span));
      assert.ok(iban, fixture.id);
      assert.equal(iban.needsReview, false, fixture.id);
      assert.equal(iban.autoApplied, true, fixture.id);
      assert.equal(iban.ibanPatternOnly, false, fixture.id);
    }
  });

  it("auto-applies mod97-fail with checksum warning", () => {
    const report = summarizeFixture(fixtureTrOneLineMod97Fail());
    const iban = report.detections.find((item) => /9012/.test(item.span));
    assert.ok(iban);
    assert.equal(iban.needsReview, false);
    assert.equal(iban.autoApplied, true);
    assert.ok(iban.reviewWarnings.includes(IBAN_CHECKSUM_FAILED_WARNING));
    assert.equal(report.uncoveredIbanWords.length, 0);
  });

  it("joins tr-two-line-split into one auto-applied IBAN covering 8413 and 26", () => {
    const fixture = fixtureTrTwoLineSplit();
    const report = summarizeFixture(fixture);
    const boxes = getMatchBoundingBoxes(fixture.words, fixture.expectedIban);
    assert.ok(Array.isArray(boxes), "per-line rects for cross-line IBAN");
    assert.equal(boxes.length, 2);
    assert.equal(report.uncoveredIbanWords.length, 0, JSON.stringify(report.uncoveredIbanWords));
    const iban = report.detections.find((item) => /8413/.test(item.span) && /26/.test(item.span));
    assert.ok(iban);
    assert.equal(iban.autoApplied, true);
  });

  for (const fixture of FOCUS) {
    it(`${fixture.id}: list detections, auto-applied rects, and uncovered IBAN words`, () => {
      const report = summarizeFixture(fixture);
      console.log(`\n===== EDITOR STRUCTURED LINES: ${fixture.id} =====`);
      console.log(JSON.stringify(report, null, 2));
      assert.ok(Array.isArray(report.detections));
    });
  }

  it("does not let credit-card / phone / ipv6 auto-apply inside IBAN tokens alone", () => {
    const findings = FOCUS.map((fixture) => {
      const report = summarizeFixture(fixture);
      return {
        fixture: fixture.id,
        autoAppliedNonIban: report.detections.filter((item) =>
          item.autoApplied && item.type !== "custom_rule"
        ),
        subRunProbes: report.subRunProbes,
      };
    });
    console.log("\n===== SUB-DETECTOR INSIDE IBAN =====");
    console.log(JSON.stringify(findings, null, 2));
    assert.equal(findings.every((entry) => entry.autoAppliedNonIban.length === 0), true);
  });

  it("covers every fixture id from IBAN_OCR_FIXTURES through the structured-line path", () => {
    for (const fixture of IBAN_OCR_FIXTURES) {
      const report = summarizeFixture(fixture);
      assert.ok(Array.isArray(report.detections));
    }
  });
});
