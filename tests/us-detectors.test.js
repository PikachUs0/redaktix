import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDetectionReview,
  detectionsForAutomaticRedaction,
  detectRoutingNumber,
  detectSsn,
  extractRoutingNumberCandidates,
  extractSsnCandidates,
  hasAbaRoutingPrefix,
  isValidAbaRoutingNumber,
  isValidSsn,
} from "../src/js/sensitive-detectors.js";

const VALID_SSN = "123-45-6789";
const BARE_SSN = "123456789";
const VALID_ROUTING = "021000021";
const VALID_ROUTING_2 = "011000015";
const INVALID_ROUTING = "123456789";

describe("US SSN detector", () => {
  it("validates SSN area/group/serial rules", () => {
    assert.equal(isValidSsn("123-45-6789"), true);
    assert.equal(isValidSsn(BARE_SSN), true);
    assert.equal(isValidSsn("000-45-6789"), false);
    assert.equal(isValidSsn("666-45-6789"), false);
    assert.equal(isValidSsn("900-45-6789"), false);
    assert.equal(isValidSsn("123-00-6789"), false);
    assert.equal(isValidSsn("123-45-0000"), false);
    assert.equal(isValidSsn("12345"), false);
  });

  it("accepts hyphenated SSNs as strings", () => {
    const found = extractSsnCandidates(`Name: Jane\nSSN: ${VALID_SSN}`);
    assert.ok(found.includes(VALID_SSN));
    assert.equal(found.every((item) => typeof item === "string"), true);
  });

  it("accepts a labeled 9-digit block but flags an unlabeled one for review", () => {
    const labeled = extractSsnCandidates(`SSN ${BARE_SSN}`);
    assert.ok(labeled.includes(BARE_SSN));

    const unlabeled = extractSsnCandidates(`Reference ${BARE_SSN} on file`);
    assert.equal(unlabeled.every((item) => typeof item === "object"), true);
    assert.equal(unlabeled[0].text, BARE_SSN);
    assert.equal(unlabeled[0].needsReview, true);
  });

  it("marks unlabeled SSNs as needsReview and excludes them from auto-redaction", () => {
    const detections = detectSsn(`Reference ${BARE_SSN} on file`);
    assert.equal(detections[0].type, "ssn");
    assert.equal(detections[0].review.needsReview, true);
    assert.equal(detections[0].review.validation, "unverified");
    assert.deepEqual(detectionsForAutomaticRedaction(detections), []);

    const labeled = detectSsn(`SSN ${VALID_SSN}`);
    assert.equal(Boolean(labeled[0].review?.needsReview), false);
    assert.equal(detectionsForAutomaticRedaction(labeled).length, 1);
  });
});

describe("US ABA routing number detector", () => {
  it("requires a valid ABA prefix and checksum", () => {
    assert.equal(hasAbaRoutingPrefix(VALID_ROUTING), true);
    assert.equal(hasAbaRoutingPrefix("991234567"), false);
    assert.equal(isValidAbaRoutingNumber(VALID_ROUTING), true);
    assert.equal(isValidAbaRoutingNumber(VALID_ROUTING_2), true);
    assert.equal(isValidAbaRoutingNumber(INVALID_ROUTING), false);
  });

  it("detects checksum-valid routing numbers as auto-redactable", () => {
    const detections = detectRoutingNumber(`Routing (ABA): ${VALID_ROUTING}\nAccount: 000123456789`);
    assert.equal(detections.some((item) => item.text === VALID_ROUTING), true);
    const routing = detections.find((item) => item.text === VALID_ROUTING);
    assert.equal(routing.type, "routing_number");
    assert.equal(Boolean(routing.review?.needsReview), false);
    assert.equal(detectionsForAutomaticRedaction(detections).some((item) => item.text === VALID_ROUTING), true);
    assert.equal(buildDetectionReview({ type: "routing_number", text: VALID_ROUTING }).validation, "checksum");
  });

  it("drops a bad-checksum number unless a routing label is present", () => {
    assert.deepEqual(extractRoutingNumberCandidates(INVALID_ROUTING), []);
    const labeled = extractRoutingNumberCandidates(`Routing number ${INVALID_ROUTING}`);
    assert.equal(labeled.length, 1);
    assert.equal(labeled[0].needsReview, true);
  });
});

describe("review wiring for US detectors", () => {
  it("flags unlabeled SSN and failed routing checksum warnings", () => {
    const ssn = buildDetectionReview({ type: "ssn", text: BARE_SSN, ssnUnlabeled: true });
    assert.equal(ssn.needsReview, true);
    assert.equal(ssn.patternMatched, true);

    const routing = buildDetectionReview({ type: "routing_number", text: INVALID_ROUTING, routingUnlabeled: true });
    assert.equal(routing.needsReview, true);
    assert.equal(routing.patternMatched, true);
  });
});
