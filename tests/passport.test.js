/**
 * Labeled passport detector: ALWAYS_ON; auto-apply only with Passport/Pasaport label.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALWAYS_ON_DETECTORS,
  isAlwaysOnDetector,
  limitToToolDetectors,
} from "../src/js/detection-profiles.js";
import {
  detectionsForAutomaticRedaction,
  extractPassportMatches,
} from "../src/js/sensitive-detectors.js";
import { detectStructuredDataFromLines } from "../src/js/structured-lines.js";

function lineFromText(id, y, text, lineIndex) {
  const tokens = text.split(/\s+/).filter(Boolean);
  let x = 8;
  const words = tokens.map((token, index) => {
    const width = Math.max(20, token.length * 8);
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
    x += width + 5;
    return item;
  });
  return {
    id,
    text,
    confidence: 91,
    bbox: { x0: 8, y0: y, x1: x, y1: y + 14, x: 8, y, width: x - 8, height: 14 },
    words,
    lineIndex,
  };
}

describe("passport detector", () => {
  it("is ALWAYS_ON and survives limitToToolDetectors", () => {
    assert.equal(isAlwaysOnDetector("passport"), true);
    assert.ok(ALWAYS_ON_DETECTORS.includes("passport"));
    const kept = limitToToolDetectors(
      [{ type: "passport", text: "U12345678" }],
      ["phone"]
    );
    assert.equal(kept.length, 1);
  });

  it("auto-applies labeled Passport/Pasaport numbers", () => {
    const lines = [
      lineFromText("p0", 10, "Passport No: U12345678", 0),
      lineFromText("p1", 30, "Pasaport No: AB9876543", 1),
      lineFromText("p2", 50, "Passport: X1Y2Z3W4V", 2),
    ];
    for (const line of lines) {
      const matches = extractPassportMatches(line.text);
      assert.ok(matches.length >= 1, line.text);
      assert.ok(matches.every((item) => item.labeled));
      assert.ok(matches.every((item) => !item.needsReview));
    }
    const detections = detectStructuredDataFromLines(lines, {
      profileId: "global",
      imageSize: { width: 700, height: 100 },
      linesById: new Map(lines.map((line) => [line.id, line])),
    });
    const passports = detections.filter((item) => item.type === "passport");
    assert.ok(passports.length >= 3);
    assert.equal(detectionsForAutomaticRedaction(passports).length, passports.length);
    assert.ok(passports.every((item) => item.normWidth > 0));
  });

  it("does not match unlabeled U12345678 in prose", () => {
    const prose = lineFromText(
      "n0",
      12,
      "Reference code U12345678 is printed on the form.",
      0
    );
    assert.deepEqual(extractPassportMatches(prose.text), []);
    const detections = detectStructuredDataFromLines([prose], {
      profileId: "global-turkey",
      imageSize: { width: 720, height: 40 },
      linesById: new Map([[prose.id, prose]]),
    });
    assert.equal(detections.filter((item) => item.type === "passport").length, 0);
    assert.deepEqual(
      detectionsForAutomaticRedaction(detections.filter((item) => item.type === "passport")),
      []
    );
  });
});
