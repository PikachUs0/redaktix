/**
 * Shared cross-line join helper tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCrossLineWindows,
  isPlausibleLineWrap,
  wordsForJoinedRange,
} from "../src/js/cross-line.js";
import { fixtureSeedPhraseTwoLine12 } from "./fixtures/seed-phrase-ocr-words.js";

function line(text, { y0, x0 = 12, height = 14, width = null, lineIndex = 0 } = {}) {
  const w = width ?? Math.max(40, text.length * 7);
  const words = text.split(/\s+/).filter(Boolean).map((token, wordIndex) => {
    const tw = Math.max(12, token.length * 7);
    return {
      text: token,
      lineIndex,
      wordIndex,
      bbox: {
        x0: x0 + wordIndex * 20,
        y0,
        x1: x0 + wordIndex * 20 + tw,
        y1: y0 + height,
        x: x0 + wordIndex * 20,
        y: y0,
        width: tw,
        height,
      },
    };
  });
  return {
    id: `l${lineIndex}`,
    text,
    lineIndex,
    bbox: { x0, y0, x1: x0 + w, y1: y0 + height, x: x0, y: y0, width: w, height },
    words,
  };
}

describe("buildCrossLineWindows", () => {
  it("joins vertically adjacent left-aligned wrap lines with a char map", () => {
    const fixture = fixtureSeedPhraseTwoLine12();
    const windows = buildCrossLineWindows(fixture.lines);
    assert.ok(windows.length >= 1);
    const win = windows[0];
    assert.match(win.text, /abandon[\s\S]+account/);
    assert.equal(win.lineIndexes.length, 2);
    assert.ok(win.charMap.length >= win.text.length);
    const words = wordsForJoinedRange(win, 0, win.text.length);
    assert.ok(words.length >= 12);
  });

  it("rejects a big vertical gap, misaligned left edge without right-reach, or sentence end", () => {
    const base = line("abandon ability able about above absent absorb abstract absurd access", {
      y0: 20,
      lineIndex: 0,
      width: 500,
    });
    const far = line("accident account", { y0: 80, lineIndex: 1, x0: 12 });
    assert.equal(isPlausibleLineWrap(base, far), false);

    const indented = line("accident account", { y0: 40, lineIndex: 1, x0: 200 });
    // Short first line that does not reach block right → reject.
    const short = line("hello there", { y0: 20, lineIndex: 0, width: 80, x0: 12 });
    assert.equal(isPlausibleLineWrap(short, indented), false);

    const punct = line("please stop here.", { y0: 20, lineIndex: 0, width: 400 });
    const next = line("more words follow along", { y0: 40, lineIndex: 1, x0: 12 });
    assert.equal(isPlausibleLineWrap(punct, next), false);
    assert.deepEqual(buildCrossLineWindows([punct, next]), []);
  });
});
