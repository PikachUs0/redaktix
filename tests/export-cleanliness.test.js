/**
 * Export path must strip EXIF/XMP/GPS and must not reuse original file bytes.
 * Uses createCleanOutputCanvas -> canvasToBlob from src/js/export-clean.js.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  canvasToBlob,
  createCleanOutputCanvas,
  findMetadataMarkers,
} from "../src/js/export-clean.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const FIXTURE = join(ROOT, "tests", "fixtures", "exif-sample.jpg");

const MANUAL_VERIFY = `
Manual verification (when Node canvas encoding is unavailable):
1. Open editor.html, load tests/fixtures/exif-sample.jpg
2. Download as PNG, JPEG, and WebP
3. Confirm each output has no APP1 "Exif", no "http://ns.adobe.com/xap", no GPS tags
   (e.g. exiftool -a -G1 file.jpg | findstr /i "Exif GPS XMP Make")
4. Confirm file size/bytes differ from the original fixture
`;

async function tryLoadNapiCanvas() {
  try {
    const mod = await import("@napi-rs/canvas");
    return mod;
  } catch {
    try {
      const mod = await import("canvas");
      return mod;
    } catch {
      return null;
    }
  }
}

function blobToUint8Array(blob) {
  if (blob instanceof Uint8Array) return blob;
  if (Buffer.isBuffer(blob)) return new Uint8Array(blob);
  if (typeof blob?.arrayBuffer === "function") {
    return blob.arrayBuffer().then((ab) => new Uint8Array(ab));
  }
  if (blob?.data) return new Uint8Array(blob.data);
  throw new Error("Unsupported blob type from canvas encoder");
}

describe("export cleanliness (EXIF / XMP / GPS)", () => {
  it("fixture JPEG embeds Exif, XMP, GPS, Make/Model markers", () => {
    assert.ok(existsSync(FIXTURE), `missing fixture: ${FIXTURE}`);
    const bytes = readFileSync(FIXTURE);
    const hits = findMetadataMarkers(bytes);
    assert.ok(hits.includes("Exif"), `expected Exif in fixture, got ${hits}`);
    assert.ok(hits.includes("xap"), `expected xap in fixture, got ${hits}`);
    assert.ok(hits.includes("GPS"), `expected GPS in fixture, got ${hits}`);
  });

  it("editor.js imports createCleanOutputCanvas / canvasToBlob from export-clean.js", () => {
    const editor = readFileSync(join(ROOT, "src", "js", "editor.js"), "utf8");
    assert.match(
      editor,
      /from\s+["']\.\/export-clean\.js["']/,
      "editor.js must import the shared export-clean module"
    );
    assert.match(
      editor,
      /createCleanOutputCanvas\s+as\s+buildCleanOutputCanvas|\{[^}]*createCleanOutputCanvas[^}]*\}\s*from\s*["']\.\/export-clean\.js["']/,
      "createCleanOutputCanvas must come from export-clean.js"
    );
    assert.match(
      editor,
      /\bcanvasToBlob\b/,
      "canvasToBlob must be imported/used from export-clean.js"
    );
    assert.equal(
      /function\s+canvasToBlob\s*\(/.test(editor),
      false,
      "local canvasToBlob implementation must be removed from editor.js"
    );
    assert.match(
      editor,
      /buildCleanOutputCanvas\s*\(/,
      "editor wrapper must call the shared buildCleanOutputCanvas"
    );
  });

  it("createCleanOutputCanvas -> canvasToBlob strips metadata for PNG, JPEG, WebP", async () => {
    const napi = await tryLoadNapiCanvas();
    if (!napi?.createCanvas || !napi?.loadImage) {
      assert.fail(
        `Canvas encoding unavailable in this Node environment; cannot assert export bytes.\n${MANUAL_VERIFY}`
      );
    }

    const original = readFileSync(FIXTURE);
    const image = await napi.loadImage(original);
    const sourceCanvas = napi.createCanvas(image.width, image.height);
    const sourceCtx = sourceCanvas.getContext("2d");
    sourceCtx.drawImage(image, 0, 0);

    const createElement = () => {
      const c = napi.createCanvas(1, 1);
      // napi canvas uses toBuffer; export-clean also checks toBlob
      if (typeof c.toBlob !== "function") {
        c.toBlob = function toBlob(cb, type, quality) {
          try {
            const mime = type || "image/png";
            let buf;
            if (mime === "image/jpeg" || mime === "image/jpg") {
              buf = this.toBuffer("image/jpeg", quality != null ? { quality } : undefined);
            } else if (mime === "image/webp") {
              // @napi-rs/canvas may not support webp; fall back and mark
              if (typeof this.encode === "function") {
                buf = this.encode("webp", quality != null ? { quality } : undefined);
              } else {
                try {
                  buf = this.toBuffer("image/webp");
                } catch {
                  buf = null;
                }
              }
            } else {
              buf = this.toBuffer("image/png");
            }
            if (!buf) {
              cb(null);
              return;
            }
            cb(new Blob([buf], { type: mime }));
          } catch (error) {
            cb(null);
          }
        };
      }
      return c;
    };

    const cleanCanvas = createCleanOutputCanvas(
      {
        image: sourceCanvas,
        width: image.width,
        height: image.height,
        redactions: [],
      },
      { createElement }
    );
    assert.ok(cleanCanvas, "createCleanOutputCanvas must return a canvas");

    const formats = [
      { type: "image/png", label: "PNG" },
      { type: "image/jpeg", label: "JPEG", quality: 0.92 },
      { type: "image/webp", label: "WebP", quality: 0.92 },
    ];

    for (const { type, label, quality } of formats) {
      let blob;
      try {
        blob = await canvasToBlob(cleanCanvas, type, quality, { createElement });
      } catch (error) {
        if (type === "image/webp") {
          assert.fail(
            `WebP encoding unavailable via canvas (${error?.message || error}).\n${MANUAL_VERIFY}`
          );
        }
        throw error;
      }
      const out = await blobToUint8Array(blob);
      assert.ok(out.byteLength > 0, `${label}: empty output`);
      assert.notDeepEqual(
        Buffer.from(out),
        original,
        `${label}: must not reuse original file bytes`
      );
      const markers = findMetadataMarkers(out);
      assert.deepEqual(
        markers,
        [],
        `${label}: output still contains metadata markers: ${markers.join(", ")}`
      );
      // No PDF text layer / embedded OCR text stream markers.
      const latin = Buffer.from(out).toString("latin1");
      assert.equal(latin.includes("/Type /Font"), false, `${label}: unexpected font/text layer`);
      assert.equal(latin.includes("tesseract"), false, `${label}: unexpected OCR text residue`);
    }
  });
});
