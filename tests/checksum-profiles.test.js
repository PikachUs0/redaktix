import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_DETECTION_PROFILE,
  filterDetectionsForProfile,
  isDetectorEnabled,
} from "../src/js/detection-profiles.js";
import { blackoutDetections } from "../src/js/app.js";
import {
  VKN_UNLABELED_CHECKSUM_WARNING,
  detectVkn,
  detectionsForAutomaticRedaction,
  extractIbanCandidates,
  findTcknMatches,
  isValidTckn,
} from "../src/js/sensitive-detectors.js";

const MODE = DEFAULT_DETECTION_PROFILE;

const VALID_IBANS = [
  "DE89 3704 0044 0532 0130 00",
  "DE89370400440532013000",
  "TR33 0006 1005 1978 6457 8413 26",
  "TR330006100519786457841326",
];

const VALID_TCKN = "10000000146";
const VALID_VKN = "1234567890";
const VALID_VKN_NONZERO = "2468013578";
const INVALID_VKN = "1111111111";

function compact(value) {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function ibanMod97Ok(value) {
  const body = compact(value);
  const rearranged = body.slice(4) + body.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const digits = /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

function vknChecksumOk(value) {
  const digits = String(value || "");
  if (!/^\d{10}$/.test(digits)) return false;
  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    const tmp = (Number(digits[index]) + (9 - index)) % 10;
    let contribution = (tmp * (2 ** (9 - index))) % 9;
    if (tmp !== 0 && contribution === 0) contribution = 9;
    sum += contribution;
  }
  return ((10 - (sum % 10)) % 10) === Number(digits[9]);
}

function hasVergiLabel(value) {
  return /vergi|\bvkn\b/i.test(String(value || ""));
}

function scan(value) {
  const detections = [];
  if (isDetectorEnabled(MODE, "tckn")) {
    for (const match of findTcknMatches(value)) {
      detections.push({ type: "tckn", text: match.text });
    }
  }
  if (isDetectorEnabled(MODE, "vkn")) {
    detections.push(...detectVkn(value));
  }
  if (isDetectorEnabled(MODE, "iban") || isDetectorEnabled(MODE, "custom_rule")) {
    for (const text of extractIbanCandidates(value)) {
      detections.push({ type: isDetectorEnabled(MODE, "iban") ? "iban" : "custom_rule", text });
    }
  }
  return filterDetectionsForProfile(detections, MODE);
}

function keptCompact(value) {
  return scan(value)
    .filter((detection) => !detection.review?.needsReview)
    .map((detection) => compact(detection.text));
}

describe("checksum detectors in single mode", () => {
  it("keeps a full valid IBAN with and without spaces", () => {
    for (const iban of VALID_IBANS) {
      assert.equal(ibanMod97Ok(iban), true, iban);
      assert.ok(
        keptCompact(iban).includes(compact(iban)),
        `single mode missed ${iban}`
      );
    }
  });

  it("keeps checksum-valid TCKN 10000000146", () => {
    assert.equal(isValidTckn(VALID_TCKN), true);
    assert.ok(keptCompact(VALID_TCKN).includes(VALID_TCKN));
  });

  it("keeps a checksum-valid VKN", () => {
    assert.equal(vknChecksumOk(VALID_VKN), true);
    assert.equal(vknChecksumOk(VALID_VKN_NONZERO), true);
    for (const vkn of [VALID_VKN, VALID_VKN_NONZERO]) {
      assert.ok(keptCompact(vkn).includes(vkn), `missed ${vkn}`);
    }
  });

  it("keeps a checksum-failing VKN when a Vergi or VKN label precedes it", () => {
    assert.equal(vknChecksumOk(INVALID_VKN), false);
    const labeled = [`Vergi No: ${INVALID_VKN}`, `VKN: ${INVALID_VKN}`];
    for (const source of labeled) {
      assert.equal(hasVergiLabel(source), true);
      assert.ok(keptCompact(source).includes(INVALID_VKN), `missed labeled ${source}`);
    }
  });

  it("drops a checksum-failing VKN that has no Vergi or VKN label unless one OCR glyph repairs it", () => {
    assert.equal(vknChecksumOk(INVALID_VKN), false);
    assert.equal(hasVergiLabel(INVALID_VKN), false);
    assert.equal(keptCompact(INVALID_VKN).includes(INVALID_VKN), false);
    assert.ok(keptCompact("123456789O").includes(VALID_VKN));
    assert.equal(keptCompact("12345678OO").includes(VALID_VKN), false);
  });

  it("emits an unlabeled checksum failure for review and leaves it out of automatic redaction", () => {
    const [detection] = detectVkn(INVALID_VKN);
    assert.equal(detection.text, INVALID_VKN);
    assert.equal(detection.review.needsReview, true);
    assert.equal(detection.review.lowConfidence, true);
    assert.deepEqual(detection.review.warnings, [VKN_UNLABELED_CHECKSUM_WARNING]);
    assert.deepEqual(detectionsForAutomaticRedaction([detection]), []);
    assert.deepEqual(detectionsForAutomaticRedaction([detection], true), [detection]);
    assert.deepEqual(blackoutDetections([
      { ...detection, normX: 0.1, normY: 0.1, normWidth: 0.2, normHeight: 0.05 },
    ], 200, 100), []);
  });

  it("treats a two-glyph VKN repair as a review-only detection", () => {
    const [detection] = detectVkn("12345678OO");
    assert.equal(detection.review.needsReview, true);
    assert.equal(detection.review.lowConfidence, true);
    assert.deepEqual(detection.review.warnings, [VKN_UNLABELED_CHECKSUM_WARNING]);
    assert.deepEqual(detectionsForAutomaticRedaction([detection]), []);
    assert.equal(keptCompact("12345678OO").includes(VALID_VKN), false);
  });

  it("still keeps an IBAN whose country length is right and whose mod-97 check fails", () => {
    const broken = ["DE89370400440532013001", "TR330006100519786457841327"];
    for (const iban of broken) {
      assert.equal(ibanMod97Ok(iban), false, iban);
      assert.ok(
        keptCompact(iban).includes(compact(iban)),
        `missed recall IBAN ${iban}`
      );
    }
  });
});
