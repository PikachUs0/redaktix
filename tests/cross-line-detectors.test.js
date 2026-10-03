/**
 * Prove seed / Bearer / IBAN cross-line joining is decided only in cross-line.js.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  findBearerTokenMatchesFromLines,
  findCrossLineIbanMatches,
  findSeedPhraseMatchesFromLines,
} from "../src/js/sensitive-detectors.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DETECTORS_SRC = readFileSync(join(ROOT, "src/js/sensitive-detectors.js"), "utf8");
const CROSS_LINE_SRC = readFileSync(join(ROOT, "src/js/cross-line.js"), "utf8");

function extractFunctionSource(name) {
  const start = DETECTORS_SRC.indexOf(`export function ${name}`);
  assert.ok(start >= 0, `missing export function ${name}`);
  const from = DETECTORS_SRC.slice(start);
  const next = from.slice(1).search(/\nexport function |\nfunction /);
  return next < 0 ? from : from.slice(0, next + 1);
}

function line(text, { y0, x0 = 12, height = 14, width = 400, lineIndex = 0, words } = {}) {
  const tokens = words || text.split(/\s+/).filter(Boolean);
  let x = x0;
  const ocrWords = tokens.map((token, wordIndex) => {
    const tw = Math.max(12, String(token).replace(/\.$/, "").length * 7);
    const item = {
      text: token,
      lineIndex,
      wordIndex,
      bbox: {
        x0: x, y0, x1: x + tw, y1: y0 + height, x, y: y0, width: tw, height,
      },
    };
    x += tw + 5;
    return item;
  });
  return {
    id: `l${lineIndex}`,
    text,
    lineIndex,
    confidence: 90,
    bbox: { x0, y0, x1: x0 + width, y1: y0 + height, x: x0, y: y0, width, height },
    words: ocrWords,
  };
}

describe("cross-line joining lives only in cross-line.js", () => {
  it("seed_phrase finder uses buildCrossLineWindows and has no local join geometry", () => {
    const src = extractFunctionSource("findSeedPhraseMatchesFromLines");
    assert.match(src, /buildCrossLineWindows\s*\(/);
    assert.doesNotMatch(src, /1\.5\s*\*|leftAlign|maxGap|isPlausibleLineWrap/);
    assert.match(CROSS_LINE_SRC, /export function buildCrossLineWindows/);
    assert.match(CROSS_LINE_SRC, /export function isPlausibleLineWrap/);

    // Runtime: period on first line → helper rejects → no seed join.
    const first = line("abandon ability able about above absent absorb abstract absurd access.", {
      y0: 20,
      lineIndex: 0,
      words: [
        "abandon", "ability", "able", "about", "above", "absent",
        "absorb", "abstract", "absurd", "access.",
      ],
    });
    const second = line("accident account", { y0: 40, lineIndex: 1 });
    assert.deepEqual(findSeedPhraseMatchesFromLines([first, second]), []);
  });

  it("bearer_token finder uses buildCrossLineWindows and has no local join geometry", () => {
    const src = extractFunctionSource("findBearerTokenMatchesFromLines");
    assert.match(src, /buildCrossLineWindows\s*\(/);
    assert.doesNotMatch(src, /1\.5\s*\*|leftAlign|maxGap|isPlausibleLineWrap/);
    // No hand-rolled consecutive-index join loop outside the helper call.
    assert.doesNotMatch(src, /for\s*\(\s*let\s+index\s*=\s*0;\s*index\s*<\s*list\.length\s*-\s*1/);

    const first = line("Authorization: Bearer eyJhbGciOi.", {
      y0: 10,
      lineIndex: 0,
      words: ["Authorization:", "Bearer", "eyJhbGciOi."],
    });
    const second = line("JIUzI1NiJ9.payload.sig99", { y0: 28, lineIndex: 1 });
    assert.deepEqual(findBearerTokenMatchesFromLines([first, second]), []);
  });

  it("IBAN finder uses buildCrossLineWindows and has no local join geometry", () => {
    const src = extractFunctionSource("findCrossLineIbanMatches");
    assert.match(src, /buildCrossLineWindows\s*\(/);
    assert.doesNotMatch(src, /1\.5\s*\*|leftAlign|maxGap|isPlausibleLineWrap/);
    assert.doesNotMatch(src, /for\s*\(\s*let\s+index\s*=\s*0;\s*index\s*<\s*list\.length\s*-\s*1/);

    // Big gap → helper rejects → no IBAN join even if texts would concatenate.
    const first = line("IBAN TR33 0006 1005 1978 6457", {
      y0: 10,
      lineIndex: 0,
      width: 520,
      words: ["IBAN", "TR33", "0006", "1005", "1978", "6457"],
    });
    const second = line("8413 26", { y0: 90, lineIndex: 1, x0: 30 });
    assert.deepEqual(findCrossLineIbanMatches([first, second]), []);
  });
});
