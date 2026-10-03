import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blackoutDetections } from "../src/js/app.js";
import { suppressShadowedDetections } from "../src/js/detection-suppression.js";
import {
  CUSTOM_ID_REVIEW_WARNING,
  detectionsForAutomaticRedaction,
  detectGroupedSecretsInScan,
  detectPhonesInScan,
  extractIbanCandidates,
  isValidIban,
} from "../src/js/sensitive-detectors.js";
import {
  detectStructuredDataFromLines,
  extractPhoneCandidatesForLines,
} from "../src/js/structured-lines.js";
import {
  fixtureCustomIdHyphen1000,
  fixtureGbOcrCountrySixAsG,
  fixtureGbOcrSixUnlabeledChecksumFail,
  fixtureOrderCodeNotIban,
  fixtureUnlabeledSixB82Elsewhere,
} from "./fixtures/regression-ocr-lines.js";

const PROFILE = "global-turkey";

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

function runEditorLikeScan(fixture) {
  const imageSize = { width: fixture.imageWidth, height: fixture.imageHeight };
  const structured = detectStructuredDataFromLines(fixture.lines, {
    profileId: PROFILE,
    imageSize,
    linesById: new Map(fixture.lines.map((line) => [line.id, line])),
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
  const afterSuppress = suppressShadowedDetections([...grouped, ...phones, ...structured]);
  const automatic = detectionsForAutomaticRedaction(afterSuppress);
  return {
    detections: afterSuppress,
    automatic,
    rects: blackoutDetections(afterSuppress, fixture.imageWidth, fixture.imageHeight),
  };
}

describe("IBAN country-code OCR repair (G read as 6)", () => {
  it("auto-redacts all 6 value words for labeled 6B82 WEST GB IBAN", () => {
    const fixture = fixtureGbOcrCountrySixAsG();
    assert.equal(fixture.lineText, "IBAN (GB) 6B82 WEST 1234 5698 7654 32");
    assert.deepEqual(
      fixture.words.map((word) => word.text),
      ["IBAN", "(GB)", "6B82", "WEST", "1234", "5698", "7654", "32"]
    );
    assert.equal(isValidIban("GB82WEST12345698765432").checksumValid, true);

    const result = runEditorLikeScan(fixture);
    const missing = fixture.ibanWordIndices
      .filter((index) => !result.rects.some((rect) => covers(rect, fixture.words[index].bbox)))
      .map((index) => `${index}:${fixture.words[index].text}`);
    assert.deepEqual(
      missing,
      [],
      `GB OCR 6B82 words left uncovered: ${missing.join(", ")}`
    );
    assert.ok(result.automatic.some((detection) => detection.ruleId === "iban"));
  });

  it("does not auto-apply unlabeled 6B82… with failing checksum after country repair", () => {
    const fixture = fixtureGbOcrSixUnlabeledChecksumFail();
    assert.equal(isValidIban("GB82WEST12345698765433").checksumValid, false);
    assert.equal(isValidIban("GB82WEST12345698765433").structureValid, true);
    const result = runEditorLikeScan(fixture);
    const autoIban = result.automatic.filter((detection) =>
      detection.ruleId === "iban" || /6B82|GB82/i.test(detection.text)
    );
    assert.deepEqual(autoIban, []);
  });

  it("leaves order codes like AB12 3456 7890 CD untouched", () => {
    const fixture = fixtureOrderCodeNotIban();
    assert.deepEqual(extractIbanCandidates(fixture.lineText), []);
    const result = runEditorLikeScan(fixture);
    assert.equal(
      result.detections.filter((detection) => detection.ruleId === "iban").length,
      0
    );
    assert.deepEqual(result.automatic, []);
  });

  it("keeps id-1000 as review-only custom-id", () => {
    const fixture = fixtureCustomIdHyphen1000();
    const result = runEditorLikeScan(fixture);
    const customId = result.detections.find((detection) =>
      detection.ruleId === "custom-id" || /id-1000/i.test(detection.text)
    );
    assert.ok(customId, "expected custom-id detection for id-1000");
    assert.equal(customId.review?.needsReview, true);
    assert.ok(customId.review?.warnings?.includes(CUSTOM_ID_REVIEW_WARNING));
    assert.deepEqual(detectionsForAutomaticRedaction([customId]), []);
  });

  it("does not redact an unlabeled short 6B82-like string elsewhere", () => {
    const fixture = fixtureUnlabeledSixB82Elsewhere();
    const result = runEditorLikeScan(fixture);
    assert.equal(
      result.automatic.filter((detection) => /6B82/i.test(detection.text)).length,
      0
    );
    assert.equal(
      result.rects.filter((rect) => covers(rect, fixture.words[2].bbox)).length,
      0
    );
  });
});
