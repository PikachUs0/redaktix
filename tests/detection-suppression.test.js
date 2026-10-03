/**
 * suppressShadowedDetections: strong types never drop; IBAN only suppresses weak types.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { suppressShadowedDetections } from "../src/js/detection-suppression.js";
import { isValidIban, passesLuhn } from "../src/js/sensitive-detectors.js";

const VALID_IBAN = "TR330006100519786457841326";
const VALID_CARD = "4242424242424242";
const TOKEN = "sk_test_mockkey123";

function box(partial) {
  return {
    normX: 0.1,
    normY: 0.1,
    normWidth: 0.5,
    normHeight: 0.08,
    ...partial,
  };
}

describe("suppressShadowedDetections protected types", () => {
  it("keeps an api_token that overlaps a structure-valid IBAN box", () => {
    assert.equal(isValidIban(VALID_IBAN).structureValid, true);
    const iban = box({
      type: "custom_rule",
      ruleId: "iban",
      label: "Possible IBAN",
      text: VALID_IBAN,
      id: "iban-1",
    });
    const token = box({
      type: "api_token",
      text: TOKEN,
      id: "token-1",
      normX: 0.12,
      normWidth: 0.4,
    });
    const kept = suppressShadowedDetections([iban, token]);
    assert.ok(kept.some((item) => item.id === "iban-1"));
    assert.ok(kept.some((item) => item.id === "token-1"), "api_token must not be suppressed by IBAN overlap");
  });

  it("suppresses a phone inside a valid IBAN and keeps a phone outside", () => {
    assert.equal(isValidIban(VALID_IBAN).structureValid, true);
    const iban = box({
      type: "custom_rule",
      ruleId: "iban",
      label: "Possible IBAN",
      text: VALID_IBAN,
      id: "iban-1",
      normX: 0.1,
      normY: 0.2,
      normWidth: 0.6,
      normHeight: 0.1,
    });
    const phoneInside = box({
      type: "phone",
      text: "05321112233",
      id: "phone-in",
      normX: 0.15,
      normY: 0.22,
      normWidth: 0.35,
      normHeight: 0.06,
    });
    const phoneOutside = box({
      type: "phone",
      text: "05329998877",
      id: "phone-out",
      normX: 0.1,
      normY: 0.55,
      normWidth: 0.35,
      normHeight: 0.06,
    });
    const kept = suppressShadowedDetections([iban, phoneInside, phoneOutside]);
    assert.ok(kept.some((item) => item.id === "iban-1"));
    assert.equal(kept.some((item) => item.id === "phone-in"), false, "phone inside IBAN must be suppressed");
    assert.ok(kept.some((item) => item.id === "phone-out"), "phone outside IBAN must be kept");
  });

  it("never suppresses Luhn-valid credit_card, tckn, vkn, or email by IBAN overlap", () => {
    assert.equal(passesLuhn(VALID_CARD), true);
    const iban = box({
      type: "custom_rule",
      ruleId: "iban",
      label: "Possible IBAN",
      text: VALID_IBAN,
      id: "iban-1",
    });
    const strong = [
      box({ type: "credit_card", text: VALID_CARD, id: "card-1", normX: 0.12 }),
      box({ type: "tckn", text: "10000000146", id: "tckn-1", normX: 0.14 }),
      box({ type: "vkn", text: "1234567890", id: "vkn-1", normX: 0.16 }),
      box({ type: "email", text: "ada@example.com", id: "email-1", normX: 0.18 }),
    ];
    const kept = suppressShadowedDetections([iban, ...strong]);
    for (const item of strong) {
      assert.ok(kept.some((keptItem) => keptItem.id === item.id), `${item.type} must stay`);
    }
  });
});
