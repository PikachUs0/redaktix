/**
 * Investigation + failing coverage tests for PEM body lines and Redis URL port.
 * Tests / fixtures only — no production source changes.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blackoutDetections } from "../src/js/app.js";
import {
  buildOcrCharacterIndex,
  detectionsForAutomaticRedaction,
  extractApiTokenCandidates,
  extractConnectionUrlCandidates,
  extractPrivateKeyBlocks,
  findPrivateKeyMatchesFromLines,
  getMatchBoundingBoxes,
} from "../src/js/sensitive-detectors.js";
import { detectStructuredDataFromLines } from "../src/js/structured-lines.js";
import {
  fixturePemBodyOnlyApiTokenPath,
  fixturePemPrivateKeyOcrSplit,
  fixtureRedisUrlPortSplit,
  PEM_BODY_LINE_1,
  PEM_BODY_LINE_2_PREFIX,
  PEM_BODY_LINE_2_TAIL,
} from "./fixtures/pem-redis-ocr-words.js";

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

function runStructured(fixture) {
  const imageSize = { width: fixture.imageWidth, height: fixture.imageHeight };
  const structured = detectStructuredDataFromLines(fixture.lines, {
    profileId: "global",
    imageSize,
    linesById: new Map(fixture.lines.map((line) => [line.id, line])),
  });
  const automatic = detectionsForAutomaticRedaction(structured);
  const rects = blackoutDetections(structured, fixture.imageWidth, fixture.imageHeight);
  return { structured, automatic, rects };
}

function missingWords(fixture, rects) {
  return fixture.mustCoverWordIndices
    .filter((index) => !rects.some((rect) => covers(rect, fixture.words[index].bbox)))
    .map((index) => `${index}:${fixture.words[index].text}`);
}

function wordIndexMap(words) {
  return words.map((word, index) => ({
    index,
    text: word.text,
    lineIndex: word.lineIndex,
    bbox: word.bbox,
  }));
}

describe("PEM / Redis coverage investigation report", () => {
  it("prints span, word indices, rects, and drop sites", () => {
    const pemFull = fixturePemPrivateKeyOcrSplit();
    const pemBody = fixturePemBodyOnlyApiTokenPath();
    const redis = fixtureRedisUrlPortSplit();

    const pemFullRun = runStructured(pemFull);
    const pemBodyRun = runStructured(pemBody);
    const redisRun = runStructured(redis);

    const pemIndexed = buildOcrCharacterIndex(pemFull.words);
    const pemBlocks = extractPrivateKeyBlocks(pemIndexed.text);
    const pemBoxText = (pemBlocks[0] || "").replace(/\n/g, " ");
    const pemMatchBoxes = pemBoxText ? getMatchBoundingBoxes(pemFull.words, pemBoxText, 0) : null;
    const pemMatches = findPrivateKeyMatchesFromLines(pemFull.lines);
    const pemMatchWordIndices = (pemMatches[0]?.words || []).map((word) =>
      pemFull.words.indexOf(word)
    );

    const redisExtracted = extractConnectionUrlCandidates(redis.lineTextWithSpace);
    const redisSpan = redisExtracted[0] || "";
    const redisBoxes = redisSpan ? getMatchBoundingBoxes(redis.words, redisSpan, 0) : null;
    const redisMatchedIndices = redisSpan
      ? redis.words
        .map((word, index) => (covers(redisBoxes, word.bbox) ? index : -1))
        .filter((index) => index >= 0)
      : [];

    const line2Text = `${PEM_BODY_LINE_2_PREFIX} ${PEM_BODY_LINE_2_TAIL}`;
    const apiLine2 = extractApiTokenCandidates(line2Text);
    const apiLine1Spaced = extractApiTokenCandidates(pemBody.lines[1].text);
    const apiLine1Continuous = extractApiTokenCandidates(PEM_BODY_LINE_1);
    const apiBodyTokens = pemBodyRun.structured
      .filter((item) => item.type === "api_token")
      .map((item) => item.text);

    const report = {
      pemScreenshotLike_apiTokenOnly: {
        note: "Broken BEGIN → no private_key. Matches editor: BEGIN/END uncovered; body1 + Nb uncovered; body2 prefix boxed.",
        lineTexts: pemBody.lines.map((line) => line.text),
        wordIndexMap: wordIndexMap(pemBody.words),
        a_matchedSpansAndWordIndices: {
          private_key: [],
          api_token_spans: apiBodyTokens,
          // body2 prefix maps to word index 5; Nb (index 6) is outside the span
          body2_api_token_maps_to_word_indices: [pemBody.body2PrefixWordIndex],
          body1_api_token_maps_to_word_indices: [],
          nb_word_index: pemBody.body2TailWordIndex,
        },
        b_rects: pemBodyRun.rects,
        c_dropSites: {
          firstBodyLine:
            "sensitive-detectors.js:extractHighEntropyTokens (lines 1384-1390) — regex \\b[A-Za-z0-9+/_=-]{40,}\\b; spaced OCR chunks (28+24) never match. Called from extractApiTokenCandidates (~674) → structured-lines.js detectStructuredDataFromLines (~276-314) → createDetection. No private_key: extractPrivateKeyBlocks (1746) needs PRIVATE KEY in BEGIN.",
          nbTail:
            "sensitive-detectors.js:extractHighEntropyTokens (1384-1390) on 'prefix Nb' keeps only the ≥40 prefix; 'Nb' is a separate \\b token <40. getMatchBoundingBoxes (1294) / envelopeForMatchedWords (1334) / createDetection (structured-lines.js:119) therefore never receive Nb.",
          portAnalog:
            "Same truncate-before-box pattern as Redis :6379.",
        },
        d_firstBodyLineTreatedDifferently:
          "No special-case skip for the first PEM body line in extractPrivateKeyBlocks or structured-lines. Difference is only OCR split length vs the 40-char high-entropy floor when private_key boxing is absent.",
        missingBodyWords: missingWords(pemBody, pemBodyRun.rects),
        probes: {
          apiLine1FromSpacedLineText: apiLine1Spaced,
          apiLine1FromContinuous: apiLine1Continuous,
          apiLine2FromSpacedWords: apiLine2,
        },
      },
      pemValidPrivateKeyPath: {
        note: "Valid BEGIN/END → private_key mega-rect covers body+Nb via envelopeForMatchedWords collapse. Does NOT match screenshot (BEGIN would be covered).",
        a_matchedSpan: pemBoxText,
        a_wordIndices: pemMatchWordIndices,
        a_matchWords: (pemMatches[0]?.words || []).map((word) => word.text),
        b_getMatchBoundingBoxesPerLine: pemMatchBoxes,
        b_finalRects: pemFullRun.rects.filter((rect) => rect.detectionType === "private_key"),
        c_dropSites_ifPrivateKeyAbsent: {
          firstBodyLine: "extractHighEntropyTokens @ sensitive-detectors.js:1384-1390",
          nbTail: "extractHighEntropyTokens @ sensitive-detectors.js:1384-1390",
        },
        d_firstBodyLineTreatedDifferently: false,
        missingBodyWords: missingWords(pemFull, pemFullRun.rects),
      },
      redis: {
        lineText: redis.lineTextWithSpace,
        a_matchedSpan: redisSpan,
        a_wordIndices: redisMatchedIndices,
        a_expectedUrl: redis.expectedUrl,
        b_getMatchBoundingBoxes: redisBoxes,
        b_finalRects: redisRun.rects.filter((rect) =>
          rect.detectionType === "connection_url" || rect.detectionType === "api_token"
        ),
        c_dropSites: {
          port6379:
            "First drop: sensitive-detectors.js CONNECTION_URL_PATTERN (679-680) / extractConnectionUrlCandidates (686-694) — host matcher stops at the OCR space before ':6379'. Trailing strip at 691 is secondary. Then structured-lines.js createDetection (119-133) + getMatchBoundingBoxes (1294) box only the truncated span; app.js blackoutDetections never sees ':6379'.",
        },
        portCovered: redisRun.rects.some((rect) =>
          covers(rect, redis.words[redis.portWordIndex].bbox)
        ),
      },
    };

    console.log("\n===== PEM / REDIS COVERAGE REPORT =====");
    console.log(JSON.stringify(report, null, 2));
    assert.ok(pemFull.words.length && redis.words.length);
  });
});

describe("PEM / Redis coverage (expected to fail until fixed)", () => {
  it("covers every PEM body word when only line-level api_token boxes paint (BEGIN uncovered)", () => {
    const fixture = fixturePemBodyOnlyApiTokenPath();
    const { rects } = runStructured(fixture);
    const missing = missingWords(fixture, rects);
    assert.deepEqual(
      missing,
      [],
      `PEM body words left uncovered under broken-BEGIN path: ${missing.join(", ")}`
    );
    assert.ok(
      fixture.body1WordIndices.every((index) =>
        rects.some((rect) => covers(rect, fixture.words[index].bbox))
      ),
      `first body line ${PEM_BODY_LINE_1} must be covered`
    );
    assert.ok(
      rects.some((rect) => covers(rect, fixture.words[fixture.body2TailWordIndex].bbox)),
      `trailing ${PEM_BODY_LINE_2_TAIL} must be covered`
    );
  });

  it("keeps trailing Nb inside the api_token span for a split PEM body line", () => {
    const spaced = `${PEM_BODY_LINE_2_PREFIX} ${PEM_BODY_LINE_2_TAIL}`;
    const tokens = extractApiTokenCandidates(spaced);
    assert.ok(
      tokens.some((token) => String(token).endsWith(PEM_BODY_LINE_2_TAIL)),
      `extractApiTokenCandidates dropped Nb from ${JSON.stringify(spaced)} → ${JSON.stringify(tokens)}`
    );
  });

  it("covers trailing Nb via api_token box extension on a tight OCR gap", () => {
    const fixture = fixturePemBodyOnlyApiTokenPath();
    const { rects } = runStructured(fixture);
    assert.ok(
      rects.some((rect) =>
        rect.detectionType === "api_token"
        && covers(rect, fixture.words[fixture.body2TailWordIndex].bbox)
      ),
      "api_token blackout must cover Nb when the next OCR word sits within ~1 character width"
    );
  });

  it("does not extend an api_token box across a real space gap to Hello", () => {
    // High-entropy api_token (not Stripe sk_live_, which has its own whitespace glue).
    const token = "xYz0123456789ABCDEFGHIJKLMNOPQRSTUVWabcdefghijklmnopqrstuv";
    const charWidth = 8;
    const tokenWidth = token.length * charWidth;
    const helloGap = charWidth * 3;
    const helloX = 12 + tokenWidth + helloGap;
    const words = [
      {
        text: token,
        confidence: 90,
        bbox: {
          x0: 12, y0: 20, x1: 12 + tokenWidth, y1: 34,
          x: 12, y: 20, width: tokenWidth, height: 14, w: tokenWidth, h: 14,
        },
        lineId: "0-0-0",
        lineIndex: 0,
        wordIndex: 0,
      },
      {
        text: "Hello",
        confidence: 90,
        bbox: {
          x0: helloX, y0: 20, x1: helloX + 5 * charWidth, y1: 34,
          x: helloX, y: 20, width: 5 * charWidth, height: 14, w: 5 * charWidth, h: 14,
        },
        lineId: "0-0-0",
        lineIndex: 0,
        wordIndex: 1,
      },
    ];
    const line = {
      id: "0-0-0",
      text: `${token}  Hello`,
      confidence: 90,
      bbox: {
        x0: 12, y0: 20, x1: helloX + 5 * charWidth, y1: 34,
        x: 12, y: 20, width: helloX + 5 * charWidth - 12, height: 14,
      },
      words,
      lineIndex: 0,
    };
    const { rects } = runStructured({
      imageWidth: 900,
      imageHeight: 60,
      lines: [line],
      words,
      mustCoverWordIndices: [],
    });
    const tokenRects = rects.filter((rect) => rect.detectionType === "api_token");
    assert.ok(tokenRects.length, "expected an api_token detection");
    assert.ok(
      tokenRects.every((rect) => !covers(rect, words[1].bbox)),
      "Hello after a real multi-character gap must not be covered by api_token extension"
    );
  });

  it("covers the entire Redis URL including the :6379 port word", () => {
    const fixture = fixtureRedisUrlPortSplit();
    const extracted = extractConnectionUrlCandidates(fixture.lineTextWithSpace);
    assert.ok(
      extracted.some((item) => item.replace(/\s+/g, "").endsWith(":6379")),
      `extractConnectionUrlCandidates dropped the port; got ${JSON.stringify(extracted)} from lineText=${JSON.stringify(fixture.lineTextWithSpace)}`
    );
    const { rects, structured } = runStructured(fixture);
    assert.ok(structured.some((item) => item.type === "connection_url"));
    const missing = fixture.urlWordIndices
      .filter((index) => !rects.some((rect) => covers(rect, fixture.words[index].bbox)))
      .map((index) => `${index}:${fixture.words[index].text}`);
    assert.deepEqual(missing, [], `Redis URL words left uncovered: ${missing.join(", ")}`);
  });
});
