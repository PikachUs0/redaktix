import assert from "node:assert/strict";
import { deflateSync, inflateSync } from "node:zlib";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createWorker } from "tesseract.js";
import { fileURLToPath } from "node:url";
import {
  adaptiveThresholdGray,
  contrastForOcr,
  cropRgba,
  cropTextBand,
  discoverSuspiciousRois,
  forceBadgeRoiPadding,
  grayscaleFromRgba,
  grayscaleStats,
  invertGray,
  mapRoiBoxToOriginal,
  mergeSpatialCandidates,
  upscaleGray,
  OCR_ADAPTIVE_DEFAULTS,
} from "../src/js/ocr-adaptive.js";
import { findTcknMatches, tcknEvidence } from "../src/js/sensitive-detectors.js";

const DIGITS = {
  0: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  3: ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  4: ["00100", "01100", "10100", "10100", "11111", "00100", "00100"],
  5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  6: ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
};

function paintDigit(data, width, digit, originX, originY, scale, color, background) {
  const rows = DIGITS[digit];
  rows.forEach((row, rowIndex) => {
    [...row].forEach((bit, columnIndex) => {
      for (let y = 0; y < scale; y += 1) {
        for (let x = 0; x < scale; x += 1) {
          const edge = x === 0 || y === 0 || x === scale - 1 || y === scale - 1;
          const ink = bit === "1";
          const pixel = ink ? (edge ? Math.round((color + background) / 2) : color) : background;
          const targetX = originX + columnIndex * scale + x;
          const targetY = originY + rowIndex * scale + y;
          const offset = (targetY * width + targetX) * 4;
          data[offset] = pixel;
          data[offset + 1] = pixel;
          data[offset + 2] = pixel;
          data[offset + 3] = 255;
        }
      }
    });
  });
}

function paintNumber(data, width, text, originX, originY, scale, color, background) {
  let cursor = originX;
  [...text].forEach((digit) => {
    paintDigit(data, width, digit, cursor, originY, scale, color, background);
    cursor += 5 * scale + scale;
  });
}

function fillRect(data, width, x, y, rectWidth, rectHeight, color) {
  for (let row = y; row < y + rectHeight; row += 1) {
    for (let column = x; column < x + rectWidth; column += 1) {
      const offset = (row * width + column) * 4;
      data[offset] = color;
      data[offset + 1] = color;
      data[offset + 2] = color;
      data[offset + 3] = 255;
    }
  }
}

function createBadgeFixture() {
  const width = 760;
  const height = 280;
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = 10;
    data[index * 4 + 1] = 10;
    data[index * 4 + 2] = 12;
  }
  fillRect(data, width, 24, 24, 700, 90, 244);
  paintNumber(data, width, "12345678950", 40, 36, 8, 12, 244);
  fillRect(data, width, 24, 150, 700, 96, 62);
  paintNumber(data, width, "12345678950", 40, 164, 8, 96, 62);
  return { data, width, height };
}

function encodePng(rgba, width, height) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const chunk = (type, body) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const kind = Buffer.from(type);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([kind, body])) >>> 0);
    return Buffer.concat([length, kind, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

function decodePng(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  const parts = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
    } else if (type === "IDAT") parts.push(chunk);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const inflated = inflateSync(Buffer.concat(parts));
  const data = new Uint8ClampedArray(width * height * 4);
  const stride = width * 4;
  let source = 0;
  const prior = Buffer.alloc(stride);
  const current = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[source];
    source += 1;
    inflated.copy(current, 0, source, source + stride);
    source += stride;
    for (let index = 0; index < stride; index += 1) {
      const left = index >= 4 ? current[index - 4] : 0;
      const up = prior[index];
      const upperLeft = index >= 4 ? prior[index - 4] : 0;
      if (filter === 1) current[index] = (current[index] + left) & 255;
      else if (filter === 2) current[index] = (current[index] + up) & 255;
      else if (filter === 3) current[index] = (current[index] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) current[index] = (current[index] + paeth(left, up, upperLeft)) & 255;
    }
    data.set(current, y * stride);
    current.copy(prior);
  }
  return { data, width, height };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const value of buffer) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return crc ^ 0xffffffff;
}

function wordsFromResult(result) {
  const direct = result?.data?.words;
  if (Array.isArray(direct) && direct.length) return direct;
  const words = [];
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (Array.isArray(node.words)) node.words.forEach((word) => words.push(word));
    walk(node.blocks);
    walk(node.paragraphs);
    walk(node.lines);
  };
  walk(result?.data?.blocks);
  return words;
}

function grayToRgba(gray) {
  const data = new Uint8ClampedArray(gray.length * 4);
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    data[offset] = gray[index];
    data[offset + 1] = gray[index];
    data[offset + 2] = gray[index];
    data[offset + 3] = 255;
  }
  return data;
}

describe("dark badge TCKN regression", { timeout: 120000 }, () => {
  it("reads the same TCKN from a high-contrast line and a dark badge", async () => {
    const fixture = decodePng(readFileSync(path.resolve("tests/fixtures/dark-badge-tckn.png")));
    const directory = mkdtempSync(path.join(tmpdir(), "redaktix-ocr-"));
    const originalPath = path.resolve("tests/fixtures/dark-badge-tckn.png");
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/assets/ocr");
    const worker = await createWorker("eng", 1, {
      langPath: path.join(root, "lang"),
      cachePath: directory,
      gzip: true,
    });
    try {
      const pass1 = await worker.recognize(originalPath, { tessedit_pageseg_mode: "6" }, { text: true, blocks: true });
      const pass1Text = pass1.data.text || "";
      const pass1Words = wordsFromResult(pass1);
      const pass1Boxes = pass1Words.map((word) => ({
        x0: word.bbox.x0,
        y0: word.bbox.y0,
        x1: word.bbox.x1,
        y1: word.bbox.y1,
      }));
      const rois = discoverSuspiciousRois(fixture.data, fixture.width, fixture.height, pass1Boxes);
      assert.ok(rois.length >= 1, `Pass 2 ROI discovery did not find the dark badge. pass1=${JSON.stringify(pass1Text)} boxes=${JSON.stringify(pass1Boxes)}`);
      const roi = rois[0];
      assert.ok(roi.y > 100, "Pass 2 ROI is not on the badge line");
      const cropped = cropRgba(fixture.data, fixture.width, roi);
      const gray = grayscaleFromRgba(cropped.data, cropped.width, cropped.height);
      const band = cropTextBand(gray, cropped.width, cropped.height);
      const glyphBox = { x: roi.x + band.x, y: roi.y + band.y, width: band.width, height: band.height };
      const roiOrigin = forceBadgeRoiPadding(glyphBox, fixture.width, roi);
      const lineCrop = cropRgba(fixture.data, fixture.width, roiOrigin);
      const lineGray = grayscaleFromRgba(lineCrop.data, lineCrop.width, lineCrop.height);
      const scaled = upscaleGray(lineGray, lineCrop.width, lineCrop.height, OCR_ADAPTIVE_DEFAULTS.scale);
      assert.ok(roiOrigin.x <= glyphBox.x, "Pass 2 ROI must extend to the left of the tight glyph box");
      assert.ok(roiOrigin.width >= glyphBox.width + 120, `Pass 2 ROI is still tight: ${JSON.stringify(roiOrigin)}`);
      const adaptive = adaptiveThresholdGray(scaled.gray, scaled.width, scaled.height, OCR_ADAPTIVE_DEFAULTS);
      const variants = [
        adaptive,
        contrastForOcr(scaled.gray, scaled.width, scaled.height),
        invertGray(adaptive),
      ];
      const pass1Stats = grayscaleStats(grayscaleFromRgba(fixture.data, fixture.width, fixture.height), fixture.width, fixture.height);
      let pass2 = null;
      let pass2Text = "";
      const variantTexts = [];
      for (const variant of variants) {
        const stats = grayscaleStats(variant, scaled.width, scaled.height);
        assert.notEqual(Math.round(stats.mean), Math.round(pass1Stats.mean));
        assert.ok(stats.foregroundRatio > 0.005 && stats.foregroundRatio < 0.995);
        const pass2Path = path.join(directory, "pass2.png");
        writeFileSync(pass2Path, encodePng(grayToRgba(variant), scaled.width, scaled.height));
        const singleLine = scaled.height <= 320 && scaled.height < scaled.width * 0.5;
        pass2 = await worker.recognize(pass2Path, {
          tessedit_char_whitelist: "0123456789",
          tessedit_pageseg_mode: singleLine ? "7" : "6",
        }, { text: true, blocks: true });
        pass2Text = pass2.data.text || "";
        variantTexts.push(pass2Text.replace(/\s+/g, " "));
        if (tcknEvidence(pass2Text).valid || findTcknMatches(pass2Text).length) break;
      }
      const pass2Evidence = tcknEvidence(pass2Text);
      const pass2Matches = findTcknMatches(pass2Text);
      assert.ok(pass2Evidence.valid || pass2Matches.length > 0, `Pass 2 text did not validate: ${JSON.stringify(variantTexts)} roi=${JSON.stringify(roi)} pass1=${JSON.stringify(pass1Text)}`);
      const normalized = pass2Evidence.valid ? pass2Evidence.normalized : pass2Matches[0].text;
      const pass2Words = wordsFromResult(pass2);
      const word = pass2Words.find((item) => tcknEvidence(item.text).valid)
        || pass2Words.find((item) => String(item.text || "").replace(/\D/g, "").length >= 8)
        || pass2Words[0];
      assert.ok(word, "Pass 2 returned no word box");
      const originalBox = mapRoiBoxToOriginal(word.bbox, roiOrigin, OCR_ADAPTIVE_DEFAULTS.scale);
      const pass1Hit = pass1Words.find((item) => tcknEvidence(item.text).valid);
      assert.ok(pass1Hit, `Pass 1 did not read the high-contrast TCKN: ${JSON.stringify(pass1Text)}`);
      const merged = mergeSpatialCandidates([
        { text: tcknEvidence(pass1Hit.text).normalized, bbox: pass1Hit.bbox },
        { text: normalized, bbox: originalBox },
      ]);
      assert.equal(merged.length, 2);
      assert.equal(merged[0].text, merged[1].text);
      assert.ok(Math.abs(merged[0].bbox.y0 - merged[1].bbox.y0) > 40);
    } finally {
      await worker.terminate();
    }
  });
});
