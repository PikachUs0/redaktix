import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALWAYS_ON_DETECTORS,
  DEFAULT_DETECTION_PROFILE,
  DETECTION_PROFILE_IDS,
  DETECTION_PROFILE_OPTIONS,
  DETECTION_PROFILE_STORAGE_KEY,
  detectionProfileLabel,
  filterDetectionsForProfile,
  getDetectionProfile,
  isAlwaysOnDetector,
  isDetectorEnabled,
  normalizeDetectionProfile,
  readStoredDetectionProfile,
  writeStoredDetectionProfile,
} from "../src/js/detection-profiles.js";

const SINGLE_MODE_DETECTORS = [
  "api_token",
  "email",
  "tckn",
  "vkn",
  "ipv4",
  "ipv6",
  "credit_card",
  "phone",
  "person_name",
  "location",
  "session_id",
  "custom_rule",
];

describe("single detection mode profile", () => {
  it("defaults to global-turkey and normalizes every id to single mode", () => {
    assert.deepEqual(DETECTION_PROFILE_IDS, {
      GLOBAL: "global",
      TURKEY: "turkey",
      GLOBAL_TURKEY: "global-turkey",
    });
    assert.equal(DEFAULT_DETECTION_PROFILE, "global-turkey");
    assert.equal(normalizeDetectionProfile("global"), "global-turkey");
    assert.equal(normalizeDetectionProfile("turkey"), "global-turkey");
    assert.equal(normalizeDetectionProfile("global-turkey"), "global-turkey");
    assert.equal(normalizeDetectionProfile("eu"), "global-turkey");
    assert.equal(Object.isFrozen(DETECTION_PROFILE_IDS), true);
  });

  it("exposes a single profile option label", () => {
    assert.deepEqual(
      DETECTION_PROFILE_OPTIONS.map((option) => option.id),
      ["global-turkey"]
    );
    assert.equal(detectionProfileLabel("turkey"), "Global + Turkey");
    assert.equal(detectionProfileLabel("not-a-profile"), "Global + Turkey");
  });

  it("returns the single-mode detector list for any requested id", () => {
    assert.deepEqual(getDetectionProfile().detectors, SINGLE_MODE_DETECTORS);
    assert.deepEqual(getDetectionProfile("global").detectors, SINGLE_MODE_DETECTORS);
    assert.deepEqual(getDetectionProfile("turkey").detectors, SINGLE_MODE_DETECTORS);
    assert.equal(getDetectionProfile("nope").id, DEFAULT_DETECTION_PROFILE);
    const profile = getDetectionProfile("global-turkey");
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(Object.isFrozen(profile.detectors), true);
    assert.throws(() => {
      profile.detectors.push("ipv6");
    }, TypeError);
  });

  it("keeps scan detectors and ALWAYS_ON types in single mode", () => {
    const detections = [
      { type: "api_token", text: "ghp_abcdefghijklmnopqrst" },
      { type: "email", text: "a@example.com" },
      { type: "tckn", text: "10000000146" },
      { type: "vkn", text: "1234567890" },
      { type: "person_name", text: "Cenk Kaya" },
      { type: "location", text: "Ankara" },
      { type: "phone", text: "05551234567" },
      { type: "custom_rule", text: "TR330006100519786457841326" },
      { type: "ipv4", text: "10.0.0.1" },
      { type: "private_key", text: "-----BEGIN PRIVATE KEY-----" },
      { type: "seed_phrase", text: "abandon ability able about above absent absorb abstract absurd abuse access accident" },
    ];
    assert.deepEqual(
      filterDetectionsForProfile(detections).map((detection) => detection.type),
      detections.map((detection) => detection.type)
    );
    assert.equal(isDetectorEnabled("global-turkey", "tckn"), true);
    assert.equal(isDetectorEnabled("global", "vkn"), true);
    assert.equal(isDetectorEnabled(undefined, "credit_card"), true);
    for (const type of ALWAYS_ON_DETECTORS) {
      assert.equal(isAlwaysOnDetector(type), true, type);
      assert.equal(isDetectorEnabled("global-turkey", type), true, type);
    }
  });
});

describe("legacy profile storage is ignored", () => {
  it("never writes a profile id and ignores stored legacy values", () => {
    const values = new Map();
    const storage = {
      getItem(key) {
        return values.has(key) ? values.get(key) : null;
      },
      setItem(key, value) {
        values.set(key, value);
      },
    };

    assert.equal(DETECTION_PROFILE_STORAGE_KEY, "redaktix_detection_profile");
    assert.equal(readStoredDetectionProfile(storage), "global-turkey");
    values.set(DETECTION_PROFILE_STORAGE_KEY, "turkey");
    assert.equal(readStoredDetectionProfile(storage), "global-turkey");
    assert.equal(writeStoredDetectionProfile("turkey", storage), "global-turkey");
    assert.equal(values.get(DETECTION_PROFILE_STORAGE_KEY), "turkey");
    assert.equal(values.size, 1);

    const blocked = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    assert.equal(readStoredDetectionProfile(blocked), DEFAULT_DETECTION_PROFILE);
    assert.equal(writeStoredDetectionProfile("turkey", blocked), DEFAULT_DETECTION_PROFILE);
    assert.equal(readStoredDetectionProfile(null), "global-turkey");
  });
});
