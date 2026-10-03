import assert from "node:assert/strict";
import test from "node:test";
import { messages, normalizeLanguage } from "../src/js/i18n.js";

test("language follows an explicit choice, then Turkish browser locales, then English", () => {
  assert.equal(normalizeLanguage("tr", "en-US"), "tr");
  assert.equal(normalizeLanguage("en", "tr-TR"), "en");
  assert.equal(normalizeLanguage(null, "tr-TR"), "tr");
  assert.equal(normalizeLanguage("", "tr"), "tr");
  assert.equal(normalizeLanguage(undefined, "de-DE"), "en");
});

test("Turkish and English dictionaries cover the same interface keys", () => {
  assert.deepEqual(Object.keys(messages.tr).sort(), Object.keys(messages.en).sort());
});
