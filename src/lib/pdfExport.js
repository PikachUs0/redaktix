/**
 * Secure client-side PDF export with pdf-lib.
 *
 * There is exactly one export path: every page is rasterized with the redaction
 * boxes burned into pixels, then written into a brand-new image-only PDF. The
 * source document is never re-saved, so no text layer, annotations, form fields,
 * JavaScript, XMP or Info metadata can survive the round-trip.
 */

import { PDFDocument } from "pdf-lib";
import { createCleanOutputCanvas, createRedactedFileName } from "../js/export-clean.js";

/**
 * Solid fill color for a redaction. Non-blackout styles hard-cover as black.
 * @param {object} redaction
 * @returns {string}
 */
export function redactionFillColor(redaction) {
  if (String(redaction?.type || "blackout") === "blackout") {
    return redaction?.color || "#000000";
  }
  return "#000000";
}

/**
 * Normalize page -> redactions map (1-based page numbers).
 * @param {Map<number, object[]>|Record<string|number, object[]>|null|undefined} input
 * @returns {Map<number, object[]>}
 */
export function normalizeRedactionsByPage(input) {
  const map = new Map();
  if (!input) return map;
  const entries = input instanceof Map ? input.entries() : Object.entries(input);
  for (const [key, value] of entries) {
    const page = Number(key);
    if (!Number.isFinite(page) || page < 1) continue;
    map.set(page, Array.isArray(value) ? value.map((item) => ({ ...item })) : []);
  }
  return map;
}

/**
 * @param {object} options
 * @param {ArrayBuffer|Uint8Array} options.pdfBytes
 * @param {Map|Record} [options.redactionsByPage]
 * @param {number} [options.scale=2]
 * @param {(info: { page: number, pageCount: number, progress: number, phase: string }) => void} [options.onProgress]
 * @param {(pageNumber: number, scale: number) => Promise<{ canvas: object, width?: number, height?: number }>} [options.renderPage]
 * @param {{ createElement?: Function, drawBlur?: Function, drawPixelate?: Function }} [options.canvasDeps]
 * @param {(canvas: object) => Promise<Uint8Array>} [options.encodePng]
 * @returns {Promise<Uint8Array>}
 */
export async function exportRedactedPdf(options = {}) {
  const scale = Number(options.scale) > 0 ? Number(options.scale) : 2;
  const redactionsByPage = normalizeRedactionsByPage(options.redactionsByPage);
  const pdfBytes = toUint8Array(options.pdfBytes);
  if (!pdfBytes?.length) throw new Error("PDF bytes are required for export.");

  return exportFlattenedRedactedPdf(pdfBytes, redactionsByPage, scale, options);
}

/**
 * Rasterize each page with redactions applied, then build a new image-only PDF (hard redact).
 */
async function exportFlattenedRedactedPdf(pdfBytes, redactionsByPage, scale, options) {
  const sourceDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pageCount = sourceDoc.getPageCount();
  const outDoc = await PDFDocument.create();
  const renderPage = options.renderPage;
  if (typeof renderPage !== "function") {
    throw new Error("Flatten export requires options.renderPage(pageNumber, scale).");
  }

  const encodePng = typeof options.encodePng === "function"
    ? options.encodePng
    : canvasToPngBytes;

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const sourcePage = sourceDoc.getPage(pageNumber - 1);
    const { width: pageWidth, height: pageHeight } = sourcePage.getSize();
    const rendered = await renderPage(pageNumber, scale);
    const sourceCanvas = rendered?.canvas;
    if (!sourceCanvas) throw new Error(`PDF page ${pageNumber} could not be rendered.`);

    const width = Number(rendered.width || sourceCanvas.width);
    const height = Number(rendered.height || sourceCanvas.height);
    const redactions = redactionsByPage.get(pageNumber) || [];
    const canvasDeps = options.canvasDeps || {
      createElement: options.createElement,
    };
    const hasStylePainters = typeof canvasDeps.drawBlur === "function"
      || typeof canvasDeps.drawPixelate === "function";
    const redactionsForCanvas = hasStylePainters
      ? redactions
      : hardenRedactionsForRaster(redactions);

    const cleaned = createCleanOutputCanvas(
      {
        image: sourceCanvas,
        width,
        height,
        redactions: redactionsForCanvas,
      },
      canvasDeps
    );

    if (!cleaned) {
      // Fallback: draw solid covers on a copy when DOM createElement is unavailable.
      const fallback = await rasterizeWithSolidCovers(sourceCanvas, width, height, redactions, options);
      const pngBytes = await encodePng(fallback);
      const image = await outDoc.embedPng(pngBytes);
      const page = outDoc.addPage([pageWidth, pageHeight]);
      page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });
    } else {
      const pngBytes = await encodePng(cleaned);
      const image = await outDoc.embedPng(pngBytes);
      const page = outDoc.addPage([pageWidth, pageHeight]);
      page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });
      if (cleaned !== sourceCanvas) {
        try {
          cleaned.width = 0;
          cleaned.height = 0;
        } catch {
          // ignore
        }
      }
    }

    options.onProgress?.({
      page: pageNumber,
      pageCount,
      progress: pageNumber / pageCount,
      phase: "flatten",
    });
  }

  return outDoc.save();
}

/**
 * Blur/pixelate become solid black covers when draw helpers are absent (secure default).
 * @param {object[]} redactions
 */
function hardenRedactionsForRaster(redactions) {
  return (Array.isArray(redactions) ? redactions : []).map((item) => {
    if (item?.type === "blackout") return { ...item };
    // Without blur/pixelate painters, export-clean skips non-blackout; force blackout covers.
    return {
      ...item,
      type: "blackout",
      color: "#000000",
    };
  });
}

async function rasterizeWithSolidCovers(sourceCanvas, width, height, redactions, options) {
  const createCanvas = options.createCanvas;
  if (typeof createCanvas !== "function") {
    throw new Error("Could not create a redacted page canvas for flatten export.");
  }
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d", { alpha: false });
  context.drawImage(sourceCanvas, 0, 0, width, height);
  for (const redaction of redactions || []) {
    const x = Number(redaction.x);
    const y = Number(redaction.y);
    const w = Number(redaction.width);
    const h = Number(redaction.height);
    if (![x, y, w, h].every(Number.isFinite) || !(w > 0) || !(h > 0)) continue;
    context.fillStyle = redactionFillColor(redaction);
    context.fillRect(x, y, w, h);
  }
  return canvas;
}

/**
 * @param {object} canvas
 * @returns {Promise<Uint8Array>}
 */
export async function canvasToPngBytes(canvas) {
  if (!canvas) throw new Error("Canvas is required.");

  if (typeof canvas.toBuffer === "function") {
    const buffer = canvas.toBuffer("image/png");
    return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  }

  if (typeof canvas.toBlob === "function") {
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error("PNG encoding failed."));
      }, "image/png");
    });
    return new Uint8Array(await blob.arrayBuffer());
  }

  if (typeof canvas.toDataURL === "function") {
    const dataUrl = canvas.toDataURL("image/png");
    const base64 = String(dataUrl).split(",")[1] || "";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  throw new Error("PNG encoding is unavailable for this canvas.");
}

/**
 * Build a generic redacted PDF download filename. The source name is never
 * reused, so the exported file cannot hint at the original document.
 * @param {Date} [date]
 * @returns {string}
 */
export function createRedactedPdfFileName(date = new Date()) {
  return createRedactedFileName("pdf", date);
}

function toUint8Array(value) {
  if (!value) return null;
  if (value instanceof Uint8Array) {
    // Slice so a detached/transferred buffer from pdf.js cannot empty the export input.
    try {
      return value.byteLength ? value.slice() : null;
    } catch {
      return null;
    }
  }
  if (value instanceof ArrayBuffer) {
    return value.byteLength ? new Uint8Array(value.slice(0)) : null;
  }
  if (ArrayBuffer.isView(value)) {
    try {
      return value.byteLength
        ? new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
        : null;
    } catch {
      return null;
    }
  }
  return null;
}
