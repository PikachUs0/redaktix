import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isValidIban,
  repairIbanSingleGlyph,
} from "../src/js/sensitive-detectors.js";

const VALID = [
  "DE89370400440532013000",
  "TR330006100519786457841326",
  "GB82WEST12345698765432",
  "FR1420041010050500013M02606",
];

describe("isValidIban", () => {
  for (const iban of VALID) {
    it(`accepts valid ${iban.slice(0, 2)} IBAN`, () => {
      const spaced = iban.replace(/(.{4})/g, "$1 ").trim();
      for (const value of [iban, spaced, iban.toLowerCase(), `${iban.slice(0, 4)}-${iban.slice(4)}`]) {
        const result = isValidIban(value);
        assert.equal(result.structureValid, true, value);
        assert.equal(result.checksumValid, true, value);
        assert.equal(result.country, iban.slice(0, 2));
      }
    });
  }

  it("marks one-digit-wrong IBANs as structureValid with checksumValid false", () => {
    const broken = [
      "DE89370400440532013001",
      "TR330006100519786457841327",
      "GB82WEST12345698765433",
      "FR1420041010050500013M02607",
    ];
    for (const iban of broken) {
      const result = isValidIban(iban);
      assert.equal(result.structureValid, true, iban);
      assert.equal(result.checksumValid, false, iban);
      assert.equal(result.country, iban.slice(0, 2));
    }
  });

  it("rejects wrong length as structureValid false", () => {
    const wrongLength = [
      "DE8937040044053201300",
      "TR33000610051978645784132",
      "GB82WEST123456987654321",
      "FR1420041010050500013M0260",
      "XX12345678901234567890",
    ];
    for (const iban of wrongLength) {
      const result = isValidIban(iban);
      assert.equal(result.structureValid, false, iban);
      assert.equal(result.checksumValid, false, iban);
    }
  });

  it("repairs a single confusable OCR glyph when mod-97 then passes", () => {
    // Valid DE with a letter O instead of digit 0 in the body.
    const damaged = "DE89370400440532O13000";
    assert.equal(isValidIban(damaged).checksumValid, false);
    assert.equal(repairIbanSingleGlyph(damaged), "DE89370400440532013000");
  });
});
