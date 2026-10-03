/**
 * Investigation + failing tests: OCR-wrapped seed phrases across 2 lines.
 * Tests / fixtures only — no production source changes.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blackoutDetections } from "../src/js/app.js";
import {
  detectionsForAutomaticRedaction,
  extractSeedPhraseMatches,
} from "../src/js/sensitive-detectors.js";
import { detectStructuredDataFromLines } from "../src/js/structured-lines.js";
import {
  fixtureSeedPhraseSingleLine12,
  fixtureSeedPhraseTwoLine12,
  fixtureSeedPhraseTwoLine24,
  SEED_12_WORDS,
  SEED_24_WORDS,
} from "./fixtures/seed-phrase-ocr-words.js";

function runStructured(fixture) {
  const imageSize = { width: fixture.imageWidth, height: fixture.imageHeight };
  const structured = detectStructuredDataFromLines(fixture.lines, {
    profileId: "global",
    imageSize,
    linesById: new Map(fixture.lines.map((line) => [line.id, line])),
  });
  const automatic = detectionsForAutomaticRedaction(structured);
  const reviewOnly = structured.filter((item) => item?.review?.needsReview);
  const rects = blackoutDetections(structured, fixture.imageWidth, fixture.imageHeight);
  return { structured, automatic, reviewOnly, rects };
}

describe("seed_phrase cross-line investigation report", () => {
  it("prints lines seen, spans, join status, and drop site", () => {
    const twoLine = fixtureSeedPhraseTwoLine12();
    const oneLine = fixtureSeedPhraseSingleLine12();

    const perLineExtracts = twoLine.lines.map((line) => ({
      lineIndex: line.lineIndex,
      text: line.text,
      tokenCount: line.text.trim().split(/\s+/).length,
      extractSeedPhraseMatches: extractSeedPhraseMatches(line.text),
    }));
    const joinedText = twoLine.lines.map((line) => line.text).join(" ");
    const joinedExtract = extractSeedPhraseMatches(joinedText);

    const twoRun = runStructured(twoLine);
    const oneRun = runStructured(oneLine);

    const report = {
      realEditorShape: {
        line0: twoLine.lines[0].text,
        line1: twoLine.lines[1].text,
        line0TokenCount: twoLine.line0WordCount,
        line1TokenCount: twoLine.line1WordCount,
        totalWords: twoLine.expectedWordCount,
      },
      detectorSawPerLine: perLineExtracts,
      joinedAcrossLinesIfCalledManually: {
        joinedText,
        matchedSpan: joinedExtract[0]?.text || null,
        matchCount: joinedExtract.length,
      },
      pipelineTwoLine: {
        seedDetections: twoRun.structured.filter((item) => item.type === "seed_phrase"),
        reviewOnlyCount: twoRun.reviewOnly.filter((item) => item.type === "seed_phrase").length,
        automaticSeedCount: twoRun.automatic.filter((item) => item.type === "seed_phrase").length,
        rectCount: twoRun.rects.filter((rect) => rect.detectionType === "seed_phrase").length,
      },
      pipelineSingleLineControl: {
        seedDetections: oneRun.structured.filter((item) => item.type === "seed_phrase").map((item) => ({
          text: item.text,
          needsReview: item.review?.needsReview,
        })),
        reviewOnlyCount: oneRun.reviewOnly.filter((item) => item.type === "seed_phrase").length,
      },
      crossLineJoinedByPipeline:
        twoRun.structured.filter((item) => item.type === "seed_phrase").length > 0,
      dropSite: {
        note:
          "Fixed via buildCrossLineWindows + findSeedPhraseMatchesFromLines; per-line extract alone still misses 10+2 wraps.",
      },
    };

    console.log("\n===== SEED PHRASE CROSS-LINE REPORT =====");
    console.log(JSON.stringify(report, null, 2));

    assert.equal(perLineExtracts[0].extractSeedPhraseMatches.length, 0);
    assert.equal(perLineExtracts[1].extractSeedPhraseMatches.length, 0);
    assert.equal(joinedExtract.length, 1, "joined line texts MUST match when called manually");
    assert.ok(
      twoRun.structured.filter((item) => item.type === "seed_phrase").length >= 1,
      "two-line wrap must be detected after cross-line helper wiring"
    );
  });
});

describe("seed_phrase cross-line coverage (expected to fail until fixed)", () => {
  it("detects a 12-word lowercase run wrapped across 2 OCR lines as review-only seed_phrase", () => {
    const fixture = fixtureSeedPhraseTwoLine12();
    const { structured, automatic, reviewOnly, rects } = runStructured(fixture);
    const seeds = structured.filter((item) => item.type === "seed_phrase");
    assert.ok(seeds.length >= 1, "wrapped 12-word seed must be detected");
    assert.ok(seeds.every((item) => item.review?.needsReview === true));
    assert.deepEqual(
      automatic.filter((item) => item.type === "seed_phrase"),
      [],
      "seed_phrase must never auto-apply"
    );
    assert.ok(
      reviewOnly.some((item) => item.type === "seed_phrase"),
      "seed_phrase must appear in the review list (needsReview)"
    );

    const seedRects = rects.filter((rect) => rect.detectionType === "seed_phrase");
    // Review-only: blackoutDetections uses detectionsForAutomaticRedaction and skips needsReview.
    // Assert detection geometry instead: one norm box per line (or equivalent multi-detection).
    const yBands = new Set(seeds.map((item) => Math.round(Number(item.normY) * fixture.imageHeight)));
    assert.ok(
      yBands.size >= 2 || seeds.length >= 2,
      `expected one rect/detection per line; seeds=${seeds.length} ys=${[...yBands]} autoRects=${seedRects.length}`
    );
    // Explicit: full 12-word span must be represented
    const joined = seeds.map((item) => item.text).join(" ");
    assert.ok(
      SEED_12_WORDS.every((word) => joined.includes(word) || seeds.some((item) => item.text.includes(word))),
      "all twelve words must appear in seed_phrase detection text"
    );
  });

  it("detects a 24-word lowercase run wrapped across 2 OCR lines as review-only seed_phrase", () => {
    const fixture = fixtureSeedPhraseTwoLine24();
    const { structured, automatic, reviewOnly } = runStructured(fixture);
    const seeds = structured.filter((item) => item.type === "seed_phrase");
    // Per-line extract may catch a 12-word subset on the longer line; require the FULL 24-word run.
    const covered = seeds.map((item) => item.text).join(" ");
    const missing = SEED_24_WORDS.filter(
      (word) => !covered.includes(word) && !seeds.some((item) => item.text.includes(word))
    );
    assert.deepEqual(
      missing,
      [],
      `wrapped 24-word seed must cover every word (cross-line join); missing=${missing.join(", ")} seeds=${JSON.stringify(seeds.map((s) => s.text))}`
    );
    assert.ok(seeds.every((item) => item.review?.needsReview === true));
    assert.deepEqual(automatic.filter((item) => item.type === "seed_phrase"), []);
    assert.ok(reviewOnly.some((item) => item.type === "seed_phrase"));
    const yBands = new Set(seeds.map((item) => Math.round(Number(item.normY) * fixture.imageHeight)));
    assert.ok(
      yBands.size >= 2 || seeds.length >= 2,
      "one rect/detection per wrapped line for the full 24-word run"
    );
  });

  it("keeps single-line 12-word seeds in the review list (not auto-applied)", () => {
    const fixture = fixtureSeedPhraseSingleLine12();
    const { structured, automatic, reviewOnly } = runStructured(fixture);
    const seeds = structured.filter((item) => item.type === "seed_phrase");
    assert.ok(seeds.length >= 1);
    assert.ok(seeds.every((item) => item.review?.needsReview === true));
    assert.deepEqual(automatic.filter((item) => item.type === "seed_phrase"), []);
    assert.ok(reviewOnly.some((item) => item.type === "seed_phrase"));
  });

  it("does not join unrelated lines into a false seed_phrase", () => {
    // Same 12 lowercase words, but first line ends with a period → helper must not join.
    const a = {
      id: "u0",
      text: "abandon ability able about above absent absorb abstract absurd access.",
      lineIndex: 0,
      confidence: 90,
      bbox: { x0: 12, y0: 20, x1: 500, y1: 34, x: 12, y: 20, width: 488, height: 14 },
      words: SEED_12_WORDS.slice(0, 10).map((text, wordIndex) => ({
        text: wordIndex === 9 ? `${text}.` : text,
        lineIndex: 0,
        wordIndex,
        bbox: {
          x0: 12 + wordIndex * 40, y0: 20, x1: 40 + wordIndex * 40, y1: 34,
          x: 12 + wordIndex * 40, y: 20, width: 28, height: 14,
        },
      })),
    };
    a.words[9].text = "access.";
    const b = {
      id: "u1",
      text: "accident account",
      lineIndex: 1,
      confidence: 90,
      bbox: { x0: 12, y0: 40, x1: 120, y1: 54, x: 12, y: 40, width: 108, height: 14 },
      words: SEED_12_WORDS.slice(10).map((text, wordIndex) => ({
        text,
        lineIndex: 1,
        wordIndex,
        bbox: {
          x0: 12 + wordIndex * 50, y0: 40, x1: 50 + wordIndex * 50, y1: 54,
          x: 12 + wordIndex * 50, y: 40, width: 40, height: 14,
        },
      })),
    };
    // Far left-edge / big gap pair that would form 12 words if wrongly joined.
    const c = {
      id: "u2",
      text: SEED_12_WORDS.slice(0, 6).join(" "),
      lineIndex: 0,
      confidence: 90,
      bbox: { x0: 12, y0: 20, x1: 200, y1: 34, x: 12, y: 20, width: 188, height: 14 },
      words: SEED_12_WORDS.slice(0, 6).map((text, wordIndex) => ({
        text,
        lineIndex: 0,
        wordIndex,
        bbox: {
          x0: 12 + wordIndex * 30, y0: 20, x1: 30 + wordIndex * 30, y1: 34,
          x: 12 + wordIndex * 30, y: 20, width: 24, height: 14,
        },
      })),
    };
    const d = {
      id: "u3",
      text: SEED_12_WORDS.slice(6).join(" "),
      lineIndex: 1,
      confidence: 90,
      bbox: { x0: 220, y0: 90, x1: 420, y1: 104, x: 220, y: 90, width: 200, height: 14 },
      words: SEED_12_WORDS.slice(6).map((text, wordIndex) => ({
        text,
        lineIndex: 1,
        wordIndex,
        bbox: {
          x0: 220 + wordIndex * 30, y0: 90, x1: 244 + wordIndex * 30, y1: 104,
          x: 220 + wordIndex * 30, y: 90, width: 24, height: 14,
        },
      })),
    };

    for (const pair of [[a, b], [c, d]]) {
      const { structured } = runStructured({
        imageWidth: 640,
        imageHeight: 140,
        lines: pair,
        words: pair.flatMap((line) => line.words),
      });
      const seeds = structured.filter((item) => item.type === "seed_phrase");
      assert.equal(
        seeds.length,
        0,
        `unrelated/non-wrap lines must not form seed_phrase; texts=${pair.map((l) => l.text).join(" | ")}`
      );
    }
  });
});
