import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  isPdfFile,
  multiplyTransform,
  pdfTextContentToOcrResult,
  setPdfWorkerSrc,
  configurePdfWorker,
  getPdfWorkerSrc,
  splitTextItemIntoWords,
  textItemToViewportBBox,
  loadPdfDocument,
  renderPdfPage,
  extractPdfPageContent,
  scanPdfDocumentPages,
  aggregatePdfDetections,
  tagDetectionsWithPage,
} from "../src/lib/pdfEngine.js";
import { extractEmailCandidates, isValidIban } from "../src/js/sensitive-detectors.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

describe("pdfEngine helpers", () => {
  it("configures a non-empty pdf.js workerSrc", () => {
    const worker = new URL(
      "../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      import.meta.url
    ).href;
    assert.equal(configurePdfWorker(worker), worker);
    assert.equal(getPdfWorkerSrc(), worker);
    assert.ok(String(getPdfWorkerSrc()).length > 0);
  });

  it("ships a static public pdf.js worker for browser (avoids Vite transform)", () => {
    const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
    const workerPath = resolve(root, "public/assets/pdf/pdf.worker.min.mjs");
    const bytes = readFileSync(workerPath);
    assert.ok(bytes.byteLength > 100_000, "public PDF worker should be present and substantial");
    const engine = readFileSync(resolve(root, "src/lib/pdfEngine.js"), "utf8");
    assert.match(engine, /assets\/pdf\/pdf\.worker\.min\.mjs/);
    assert.match(engine, /publicPdfWorkerUrl|static public/);
  });

  it("detects PDF files by MIME type or extension", () => {
    assert.equal(isPdfFile({ type: "application/pdf", name: "a.bin" }), true);
    assert.equal(isPdfFile({ type: "", name: "statement.PDF" }), true);
    assert.equal(isPdfFile({ type: "image/png", name: "shot.png" }), false);
    assert.equal(isPdfFile(null), false);
  });

  it("multiplies affine transforms like pdf.js Util.transform", () => {
    const viewport = [2, 0, 0, -2, 0, 400];
    const item = [1, 0, 0, 1, 40, 140];
    assert.deepEqual(multiplyTransform(viewport, item), [2, 0, 0, -2, 80, 120]);
  });

  it("maps text items into canvas-space bounding boxes using ascent + padding", () => {
    const viewport = { transform: [2, 0, 0, -2, 0, 400], scale: 2 };
    const item = { transform: [14, 0, 0, 14, 40, 140], width: 100, height: 14 };
    // Disable pad for an exact ascent check (baseline tx[5]=120, fontHeight=28, ascent=0.8*28).
    const tight = textItemToViewportBBox(item, viewport, undefined, { padRatio: 0 });
    assert.ok(tight);
    assert.equal(tight.x, 80);
    assert.equal(tight.width, 200);
    assert.equal(tight.height, 28);
    assert.equal(tight.y, 120 - 28 * 0.8);

    // Default pad expands the rect so highlights wrap the full glyph box.
    const padded = textItemToViewportBBox(item, viewport);
    assert.ok(padded.height > tight.height);
    assert.ok(padded.y < tight.y);
    assert.ok(padded.y + padded.height > tight.y + tight.height);

    // Width stays tied to transformed font size; style.ascent is used like pdf.js TextLayer.
    const styleAware = textItemToViewportBBox(
      { ...item, fontName: "g_f1" },
      viewport,
      undefined,
      { padRatio: 0, styles: { g_f1: { ascent: 0.7, descent: -0.3 } } }
    );
    assert.equal(styleAware.y, 120 - 28 * 0.7);
  });

  it("splits multi-word items into OCR-shaped words with proportional boxes", () => {
    const words = splitTextItemIntoWords(
      "hello world",
      { x: 10, y: 20, width: 110, height: 12 },
      { lineId: "pdf-0", lineIndex: 0 }
    );
    assert.equal(words.length, 2);
    assert.equal(words[0].text, "hello");
    assert.equal(words[1].text, "world");
    assert.equal(words[0].lineId, "pdf-0");
    assert.equal(words[0].bbox.y, 20);
    assert.ok(words[0].bbox.width > 0);
    assert.ok(words[1].bbox.x > words[0].bbox.x);
  });

  it("builds OCR words/lines from getTextContent-like items for detectors", () => {
    const viewport = { transform: [1, 0, 0, -1, 0, 200], scale: 1 };
    const result = pdfTextContentToOcrResult(
      {
        items: [
          { str: "Contact test@example.com", transform: [12, 0, 0, 12, 20, 160], width: 160, height: 12, hasEOL: true },
          { str: "IBAN TR330006100519786457841326", transform: [12, 0, 0, 12, 20, 130], width: 220, height: 12, hasEOL: true },
        ],
      },
      viewport
    );
    assert.ok(result.words.length >= 3);
    assert.ok(result.lines.length >= 2);
    assert.match(result.text, /test@example\.com/);
    assert.match(result.text, /TR330006100519786457841326/);
    assert.ok(result.words.every((word) => word.bbox && Number.isFinite(word.bbox.x)));
  });
});

describe("pdfEngine render + extract", () => {
  it("renders pages and extracts positioned text without OCR", async () => {
    setPdfWorkerSrc(
      new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href
    );

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const first = pdf.addPage([400, 220]);
    first.drawText("Email: alice@redaktix.test", { x: 36, y: 160, size: 14, font });
    first.drawText("IBAN TR330006100519786457841326", { x: 36, y: 120, size: 12, font });
    const second = pdf.addPage([400, 220]);
    second.drawText("Page two phone +905551112233", { x: 36, y: 150, size: 14, font });
    const bytes = await pdf.save();

    const documentProxy = await loadPdfDocument(bytes);
    assert.equal(documentProxy.numPages, 2);

    const page1 = await renderPdfPage(documentProxy, 1, {
      scale: 2,
      createCanvas: (width, height) => {
        const canvas = createCanvas(width, height);
        return canvas;
      },
    });

    assert.equal(page1.pageCount, 2);
    assert.equal(page1.pageNumber, 1);
    assert.ok(page1.canvas.width > 0);
    assert.ok(page1.canvas.height > 0);
    assert.match(page1.text, /alice@redaktix\.test/);
    assert.match(page1.text, /TR330006100519786457841326/);
    assert.ok(page1.words.some((word) => /alice@redaktix\.test/i.test(word.text) || /alice/i.test(word.text)));
    assert.ok(page1.words.every((word) => word.bbox.width > 0 && word.bbox.height > 0));

    const page2 = await renderPdfPage(documentProxy, 2, {
      scale: 2,
      createCanvas: (width, height) => createCanvas(width, height),
    });
    assert.match(page2.text, /Page two/);
    assert.match(page2.text, /\+905551112233/);

    if (typeof documentProxy.destroy === "function") await documentProxy.destroy();
    else documentProxy.cleanup?.();
  });

  it("extracts text for a page without allocating a canvas bitmap", async () => {
    setPdfWorkerSrc(
      new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href
    );
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([320, 180]);
    page.drawText("hello@example.com", { x: 40, y: 120, size: 14, font });
    const bytes = await pdf.save();
    const documentProxy = await loadPdfDocument(bytes);
    const content = await extractPdfPageContent(documentProxy, 1, { scale: 2 });
    assert.equal(content.pageNumber, 1);
    assert.match(content.text, /hello@example\.com/);
    assert.ok(content.canvasWidth > 0);
    assert.equal(content.canvas, undefined);
    if (typeof documentProxy.destroy === "function") await documentProxy.destroy();
    else documentProxy.cleanup?.();
  });

  it("scans every page in the background and aggregates detections without page navigation", async () => {
    setPdfWorkerSrc(
      new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href
    );

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page1 = pdf.addPage([420, 240]);
    page1.drawText("Contact alice@redaktix.test", { x: 36, y: 170, size: 14, font });
    const page2 = pdf.addPage([420, 240]);
    page2.drawText("IBAN TR330006100519786457841326", { x: 36, y: 150, size: 12, font });
    const page3 = pdf.addPage([420, 240]);
    page3.drawText("No secrets on this page", { x: 36, y: 150, size: 12, font });
    const bytes = await pdf.save();
    const documentProxy = await loadPdfDocument(bytes);

    const progressPages = [];
    const result = await scanPdfDocumentPages(documentProxy, {
      scale: 2,
      detectFn: (ocrResult, pageNumber) => {
        const detections = [];
        for (const email of extractEmailCandidates(ocrResult.text || "")) {
          detections.push({
            id: `email-${pageNumber}`,
            type: "email",
            text: email,
            normX: 0.1,
            normY: 0.2,
            normWidth: 0.4,
            normHeight: 0.05,
            confidence: 100,
          });
        }
        const compact = String(ocrResult.text || "").replace(/\s+/g, "");
        const ibanMatch = compact.match(/TR\d{24}/);
        if (ibanMatch && isValidIban(ibanMatch[0]).checksumValid) {
          detections.push({
            id: `iban-${pageNumber}`,
            type: "custom_rule",
            ruleId: "iban",
            text: ibanMatch[0],
            normX: 0.1,
            normY: 0.3,
            normWidth: 0.6,
            normHeight: 0.05,
            confidence: 100,
          });
        }
        return detections;
      },
      onProgress: ({ page }) => progressPages.push(page),
    });

    assert.equal(result.pageCount, 3);
    assert.equal(result.pages.length, 3);
    assert.deepEqual(progressPages, [1, 2, 3]);
    assert.ok(result.pages.every((page) => !page.canvas), "full-document scan must not keep page canvases");

    const all = aggregatePdfDetections(result.pages);
    assert.ok(all.some((item) => item.page === 1 && item.type === "email"));
    assert.ok(all.some((item) => item.page === 2 && item.ruleId === "iban"));
    assert.equal(all.filter((item) => item.page === 3).length, 0);
    assert.deepEqual(
      tagDetectionsWithPage([{ type: "email", text: "a@b.co" }], 4)[0].page,
      4
    );

    if (typeof documentProxy.destroy === "function") await documentProxy.destroy();
    else documentProxy.cleanup?.();
  });

  it("wires editor full-document PDF scan + lazy canvas caching", () => {
    const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
    const editor = readFileSync(resolve(root, "src/js/editor.js"), "utf8");
    const engine = readFileSync(resolve(root, "src/lib/pdfEngine.js"), "utf8");
    assert.match(editor, /startPdfFullDocumentScan/);
    assert.match(editor, /scanPdfDocumentPages/);
    assert.match(editor, /extractPdfPageContent/);
    assert.match(editor, /releasePdfCanvasBitmap/);
    assert.match(editor, /pdfScanProgress/);
    assert.match(editor, /collectAllPdfDetections|aggregatePdfDetections/);
    assert.match(editor, /configurePdfWorker/);
    assert.match(editor, /failPdfDocumentScan/);
    assert.match(editor, /schedulePdfAutoScan|triggerPdfSensitiveDataScan/);
    assert.match(editor, /startPdfFullDocumentScan\(\)/);
    assert.match(editor, /publishScanDetections/);
    assert.match(editor, /schedulePdfAutoScan\(\)/);
    assert.match(editor, /autoScanScheduled/);
    assert.match(editor, /ocrFallbackPdfPage|runPdfOcrFallbackForEmptyPages/);
    assert.match(editor, /forceOcr:\s*true/);
    assert.match(editor, /scanImageForSensitiveData\(scanButton\)/);
    assert.match(editor, /renderSensitiveDataPanel\(\)/);
    assert.match(editor, /presentPdfPage\(1/);
    assert.match(engine, /runPdfWorkerOp/);
    assert.match(engine, /DEFAULT_RENDER_TIMEOUT_MS|PDF_RENDER_TIMEOUT_MS/);
    // Single auto-start after preview (no immediate trigger + schedule double-fire).
    const loadPdfSlice = editor.slice(
      editor.indexOf("async function loadPdfFile"),
      editor.indexOf("function getPdfPageCacheEntry")
    );
    assert.match(loadPdfSlice, /schedulePdfAutoScan\(\)/);
    assert.equal(
      (loadPdfSlice.match(/triggerPdfSensitiveDataScan\(\)/g) || []).length,
      0,
      "loadPdfFile must not call triggerPdfSensitiveDataScan directly"
    );
    const presentAt = loadPdfSlice.indexOf("presentPdfPage(1");
    const scheduleAt = loadPdfSlice.indexOf("schedulePdfAutoScan()");
    assert.ok(presentAt >= 0 && scheduleAt > presentAt, "PDF scan should start after page preview");
  });

  it("tags PDF detections with both page and pageNumber", () => {
    const tagged = tagDetectionsWithPage([{ type: "email", text: "a@b.co" }], 3);
    assert.equal(tagged[0].page, 3);
    assert.equal(tagged[0].pageNumber, 3);
    const aggregated = aggregatePdfDetections([
      { pageNumber: 1, detections: [{ type: "iban", text: "TR1" }] },
      { pageNumber: 2, detections: [{ type: "email", text: "x@y.z", page: 2 }] },
    ]);
    assert.equal(aggregated[0].pageNumber, 1);
    assert.equal(aggregated[1].pageNumber, 2);
  });

  it("continues full-document scan when one page detectFn throws", async () => {
    setPdfWorkerSrc(
      new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href
    );
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page1 = pdf.addPage([300, 180]);
    page1.drawText("alice@redaktix.test", { x: 40, y: 120, size: 14, font });
    const page2 = pdf.addPage([300, 180]);
    page2.drawText("second page", { x: 40, y: 120, size: 14, font });
    const bytes = await pdf.save();
    const documentProxy = await loadPdfDocument(bytes);
    const pageErrors = [];

    const result = await scanPdfDocumentPages(documentProxy, {
      scale: 2,
      onPageError: (error, pageNumber, phase) => {
        pageErrors.push({ pageNumber, phase, message: String(error?.message || error) });
      },
      detectFn: (ocrResult, pageNumber) => {
        if (pageNumber === 1) throw new Error("boom-page-1");
        return /@/.test(ocrResult.text)
          ? [{ id: "e2", type: "email", text: "x", confidence: 1 }]
          : [];
      },
    });

    assert.equal(result.pages.length, 2);
    assert.ok(pageErrors.some((item) => item.pageNumber === 1 && item.phase === "detect"));
    assert.equal(result.pages[0].detections.length, 0);
    assert.equal(result.pages[1].error, undefined);

    if (typeof documentProxy.destroy === "function") await documentProxy.destroy();
    else documentProxy.cleanup?.();
  });
});
