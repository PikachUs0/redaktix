/**
 * Redaction guarantees.
 *
 * These tests treat the exported artifact as hostile input: they assume someone
 * wants to recover the redacted content and try to do so with a PDF text
 * extractor, a metadata scanner, and pixel probing.
 *
 * Guarantees covered:
 *  (a) redaction boxes are burned into pixels before the page is encoded;
 *  (b) the output PDF is a brand-new image-only document (no text layer,
 *      annotations, forms, JavaScript or carried-over Info/XMP metadata);
 *  (c) exported images are re-encoded through a canvas, dropping EXIF/GPS/XMP;
 *  (e) object URLs are revoked and pixel buffers released; a "Clear session"
 *      action exists and runs the full teardown.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { exportRedactedPdf } from "../src/lib/pdfExport.js";
import {
  loadPdfDocument,
  renderPdfPage,
  setPdfWorkerSrc,
  verifyRedactionIntegrity,
} from "../src/lib/pdfEngine.js";
import {
  canvasToBlob,
  createCleanOutputCanvas,
  findMetadataMarkers,
} from "../src/js/export-clean.js";

setPdfWorkerSrc(
  new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href
);

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const EXIF_FIXTURE = join(ROOT, "tests", "fixtures", "exif-sample.jpg");

const SECRET_EMAIL = "alice@redaktix.test";
const SECRET_PHONE = "+905551112233";
const SECRET_TITLE = "SUPER SECRET STATEMENT";
const SECRET_AUTHOR = "bob@redaktix.test";

/** Synthetic fixture: 2 pages, embedded text, secret Info metadata. */
async function buildSyntheticPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.setTitle(SECRET_TITLE);
  pdf.setAuthor(SECRET_AUTHOR);
  pdf.setSubject("Confidential payroll");
  pdf.setKeywords(["secret"]);

  const page = pdf.addPage([400, 240]);
  page.drawText(`Secret email ${SECRET_EMAIL}`, {
    x: 40,
    y: 170,
    size: 14,
    font,
    color: rgb(0, 0, 0),
  });
  page.drawText("Visible footer stays", {
    x: 40,
    y: 40,
    size: 12,
    font,
    color: rgb(0.2, 0.2, 0.2),
  });

  const page2 = pdf.addPage([400, 240]);
  page2.drawText(`Second page phone ${SECRET_PHONE}`, {
    x: 40,
    y: 150,
    size: 14,
    font,
  });
  return pdf.save();
}

async function exportFixture({ redactionsByPage = {}, onCleanCanvas } = {}) {
  const sourceBytes = await buildSyntheticPdf();
  const sourcePdf = await loadPdfDocument(sourceBytes);

  const out = await exportRedactedPdf({
    pdfBytes: sourceBytes,
    scale: 2,
    redactionsByPage,
    createCanvas: (width, height) => createCanvas(width, height),
    canvasDeps: { createElement: () => createCanvas(1, 1) },
    renderPage: async (pageNumber, scale) => {
      const rendered = await renderPdfPage(sourcePdf, pageNumber, {
        scale,
        createCanvas: (width, height) => createCanvas(width, height),
      });
      return { canvas: rendered.canvas, width: rendered.canvas.width, height: rendered.canvas.height };
    },
    encodePng: async (canvas) => {
      await onCleanCanvas?.(canvas);
      return canvas.toBuffer("image/png");
    },
  });

  if (typeof sourcePdf.destroy === "function") await sourcePdf.destroy();
  else sourcePdf.cleanup?.();

  return { out, sourceBytes };
}

function pixelAt(canvas, x, y) {
  const data = canvas.getContext("2d").getImageData(x, y, 1, 1).data;
  return { r: data[0], g: data[1], b: data[2], a: data[3] };
}

function latin1(bytes) {
  return Buffer.from(bytes).toString("latin1");
}

describe("(a) redaction boxes are burned into pixels before encoding", () => {
  it("covers the secret text with solid pixels while preserving the rest of the page", async () => {
    const samples = [];
    await exportFixture({
      redactionsByPage: {
        1: [{ type: "blackout", color: "#000000", x: 0, y: 80, width: 800, height: 140 }],
      },
      onCleanCanvas: async (canvas) => {
        samples.push({
          inside: pixelAt(canvas, 20, 120),
          outside: pixelAt(canvas, 400, 460),
        });
      },
    });

    assert.equal(samples.length, 2, "one cleaned canvas per page");
    const [page1] = samples;
    assert.deepEqual(
      { r: page1.inside.r, g: page1.inside.g, b: page1.inside.b },
      { r: 0, g: 0, b: 0 },
      "the redacted region must be opaque black in the encoded pixels"
    );
    assert.ok(
      page1.outside.r > 200 && page1.outside.g > 200 && page1.outside.b > 200,
      `unredacted page area must keep its content, got ${JSON.stringify(page1.outside)}`
    );
  });

  it("hardens blur/pixelate to solid covers when no style painters are available", async () => {
    const samples = [];
    await exportFixture({
      redactionsByPage: {
        1: [{ type: "blur", x: 0, y: 80, width: 800, height: 140 }],
      },
      onCleanCanvas: async (canvas) => {
        samples.push(pixelAt(canvas, 20, 120));
      },
    });

    const first = samples[0];
    assert.deepEqual({ r: first.r, g: first.g, b: first.b }, { r: 0, g: 0, b: 0 });
  });
});

describe("(b) un-redaction attempts on the exported PDF", () => {
  it("source fixture does leak text (the detector really works)", async () => {
    const sourceBytes = await buildSyntheticPdf();
    const result = await verifyRedactionIntegrity(sourceBytes, [SECRET_EMAIL, SECRET_PHONE]);
    assert.equal(result.verified, false, "fixture must be extractable before export");
    assert.deepEqual(
      result.leaksFound.map((leak) => leak.term).sort(),
      [SECRET_PHONE, SECRET_EMAIL].sort()
    );
  });

  it("exported PDF yields no extractable text, even with zero redaction boxes", async () => {
    const { out } = await exportFixture({ redactionsByPage: {} });
    const result = await verifyRedactionIntegrity(out, [
      SECRET_EMAIL,
      SECRET_PHONE,
      "Visible footer stays",
      SECRET_TITLE,
    ]);
    assert.deepEqual(result.leaksFound, [], "nothing may be extractable from the export");
    assert.equal(result.verified, true);
  });

  it("exported PDF carries no text layer, annotations, forms, JS or source metadata", async () => {
    const { out } = await exportFixture({
      redactionsByPage: {
        1: [{ type: "blackout", color: "#000000", x: 0, y: 80, width: 800, height: 140 }],
      },
    });
    const text = latin1(out);

    assert.match(text, /\/Subtype\s*\/Image/, "pages must be images");
    for (const forbidden of [
      "/Type /Font",
      "/Annots",
      "/AcroForm",
      "/JavaScript",
      "/EmbeddedFile",
      "adobe.com/xap",
    ]) {
      assert.equal(text.includes(forbidden), false, `export must not contain ${forbidden}`);
    }
    for (const carried of [SECRET_TITLE, SECRET_AUTHOR, "Confidential payroll"]) {
      assert.equal(text.includes(carried), false, `source metadata leaked: ${carried}`);
    }

    const loaded = await PDFDocument.load(out);
    assert.equal(loaded.getPageCount(), 2);
    assert.equal(loaded.getForm().getFields().length, 0, "no form fields in the export");
  });
});

describe("(c) exported images are re-encoded and stripped of metadata", () => {
  it("a JPEG with Exif/XMP/GPS is re-encoded without any metadata markers", async () => {
    assert.ok(existsSync(EXIF_FIXTURE), `missing fixture: ${EXIF_FIXTURE}`);
    const original = readFileSync(EXIF_FIXTURE);
    assert.ok(findMetadataMarkers(original).length > 0, "fixture must contain metadata");

    const image = await loadImage(original);
    const sourceCanvas = createCanvas(image.width, image.height);
    sourceCanvas.getContext("2d").drawImage(image, 0, 0);

    const cleanCanvas = createCleanOutputCanvas(
      { image: sourceCanvas, width: image.width, height: image.height, redactions: [] },
      { createElement: () => createCanvas(1, 1) }
    );
    assert.ok(cleanCanvas, "createCleanOutputCanvas must return a canvas");

    const blob = await canvasToBlob(cleanCanvas, "image/jpeg", 0.92, {
      createElement: () => createCanvas(1, 1),
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());

    assert.ok(bytes.byteLength > 0, "re-encoded image must not be empty");
    assert.notDeepEqual(Buffer.from(bytes), original, "export must not reuse source bytes");
    assert.deepEqual(findMetadataMarkers(bytes), [], "Exif/XMP/GPS must be gone");
  });
});

describe("(e) session teardown", () => {
  const editor = readFileSync(join(ROOT, "src", "js", "editor.js"), "utf8");

  it("revokes every object URL it creates", () => {
    const creates = editor.match(/URL\.createObjectURL\(/g) || [];
    const revokes = editor.match(/URL\.revokeObjectURL\(/g) || [];
    assert.ok(creates.length > 0, "expected object URLs in the download path");
    assert.ok(
      revokes.length >= creates.length,
      `every created URL must be revoked (create=${creates.length}, revoke=${revokes.length})`
    );
    assert.match(
      editor,
      /function triggerBlobDownload\([\s\S]{0,400}URL\.revokeObjectURL\(url\)/,
      "downloads must revoke their object URL"
    );
  });

  it("releases the source bitmap and PDF page canvases", () => {
    assert.match(
      editor,
      /function releaseEditorImage\(\)[\s\S]{0,300}image\.width = 0[\s\S]{0,120}image\.height = 0/
    );
    assert.match(
      editor,
      /function releasePdfCanvasBitmap\(entry\)[\s\S]{0,300}entry\.canvas\.width = 0/
    );
  });

  it("exposes a Clear session action that runs the full teardown", () => {
    assert.match(editor, /id="reviewClearSessionButton"/);
    assert.match(
      editor,
      /reviewClearSessionButton[\s\S]{0,200}clearSession\(\)/,
      "the Clear session button must call clearSession()"
    );
    assert.match(
      editor,
      /async function clearSession\(\)[\s\S]{0,600}destroyPdfSession\(\)[\s\S]{0,200}clearPreviousObjectUrl\(\)[\s\S]{0,200}releaseEditorImage\(\)/
    );
    assert.match(editor, /async function startNewRedaction\(\)[\s\S]{0,120}clearSession\(\)/);
  });
});
