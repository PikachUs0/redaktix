import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDetectionReview,
  cloneDetectionForHistory,
  detectPhonesInScan,
  phoneReviewHints,
} from "../src/js/sensitive-detectors.js";

describe("detection review metadata", () => {
  it("keeps OCR confidence separate from checksum validation", () => {
    const review = buildDetectionReview({
      type: "tckn",
      text: "10000000146",
      confidence: 42,
    });
    assert.equal(review.ocrConfidence, 42);
    assert.equal(review.validation, "checksum");
    assert.equal(review.labelBased, false);
    assert.deepEqual(review.warnings, [
      "OCR confidence is low. That percentage does not prove this value is correct.",
    ]);
  });

  it("warns when a labeled identity number fails the checksum", () => {
    const review = buildDetectionReview({
      type: "tckn",
      text: "10000000050",
      confidence: 91,
      labelBased: true,
    });
    assert.equal(review.validation, "contextual");
    assert.equal(review.labelBased, true);
    assert.equal(review.warnings[0], "Shown because of a nearby identity label. The checksum did not match.");
  });

  it("marks a labeled phone whose trunk letter was corrected", () => {
    const hints = phoneReviewHints("Tel: O 555 123 4567", "0 555 123 4567");
    const review = buildDetectionReview({
      type: "phone",
      text: "0 555 123 4567",
      confidence: 88,
      ...hints,
    });
    assert.equal(hints.ocrCorrected, true);
    assert.equal(hints.labelBased, true);
    assert.equal(hints.carrierSkipped, false);
    assert.equal(review.validation, "pattern");
    assert.equal(review.ocrCorrected, true);
    assert.deepEqual(review.warnings, [
      "OCR changed a character in this value. Compare it with the image.",
    ]);
  });

  it("warns when a phone label keeps an unconfirmed carrier prefix", () => {
    const hints = phoneReviewHints("Tel: 0 585 123 4567", "0 585 123 4567");
    const review = buildDetectionReview({
      type: "phone",
      text: "0 585 123 4567",
      confidence: 90,
      ...hints,
    });
    assert.equal(hints.carrierSkipped, true);
    assert.equal(review.validation, "contextual");
    assert.equal(review.warnings[0], "Shown because of a phone label. The carrier prefix was not confirmed.");
  });

  it("marks a short explicit credential as truncated and leaves a full token unmarked", () => {
    const truncated = buildDetectionReview({
      type: "api_token",
      text: "sk_live_51H7xK2aBcDeF",
      confidence: 96,
    });
    const complete = buildDetectionReview({
      type: "api_token",
      text: "ghp_abcdefghijklmnopqrst",
      confidence: 96,
    });
    assert.equal(truncated.truncated, true);
    assert.equal(truncated.validation, "pattern");
    assert.equal(truncated.warnings[0], "This credential looks incomplete. Confirm the full value before sharing.");
    assert.equal(complete.truncated, false);
    assert.deepEqual(complete.warnings, []);
  });

  it("states that a built-in IBAN match was not checksum-validated", () => {
    const review = buildDetectionReview({
      type: "custom_rule",
      text: "TR 12 0000 0000 0000 0000 0000 12",
      confidence: 95,
      ibanPatternOnly: true,
    });
    assert.equal(review.needsReview, true);
    assert.equal(review.validation, "unverified");
    assert.equal(review.patternMatched, true);
    assert.equal(review.ocrConfidence, 95);
    assert.deepEqual(review.warnings, [
      "This value matches an IBAN pattern, but its checksum was not validated.",
    ]);
  });

  it("does not treat another custom rule as an unverified IBAN", () => {
    const review = buildDetectionReview({
      type: "custom_rule",
      text: "INV-12345",
      confidence: 95,
    });
    assert.equal(review.validation, "pattern");
    assert.equal(review.needsReview, undefined);
    assert.equal(review.patternMatched, undefined);
    assert.deepEqual(review.warnings, []);
  });

  it("describes names and locations as contextual suggestions", () => {
    const review = buildDetectionReview({
      type: "person_name",
      text: "Cenk Kaya",
      confidence: 93,
    });
    assert.equal(review.validation, "contextual");
    assert.equal(review.warnings[0], "Suggested from surrounding context. This is not confirmed by a checksum.");
  });

  it("copies review metadata for history without sharing the warning list", () => {
    const detection = {
      id: "detection-1",
      type: "phone",
      label: "Possible phone number",
      text: "0 555 123 4567",
      confidence: 88,
      normX: 0.1,
      normY: 0.2,
      normWidth: 0.3,
      normHeight: 0.05,
      review: buildDetectionReview({
        type: "phone",
        text: "0 555 123 4567",
        confidence: 88,
        ocrCorrected: true,
      }),
    };
    const copy = cloneDetectionForHistory(detection);
    copy.review.warnings.push("changed");
    assert.equal(detection.review.warnings.includes("changed"), false);
    assert.equal(copy.isFlashing, false);
    assert.equal(copy.text, detection.text);
    assert.equal(copy.normX, detection.normX);

    const older = cloneDetectionForHistory({
      id: "detection-2",
      type: "email",
      text: "a@example.com",
      confidence: 80,
      normX: 0,
      normY: 0,
      normWidth: 0.1,
      normHeight: 0.1,
    });
    assert.equal(older.review, undefined);
    assert.equal(older.isFlashing, false);
  });

  it("adds review metadata to a scanned phone without changing the detection box", () => {
    const words = [
      { text: "Tel", lineId: "0-0-4", confidence: 91, bbox: { x0: 12, y0: 100, x1: 48, y1: 124 } },
      { text: "O", lineId: "0-0-4", confidence: 88, bbox: { x0: 62, y0: 100, x1: 76, y1: 124 } },
      { text: "555", lineId: "0-0-4", confidence: 90, bbox: { x0: 87, y0: 100, x1: 123, y1: 124 } },
      { text: "123", lineId: "0-0-4", confidence: 87, bbox: { x0: 135, y0: 100, x1: 171, y1: 124 } },
      { text: "4567", lineId: "0-0-4", confidence: 86, bbox: { x0: 182, y0: 100, x1: 230, y1: 124 } },
    ];
    const detections = detectPhonesInScan(words, 1000, 400);
    assert.equal(detections.length, 1);
    assert.equal(detections[0].text, "0 555 123 4567");
    assert.equal(detections[0].normX, 0.062);
    assert.equal(detections[0].review.ocrCorrected, true);
    assert.equal(detections[0].review.validation, "pattern");
    assert.equal(detections[0].review.ocrConfidence, 86);
    assert.notEqual(detections[0].review.validation, "checksum");
  });
});
