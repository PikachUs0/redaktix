/**
 * Seed phrase detector: 12/24 lowercase words, ALWAYS_ON, REVIEW-ONLY.
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
  extractSeedPhraseMatches,
} from "../src/js/sensitive-detectors.js";
import { detectStructuredDataFromLines } from "../src/js/structured-lines.js";

const WORDS_12 = [
  "abandon", "ability", "able", "about", "above", "absent",
  "absorb", "abstract", "absurd", "abuse", "access", "accident",
];
const WORDS_24 = [
  ...WORDS_12,
  "account", "accuse", "achieve", "acid", "acoustic", "acquire",
  "across", "act", "action", "actor", "actress", "actual",
];

function lineFromWords(id, y, words, lineIndex) {
  let x = 8;
  const ocrWords = words.map((token, index) => {
    const width = Math.max(18, token.length * 7);
    const item = {
      text: token,
      confidence: 90,
      bbox: {
        x0: x, y0: y, x1: x + width, y1: y + 14, x, y, width, height: 14, w: width, h: 14,
      },
      lineId: id,
      lineIndex,
      wordIndex: index,
    };
    x += width + 4;
    return item;
  });
  return {
    id,
    text: words.join(" "),
    confidence: 88,
    bbox: { x0: 8, y0: y, x1: x, y1: y + 14, x: 8, y, width: x - 8, height: 14 },
    words: ocrWords,
    lineIndex,
  };
}

describe("seed_phrase detector", () => {
  it("is ALWAYS_ON and survives limitToToolDetectors", () => {
    assert.equal(isAlwaysOnDetector("seed_phrase"), true);
    assert.ok(ALWAYS_ON_DETECTORS.includes("seed_phrase"));
    const kept = limitToToolDetectors(
      [{ type: "seed_phrase", text: WORDS_12.join(" ") }],
      ["email"]
    );
    assert.equal(kept.length, 1);
  });

  it("detects 12 and 24 lowercase word runs as REVIEW-ONLY", () => {
    const twelve = lineFromWords("s0", 10, WORDS_12, 0);
    const twentyFour = lineFromWords("s1", 40, WORDS_24, 1);
    for (const line of [twelve, twentyFour]) {
      const matches = extractSeedPhraseMatches(line.text);
      assert.equal(matches.length, 1, line.text.slice(0, 40));
      assert.equal(matches[0].needsReview, true);
      assert.ok(matches[0].text.split(/\s+/).length === 12 || matches[0].text.split(/\s+/).length === 24);
    }

    const detections = detectStructuredDataFromLines([twelve, twentyFour], {
      profileId: "global",
      imageSize: { width: 1200, height: 80 },
      linesById: new Map([[twelve.id, twelve], [twentyFour.id, twentyFour]]),
    });
    const seeds = detections.filter((item) => item.type === "seed_phrase");
    assert.ok(seeds.length >= 2);
    assert.ok(seeds.every((item) => item.review?.needsReview === true));
    assert.deepEqual(detectionsForAutomaticRedaction(seeds), []);
  });

  it("ignores a normal 12-word sentence with punctuation or capitals", () => {
    const punctuated = lineFromWords(
      "n0",
      12,
      ["Please", "bring", "the", "documents,", "keys,", "and", "forms", "to", "the", "front", "desk", "today."],
      0
    );
    // Force prose text with punctuation/capitals (join would drop commas on tokens).
    punctuated.text = "Please bring the documents, keys, and forms to the front desk today.";
    assert.deepEqual(extractSeedPhraseMatches(punctuated.text), []);

    const titled = lineFromWords(
      "n1",
      40,
      ["Abandon", "Ability", "Able", "About", "Above", "Absent", "Absorb", "Abstract", "Absurd", "Abuse", "Access", "Accident"],
      1
    );
    assert.deepEqual(extractSeedPhraseMatches(titled.text), []);

    const detections = detectStructuredDataFromLines([punctuated, titled], {
      profileId: "global-turkey",
      imageSize: { width: 900, height: 80 },
      linesById: new Map([[punctuated.id, punctuated], [titled.id, titled]]),
    });
    assert.equal(detections.filter((item) => item.type === "seed_phrase").length, 0);
  });
});
