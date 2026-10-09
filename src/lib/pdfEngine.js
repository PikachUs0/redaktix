/**
 * Client-side PDF page render + text extraction (pdfjs-dist).
 * Text items are mapped into the same OCR word/line shape the editor detectors expect.
 */

// Legacy build works in both Vite (browser) and Node tests.
import { getDocument, GlobalWorkerOptions, Util } from "pdfjs-dist/legacy/build/pdf.mjs";

const DEFAULT_RENDER_SCALE = 2;
const DEFAULT_LOAD_TIMEOUT_MS = 45000;
const DEFAULT_RENDER_TIMEOUT_MS = 30000;

/** Serialize pdf.js worker ops — concurrent render + extract can deadlock the worker. */
let pdfWorkerQueue = Promise.resolve();

/**
 * Run a pdf.js-backed operation after prior ops settle.
 * @template T
 * @param {() => Promise<T>} operation
 * @returns {Promise<T>}
 */
export function runPdfWorkerOp(operation) {
  const run = pdfWorkerQueue.then(
    () => operation(),
    () => operation()
  );
  // Keep the queue alive even when an op rejects.
  pdfWorkerQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} timeoutMs
 * @param {string} label
 * @param {() => void} [onTimeout]
 * @returns {Promise<T>}
 */
function withTimeout(promise, timeoutMs, label, onTimeout) {
  const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : 0;
  if (!ms) return promise;
  let timeoutId = 0;
  const timed = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      try {
        onTimeout?.();
      } catch {
        // ignore
      }
      reject(new Error(`${label} timed out after ${ms}ms.`));
    }, ms);
  });
  return Promise.race([promise, timed]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

// Keep this `new URL(...)` call on one line so Vite emits the worker asset in build.
const VITE_WORKER_URL = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href;

/** Same-origin static copy under public/ — avoids Vite transforming the worker in dev. */
function publicPdfWorkerUrl() {
  try {
    const base = typeof import.meta !== "undefined" && import.meta.env && import.meta.env.BASE_URL
      ? String(import.meta.env.BASE_URL)
      : "/";
    const normalized = base.endsWith("/") ? base : `${base}/`;
    return `${normalized}assets/pdf/pdf.worker.min.mjs`;
  } catch {
    return "/assets/pdf/pdf.worker.min.mjs";
  }
}

/**
 * @param {string} [workerSrc]
 * @returns {string} resolved workerSrc
 */
export function setPdfWorkerSrc(workerSrc) {
  return configurePdfWorker(workerSrc);
}

/**
 * Configure pdf.js worker for Vite dev/build and Node tests.
 * In the browser, prefer the static public/ worker so Vite does not transform a 1.3MB worker into a multi‑MB module.
 * @param {string} [preferredSrc]
 * @returns {string}
 */
export function configurePdfWorker(preferredSrc) {
  const staticPublic = publicPdfWorkerUrl();
  const candidates =
    typeof window !== "undefined"
      ? [staticPublic, preferredSrc, GlobalWorkerOptions.workerSrc, VITE_WORKER_URL]
      : [preferredSrc, GlobalWorkerOptions.workerSrc, VITE_WORKER_URL, staticPublic];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (!value || value === "undefined" || value === "null") continue;
    GlobalWorkerOptions.workerSrc = value;
    return value;
  }
  throw new Error("PDF.js workerSrc could not be resolved for this environment.");
}

export function getPdfWorkerSrc() {
  return String(GlobalWorkerOptions.workerSrc || "");
}

/**
 * Best-effort worker path for Node / non-Vite callers. The editor sets the Vite
 * asset URL via setPdfWorkerSrc / configurePdfWorker before loading PDFs.
 */
export function ensurePdfWorker() {
  if (String(GlobalWorkerOptions.workerSrc || "").trim()) return getPdfWorkerSrc();
  try {
    return configurePdfWorker(VITE_WORKER_URL);
  } catch (error) {
    try {
      return configurePdfWorker(
        new URL("../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href
      );
    } catch {
      throw error;
    }
  }
}

/**
 * @param {File | Blob | { type?: string, name?: string } | null | undefined} file
 * @returns {boolean}
 */
export function isPdfFile(file) {
  if (!file) return false;
  const type = String(file.type || "").toLowerCase();
  if (type === "application/pdf" || type === "application/x-pdf") return true;
  return /\.pdf$/i.test(String(file.name || ""));
}

/**
 * Affine matrix multiply matching pdf.js Util.transform.
 * @param {number[]} m1
 * @param {number[]} m2
 * @returns {number[]}
 */
export function multiplyTransform(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/** Default ascent / em-box ratio (matches typical pdf.js TextLayer fallback). */
const DEFAULT_PDF_ASCENT_RATIO = 0.8;
/** Extra vertical pad so highlight rects wrap glyphs instead of skimming the midline. */
const DEFAULT_PDF_BBOX_PAD_RATIO = 0.14;

/**
 * Convert a pdf.js text item into a canvas-space axis-aligned bbox.
 * Vertical origin follows the TextLayer rule: top = baseline − ascent (not baseline − em).
 * Height always comes from the transformed font matrix so it stays in the same space as x/y.
 *
 * @param {{ transform: number[], width?: number, height?: number, fontName?: string }} item
 * @param {{ transform: number[], scale: number }} viewport
 * @param {(a: number[], b: number[]) => number[]} [transformFn]
 * @param {{
 *   ascentRatio?: number,
 *   padRatio?: number,
 *   styles?: Record<string, { ascent?: number, descent?: number, vertical?: boolean }>,
 * }} [options]
 * @returns {{ x: number, y: number, width: number, height: number } | null}
 */
export function textItemToViewportBBox(item, viewport, transformFn = multiplyTransform, options = {}) {
  if (!item?.transform || !viewport?.transform) return null;
  const tx = transformFn(viewport.transform, item.transform);
  const fontHeight = Math.hypot(tx[2], tx[3]);
  if (!(fontHeight > 0) || !Number.isFinite(fontHeight)) return null;

  const style = options.styles?.[item.fontName];
  let ascentRatio = DEFAULT_PDF_ASCENT_RATIO;
  if (Number(options.ascentRatio) > 0 && Number(options.ascentRatio) <= 1) {
    ascentRatio = Number(options.ascentRatio);
  } else if (style && Number(style.ascent) > 0 && Number(style.ascent) <= 1) {
    // pdf.js TextStyle.ascent is a fraction of the em box (same as TextLayer.#getAscent fallback).
    ascentRatio = Number(style.ascent);
  } else if (style && Number(style.descent) < 0 && Number(style.descent) >= -1) {
    ascentRatio = 1 + Number(style.descent);
  }
  ascentRatio = Math.min(0.95, Math.max(0.55, ascentRatio));

  // item.width is in text-space units (same as the font size on the text matrix).
  const textFontSize = Math.hypot(item.transform[2], item.transform[3])
    || Math.hypot(item.transform[0], item.transform[1])
    || 1;
  const widthFromItem = Number(item.width);
  const width = Number.isFinite(widthFromItem) && widthFromItem > 0
    ? widthFromItem * (fontHeight / textFontSize)
    : Math.max(1, Math.hypot(tx[0], tx[1]));

  const padRatio = Number.isFinite(Number(options.padRatio))
    ? Math.max(0, Number(options.padRatio))
    : DEFAULT_PDF_BBOX_PAD_RATIO;
  const pad = fontHeight * padRatio;
  const ascent = fontHeight * ascentRatio;
  // Baseline is tx[5]; top of ink ≈ baseline − ascent (pdf.js TextLayer).
  const x = tx[4];
  const y = tx[5] - ascent - pad;
  const height = fontHeight + pad * 2;

  if (![x, y, width, height].every(Number.isFinite)) return null;
  return {
    x,
    y,
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

/**
 * Split a text item into OCR-shaped words (space-delimited) with proportional bboxes.
 * @param {string} text
 * @param {{ x: number, y: number, width: number, height: number }} bbox
 * @param {{ lineId: string, lineIndex: number, confidence?: number }} meta
 * @returns {object[]}
 */
export function splitTextItemIntoWords(text, bbox, meta) {
  const raw = String(text || "");
  const trimmed = raw.trim();
  if (!trimmed || !bbox) return [];

  const confidence = Number.isFinite(Number(meta?.confidence)) ? Number(meta.confidence) : 100;
  const lineId = meta.lineId;
  const lineIndex = meta.lineIndex;
  const parts = [];
  const pattern = /\S+/g;
  let match = pattern.exec(raw);
  while (match) {
    parts.push({ text: match[0], start: match.index, end: match.index + match[0].length });
    match = pattern.exec(raw);
  }
  if (!parts.length) return [];

  const totalChars = Math.max(1, raw.length);
  return parts.map((part, wordIndex) => {
    const startRatio = part.start / totalChars;
    const endRatio = part.end / totalChars;
    const x = bbox.x + bbox.width * startRatio;
    const width = Math.max(1, bbox.width * (endRatio - startRatio));
    return {
      text: part.text,
      confidence,
      bbox: {
        x,
        y: bbox.y,
        width,
        height: bbox.height,
      },
      lineId,
      lineIndex,
      wordIndex,
      blockIndex: 0,
      paragraphIndex: 0,
      source: "pdf",
    };
  });
}

/**
 * Map pdf.js getTextContent() output into OCR-compatible words + lines.
 * @param {{ items?: object[], styles?: Record<string, object> }} textContent
 * @param {{ transform: number[], scale: number, width?: number, height?: number }} viewport
 * @param {{ transformFn?: Function, styles?: Record<string, object>, padRatio?: number }} [options]
 * @returns {{ words: object[], lines: object[], text: string }}
 */
export function pdfTextContentToOcrResult(textContent, viewport, options = {}) {
  const transformFn = options.transformFn || multiplyTransform;
  const styles = options.styles || textContent?.styles || null;
  const items = Array.isArray(textContent?.items) ? textContent.items : [];
  const words = [];
  const lineBuckets = new Map();
  let lineIndex = 0;
  let lineId = `pdf-0`;

  for (const item of items) {
    if (!item || typeof item.str !== "string") continue;
    const str = item.str;
    if (!str.trim()) {
      if (item.hasEOL) {
        lineIndex += 1;
        lineId = `pdf-${lineIndex}`;
      }
      continue;
    }

    const bbox = textItemToViewportBBox(item, viewport, transformFn, {
      styles,
      padRatio: options.padRatio,
    });
    if (!bbox) {
      if (item.hasEOL) {
        lineIndex += 1;
        lineId = `pdf-${lineIndex}`;
      }
      continue;
    }

    const itemWords = splitTextItemIntoWords(str, bbox, {
      lineId,
      lineIndex,
      confidence: 100,
    });
    for (const word of itemWords) {
      words.push(word);
      if (!lineBuckets.has(lineId)) lineBuckets.set(lineId, []);
      lineBuckets.get(lineId).push(word);
    }

    if (item.hasEOL) {
      lineIndex += 1;
      lineId = `pdf-${lineIndex}`;
    }
  }

  // Fallback: group by visual Y when PDF never set hasEOL.
  if (lineBuckets.size <= 1 && words.length > 1) {
    lineBuckets.clear();
    for (const word of words) {
      const height = Math.max(1, Number(word.bbox.height) || 1);
      const centerY = Number(word.bbox.y) + height / 2;
      const key = `pdf-y${Math.round(centerY / Math.max(6, height * 0.65))}`;
      word.lineId = key;
      if (!lineBuckets.has(key)) lineBuckets.set(key, []);
      lineBuckets.get(key).push(word);
    }
    let index = 0;
    for (const [, lineWords] of lineBuckets) {
      for (const word of lineWords) word.lineIndex = index;
      index += 1;
    }
  }

  const lines = [];
  for (const [id, lineWords] of lineBuckets) {
    const sorted = [...lineWords].sort((a, b) => Number(a.bbox.x) - Number(b.bbox.x));
    if (!sorted.length) continue;
    const left = Math.min(...sorted.map((word) => Number(word.bbox.x)));
    const top = Math.min(...sorted.map((word) => Number(word.bbox.y)));
    const right = Math.max(...sorted.map((word) => Number(word.bbox.x) + Number(word.bbox.width)));
    const bottom = Math.max(...sorted.map((word) => Number(word.bbox.y) + Number(word.bbox.height)));
    const text = sorted.map((word) => word.text).join(" ");
    lines.push({
      id,
      text,
      confidence: 100,
      bbox: {
        x: left,
        y: top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
      },
      words: sorted,
      blockIndex: 0,
      paragraphIndex: 0,
      lineIndex: Number(sorted[0]?.lineIndex) || 0,
    });
  }

  lines.sort((a, b) => Number(a.bbox.y) - Number(b.bbox.y) || Number(a.bbox.x) - Number(b.bbox.x));

  return {
    words,
    lines,
    text: lines.map((line) => line.text).join("\n"),
  };
}

/**
 * @param {ArrayBuffer | Uint8Array | { data: ArrayBuffer | Uint8Array }} source
 * @param {object} [options]
 * @returns {Promise<import('pdfjs-dist').PDFDocumentProxy>}
 */
export async function loadPdfDocument(source, options = {}) {
  return runPdfWorkerOp(async () => {
    const workerSrc = ensurePdfWorker();
    if (!workerSrc) {
      throw new Error("PDF.js worker is not configured (GlobalWorkerOptions.workerSrc is empty).");
    }

    const raw = source?.data || source;
    // Copy bytes: pdf.js may transfer/detach the ArrayBuffer to the worker.
    const data = raw instanceof Uint8Array
      ? raw.slice()
      : new Uint8Array(raw);
    if (!data?.byteLength) {
      throw new Error("PDF bytes are empty or detached.");
    }

    const timeoutMs = Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : DEFAULT_LOAD_TIMEOUT_MS;
    const { timeoutMs: _ignoredTimeout, ...docOptions } = options;

    const loadingTask = getDocument({
      data,
      useSystemFonts: true,
      ...docOptions,
    });

    return withTimeout(
      loadingTask.promise,
      timeoutMs,
      `PDF load (worker: ${workerSrc})`,
      () => {
        try {
          loadingTask.destroy();
        } catch {
          // ignore
        }
      }
    );
  });
}

/**
 * Extract text + bounding boxes for one page without allocating a canvas bitmap.
 * BBoxes are in the same canvas-space as a render at the same scale.
 *
 * @param {import('pdfjs-dist').PDFDocumentProxy} pdf
 * @param {number} pageNumber 1-based
 * @param {{ scale?: number }} [options]
 * @returns {Promise<{
 *   pageNumber: number,
 *   pageCount: number,
 *   viewport: { width: number, height: number, scale: number, transform: number[] },
 *   canvasWidth: number,
 *   canvasHeight: number,
 *   words: object[],
 *   lines: object[],
 *   text: string,
 * }>}
 */
export async function extractPdfPageContent(pdf, pageNumber, options = {}) {
  return runPdfWorkerOp(async () => {
    if (!pdf) throw new Error("PDF document is required.");
    const pageCount = Number(pdf.numPages) || 0;
    const page = Math.max(1, Math.min(pageCount || 1, Number(pageNumber) || 1));
    const scale = Number(options.scale) > 0 ? Number(options.scale) : DEFAULT_RENDER_SCALE;
    const pdfPage = await pdf.getPage(page);
    const viewport = pdfPage.getViewport({ scale });
    const textContent = await pdfPage.getTextContent();
    const ocrResult = pdfTextContentToOcrResult(textContent, viewport, {
      transformFn: (a, b) => Util.transform(a, b),
    });

    return {
      pageNumber: page,
      pageCount,
      viewport: {
        width: viewport.width,
        height: viewport.height,
        scale,
        transform: Array.from(viewport.transform || []),
      },
      canvasWidth: Math.ceil(viewport.width),
      canvasHeight: Math.ceil(viewport.height),
      words: ocrResult.words,
      lines: ocrResult.lines,
      text: ocrResult.text,
    };
  });
}

/**
 * Render one PDF page to a canvas (lazy display / export). Optionally skips text extract
 * when `options.words` is already known.
 *
 * @param {import('pdfjs-dist').PDFDocumentProxy} pdf
 * @param {number} pageNumber 1-based
 * @param {{ scale?: number, createCanvas?: Function, skipText?: boolean }} [options]
 */
export async function renderPdfPage(pdf, pageNumber, options = {}) {
  return runPdfWorkerOp(async () => {
    if (!pdf) throw new Error("PDF document is required.");
    const pageCount = Number(pdf.numPages) || 0;
    const page = Math.max(1, Math.min(pageCount || 1, Number(pageNumber) || 1));
    const scale = Number(options.scale) > 0 ? Number(options.scale) : DEFAULT_RENDER_SCALE;
    const timeoutMs = Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : DEFAULT_RENDER_TIMEOUT_MS;
    const pdfPage = await pdf.getPage(page);
    const viewport = pdfPage.getViewport({ scale });

    const canvas = typeof options.createCanvas === "function"
      ? options.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      : createBrowserCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Could not create a 2D canvas context for the PDF page.");

    const renderTask = pdfPage.render({
      canvasContext: context,
      viewport,
      canvas,
    });
    await withTimeout(
      renderTask.promise,
      timeoutMs,
      `PDF page ${page} render`,
      () => {
        try {
          renderTask.cancel?.();
        } catch {
          // ignore
        }
      }
    );

    let words = Array.isArray(options.words) ? options.words : null;
    let lines = Array.isArray(options.lines) ? options.lines : null;
    let text = typeof options.text === "string" ? options.text : null;

    if (!options.skipText && (!words || !lines)) {
      const textContent = await pdfPage.getTextContent();
      const ocrResult = pdfTextContentToOcrResult(textContent, viewport, {
        transformFn: (a, b) => Util.transform(a, b),
      });
      words = ocrResult.words;
      lines = ocrResult.lines;
      text = ocrResult.text;
    }

    return {
      pageNumber: page,
      pageCount,
      canvas,
      viewport,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      words: words || [],
      lines: lines || [],
      text: text || "",
    };
  });
}

/**
 * Tag detections with a 1-based PDF page number.
 * @param {object[]} detections
 * @param {number} pageNumber
 * @returns {object[]}
 */
export function tagDetectionsWithPage(detections, pageNumber) {
  const page = Math.max(1, Number(pageNumber) || 1);
  return (Array.isArray(detections) ? detections : []).map((item) => ({
    ...item,
    page,
    pageNumber: page,
  }));
}

/**
 * Flatten per-page findings into one document list (sorted by page, then y).
 * @param {Array<{ pageNumber?: number, detections?: object[] }>} pages
 * @returns {object[]}
 */
export function aggregatePdfDetections(pages) {
  const all = [];
  for (const entry of Array.isArray(pages) ? pages : []) {
    const page = Number(entry?.pageNumber) || Number(entry?.page) || 1;
    for (const detection of Array.isArray(entry?.detections) ? entry.detections : []) {
      const pageValue = Number(detection?.page || detection?.pageNumber) || page;
      all.push({
        ...detection,
        page: pageValue,
        pageNumber: pageValue,
      });
    }
  }
  return all.sort((a, b) => {
    const pageDelta = Number(a.page) - Number(b.page);
    if (pageDelta) return pageDelta;
    return Number(a.normY || 0) - Number(b.normY || 0);
  });
}

/**
 * Iterate every page: extract text (no canvases) and optionally run detectFn.
 * Designed for background full-document scans after upload.
 *
 * @param {import('pdfjs-dist').PDFDocumentProxy} pdf
 * @param {{
 *   scale?: number,
 *   signal?: AbortSignal,
 *   detectFn?: (ocr: { words: object[], lines: object[], text: string }, pageNumber: number) => object[] | Promise<object[]>,
 *   onProgress?: (info: object) => void,
 * }} [options]
 */
export async function scanPdfDocumentPages(pdf, options = {}) {
  if (!pdf) throw new Error("PDF document is required.");
  const pageCount = Number(pdf.numPages) || 0;
  const scale = Number(options.scale) > 0 ? Number(options.scale) : DEFAULT_RENDER_SCALE;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    if (options.signal?.aborted) {
      break;
    }

    let pageResult;
    try {
      const content = await extractPdfPageContent(pdf, pageNumber, { scale });
      let detections = [];
      if (typeof options.detectFn === "function") {
        try {
          detections = tagDetectionsWithPage(
            await options.detectFn(
              {
                words: content.words,
                lines: content.lines,
                text: content.text,
                canvasWidth: content.canvasWidth,
                canvasHeight: content.canvasHeight,
              },
              pageNumber
            ),
            pageNumber
          );
        } catch (detectError) {
          options.onPageError?.(detectError, pageNumber, "detect");
          detections = [];
        }
      }

      pageResult = {
        ...content,
        detections,
      };
    } catch (pageError) {
      options.onPageError?.(pageError, pageNumber, "extract");
      pageResult = {
        pageNumber,
        pageCount,
        viewport: { width: 0, height: 0, scale, transform: [] },
        canvasWidth: 0,
        canvasHeight: 0,
        words: [],
        lines: [],
        text: "",
        detections: [],
        error: String(pageError?.message || pageError || "Page scan failed"),
      };
    }

    pages.push(pageResult);

    try {
      options.onProgress?.({
        page: pageNumber,
        pageCount,
        progress: pageCount ? pageNumber / pageCount : 1,
        pageResult,
        detections: aggregatePdfDetections(pages),
      });
    } catch (progressError) {
      options.onPageError?.(progressError, pageNumber, "progress");
    }
  }

  return {
    pageCount,
    scale,
    pages,
    detections: aggregatePdfDetections(pages),
    aborted: Boolean(options.signal?.aborted),
  };
}

/**
 * @param {number} width
 * @param {number} height
 * @returns {HTMLCanvasElement}
 */
function createBrowserCanvas(width, height) {
  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    throw new Error("Canvas is unavailable. Pass options.createCanvas for non-browser use.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export const PDF_DEFAULT_SCALE = DEFAULT_RENDER_SCALE;
export const PDF_RENDER_TIMEOUT_MS = DEFAULT_RENDER_TIMEOUT_MS;
