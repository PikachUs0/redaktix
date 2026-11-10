/**
 * Export contract: there is exactly one PDF export path. Every page is
 * rasterized with the redaction boxes burned into pixels, then written into a
 * brand-new image-only PDF. Nothing from the source document (text layer,
 * annotations, forms, JavaScript, XMP/Info metadata) is carried over.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  createRedactedPdfFileName,
  exportRedactedPdf,
  normalizeRedactionsByPage,
  redactionFillColor,
} from "../src/lib/pdfExport.js";
import { loadPdfDocument, renderPdfPage, setPdfWorkerSrc } from "../src/lib/pdfEngine.js";
import { createRedactedFileName } from "../src/js/export-clean.js";

setPdfWorkerSrc(
  new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href
);

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SECRET_EMAIL = "alice@redaktix.test";
const SECRET_PHONE = "+905551112233";
const SECRET_TITLE = "SUPER SECRET STATEMENT";
const SECRET_AUTHOR = "alice@redaktix.test";

async function buildFixturePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.setTitle(SECRET_TITLE);
  pdf.setAuthor(SECRET_AUTHOR);
  pdf.setSubject("Confidential");
  pdf.setKeywords(["secret", "private"]);

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

function latin1(bytes) {
  return Buffer.from(bytes).toString("latin1");
}

function makeRenderPage(sourcePdf) {
  return async (pageNumber, scale) => {
    const rendered = await renderPdfPage(sourcePdf, pageNumber, {
      scale,
      createCanvas: (width, height) => createCanvas(width, height),
    });
    return {
      canvas: rendered.canvas,
      width: rendered.canvas.width,
      height: rendered.canvas.height,
    };
  };
}

function napiCreateElement() {
  return createCanvas(1, 1);
}

describe("pdfExport helpers", () => {
  it("keeps redaction fill colors and hardens non-blackout styles", () => {
    assert.equal(redactionFillColor({ type: "blackout", color: "#112233" }), "#112233");
    assert.equal(redactionFillColor({ type: "blur" }), "#000000");
    assert.equal(redactionFillColor({ type: "pixelate" }), "#000000");
    assert.equal(redactionFillColor(undefined), "#000000");
  });

  it("normalizes page -> redactions maps and clones entries", () => {
    const source = { 1: [{ type: "blackout", x: 1 }], 0: [{ type: "blackout" }], nope: [] };
    const map = normalizeRedactionsByPage(source);
    assert.deepEqual([...map.keys()], [1]);
    assert.notEqual(map.get(1)[0], source[1][0]);
    assert.equal(normalizeRedactionsByPage(null).size, 0);
  });

  it("builds a generic, timestamped redacted PDF filename", () => {
    const name = createRedactedPdfFileName(new Date("2026-11-11T09:08:07Z"));
    assert.equal(name, "redacted-20261111-090807.pdf");
    assert.match(createRedactedPdfFileName(), /^redacted-\d{8}-\d{6}\.pdf$/);
  });

  it("never reuses the source file name in exported image names", () => {
    assert.equal(createRedactedFileName("png", new Date("2026-11-11T09:08:07Z")), "redacted-20261111-090807.png");
    assert.equal(createRedactedFileName("jpeg", new Date("2026-11-11T09:08:07Z")), "redacted-20261111-090807.jpeg");
    // Unknown extensions fall back to png instead of echoing attacker-controlled input.
    assert.equal(createRedactedFileName("../Statement Q1.exe", new Date("2026-11-11T09:08:07Z")), "redacted-20261111-090807.png");
  });

  it("rejects empty input instead of silently exporting nothing", async () => {
    await assert.rejects(() => exportRedactedPdf({ pdfBytes: new Uint8Array() }), /PDF bytes are required/);
    await assert.rejects(() => exportRedactedPdf({}), /PDF bytes are required/);
  });

  it("requires a page renderer — there is no vector fallback", async () => {
    const sourceBytes = await buildFixturePdf();
    await assert.rejects(
      () => exportRedactedPdf({ pdfBytes: sourceBytes }),
      /renderPage/
    );
  });
});

describe("pdfExport generation", () => {
  it("exports every page as a fresh image-only PDF", async () => {
    const sourceBytes = await buildFixturePdf();
    const sourcePdf = await loadPdfDocument(sourceBytes);
    const progress = [];

    const out = await exportRedactedPdf({
      pdfBytes: sourceBytes,
      scale: 2,
      redactionsByPage: {
        1: [{ type: "blackout", color: "#000000", x: 70, y: 90, width: 260, height: 36 }],
        2: [{ type: "blackout", color: "#111111", x: 60, y: 100, width: 280, height: 40 }],
      },
      onProgress: (info) => progress.push(info),
      createCanvas: (width, height) => createCanvas(width, height),
      canvasDeps: { createElement: napiCreateElement },
      renderPage: makeRenderPage(sourcePdf),
    });

    assert.ok(out instanceof Uint8Array);
    assert.ok(out.byteLength > 100);
    assert.equal(String.fromCharCode(out[0], out[1], out[2], out[3]), "%PDF");
    assert.equal(progress.length, 2);
    assert.deepEqual(
      progress.map((info) => info.phase),
      ["flatten", "flatten"]
    );
    assert.equal(progress.at(-1).page, 2);

    const loaded = await PDFDocument.load(out);
    assert.equal(loaded.getPageCount(), 2);

    if (typeof sourcePdf.destroy === "function") await sourcePdf.destroy();
    else sourcePdf.cleanup?.();
  });

  it("builds a brand-new PDF with no text layer, annotations, forms, JS or carried metadata", async () => {
    const sourceBytes = await buildFixturePdf();
    const sourcePdf = await loadPdfDocument(sourceBytes);

    const out = await exportRedactedPdf({
      pdfBytes: sourceBytes,
      scale: 2,
      redactionsByPage: {
        1: [{ type: "blackout", color: "#000000", x: 70, y: 90, width: 260, height: 36 }],
      },
      createCanvas: (width, height) => createCanvas(width, height),
      canvasDeps: { createElement: napiCreateElement },
      renderPage: makeRenderPage(sourcePdf),
    });

    const text = latin1(out);
    // Rasterized content is present...
    assert.match(text, /\/Subtype\s*\/Image/);
    // ...and none of the dangerous source structures survive.
    assert.equal(text.includes("/Type /Font"), false, "export must not carry a font/text layer");
    assert.equal(text.includes("/Annots"), false, "export must not carry annotations");
    assert.equal(text.includes("/AcroForm"), false, "export must not carry form fields");
    assert.equal(text.includes("/JavaScript"), false, "export must not carry JavaScript");
    assert.equal(text.includes("/EmbeddedFile"), false, "export must not carry attachments");
    // Source Info metadata must not be copied over.
    assert.equal(text.includes(SECRET_TITLE), false, "source title leaked into export");
    assert.equal(text.includes(SECRET_AUTHOR), false, "source author leaked into export");
    assert.equal(text.includes("Confidential"), false, "source subject leaked into export");
    // No XMP packet.
    assert.equal(text.includes("adobe.com/xap"), false, "export must not carry XMP metadata");
    // No plaintext PII.
    assert.equal(text.includes(SECRET_EMAIL), false, "secret email found in exported bytes");
    assert.equal(text.includes(SECRET_PHONE), false, "secret phone found in exported bytes");

    if (typeof sourcePdf.destroy === "function") await sourcePdf.destroy();
    else sourcePdf.cleanup?.();
  });

  it("editor download path routes PDF exports through pdfExport.js", () => {
    const editor = readFileSync(resolve(ROOT, "src/js/editor.js"), "utf8");
    assert.match(editor, /from\s+["']\.\.\/lib\/pdfExport\.js["']/);
    assert.match(editor, /exportRedactedPdf\s*\(/);
    assert.match(editor, /downloadRedactedPdf/);
    assert.match(editor, /pdfExportProgress/);
    assert.equal(
      /PDF_EXPORT_MODES/.test(editor),
      false,
      "the vector export mode must be gone from editor.js"
    );
  });
});
