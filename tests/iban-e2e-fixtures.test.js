import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blackoutDetections } from "../src/js/app.js";
import {
  detectionsForAutomaticRedaction,
  detectGroupedSecretsInScan,
} from "../src/js/sensitive-detectors.js";
import { detectStructuredDataFromLines } from "../src/js/structured-lines.js";
import { IBAN_OCR_FIXTURES } from "./fixtures/iban-ocr-words.js";

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

describe("IBAN OCR fixtures end-to-end auto-apply coverage", () => {
  for (const fixture of IBAN_OCR_FIXTURES) {
    it(`${fixture.id}: union of auto-applied rects covers every IBAN word box`, () => {
      const imageSize = { width: fixture.imageWidth, height: fixture.imageHeight };
      const structured = detectStructuredDataFromLines(fixture.lines, {
        profileId: "global-turkey",
        imageSize,
        linesById: new Map(fixture.lines.map((line) => [line.id, line])),
      });
      const grouped = detectGroupedSecretsInScan(
        fixture.words,
        fixture.imageWidth,
        fixture.imageHeight
      );
      const detections = [...structured, ...grouped];
      const automatic = detectionsForAutomaticRedaction(detections);
      const rects = blackoutDetections(detections, fixture.imageWidth, fixture.imageHeight);

      const missing = fixture.ibanWordIndices.filter((index) => {
        const box = fixture.words[index].bbox;
        return !rects.some((rect) => covers(rect, box));
      }).map((index) => `${index}:${fixture.words[index].text}`);

      assert.ok(automatic.length > 0, `${fixture.id} expected auto-applied IBAN detections`);
      assert.deepEqual(missing, [], `${fixture.id} left IBAN words uncovered: ${missing.join(", ")}`);
    });
  }
});
