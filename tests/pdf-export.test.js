import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  canvasRectToPdfRect,
  createRedactedPdfFileName,
  exportRedactedPdf,
  parseCssColorToRgb,
  PDF_EXPORT_MODES,
  redactionFillColor,
} from "../src/lib/pdfExport.js";
import { loadPdfDocument, renderPdfPage, setPdfWorkerSrc } from "../src/lib/pdfEngine.js";

setPdfWorkerSrc(
  new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href
);

async function buildFixturePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([400, 240]);
  page.drawText("Secret email alice@redaktix.test", {
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
  page2.drawText("Second page phone +905551112233", {
    x: 40,
    y: 150,
    size: 14,
    font,
  });
  return pdf.save();
}

describe("pdfExport helpers", () => {
  it("parses CSS colors and redaction fill defaults", () => {
    assert.deepEqual(parseCssColorToRgb("#000000"), { r: 0, g: 0, b: 0 });
    assert.deepEqual(parseCssColorToRgb("#fff"), { r: 1, g: 1, b: 1 });
    assert.deepEqual(parseCssColorToRgb("rgb(255, 0, 0)"), { r: 1, g: 0, b: 0 });
    assert.equal(redactionFillColor({ type: "blackout", color: "#112233" }), "#112233");
    assert.equal(redactionFillColor({ type: "blur" }), "#000000");
  });

  it("maps canvas-space boxes into PDF page space", () => {
    const scale = 2;
    const pageHeight = 240;
    const rect = canvasRectToPdfRect(
      { x: 80, y: 80, width: 200, height: 40 },
      400,
      pageHeight,
      scale
    );
    assert.ok(rect);
    assert.equal(rect.x, 40);
    assert.equal(rect.width, 100);
    assert.equal(rect.height, 20);
    assert.equal(rect.y, pageHeight - 40 - 20);
  });

  it("builds a safe redacted PDF filename", () => {
    assert.equal(createRedactedPdfFileName("Statement Q1.pdf"), "Statement Q1_redacted.pdf");
    assert.equal(createRedactedPdfFileName("a/b:c.pdf"), "a-b-c_redacted.pdf");
  });
});

describe("pdfExport generation", () => {
  it("exports vector-redacted multi-page PDFs without throwing", async () => {
    const sourceBytes = await buildFixturePdf();
    const progress = [];
    const out = await exportRedactedPdf({
      pdfBytes: sourceBytes,
      mode: PDF_EXPORT_MODES.VECTOR,
      scale: 2,
      redactionsByPage: {
        1: [{ type: "blackout", color: "#000000", x: 70, y: 90, width: 260, height: 36 }],
        2: [{ type: "blackout", color: "#111111", x: 60, y: 100, width: 280, height: 40 }],
      },
      onProgress: (info) => progress.push(info),
    });

    assert.ok(out instanceof Uint8Array);
    assert.ok(out.byteLength > 100);
    assert.equal(String.fromCharCode(out[0], out[1], out[2], out[3]), "%PDF");
    assert.equal(progress.length, 2);
    assert.equal(progress[1].page, 2);

    const loaded = await PDFDocument.load(out);
    assert.equal(loaded.getPageCount(), 2);
  });

  it("exports flattened hard-redacted PDFs without throwing", async () => {
    const sourceBytes = await buildFixturePdf();
    const sourcePdf = await loadPdfDocument(sourceBytes);
    const progress = [];

    const out = await exportRedactedPdf({
      pdfBytes: sourceBytes,
      mode: PDF_EXPORT_MODES.FLATTEN,
      scale: 2,
      redactionsByPage: {
        1: [{ type: "blackout", color: "#000000", x: 70, y: 90, width: 260, height: 36 }],
      },
      onProgress: (info) => progress.push(info),
      createCanvas: (width, height) => createCanvas(width, height),
      renderPage: async (pageNumber, scale) => {
        const rendered = await renderPdfPage(sourcePdf, pageNumber, {
          scale,
          createCanvas: (width, height) => createCanvas(width, height),
        });
        return {
          canvas: rendered.canvas,
          width: rendered.canvas.width,
          height: rendered.canvas.height,
        };
      },
    });

    assert.ok(out instanceof Uint8Array);
    assert.ok(out.byteLength > 100);
    assert.equal(String.fromCharCode(out[0], out[1], out[2], out[3]), "%PDF");
    assert.ok(progress.length >= 2);
    assert.equal(progress.at(-1)?.phase, "flatten");

    const loaded = await PDFDocument.load(out);
    assert.equal(loaded.getPageCount(), 2);

    if (typeof sourcePdf.destroy === "function") await sourcePdf.destroy();
    else sourcePdf.cleanup?.();
  });

  it("editor download path routes PDF exports through pdfExport.js", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
    const editor = readFileSync(resolve(root, "src/js/editor.js"), "utf8");
    assert.match(editor, /from\s+["']\.\.\/lib\/pdfExport\.js["']/);
    assert.match(editor, /exportRedactedPdf\s*\(/);
    assert.match(editor, /downloadRedactedPdf/);
    assert.match(editor, /pdfExportProgress/);
  });
});
