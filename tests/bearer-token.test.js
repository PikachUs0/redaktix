/**
 * Authorization / Bearer token detector: ALWAYS_ON, auto-apply.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALWAYS_ON_DETECTORS,
  isAlwaysOnDetector,
  limitToToolDetectors,
} from "../src/js/detection-profiles.js";
import { blackoutDetections } from "../src/js/app.js";
import {
  detectionsForAutomaticRedaction,
  extractBearerTokenMatches,
  findBearerTokenMatchesFromLines,
} from "../src/js/sensitive-detectors.js";
import { detectStructuredDataFromLines } from "../src/js/structured-lines.js";

function lineFromTokens(id, y, tokens, lineIndex) {
  let x = 8;
  const words = tokens.map((token, index) => {
    const width = Math.max(24, token.length * 8);
    const item = {
      text: token,
      confidence: 93,
      bbox: {
        x0: x, y0: y, x1: x + width, y1: y + 14, x, y, width, height: 14, w: width, h: 14,
      },
      lineId: id,
      lineIndex,
      wordIndex: index,
    };
    x += width + 6;
    return item;
  });
  return {
    id,
    text: tokens.join(" "),
    confidence: 91,
    bbox: { x0: 8, y0: y, x1: x, y1: y + 14, x: 8, y, width: x - 8, height: 14, w: x - 8, h: 14 },
    words,
    lineIndex,
  };
}

describe("Bearer / Authorization header detector", () => {
  it("is ALWAYS_ON and survives limitToToolDetectors", () => {
    assert.equal(isAlwaysOnDetector("bearer_token"), true);
    assert.ok(ALWAYS_ON_DETECTORS.includes("bearer_token"));
    const kept = limitToToolDetectors(
      [{ type: "bearer_token", text: "Bearer abcdEFGH12345678" }],
      ["phone"]
    );
    assert.equal(kept.length, 1);
  });

  it("auto-applies Authorization Bearer and bare Bearer tokens with boxes", () => {
    const authLine = lineFromTokens(
      "a0",
      12,
      ["Authorization:", "Bearer", "eyJhbGciOiJIUzI1NiJ9.payload.sig"],
      0
    );
    const bareLine = lineFromTokens(
      "a1",
      40,
      ["Bearer", "sk_live_51H7xExampleSecret99"],
      1
    );
    const lines = [authLine, bareLine];
    const matches = [
      ...extractBearerTokenMatches(authLine.text),
      ...extractBearerTokenMatches(bareLine.text),
    ];
    assert.ok(matches.some((item) => item.text.startsWith("Bearer ") && item.text.includes("eyJ")));
    assert.ok(matches.some((item) => item.text === "Bearer sk_live_51H7xExampleSecret99"));
    assert.ok(matches.every((item) => !/^Authorization:/i.test(item.text)));

    const detections = detectStructuredDataFromLines(lines, {
      profileId: "global",
      imageSize: { width: 800, height: 80 },
      linesById: new Map(lines.map((line) => [line.id, line])),
    });
    const bearers = detections.filter((item) => item.type === "bearer_token");
    assert.ok(bearers.length >= 2);
    assert.equal(detectionsForAutomaticRedaction(bearers).length, bearers.length);
    assert.ok(bearers.every((item) => item.normWidth > 0));
  });

  it("does not auto-apply the word Bearer in normal prose without a token", () => {
    const prose = lineFromTokens(
      "p0",
      10,
      ["Please", "have", "the", "bearer", "bring", "ID", "to", "reception."],
      0
    );
    assert.deepEqual(extractBearerTokenMatches(prose.text), []);
    const detections = detectStructuredDataFromLines([prose], {
      profileId: "global-turkey",
      imageSize: { width: 640, height: 40 },
      linesById: new Map([[prose.id, prose]]),
    });
    assert.equal(detections.filter((item) => item.type === "bearer_token").length, 0);
  });

  it("joins a Bearer token that wraps to the next line with one rect per line", () => {
    // First-line fragment intentionally < 16 so same-line Bearer extract misses it.
    const line0 = lineFromTokens("w0", 10, ["Authorization:", "Bearer", "eyJhbGciOi"], 0);
    const line1 = lineFromTokens("w1", 28, ["JIUzI1NiJ9.payload.sig99"], 1);
    const matches = findBearerTokenMatchesFromLines([line0, line1]);
    assert.ok(matches.length >= 2, "expected one match fragment per line");
    assert.ok(matches.every((item) => String(item.text).includes("eyJ")));
    const lineIndexes = new Set(matches.map((item) => item.lineIndex));
    assert.ok(lineIndexes.has(0) && lineIndexes.has(1));

    const detections = detectStructuredDataFromLines([line0, line1], {
      profileId: "global",
      imageSize: { width: 800, height: 60 },
      linesById: new Map([[line0.id, line0], [line1.id, line1]]),
    });
    const bearers = detections.filter((item) => item.type === "bearer_token");
    assert.ok(bearers.length >= 2, "one detection/rect per wrapped line");
    assert.equal(detectionsForAutomaticRedaction(bearers).length, bearers.length);

    const rects = blackoutDetections(bearers, 800, 60);
    const yBands = new Set(rects.map((rect) => Math.round(rect.y)));
    assert.ok(yBands.size >= 2, `expected distinct line rects, got ys=${[...yBands]}`);
    assert.ok(rects.every((rect) => rect.height < 20), "each rect should be single-line tall");
  });

  it("does not join Bearer of bad news with an unrelated following line", () => {
    const line0 = lineFromTokens("b0", 10, ["Bearer", "of", "bad", "news"], 0);
    const line1 = lineFromTokens("b1", 28, ["Please", "submit", "the", "form", "today"], 1);
    assert.deepEqual(extractBearerTokenMatches(line0.text), []);
    assert.deepEqual(findBearerTokenMatchesFromLines([line0, line1]), []);
    const detections = detectStructuredDataFromLines([line0, line1], {
      profileId: "global",
      imageSize: { width: 700, height: 60 },
      linesById: new Map([[line0.id, line0], [line1.id, line1]]),
    });
    assert.equal(detections.filter((item) => item.type === "bearer_token").length, 0);
  });
});
