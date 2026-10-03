import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SAMPLE_CUSTOM_RULES,
  USER_CUSTOM_RULES_KEY,
  extractCustomRuleMatches,
  loadCustomRules,
  saveUserCustomRule,
  testCustomPattern,
} from "../src/js/custom-rules.js";
import { matchCustomRules } from "../src/js/sensitive-detectors.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

const LEGACY_IBAN_PATTERN = "\\b[A-Z]{2}\\d{2}[A-Z0-9]{11,30}\\b";

describe("custom rules", () => {
  it("matches a compact IBAN and an OCR-spaced Turkish IBAN", () => {
    const iban = SAMPLE_CUSTOM_RULES[0];
    assert.deepEqual(
      extractCustomRuleMatches(iban, "TR330006100519786457841326"),
      ["TR330006100519786457841326"]
    );
    assert.deepEqual(
      extractCustomRuleMatches(iban, "TR33 0006 1005 1978 6457 8413 26"),
      ["TR33 0006 1005 1978 6457 8413 26"]
    );
    assert.deepEqual(
      extractCustomRuleMatches(iban, "IBAN: TR 12 0000 0000 0000 0000 0000 12"),
      ["TR 12 0000 0000 0000 0000 0000 12"]
    );
  });

  it("upgrades the stored legacy IBAN pattern when the rule id is iban", () => {
    assert.deepEqual(
      extractCustomRuleMatches({
        id: "iban",
        label: "Possible IBAN",
        pattern: LEGACY_IBAN_PATTERN,
        flags: "g",
      }, "Account TR33 0006 1005 1978 6457 8413 26"),
      ["TR33 0006 1005 1978 6457 8413 26"]
    );
    assert.deepEqual(
      extractCustomRuleMatches({
        id: "iban",
        label: "Possible IBAN",
        pattern: "\\b[A-Z]{2}\\d{2}(?:[A-Z0-9]{11,30}|(?: [A-Z0-9]{4}){5} [A-Z0-9]{2})\\b",
        flags: "g",
      }, "IBAN: TR 12 0000 0000 0000 0000 0000 12"),
      ["TR 12 0000 0000 0000 0000 0000 12"]
    );
  });

  it("still matches the sample custom id rule", () => {
    assert.deepEqual(extractCustomRuleMatches(SAMPLE_CUSTOM_RULES[1], "INV-12345"), ["INV-12345"]);
  });

  it("stores user rules separately and keeps built-in rules in the scan set", () => {
    const storage = memoryStorage();
    const saved = saveUserCustomRule({
      id: "falcon",
      name: "Project Falcon",
      pattern: "FALCON",
      type: "keyword",
      enabled: true,
    }, storage);
    assert.equal(saved.ok, true);
    assert.equal(USER_CUSTOM_RULES_KEY, "redaktix_custom_rules");
    const stored = JSON.parse(storage.getItem(USER_CUSTOM_RULES_KEY));
    assert.deepEqual(stored.map((rule) => rule.id), ["falcon"]);
    assert.equal(stored.some((rule) => rule.id === "iban"), false);

    const active = loadCustomRules(storage);
    assert.equal(active.some((rule) => rule.id === "iban"), true);
    assert.equal(active.some((rule) => rule.label === "Project Falcon"), true);
    assert.deepEqual(
      extractCustomRuleMatches(active.find((rule) => rule.id === "falcon"), "Build FALCON now"),
      ["FALCON"]
    );

    saveUserCustomRule({
      id: "falcon",
      name: "Project Falcon",
      pattern: "FALCON",
      type: "keyword",
      enabled: false,
    }, storage);
    assert.equal(loadCustomRules(storage).some((rule) => rule.id === "falcon"), false);
  });

  it("rejects a malformed regex and still tests a keyword safely", () => {
    const storage = memoryStorage();
    assert.equal(saveUserCustomRule({
      name: "Broken",
      pattern: "(",
      type: "regex",
    }, storage).ok, false);
    assert.equal(storage.getItem(USER_CUSTOM_RULES_KEY), null);
    assert.deepEqual(testCustomPattern("(", "anything", "regex"), {
      ok: false,
      matches: [],
      error: "This pattern could not be compiled.",
    });
    assert.deepEqual(testCustomPattern("C++", "use C++ here", "keyword").matches, ["C++"]);
    assert.doesNotThrow(() => matchCustomRules([{
      id: "bad",
      label: "Bad",
      expression: {
        lastIndex: 0,
        [Symbol.match]() {
          throw new Error("boom");
        },
      },
    }], "text"));
    assert.deepEqual(matchCustomRules([{
      id: "bad",
      label: "Bad",
      expression: {
        lastIndex: 0,
        [Symbol.match]() {
          throw new Error("boom");
        },
      },
    }], "text"), []);
  });
});
