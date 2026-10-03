import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IBAN_CHECKSUM_FAILED_WARNING,
  buildDetectionReview,
  detectionsForAutomaticRedaction,
  ibanReviewHints,
  isValidIban,
} from "../src/js/sensitive-detectors.js";
import {
  createDetection,
  detectStructuredDataFromLines,
} from "../src/js/structured-lines.js";
import {
  fixtureTrOneLineMod97Fail,
  fixtureTrOneLineWideGap,
  fixtureTrTwoLineSplit,
} from "./fixtures/iban-ocr-words.js";

const PROFILE = "global-turkey";

function scan(fixture) {
  const imageSize = { width: fixture.imageWidth, height: fixture.imageHeight };
  const linesById = new Map(fixture.lines.map((line) => [line.id, line]));
  return detectStructuredDataFromLines(fixture.lines, {
    profileId: PROFILE,
    imageSize,
    linesById,
  });
}

describe("IBAN checksum policy", () => {
  it("auto-applies checksum-valid IBANs without ibanPatternOnly", () => {
    const hints = ibanReviewHints("DE89370400440532013000");
    assert.equal(hints.ibanChecksumValid, true);
    assert.equal(hints.ibanPatternOnly, undefined);
    const review = buildDetectionReview({
      type: "custom_rule",
      text: hints.text,
      confidence: 90,
      ibanChecksumValid: true,
    });
    assert.equal(review.needsReview, undefined);
    assert.equal(review.validation, "checksum");
    assert.deepEqual(detectionsForAutomaticRedaction([{ review }]), [{ review }]);
  });

  it("auto-applies structure-valid checksum failures with the checksum warning", () => {
    const iban = "TR330006100519786457841327";
    assert.equal(isValidIban(iban).structureValid, true);
    assert.equal(isValidIban(iban).checksumValid, false);
    const hints = ibanReviewHints(iban);
    assert.equal(hints.ibanChecksumFailed, true);
    assert.equal(hints.ibanPatternOnly, undefined);
    const review = buildDetectionReview({
      type: "custom_rule",
      text: hints.text,
      confidence: 90,
      ibanChecksumFailed: true,
    });
    assert.equal(review.needsReview, undefined);
    assert.ok(review.warnings.includes(IBAN_CHECKSUM_FAILED_WARNING));
    assert.deepEqual(detectionsForAutomaticRedaction([{ review, text: iban }]).map((item) => item.text), [iban]);
  });

  it("keeps structure-invalid pattern matches as needsReview only", () => {
    const hints = ibanReviewHints("TR33 0006 1005 1978 6457");
    assert.equal(hints.ibanPatternOnly, true);
    const review = buildDetectionReview({
      type: "custom_rule",
      text: hints.text,
      confidence: 90,
      ibanPatternOnly: true,
    });
    assert.equal(review.needsReview, true);
    assert.deepEqual(detectionsForAutomaticRedaction([{ review }]), []);
  });

  it("uses a single-glyph repair and auto-applies the repaired value", () => {
    const hints = ibanReviewHints("DE89370400440532O13000");
    assert.equal(hints.text, "DE89370400440532013000");
    assert.equal(hints.ibanChecksumValid, true);
    assert.equal(hints.ocrCorrected, true);
  });

  it("auto-applies the wide-gap TR fixture via structured lines", () => {
    const detections = scan(fixtureTrOneLineWideGap());
    const ibans = detections.filter((item) => item.ruleId === "iban" || /IBAN/i.test(item.label || ""));
    const automatic = detectionsForAutomaticRedaction(ibans);
    assert.ok(automatic.length >= 1);
    assert.ok(automatic.some((item) => !item.review?.needsReview));
    assert.ok(automatic.some((item) => /TR33/.test(item.text) && /8413/.test(item.text)));
  });

  it("auto-applies mod97-fail TR fixture with checksum warning", () => {
    const detections = scan(fixtureTrOneLineMod97Fail());
    const iban = detections.find((item) => /9012/.test(item.text));
    assert.ok(iban);
    assert.equal(iban.review?.needsReview, undefined);
    assert.ok(iban.review?.warnings?.includes(IBAN_CHECKSUM_FAILED_WARNING));
    assert.deepEqual(detectionsForAutomaticRedaction([iban]), [iban]);
  });

  it("emits one cross-line IBAN spanning both lines for tr-two-line-split", () => {
    const fixture = fixtureTrTwoLineSplit();
    const detections = scan(fixture);
    const iban = detections.find((item) =>
      item.ruleId === "iban" && /8413/.test(item.text) && /26/.test(item.text)
    );
    assert.ok(iban, "expected joined cross-line IBAN");
    assert.equal(iban.review?.needsReview, undefined);
    const imageSize = { width: fixture.imageWidth, height: fixture.imageHeight };
    const box = {
      x0: iban.normX * imageSize.width,
      y0: iban.normY * imageSize.height,
      x1: (iban.normX + iban.normWidth) * imageSize.width,
      y1: (iban.normY + iban.normHeight) * imageSize.height,
    };
    for (const index of [8, 9]) {
      const word = fixture.words[index];
      assert.ok(box.x0 <= word.bbox.x0 + 0.5 && box.x1 >= word.bbox.x1 - 0.5
        && box.y0 <= word.bbox.y0 + 0.5 && box.y1 >= word.bbox.y1 - 0.5,
      `joined detection must cover ${word.text}`);
    }
    assert.equal(typeof createDetection, "function");
  });
});
