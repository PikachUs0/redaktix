import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  discoverSuspiciousRois,
  expandRoiToBadgeLine,
  forceBadgeRoiPadding,
  grayscaleStats,
  intersectionOverUnion,
  mapRoiBoxToOriginal,
  mergeSpatialCandidates,
  sauvolaThreshold,
  spatiallyDuplicate,
  sameTcknGlyph,
} from "../src/js/ocr-adaptive.js";
import { findPass2TcknTexts, tcknEvidence } from "../src/js/sensitive-detectors.js";

describe("ocr adaptive helpers", () => {
  it("maps a 3x ROI box back onto the original image", () => {
    const mapped = mapRoiBoxToOriginal(
      { x0: 30, y0: 15, x1: 90, y1: 45 },
      { x: 40, y: 120 },
      3
    );
    assert.equal(mapped.x0, 50);
    assert.equal(mapped.y0, 125);
    assert.equal(mapped.width, 20);
    assert.equal(mapped.height, 10);
  });

  it("keeps two identical TCKNs on different lines", () => {
    const merged = mergeSpatialCandidates([
      { text: "12345678950", bbox: { x0: 10, y0: 20, x1: 180, y1: 48 } },
      { text: "12345678950", bbox: { x0: 10, y0: 140, x1: 180, y1: 168 } },
    ]);
    assert.equal(merged.length, 2);
    assert.equal(intersectionOverUnion(merged[0].bbox, merged[1].bbox), 0);
  });

  it("keeps the same TCKN on line 1 and line 2", () => {
    const merged = mergeSpatialCandidates([
      { text: "12345678950", bbox: { x0: 40, y0: 48, x1: 320, y1: 74 } },
      { text: "12345678950", bbox: { x0: 36, y0: 196, x1: 340, y1: 226 } },
    ]);
    assert.equal(merged.length, 2);
    assert.equal(spatiallyDuplicate(merged[0].bbox, merged[1].bbox), false);
    const stacked = mergeSpatialCandidates([
      { text: "12345678950", bbox: { x0: 40, y0: 48, x1: 320, y1: 74 } },
      { text: "12345678950", bbox: { x0: 44, y0: 50, x1: 318, y1: 72 } },
    ]);
    assert.equal(stacked.length, 1);
    const closeLines = mergeSpatialCandidates([
      { text: "12345678950", bbox: { x0: 80, y0: 10, x1: 280, y1: 24 } },
      { text: "12345678950", bbox: { x0: 90, y0: 30, x1: 290, y1: 44 } },
    ]);
    assert.equal(closeLines.length, 2);
    assert.equal(spatiallyDuplicate(closeLines[0].bbox, closeLines[1].bbox), false);
    assert.equal(sameTcknGlyph(
      { x0: 40, y0: 8, x1: 280, y1: 36 },
      { x0: 150, y0: 48, x1: 430, y1: 84 },
    ), false);
    assert.equal(sameTcknGlyph(
      { x0: 40, y0: 48, x1: 320, y1: 74 },
      { x0: 44, y0: 50, x1: 318, y1: 72 },
    ), true);
  });

  it("reports checksum evidence without treating it as a real identity", () => {
    const evidence = tcknEvidence("1234567895O");
    assert.equal(evidence.valid, true);
    assert.deepEqual(evidence.evidence, ["11-digit", "first-digit-nonzero", "checksum-valid"]);
    assert.equal(tcknEvidence("10000000050").valid, false);
    assert.deepEqual(findPass2TcknTexts("12345678950"), ["12345678950"]);
    assert.deepEqual(findPass2TcknTexts("123456789501"), ["12345678950"]);
    assert.deepEqual(findPass2TcknTexts("4111111111111111"), []);
  });

  it("writes a non-uniform Sauvola image and does not mutate the source", () => {
    const width = 48;
    const height = 32;
    const gray = new Float32Array(width * height);
    gray.fill(70);
    for (let y = 8; y < 24; y += 1) {
      for (let x = 8; x < 16; x += 1) gray[y * width + x] = 20;
    }
    const source = Float32Array.from(gray);
    const binary = sauvolaThreshold(gray, width, height, { window: 15, k: 0.18, R: 128 });
    assert.deepEqual(gray, source);
    const stats = grayscaleStats(binary, width, height);
    assert.ok(stats.foregroundRatio > 0.01 && stats.foregroundRatio < 0.99);
    assert.ok(stats.max - stats.min > 100);
  });

  it("finds a dark badge and leaves a high-contrast code block alone", () => {
    const width = 180;
    const height = 120;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      data[index * 4] = 12;
      data[index * 4 + 1] = 12;
      data[index * 4 + 2] = 14;
      data[index * 4 + 3] = 255;
    }
    const fill = (x, y, w, h, color) => {
      for (let row = y; row < y + h; row += 1) {
        for (let column = x; column < x + w; column += 1) {
          const offset = (row * width + column) * 4;
          data[offset] = color;
          data[offset + 1] = color;
          data[offset + 2] = color;
        }
      }
    };
    fill(10, 8, 140, 36, 245);
    fill(16, 16, 40, 16, 10);
    fill(10, 70, 140, 36, 64);
    fill(16, 78, 40, 16, 96);
    const rois = discoverSuspiciousRois(data, width, height, [
      { x0: 10, y0: 8, x1: 150, y1: 44 },
    ]);
    assert.ok(rois.length >= 1);
    assert.ok(rois.some((roi) => roi.y < 90 && roi.y + roi.height > 78));
  });

  it("extends a right-hand badge fragment across the full pill", () => {
    const width = 520;
    const height = 140;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      data[index * 4] = 10;
      data[index * 4 + 1] = 10;
      data[index * 4 + 2] = 12;
      data[index * 4 + 3] = 255;
    }
    for (let y = 40; y < 96; y += 1) {
      for (let x = 30; x < 480; x += 1) {
        const offset = (y * width + x) * 4;
        data[offset] = 64;
        data[offset + 1] = 64;
        data[offset + 2] = 64;
      }
    }
    const fragment = { x: 300, y: 48, width: 120, height: 36 };
    const roi = expandRoiToBadgeLine(data, width, height, fragment);
    assert.ok(roi.x <= 30, `ROI starts too far right: ${JSON.stringify(roi)}`);
    assert.ok(roi.x + roi.width >= 470, `ROI misses the pill's right side: ${JSON.stringify(roi)}`);
    assert.ok(roi.width - fragment.width >= 40, "horizontal padding is missing");
  });

  it("pads a tight glyph box by 120px on each side", () => {
    const padded = forceBadgeRoiPadding({ x: 200, y: 40, width: 180, height: 36 }, 800);
    assert.equal(padded.x, 80);
    assert.equal(padded.width, 420);
    assert.equal(padded.y, 40);
    const clamped = forceBadgeRoiPadding({ x: 40, y: 10, width: 90, height: 20 }, 800);
    assert.equal(clamped.x, 0);
    assert.equal(clamped.width, 250);
  });
});
