import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BATCH_IMAGE_LIMIT,
  batchOverallLabel,
  batchStatusLabel,
  blackoutDetections,
  crc32,
  createStoredZip,
  runSequentialQueue,
  selectBatchFiles,
  uniqueZipNames,
} from "../src/js/app.js";

describe("batch queue", () => {
  it("accepts up to 20 images and skips the rest", () => {
    const files = Array.from({ length: 24 }, (_, index) => ({
      type: "image/png",
      size: 100,
      name: `shot-${index}.png`,
    }));
    files.push({ type: "text/plain", size: 10, name: "notes.txt" });
    const selected = selectBatchFiles(files, {
      allowedTypes: ["image/png", "image/jpeg", "image/webp"],
      maxBytes: 1024,
      existingCount: 2,
    });
    assert.equal(BATCH_IMAGE_LIMIT, 20);
    assert.equal(selected.accepted.length, 18);
    assert.equal(selected.skipped, 7);
  });

  it("describes queue progress without running scans together", async () => {
    assert.equal(batchStatusLabel("queued"), "Queued");
    assert.equal(batchStatusLabel("processing", 42), "Processing (42%)");
    assert.equal(batchStatusLabel("completed"), "Completed");
    assert.equal(batchStatusLabel("failed"), "Failed");
    assert.equal(batchOverallLabel([
      { status: "completed" },
      { status: "processing" },
      { status: "queued" },
    ]), "Processing image 2 of 3...");
    assert.equal(batchOverallLabel([
      { status: "completed" },
      { status: "failed" },
    ]), "2 images ready");

    let active = 0;
    let maxActive = 0;
    const outcome = await runSequentialQueue([1, 2, 3], async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return item;
    });
    assert.equal(maxActive, 1);
    assert.equal(outcome.maxActive, 1);
    assert.deepEqual(outcome.results.map((result) => result.value), [1, 2, 3]);
  });

  it("turns detections into blackout redactions and stores images in one zip", () => {
    const redactions = blackoutDetections([
      { id: "d1", type: "email", text: "a@b.co", normX: 0.1, normY: 0.2, normWidth: 0.3, normHeight: 0.05 },
    ], 200, 100);
    assert.equal(redactions[0].type, "blackout");
    assert.equal(redactions[0].x, 20);
    assert.equal(redactions[0].width, 60);
    assert.deepEqual(uniqueZipNames(["a.png", "a.png", "folder/b.png"]), ["a.png", "a-2.png", "b.png"]);

    const payload = new TextEncoder().encode("png-bytes");
    const zip = createStoredZip([{ name: "clean.png", data: payload }], new Date(Date.UTC(2026, 0, 2, 3, 4, 6)));
    assert.equal(zip[0], 0x50);
    assert.equal(zip[1], 0x4b);
    assert.equal(zip[2], 0x03);
    assert.equal(zip[3], 0x04);
    const text = new TextDecoder().decode(zip);
    assert.equal(text.includes("clean.png"), true);
    assert.equal(text.includes("png-bytes"), true);
    assert.equal(crc32(payload) > 0, true);
  });
});
