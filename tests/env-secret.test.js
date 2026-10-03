/**
 * .env KEY=value detector: sensitive key names only; redact value; ALWAYS_ON.
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
  extractEnvSecretMatches,
} from "../src/js/sensitive-detectors.js";
import { detectStructuredDataFromLines } from "../src/js/structured-lines.js";
import { blackoutDetections } from "../src/js/app.js";

function lineFromText(id, y, text, lineIndex) {
  const tokens = text.split(/(\s+|=)/).filter((part) => part && !/^\s+$/.test(part));
  let x = 8;
  const words = [];
  for (const token of tokens) {
    const width = Math.max(10, token.length * 8);
    words.push({
      text: token,
      confidence: 94,
      bbox: {
        x0: x, y0: y, x1: x + width, y1: y + 14, x, y, width, height: 14, w: width, h: 14,
      },
      lineId: id,
      lineIndex,
      wordIndex: words.length,
    });
    x += width + (token === "=" ? 2 : 4);
  }
  return {
    id,
    text,
    confidence: 92,
    bbox: { x0: 8, y0: y, x1: x, y1: y + 14, x: 8, y, width: x - 8, height: 14 },
    words,
    lineIndex,
  };
}

function covers(rect, box, epsilon = 0.5) {
  const x0 = Number(rect.x0 ?? rect.x);
  const y0 = Number(rect.y0 ?? rect.y);
  const x1 = Number.isFinite(Number(rect.x1)) ? Number(rect.x1) : x0 + Number(rect.width);
  const y1 = Number.isFinite(Number(rect.y1)) ? Number(rect.y1) : y0 + Number(rect.height);
  return x0 <= box.x0 + epsilon
    && y0 <= box.y0 + epsilon
    && x1 >= box.x1 - epsilon
    && y1 >= box.y1 - epsilon;
}

describe("env_secret .env KEY=value detector", () => {
  it("is ALWAYS_ON and survives limitToToolDetectors", () => {
    assert.equal(isAlwaysOnDetector("env_secret"), true);
    assert.ok(ALWAYS_ON_DETECTORS.includes("env_secret"));
    const kept = limitToToolDetectors(
      [{ type: "env_secret", text: "s3cr3tValue" }],
      ["email"]
    );
    assert.equal(kept.length, 1);
  });

  it("auto-applies sensitive KEY=value and boxes only the value", () => {
    const lines = [
      lineFromText("e0", 10, "API_SECRET=supersecret99", 0),
      lineFromText("e1", 30, "DB_PASSWORD=hunter2xx", 1),
      lineFromText("e2", 50, "ACCESS_TOKEN=abcdefghi", 2),
      lineFromText("e3", 70, "CLIENT_SECRET=clientval1", 3),
    ];
    for (const line of lines) {
      const matches = extractEnvSecretMatches(line.text);
      assert.equal(matches.length, 1, line.text);
      assert.ok(matches[0].text.length >= 8);
      assert.ok(!/=/.test(matches[0].text), "match text is the value only");
    }

    const detections = detectStructuredDataFromLines(lines, {
      profileId: "global",
      imageSize: { width: 640, height: 120 },
      linesById: new Map(lines.map((line) => [line.id, line])),
    });
    const envs = detections.filter((item) => item.type === "env_secret");
    assert.ok(envs.length >= 4);
    assert.equal(detectionsForAutomaticRedaction(envs).length, envs.length);

    const rects = blackoutDetections(envs, 640, 120);
    for (const line of lines) {
      const keyWord = line.words.find((word) => /SECRET|PASSWORD|TOKEN/i.test(word.text));
      const valueWord = line.words[line.words.length - 1];
      assert.ok(keyWord && valueWord);
      assert.ok(
        rects.some((rect) => covers(rect, valueWord.bbox)),
        `value of ${line.text} must be covered`
      );
      assert.ok(
        rects.every((rect) => !covers(rect, keyWord.bbox) || covers(rect, valueWord.bbox)),
        "key name alone must not be the redaction target"
      );
      // Key name left of '=' should not be fully covered without the value being the intent.
      const keyOnly = rects.filter((rect) => covers(rect, keyWord.bbox) && !covers(rect, valueWord.bbox));
      assert.equal(keyOnly.length, 0, `must not redact key name for ${line.text}`);
    }
  });

  it("ignores PORT, DEBUG, NODE_ENV, and empty values", () => {
    const negatives = [
      "PORT=3000",
      "DEBUG=true",
      "NODE_ENV=production",
      "API_SECRET=",
      "PASSWORD=",
    ];
    for (const text of negatives) {
      assert.deepEqual(extractEnvSecretMatches(text), [], text);
    }
    const lines = negatives.map((text, index) => lineFromText(`n${index}`, 10 + index * 18, text, index));
    const detections = detectStructuredDataFromLines(lines, {
      profileId: "global-turkey",
      imageSize: { width: 640, height: 120 },
      linesById: new Map(lines.map((line) => [line.id, line])),
    });
    assert.equal(detections.filter((item) => item.type === "env_secret").length, 0);
  });
});
