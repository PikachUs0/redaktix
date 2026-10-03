/**
 * PEM private key detector: ALWAYS_ON, line-text + word-box mapping, auto-apply.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALWAYS_ON_DETECTORS,
  isAlwaysOnDetector,
  limitToToolDetectors,
} from "../src/js/detection-profiles.js";
import { detectionsForAutomaticRedaction } from "../src/js/sensitive-detectors.js";
import { detectStructuredDataFromLines } from "../src/js/structured-lines.js";
import {
  extractPrivateKeyBlocks,
  findPrivateKeyMatchesFromLines,
} from "../src/js/sensitive-detectors.js";

function word(text, x, y, width = Math.max(24, text.length * 8)) {
  return {
    text,
    confidence: 92,
    bbox: {
      x0: x,
      y0: y,
      x1: x + width,
      y1: y + 14,
      x,
      y,
      width,
      height: 14,
      w: width,
      h: 14,
    },
  };
}

function lineFromTokens(id, y, tokens, lineIndex) {
  let x = 8;
  const words = tokens.map((token, index) => {
    const item = {
      ...word(token, x, y),
      lineId: id,
      lineIndex,
      wordIndex: index,
    };
    x += item.bbox.width + 6;
    return item;
  });
  return {
    id,
    text: tokens.join(" "),
    confidence: 90,
    bbox: {
      x0: 8,
      y0: y,
      x1: x,
      y1: y + 14,
      x: 8,
      y,
      width: x - 8,
      height: 14,
      w: x - 8,
      h: 14,
    },
    words,
    lineIndex,
  };
}

function pemFixture() {
  const lines = [
    lineFromTokens("l0", 10, ["-----BEGIN", "RSA", "PRIVATE", "KEY-----"], 0),
    lineFromTokens("l1", 28, ["MIIEowIBAAKCAQEA1234567890abcdef"], 1),
    lineFromTokens("l2", 46, ["MOREBASE64DATA=="], 2),
    lineFromTokens("l3", 64, ["-----END", "RSA", "PRIVATE", "KEY-----"], 3),
  ];
  return {
    lines,
    words: lines.flatMap((line) => line.words),
    imageSize: { width: 720, height: 120 },
  };
}

function certificateFixture() {
  const lines = [
    lineFromTokens("c0", 10, ["-----BEGIN", "CERTIFICATE-----"], 0),
    lineFromTokens("c1", 28, ["MIICertPublicOnlyData=="], 1),
    lineFromTokens("c2", 46, ["-----END", "CERTIFICATE-----"], 2),
  ];
  return {
    lines,
    words: lines.flatMap((line) => line.words),
    imageSize: { width: 720, height: 100 },
  };
}

describe("PEM private key detector", () => {
  it("is ALWAYS_ON and survives limitToToolDetectors", () => {
    assert.equal(isAlwaysOnDetector("private_key"), true);
    assert.ok(ALWAYS_ON_DETECTORS.includes("private_key"));
    const kept = limitToToolDetectors(
      [{ type: "private_key", text: "-----BEGIN PRIVATE KEY-----" }],
      ["email"]
    );
    assert.equal(kept.length, 1);
  });

  it("extracts BEGIN..PRIVATE KEY through END and auto-applies with word boxes", () => {
    const fixture = pemFixture();
    const joined = fixture.lines.map((line) => line.text).join("\n");
    const blocks = extractPrivateKeyBlocks(joined);
    assert.equal(blocks.length, 1);
    assert.match(blocks[0], /BEGIN RSA PRIVATE KEY/);
    assert.match(blocks[0], /END RSA PRIVATE KEY/);
    assert.match(blocks[0], /MIIEowIBAAKCAQEA/);

    const matches = findPrivateKeyMatchesFromLines(fixture.lines);
    assert.equal(matches.length, 1);
    assert.ok(matches[0].words.length >= 6, "should cover header, body, and end words");

    const detections = detectStructuredDataFromLines(fixture.lines, {
      profileId: "global",
      imageSize: fixture.imageSize,
      linesById: new Map(fixture.lines.map((line) => [line.id, line])),
    });
    const keys = detections.filter((item) => item.type === "private_key");
    assert.ok(keys.length >= 1);
    const automatic = detectionsForAutomaticRedaction(keys);
    assert.equal(automatic.length, keys.length);
    assert.equal(keys[0].review?.needsReview, undefined);
    assert.ok(keys[0].normWidth > 0 && keys[0].normHeight > 0);
  });

  it("does not auto-apply a BEGIN CERTIFICATE public block", () => {
    const fixture = certificateFixture();
    const joined = fixture.lines.map((line) => line.text).join("\n");
    assert.deepEqual(extractPrivateKeyBlocks(joined), []);
    const detections = detectStructuredDataFromLines(fixture.lines, {
      profileId: "global-turkey",
      imageSize: fixture.imageSize,
      linesById: new Map(fixture.lines.map((line) => [line.id, line])),
    });
    assert.equal(detections.filter((item) => item.type === "private_key").length, 0);
    assert.deepEqual(
      detectionsForAutomaticRedaction(detections.filter((item) => item.type === "private_key")),
      []
    );
  });

  it("covers body lines for a broken BEGIN RSA KEY header via PEM fallback", () => {
    const body1 = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7";
    const body2 = "xYz0123456789ABCDEFGHIJKLMNOPQRSTUVWabcdefghijklmnopqrstuv Nb";
    const lines = [
      lineFromTokens("b0", 10, ["-----BEGIN", "RSA", "KEY-----"], 0),
      lineFromTokens("b1", 28, [body1.slice(0, 28), body1.slice(28)], 1),
      lineFromTokens("b2", 46, body2.split(/\s+/), 2),
      lineFromTokens("b3", 64, ["-----END", "RSA", "KEY-----"], 3),
    ];
    const matches = findPrivateKeyMatchesFromLines(lines);
    assert.ok(matches.length >= 1, "broken header must still yield a private_key match");
    const bodyWords = lines.slice(1, 3).flatMap((line) => line.words);
    for (const word of bodyWords) {
      assert.ok(
        matches.some((match) => match.words.includes(word)),
        `body word ${word.text} must be in the private_key match`
      );
    }
    const detections = detectStructuredDataFromLines(lines, {
      profileId: "global",
      imageSize: { width: 900, height: 120 },
      linesById: new Map(lines.map((line) => [line.id, line])),
    });
    assert.ok(detections.some((item) => item.type === "private_key"));
  });

  it("does not redact a CERTIFICATE block with the same body shape", () => {
    const body1 = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7";
    const body2 = "xYz0123456789ABCDEFGHIJKLMNOPQRSTUVWabcdefghijklmnopqrstuvNb";
    const lines = [
      lineFromTokens("c0", 10, ["-----BEGIN", "CERTIFICATE-----"], 0),
      lineFromTokens("c1", 28, [body1], 1),
      lineFromTokens("c2", 46, [body2], 2),
      lineFromTokens("c3", 64, ["-----END", "CERTIFICATE-----"], 3),
    ];
    assert.deepEqual(extractPrivateKeyBlocks(lines.map((line) => line.text).join("\n")), []);
    assert.equal(findPrivateKeyMatchesFromLines(lines).length, 0);
    const detections = detectStructuredDataFromLines(lines, {
      profileId: "global",
      imageSize: { width: 900, height: 120 },
      linesById: new Map(lines.map((line) => [line.id, line])),
    });
    assert.equal(detections.filter((item) => item.type === "private_key").length, 0);
  });

  it("does not redact a single base64-looking line in prose", () => {
    const lines = [
      lineFromTokens(
        "p0",
        12,
        ["Note", "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7", "in", "docs"],
        0
      ),
    ];
    assert.equal(findPrivateKeyMatchesFromLines(lines).length, 0);
    const detections = detectStructuredDataFromLines(lines, {
      profileId: "global",
      imageSize: { width: 900, height: 40 },
      linesById: new Map(lines.map((line) => [line.id, line])),
    });
    assert.equal(detections.filter((item) => item.type === "private_key").length, 0);
  });
});
