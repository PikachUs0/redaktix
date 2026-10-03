/**
 * Tool pages may prioritize activeDetectors, but MUST keep ALWAYS_ON checksum detectors.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALWAYS_ON_DETECTORS, limitToToolDetectors } from "../src/js/detection-profiles.js";
import {
  extractCreditCardCandidates,
  extractIbanCandidates,
  findTcknMatches,
} from "../src/js/sensitive-detectors.js";
import { detectStructuredDataFromLines } from "../src/js/structured-lines.js";
import { getToolBySlug, TOOLS } from "../src/tools/registry.js";

const VALID_TCKN = "10000000146";
const VALID_IBAN = "TR33 0006 1005 1978 6457 8413 26";
const VALID_CARD = "4242 4242 4242 4242";

const ALWAYS_ON_COPY_EN = "also catches card numbers, IBAN, TCKN and VKN";
const ALWAYS_ON_COPY_TR = "kart numaraları, IBAN, TCKN ve VKN";

function line(id, text, y = 10) {
  const tokens = text.split(/\s+/).filter(Boolean);
  let x = 8;
  const words = tokens.map((token, index) => {
    const width = Math.max(28, token.length * 10);
    const word = {
      text: token,
      confidence: 92,
      bbox: { x0: x, y0: y, x1: x + width, y1: y + 16, x, y, width, height: 16, w: width, h: 16 },
      lineId: id,
      wordIndex: index,
    };
    x += width + 8;
    return word;
  });
  return {
    id,
    text,
    confidence: 90,
    bbox: {
      x0: 8,
      y0: y,
      x1: x,
      y1: y + 16,
      x: 8,
      y,
      width: x - 8,
      height: 16,
      w: x - 8,
      h: 16,
    },
    words,
    lineIndex: Number(String(id).replace(/\D/g, "")) || 0,
  };
}

describe("tool pages keep ALWAYS_ON detectors", () => {
  it("documents ALWAYS_ON checksum types", () => {
    assert.ok(ALWAYS_ON_DETECTORS.includes("credit_card"));
    assert.ok(ALWAYS_ON_DETECTORS.includes("iban"));
    assert.ok(ALWAYS_ON_DETECTORS.includes("tckn"));
    assert.ok(ALWAYS_ON_DETECTORS.includes("vkn"));
    assert.ok(ALWAYS_ON_DETECTORS.includes("private_key"));
    assert.ok(ALWAYS_ON_DETECTORS.includes("bearer_token"));
    assert.ok(ALWAYS_ON_DETECTORS.includes("connection_url"));
    assert.ok(ALWAYS_ON_DETECTORS.includes("env_secret"));
    assert.ok(ALWAYS_ON_DETECTORS.includes("passport"));
    assert.ok(ALWAYS_ON_DETECTORS.includes("seed_phrase"));
  });

  it("limitToToolDetectors keeps ALWAYS_ON when only credit_card is selected", () => {
    const tool = getToolBySlug("redact-credit-card");
    assert.deepEqual(tool.activeDetectors, ["credit_card"]);
    const detections = [
      { type: "credit_card", text: VALID_CARD },
      { type: "tckn", text: VALID_TCKN },
      { type: "custom_rule", ruleId: "iban", text: VALID_IBAN, label: "Possible IBAN" },
      { type: "vkn", text: "1234567890" },
      { type: "phone", text: "05321112233" },
      { type: "email", text: "ada@example.com" },
    ];
    const kept = limitToToolDetectors(detections, tool.activeDetectors);
    assert.ok(kept.some((item) => item.type === "credit_card"));
    assert.ok(kept.some((item) => item.type === "tckn"));
    assert.ok(kept.some((item) => item.type === "vkn"));
    assert.ok(kept.some((item) => item.ruleId === "iban"));
    assert.equal(kept.some((item) => item.type === "phone"), false);
    assert.equal(kept.some((item) => item.type === "email"), false);
  });

  it("redact-credit-card tool-page scan still detects valid TCKN and IBAN in the same image", () => {
    const tool = getToolBySlug("redact-credit-card");
    const lines = [
      line("l0", `Card ${VALID_CARD}`, 12),
      line("l1", `TCKN ${VALID_TCKN}`, 40),
      line("l2", `IBAN ${VALID_IBAN}`, 68),
    ];
    const words = lines.flatMap((item) => item.words);
    const imageSize = { width: 640, height: 120 };
    const structured = detectStructuredDataFromLines(lines, {
      profileId: "global-turkey",
      imageSize,
      linesById: new Map(lines.map((item) => [item.id, item])),
    });
    // Also confirm extractors see the values in the combined OCR text.
    const blob = lines.map((item) => item.text).join("\n");
    assert.ok(extractCreditCardCandidates(blob).length);
    assert.ok(findTcknMatches(blob).some((match) => match.text === VALID_TCKN));
    assert.ok(extractIbanCandidates(blob).some((text) => text.replace(/\s+/g, "") === VALID_IBAN.replace(/\s+/g, "")));

    const limited = limitToToolDetectors(structured, tool.activeDetectors);
    assert.ok(
      limited.some((item) => item.type === "credit_card"),
      "credit_card should remain (tool focus + ALWAYS_ON)"
    );
    assert.ok(
      limited.some((item) => item.type === "tckn" && item.text === VALID_TCKN),
      "ALWAYS_ON tckn must still be detected on the credit-card tool page"
    );
    assert.ok(
      limited.some((item) => item.ruleId === "iban" || /TR33/.test(item.text)),
      "ALWAYS_ON iban must still be detected on the credit-card tool page"
    );
  });

  it("every tool page intro mentions ALWAYS_ON checksum types", () => {
    for (const tool of TOOLS) {
      const copy = tool.lang === "tr" ? ALWAYS_ON_COPY_TR : ALWAYS_ON_COPY_EN;
      assert.match(
        tool.introText,
        new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        `${tool.slug} intro must mention ALWAYS_ON detectors`
      );
    }
  });
});
