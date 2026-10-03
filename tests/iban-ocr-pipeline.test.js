import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blackoutDetections } from "../src/js/app.js";
import { SAMPLE_CUSTOM_RULES, extractCustomRuleMatches } from "../src/js/custom-rules.js";
import {
  buildOcrCharacterIndex,
  detectGroupedSecretsInScan,
  envelopeForMatchedWords,
  extractIbanCandidates,
  getMatchBoundingBoxes,
  mergeGroupedOcrWords,
  normalizeBox,
} from "../src/js/sensitive-detectors.js";
import { detectStructuredDataFromLines } from "../src/js/structured-lines.js";
import { IBAN_OCR_FIXTURES } from "./fixtures/iban-ocr-words.js";

const IBAN_RULE = SAMPLE_CUSTOM_RULES[0];

function rectCoversBox(rect, box, epsilon = 0.5) {
  if (!rect || !box) return false;
  const rx0 = Number(rect.x0 ?? rect.x);
  const ry0 = Number(rect.y0 ?? rect.y);
  const rx1 = Number.isFinite(Number(rect.x1)) ? Number(rect.x1) : rx0 + Number(rect.width);
  const ry1 = Number.isFinite(Number(rect.y1)) ? Number(rect.y1) : ry0 + Number(rect.height);
  return rx0 <= box.x0 + epsilon &&
    ry0 <= box.y0 + epsilon &&
    rx1 >= box.x1 - epsilon &&
    ry1 >= box.y1 - epsilon;
}

function unionRects(rects) {
  if (!rects.length) return null;
  const x0 = Math.min(...rects.map((rect) => Number(rect.x0 ?? rect.x)));
  const y0 = Math.min(...rects.map((rect) => Number(rect.y0 ?? rect.y)));
  const x1 = Math.max(...rects.map((rect) => Number.isFinite(Number(rect.x1)) ? Number(rect.x1) : Number(rect.x) + Number(rect.width)));
  const y1 = Math.max(...rects.map((rect) => Number.isFinite(Number(rect.y1)) ? Number(rect.y1) : Number(rect.y) + Number(rect.height)));
  return { x0, y0, x1, y1, x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function spanWordIndices(indexed, start, length) {
  const end = start + length;
  const indices = [];
  const seen = new Set();
  for (let index = start; index < end; index += 1) {
    const entry = indexed.chars[index];
    if (!entry?.word || seen.has(entry.word)) continue;
    seen.add(entry.word);
    const wordIndex = indexed.spans.findIndex((span) => span.word === entry.word);
    if (wordIndex >= 0) indices.push(wordIndex);
  }
  return indices;
}

/**
 * Editor IBAN path without DOM:
 * 1) detectGroupedSecretsInScan / mergeGroupedOcrWords (word-adjacency merge)
 * 2) custom IBAN rule on each OCR line.text + envelopeForMatchedWords(line.words)
 * Final redaction rects: blackoutDetections on normalized detections.
 */
function runIbanPipeline(fixture) {
  const reports = [];
  const detections = [];

  const grouped = mergeGroupedOcrWords(fixture.words);
  const groupedDetections = detectGroupedSecretsInScan(
    fixture.words,
    fixture.imageWidth,
    fixture.imageHeight
  );
  for (const match of grouped) {
    const indexed = buildOcrCharacterIndex(match.words);
    const start = 0;
    const end = indexed.text.length;
    reports.push({
      detector: "mergeGroupedOcrWords / detectGroupedSecretsInScan (iban custom_rule)",
      lineText: indexed.text,
      matchedSpan: { start, end, text: match.text },
      wordIndicesInMatch: match.words.map((word) => fixture.words.indexOf(word)),
      bbox: match.bbox,
      ruleId: match.ruleId || null,
      type: match.type,
    });
  }
  detections.push(...groupedDetections);

  const structured = detectStructuredDataFromLines(fixture.lines, {
    profileId: "global-turkey",
    imageSize: { width: fixture.imageWidth, height: fixture.imageHeight },
    linesById: new Map(fixture.lines.map((line) => [line.id, line])),
  });
  for (const detection of structured) {
    if (detection.ruleId !== "iban" && detection.type !== "custom_rule") continue;
    reports.push({
      detector: "detectStructuredDataFromLines (cross-line / IBAN policy)",
      lineText: detection.text,
      matchedSpan: { start: 0, end: detection.text.length, text: detection.text },
      wordIndicesInMatch: [],
      bbox: {
        x0: detection.normX * fixture.imageWidth,
        y0: detection.normY * fixture.imageHeight,
        x1: (detection.normX + detection.normWidth) * fixture.imageWidth,
        y1: (detection.normY + detection.normHeight) * fixture.imageHeight,
      },
      ruleId: detection.ruleId || null,
      type: detection.type,
    });
    detections.push(detection);
  }

  for (const line of fixture.lines) {
    const matches = extractCustomRuleMatches(IBAN_RULE, line.text);
    for (const text of matches) {
      const start = line.text.indexOf(text);
      const end = start + text.length;
      const envelope = envelopeForMatchedWords(line.words, text);
      const indexedLine = buildOcrCharacterIndex(line.words);
      const rangeStart = indexedLine.text.indexOf(text);
      const mapped = rangeStart >= 0
        ? spanWordIndices(indexedLine, rangeStart, text.length).map((local) => fixture.words.indexOf(line.words[local]))
        : [];
      const normalized = envelope
        ? normalizeBox(envelope, fixture.imageWidth, fixture.imageHeight)
        : null;
      reports.push({
        detector: "custom_rule iban on OCR line.text + envelopeForMatchedWords",
        lineText: line.text,
        matchedSpan: { start, end, text },
        wordIndicesInMatch: mapped,
        bbox: envelope,
        ruleId: "iban",
        type: "custom_rule",
      });
      if (normalized) {
        detections.push({
          id: `line-iban-${line.lineIndex}-${start}`,
          type: "custom_rule",
          ruleId: "iban",
          text,
          confidence: line.confidence,
          normX: normalized.normX,
          normY: normalized.normY,
          normWidth: normalized.normWidth,
          normHeight: normalized.normHeight,
        });
      }
    }
  }

  const allWordsIndexed = buildOcrCharacterIndex(fixture.words);
  const direct = extractIbanCandidates(allWordsIndexed.text.replace(/\n/g, " "));
  const fullEnvelope = getMatchBoundingBoxes(fixture.words, fixture.expectedIban);
  const redactionRects = blackoutDetections(detections, fixture.imageWidth, fixture.imageHeight);
  const pixelRects = detections.map((detection) => ({
    x: detection.normX * fixture.imageWidth,
    y: detection.normY * fixture.imageHeight,
    width: detection.normWidth * fixture.imageWidth,
    height: detection.normHeight * fixture.imageHeight,
    x0: detection.normX * fixture.imageWidth,
    y0: detection.normY * fixture.imageHeight,
    x1: (detection.normX + detection.normWidth) * fixture.imageWidth,
    y1: (detection.normY + detection.normHeight) * fixture.imageHeight,
    text: detection.text,
    type: detection.type,
    ruleId: detection.ruleId,
  }));

  return {
    allWordsIndexedText: allWordsIndexed.text,
    directIbanCandidates: direct,
    fullEnvelope,
    grouped,
    reports,
    detections,
    pixelRects,
    redactionRects,
  };
}

function analyzeCoverage(fixture, pipeline) {
  const ibanWords = fixture.ibanWordIndices.map((index) => ({
    index,
    word: fixture.words[index],
  }));
  const union = unionRects(pipeline.pixelRects);
  const covered = [];
  const dropped = [];
  for (const item of ibanWords) {
    const hit = pipeline.pixelRects.some((rect) => rectCoversBox(rect, item.word.bbox)) ||
      rectCoversBox(union, item.word.bbox);
    if (hit) covered.push(item.index);
    else dropped.push(item);
  }

  const overlaps = [];
  for (let first = 0; first < pipeline.pixelRects.length; first += 1) {
    for (let second = first + 1; second < pipeline.pixelRects.length; second += 1) {
      const a = pipeline.pixelRects[first];
      const b = pipeline.pixelRects[second];
      const overlap = !(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0);
      if (overlap) overlaps.push([first, second, a.text, b.text]);
    }
  }

  return { covered, dropped, union, overlaps };
}

function dropReason(fixture, item, pipeline) {
  const text = item.word.text;
  const inGrouped = pipeline.grouped.some((match) => match.words.includes(item.word));
  if (!inGrouped) {
    const neighbors = fixture.words.filter((word) => word.lineIndex === item.word.lineIndex);
    const sorted = [...neighbors].sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const position = sorted.indexOf(item.word);
    if (position > 0) {
      const previous = sorted[position - 1];
      const gap = item.word.bbox.x0 - previous.bbox.x1;
      const height = Math.max(item.word.bbox.height, previous.bbox.height, 1);
      const maxGap = Math.max(20, height * 2.2);
      if (gap > maxGap) {
        return `mergeGroupedOcrWords (sensitive-detectors.js ~1501) stopped before "${text}" because ipv6WordsAdjacent (line ~1361) rejected gap=${gap.toFixed(1)} > max=${maxGap.toFixed(1)}`;
      }
    }
    if (item.word.lineIndex > 0) {
      return `mergeGroupedOcrWords / groupPhoneWords (sensitive-detectors.js ~1494 via samePhoneRow ~341) never joined line ${item.word.lineIndex} word "${text}" with the previous IBAN line`;
    }
    return `mergeGroupedOcrWords never included "${text}" in a hit (groupedSecretHit exact-equality check, sensitive-detectors.js ~1479)`;
  }
  if (!pipeline.fullEnvelope) {
    return `getMatchBoundingBoxes (sensitive-detectors.js ~1070) returned null for expected IBAN across the built character index`;
  }
  return `pixel/redaction rects from detectGroupedSecretsInScan + line custom_rule did not cover "${text}"`;
}

describe("IBAN OCR word fixtures through the real detector pipeline", () => {
  for (const fixture of IBAN_OCR_FIXTURES) {
    it(`${fixture.id}: union of final rects covers every IBAN word box`, () => {
      const pipeline = runIbanPipeline(fixture);
      const analysis = analyzeCoverage(fixture, pipeline);

      const report = {
        fixture: fixture.id,
        a_lineTextAndSpan: pipeline.reports.map((entry) => ({
          detector: entry.detector,
          lineText: entry.lineText,
          matchedSpan: entry.matchedSpan,
        })),
        b_wordIndices: pipeline.reports.map((entry) => ({
          detector: entry.detector,
          wordIndices: entry.wordIndicesInMatch,
        })),
        c_detectors: pipeline.reports.map((entry) => ({
          detector: entry.detector,
          type: entry.type,
          ruleId: entry.ruleId,
          spanText: entry.matchedSpan.text,
        })),
        d_finalRects: {
          pixelRects: pipeline.pixelRects,
          redactionRects: pipeline.redactionRects,
          union: analysis.union,
        },
        e_dropped: analysis.dropped.map((item) => ({
          wordIndex: item.index,
          text: item.word.text,
          bbox: item.word.bbox,
          reason: dropReason(fixture, item, pipeline),
        })),
        overlaps: analysis.overlaps,
        indexedText: pipeline.allWordsIndexedText,
        groupedTexts: pipeline.grouped.map((match) => match.text),
        fullEnvelope: pipeline.fullEnvelope,
      };

      console.log(`\n===== IBAN FIXTURE REPORT: ${fixture.id} =====`);
      console.log(JSON.stringify(report, null, 2));

      assert.equal(
        analysis.dropped.length,
        0,
        `${fixture.id} dropped IBAN words: ${analysis.dropped.map((item) => `${item.index}:${item.word.text}`).join(", ")}`
      );
      for (const index of fixture.ibanWordIndices) {
        assert.ok(
          analysis.covered.includes(index),
          `${fixture.id} missing coverage for word ${index} (${fixture.words[index].text})`
        );
      }
    });
  }
});
