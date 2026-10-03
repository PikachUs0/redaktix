/**
 * Single detection mode (global-turkey): no profile menu; ALWAYS_ON retained.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_DETECTION_PROFILE,
  DETECTION_PROFILE_STORAGE_KEY,
  isAlwaysOnDetector,
  isDetectorEnabled,
  normalizeDetectionProfile,
  readStoredDetectionProfile,
  writeStoredDetectionProfile,
} from "../src/js/detection-profiles.js";
import { messages } from "../src/js/i18n.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EDITOR_JS = readFileSync(join(ROOT, "src/js/editor.js"), "utf8");
const EDITOR_HTML = readFileSync(join(ROOT, "editor.html"), "utf8");

describe("single detection mode", () => {
  it("removes the profile dropdown from editor UI sources", () => {
    assert.doesNotMatch(EDITOR_JS, /detectionProfileSelect/);
    assert.doesNotMatch(EDITOR_JS, /editor-profile-selector/);
    assert.doesNotMatch(EDITOR_HTML, /detectionProfileSelect/);
    assert.doesNotMatch(EDITOR_HTML, /editor-profile-selector/);
  });

  it("uses only global-turkey and ignores legacy storage without writing", () => {
    assert.equal(DEFAULT_DETECTION_PROFILE, "global-turkey");
    assert.equal(normalizeDetectionProfile("global"), "global-turkey");
    assert.equal(normalizeDetectionProfile("turkey"), "global-turkey");
    assert.equal(normalizeDetectionProfile("global-turkey"), "global-turkey");

    const values = new Map([
      [DETECTION_PROFILE_STORAGE_KEY, "turkey"],
      ["privacylab_detection_profile", "global"],
    ]);
    const storage = {
      getItem(key) {
        return values.has(key) ? values.get(key) : null;
      },
      setItem(key, value) {
        values.set(key, value);
      },
    };
    assert.equal(readStoredDetectionProfile(storage), "global-turkey");
    assert.equal(writeStoredDetectionProfile("turkey", storage), "global-turkey");
    assert.equal(values.get(DETECTION_PROFILE_STORAGE_KEY), "turkey", "must not overwrite/remove legacy key via write");
    assert.equal(readStoredDetectionProfile({
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
    }), "global-turkey");
  });

  it("keeps ALWAYS_ON detectors enabled in single mode", () => {
    for (const type of ["tckn", "vkn", "credit_card", "iban", "private_key", "bearer_token", "connection_url", "env_secret", "passport", "seed_phrase"]) {
      assert.equal(isAlwaysOnDetector(type), true, type);
      assert.equal(isDetectorEnabled("global-turkey", type), true, type);
      assert.equal(isDetectorEnabled("global", type), true, `${type} via legacy id`);
    }
  });

  it("exposes the always-scanned note near scan in TR/EN i18n", () => {
    assert.match(EDITOR_JS, /editor\.scanAlwaysOnNote|scanAlwaysOnNote/);
    assert.equal(
      messages.en["editor.scanAlwaysOnNote"],
      "Cards, IBAN, TCKN, VKN, API keys and private keys are always scanned."
    );
    assert.ok(messages.tr["editor.scanAlwaysOnNote"]);
    assert.match(messages.tr["editor.scanAlwaysOnNote"], /IBAN|TCKN|VKN/i);
  });
});
