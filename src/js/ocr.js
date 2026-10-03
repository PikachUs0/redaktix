import { createWorker } from "tesseract.js";
import { findTcknMatches, findPass2TcknTexts, tcknEvidence } from "./sensitive-detectors.js";
import {
  OCR_ADAPTIVE_DEFAULTS,
  adaptiveThresholdGray,
  contrastForOcr,
  cropRgba,
  cropTextBand,
  forceBadgeRoiPadding,
  discoverSuspiciousRois,
  grayscaleFromRgba,
  grayscaleStats,
  invertGray,
  spatiallyDuplicate,
  sameTcknGlyph,
  mapRoiBoxToOriginal,
  rgbaFromGray,
  upscaleGray,
  warnIfCollapsed,
} from "./ocr-adaptive.js";

let ocrWorker = null;
let workerInitializationPromise = null;
let latestProgressHandler = null;
let recognitionQueue = Promise.resolve();
let isTerminatingWorker = false;
let activeScanId = null;

const OCR_LANGUAGES = Object.freeze([
  "eng",
  "tur",
]);

const viteBaseUrl =
  typeof import.meta.env.BASE_URL === "string"
    ? import.meta.env.BASE_URL
    : "/";

const normalizedBaseUrl =
  viteBaseUrl.endsWith("/")
    ? viteBaseUrl
    : `${viteBaseUrl}/`;

const OCR_ASSET_BASE =
  `${normalizedBaseUrl}assets/ocr`;

const OCR_PATHS = Object.freeze({
  worker:
    `${OCR_ASSET_BASE}/worker/worker.min.js`,

  core:
    `${OCR_ASSET_BASE}/core`,

  languages:
    `${OCR_ASSET_BASE}/lang`,
});

/**
 * Progress callback errors must not interrupt OCR.
 */
function reportProgress(message) {
  if (
    typeof latestProgressHandler !==
    "function"
  ) {
    return;
  }

  try {
    latestProgressHandler(message);
  } catch {
    // UI progress handlers must not stop OCR.
  }
}

function createOcrInitializationError(error) {
  const message =
    error instanceof Error
      ? error.message
      : String(error || "Unknown OCR error");

  return new Error(
    `The local OCR engine could not be initialized: ${message}`,
    {
      cause: error,
    }
  );
}

async function initializeOcrWorker() {
  const worker = await createWorker(
    OCR_LANGUAGES,
    1,
    {
      workerPath: OCR_PATHS.worker,
      corePath: OCR_PATHS.core,
      langPath: OCR_PATHS.languages,

      logger: (message) => {
        reportProgress(message);
        if (import.meta.env?.DEV) {
          console.debug("[Tesseract]", message?.status ?? "", message?.progress ?? "");
        }
      },

      errorHandler: (error) => {
        /*
         * Do not include OCR text, image data or
         * filenames in production error output.
         */
        console.error(
          "Redaktix OCR worker encountered an error.",
          error
        );
      },
    }
  );

  try {
    await worker.setParameters({
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
      tessedit_pageseg_mode: "3",
    });

    return worker;
  } catch (error) {
    try {
      await worker.terminate();
    } catch {
      // Initialization error remains the primary error.
    }

    throw error;
  }
}

async function getOcrWorker(onProgress) {
  latestProgressHandler =
    typeof onProgress === "function"
      ? onProgress
      : null;

  if (isTerminatingWorker) {
    throw new Error(
      "The OCR engine is currently shutting down."
    );
  }

  if (ocrWorker) {
    return ocrWorker;
  }

  if (!workerInitializationPromise) {
    workerInitializationPromise =
      initializeOcrWorker()
        .then((worker) => {
          ocrWorker = worker;
          return worker;
        })
        .catch((error) => {
          ocrWorker = null;
          workerInitializationPromise = null;

          throw createOcrInitializationError(
            error
          );
        });
  }

  return workerInitializationPromise;
}

function getImageDimensions(imageSource) {
  const sourceWidth = Number(
    imageSource?.naturalWidth ||
    imageSource?.videoWidth ||
    imageSource?.width ||
    0
  );

  const sourceHeight = Number(
    imageSource?.naturalHeight ||
    imageSource?.videoHeight ||
    imageSource?.height ||
    0
  );

  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    throw new Error(
      "The OCR image dimensions could not be determined."
    );
  }

  return {
    width: sourceWidth,
    height: sourceHeight,
  };
}

function sanitizeOcrToken(value) {
  return String(value || "")
    .trim()
    .replace(/^[\u0000-\u001F]+/g, "")
    .replace(/[\u0000-\u001F]+$/g, "")
    .replace(/[.,;:!]+$/g, "");
}

function sanitizeOcrLine(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .trim();
}

function normalizeBoundingBox(
  bbox,
  scale = 1
) {
  if (!bbox) {
    return null;
  }

  const numericScale = Number(scale);

  const safeScale =
    Number.isFinite(numericScale) &&
      numericScale > 0
      ? numericScale
      : 1;

  const rawX0 = Number(
    bbox.x0 ?? bbox.x
  );

  const rawY0 = Number(
    bbox.y0 ?? bbox.y
  );

  const rawX1 = Number.isFinite(
    Number(bbox.x1)
  )
    ? Number(bbox.x1)
    : rawX0 + Number(
      bbox.width ?? bbox.w
    );

  const rawY1 = Number.isFinite(
    Number(bbox.y1)
  )
    ? Number(bbox.y1)
    : rawY0 + Number(
      bbox.height ?? bbox.h
    );

  if (
    ![
      rawX0,
      rawY0,
      rawX1,
      rawY1,
    ].every(Number.isFinite)
  ) {
    return null;
  }

  const x0 = rawX0 / safeScale;
  const y0 = rawY0 / safeScale;
  const x1 = rawX1 / safeScale;
  const y1 = rawY1 / safeScale;

  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  const right = Math.max(x0, x1);
  const bottom = Math.max(y0, y1);

  const width = right - left;
  const height = bottom - top;

  if (
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return {
    x0: left,
    y0: top,
    x1: right,
    y1: bottom,

    x: left,
    y: top,

    width,
    height,

    w: width,
    h: height,
  };
}

function normalizeConfidence(value) {
  const confidence = Number(value);

  if (!Number.isFinite(confidence)) {
    return 0;
  }

  return Math.min(
    100,
    Math.max(0, confidence)
  );
}

function createOcrSymbol(
  symbol,
  scale
) {
  const text = String(
    symbol?.text || ""
  );

  const bbox = normalizeBoundingBox(
    symbol?.bbox,
    scale
  );

  if (!text || !bbox) {
    return null;
  }

  return {
    text,
    confidence: normalizeConfidence(
      symbol?.confidence
    ),
    bbox,
  };
}

function createOcrWord(
  word,
  scale,
  position
) {
  const text = sanitizeOcrToken(
    word?.text
  );

  const bbox = normalizeBoundingBox(
    word?.bbox,
    scale
  );

  if (!text || !bbox) {
    return null;
  }

  const symbols =
    Array.isArray(word?.symbols)
      ? word.symbols
        .map((symbol) => {
          return createOcrSymbol(
            symbol,
            scale
          );
        })
        .filter(Boolean)
      : [];

  const blockIndex = Number(
    position?.blockIndex ?? 0
  );

  const paragraphIndex = Number(
    position?.paragraphIndex ?? 0
  );

  const lineIndex = Number(
    position?.lineIndex ?? 0
  );

  const wordIndex = Number(
    position?.wordIndex ?? 0
  );

  return {
    text,

    confidence: normalizeConfidence(
      word?.confidence
    ),

    bbox,
    symbols,

    lineId:
      `${blockIndex}-` +
      `${paragraphIndex}-` +
      `${lineIndex}`,

    blockIndex,
    paragraphIndex,
    lineIndex,
    wordIndex,
  };
}

function collectWordsFromBlocks(
  blocks,
  scale
) {
  if (!Array.isArray(blocks)) {
    return [];
  }

  const words = [];

  blocks.forEach(
    (block, blockIndex) => {
      const paragraphs =
        Array.isArray(block?.paragraphs)
          ? block.paragraphs
          : [];

      paragraphs.forEach(
        (
          paragraph,
          paragraphIndex
        ) => {
          const lines =
            Array.isArray(
              paragraph?.lines
            )
              ? paragraph.lines
              : [];

          lines.forEach(
            (line, lineIndex) => {
              const lineWords =
                Array.isArray(
                  line?.words
                )
                  ? line.words
                  : [];

              lineWords.forEach(
                (word, wordIndex) => {
                  const collectedWord =
                    createOcrWord(
                      word,
                      scale,
                      {
                        blockIndex,
                        paragraphIndex,
                        lineIndex,
                        wordIndex,
                      }
                    );

                  if (collectedWord) {
                    words.push(
                      collectedWord
                    );
                  }
                }
              );
            }
          );
        }
      );
    }
  );

  return words;
}

function collectLinesFromBlocks(
  blocks,
  scale
) {
  if (!Array.isArray(blocks)) {
    return [];
  }

  const lines = [];

  blocks.forEach(
    (block, blockIndex) => {
      const paragraphs =
        Array.isArray(block?.paragraphs)
          ? block.paragraphs
          : [];

      paragraphs.forEach(
        (
          paragraph,
          paragraphIndex
        ) => {
          const paragraphLines =
            Array.isArray(
              paragraph?.lines
            )
              ? paragraph.lines
              : [];

          paragraphLines.forEach(
            (line, lineIndex) => {
              const text =
                sanitizeOcrLine(
                  line?.text
                );

              const bbox =
                normalizeBoundingBox(
                  line?.bbox,
                  scale
                );

              if (!text || !bbox) {
                return;
              }

              const rawWords =
                Array.isArray(
                  line?.words
                )
                  ? line.words
                  : [];

              const words = rawWords
                .map(
                  (word, wordIndex) => {
                    return createOcrWord(
                      word,
                      scale,
                      {
                        blockIndex,
                        paragraphIndex,
                        lineIndex,
                        wordIndex,
                      }
                    );
                  }
                )
                .filter(Boolean);

              const confidences =
                words
                  .map((word) => {
                    return Number(
                      word.confidence
                    );
                  })
                  .filter(
                    Number.isFinite
                  );

              const fallbackConfidence =
                normalizeConfidence(
                  line?.confidence
                );

              const confidence =
                confidences.length > 0
                  ? confidences.reduce(
                    (total, value) => {
                      return (
                        total + value
                      );
                    },
                    0
                  ) /
                  confidences.length
                  : fallbackConfidence;

              lines.push({
                id:
                  `${blockIndex}-` +
                  `${paragraphIndex}-` +
                  `${lineIndex}`,

                text,
                confidence,
                bbox,
                words,

                blockIndex,
                paragraphIndex,
                lineIndex,
              });
            }
          );
        }
      );
    }
  );

  return lines;
}

const OCR_OUTPUT = Object.freeze({
  text: true,
  blocks: true,
  hocr: false,
  tsv: false,
  pdf: false,
  imageColor: false,
  imageGrey: false,
  imageBinary: false,
  debug: false,
});

async function recognizePreparedImage(worker, imageSource, scale, recognizeOptions = {}) {
  assertOcrCanvas(imageSource, "OCR input");
  const result = await worker.recognize(imageSource, recognizeOptions, OCR_OUTPUT);
  const resultData = result?.data || {};
  const blocks = Array.isArray(resultData.blocks) ? resultData.blocks : [];
  return {
    text: String(resultData.text || ""),
    blocks,
    words: collectWordsFromBlocks(blocks, scale),
    lines: collectLinesFromBlocks(blocks, scale),
  };
}

function assertOcrCanvas(canvas, label) {
  if (!canvas || typeof canvas.getContext !== "function") {
    throw new Error(`${label} is not a canvas. Refusing to fall back to another image.`);
  }
  if (!(canvas.width > 0) || !(canvas.height > 0)) {
    throw new Error(`${label} has zero dimensions (${canvas?.width}x${canvas?.height}).`);
  }
}

function readCanvasPixels(canvas, label) {
  assertOcrCanvas(canvas, label);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error(`${label} has no 2D context.`);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  let opaque = false;
  for (let index = 3; index < image.data.length; index += 16) {
    if (image.data[index] > 0) {
      opaque = true;
      break;
    }
  }
  return { image, opaque };
}

function canvasStats(canvas, label) {
  const { image, opaque } = readCanvasPixels(canvas, label);
  const gray = grayscaleFromRgba(image.data, image.width, image.height);
  return { ...grayscaleStats(gray, image.width, image.height), nonTransparent: opaque, label };
}

function logStage(stage, scanId, fields) {
  if (!import.meta.env?.DEV) return;
  // Never print OCR/detection text — only coarse progress metrics.
  console.log(
    `[${stage}] scanId=${scanId} pass=${fields.pass || ""} width=${fields.width ?? ""} height=${fields.height ?? ""} elapsed=${fields.elapsed ?? ""} words=${fields.words ?? ""} bboxes=${fields.bboxes ?? ""}`
  );
}

function elapsedSince(started) {
  return Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - started);
}

function confidenceSummary(words) {
  return words.map((word) => Number(word.confidence || 0)).slice(0, 12).join(",");
}

function canvasFromGray(gray, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true, alpha: false });
  if (!context) throw new Error("The OCR variant canvas could not be created.");
  const image = context.createImageData(width, height);
  image.data.set(rgbaFromGray(gray));
  context.putImageData(image, 0, 0);
  assertOcrCanvas(canvas, "OCR variant");
  return canvas;
}

export function createSauvolaCanvas(sourceCanvas, options = {}) {
  assertOcrCanvas(sourceCanvas, "Sauvola source");
  const { image } = readCanvasPixels(sourceCanvas, "Sauvola source");
  const gray = grayscaleFromRgba(image.data, image.width, image.height);
  const binary = sauvolaThreshold(gray, image.width, image.height, options);
  return canvasFromGray(binary, image.width, image.height);
}

function releaseCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

function relocateWord(word, roi, scale, sourcePass) {
  const bbox = mapRoiBoxToOriginal(word.bbox, roi, scale);
  return {
    ...word,
    bbox,
    sourcePass,
    lineId: `p2-${word.lineId}`,
    lineIndex: Number(word.lineIndex) + 1000,
  };
}

function lineFromWord(word) {
  return {
    id: word.lineId,
    text: word.text,
    confidence: word.confidence,
    bbox: word.bbox,
    words: [word],
    lineIndex: word.lineIndex,
  };
}

function mergeDistinctWords(primary, extra) {
  const merged = primary.slice();
  extra.forEach((word) => {
    if (!word?.bbox || !String(word.text || "").trim()) return;
    const duplicate = merged.some((kept) => {
      const bothTckn = tcknEvidence(word.text).valid && tcknEvidence(kept.text).valid;
      return bothTckn ? sameTcknGlyph(kept.bbox, word.bbox) : spatiallyDuplicate(kept.bbox, word.bbox);
    });
    if (!duplicate) merged.push(word);
  });
  return merged;
}

function classifyPassText(text) {
  if (findPass2TcknTexts(text).length) return "valid-tckn";
  if (/\d{4,}/.test(String(text || ""))) return "CASE 2";
  return "CASE 3";
}

function roiTcknWord(text, roiOrigin) {
  const x0 = Number(roiOrigin.x) || 0;
  const y0 = Number(roiOrigin.y) || 0;
  const width = Math.max(1, Number(roiOrigin.width) || 0);
  const height = Math.max(1, Number(roiOrigin.height) || 0);
  return {
    text,
    confidence: 90,
    sourcePass: "pass2",
    lineId: `p2-roi-y${Math.round(y0)}-x${Math.round(x0)}`,
    lineIndex: 1000 + Math.round(y0),
    bbox: {
      x0,
      y0,
      x1: x0 + width,
      y1: y0 + height,
      x: x0,
      y: y0,
      width,
      height,
    },
  };
}

function numericVariants(gray, width, height) {
  const sauvola = adaptiveThresholdGray(gray, width, height, OCR_ADAPTIVE_DEFAULTS);
  return [
    { name: "adaptive-threshold", gray: sauvola },
    { name: "contrast-enhanced", gray: contrastForOcr(gray, width, height) },
    { name: "inverted-adaptive-threshold", gray: invertGray(sauvola) },
  ];
}

async function recognizeWithWorker(imageSource, onProgress) {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const scanId = crypto.randomUUID();
  activeScanId = scanId;
  const dimensions = getImageDimensions(imageSource);
  logStage("SCAN START", scanId, {
    pass: "session",
    width: dimensions.width,
    height: dimensions.height,
    elapsed: 0,
    text: "",
    words: 0,
    bboxes: 0,
  });
  logStage("IMAGE DECODE", scanId, {
    pass: "source",
    width: dimensions.width,
    height: dimensions.height,
    elapsed: elapsedSince(started),
    text: "",
  });

  if (import.meta.env?.DEV && globalThis.PRIVACYLAB_RESET_OCR_WORKER) {
    const previous = ocrWorker;
    ocrWorker = null;
    workerInitializationPromise = null;
    if (previous) await previous.terminate();
    console.debug("[OCR] RESET_WORKER created a fresh worker", scanId);
  }

  const worker = await getOcrWorker(onProgress);
  if (import.meta.env?.DEV && typeof worker.setLogging === "function") worker.setLogging(true);
  assertOcrCanvas(imageSource, "Pass 1 input");
  const pass1Stats = canvasStats(imageSource, "pass1");
  logStage("PASS1 INPUT", scanId, {
    pass: "pass1",
    width: pass1Stats.width,
    height: pass1Stats.height,
    elapsed: elapsedSince(started),
    text: `min=${pass1Stats.min.toFixed(1)} max=${pass1Stats.max.toFixed(1)} mean=${pass1Stats.mean.toFixed(1)} foregroundRatio=${pass1Stats.foregroundRatio.toFixed(3)} nonTransparent=${pass1Stats.nonTransparent}`,
  });

  reportProgress({ status: "recognizing text", progress: 0.05 });
  const first = await recognizePreparedImage(worker, imageSource, 1);
  const pass1Words = first.words.map((word) => ({ ...word, sourcePass: word.sourcePass || "pass1" }));
  logStage("PASS1 RESULT", scanId, {
    pass: "pass1",
    width: dimensions.width,
    height: dimensions.height,
    elapsed: elapsedSince(started),
    text: first.text,
    words: pass1Words.length,
    bboxes: pass1Words.length,
    confidence: confidenceSummary(pass1Words),
  });
  if (activeScanId !== scanId) {
    console.debug("[OCR] Ignoring stale result", scanId);
    return null;
  }

  const sourcePixels = readCanvasPixels(imageSource, "ROI discovery");
  const covered = pass1Words.map((word) => word.bbox).filter(Boolean);
  const rois = discoverSuspiciousRois(sourcePixels.image.data, dimensions.width, dimensions.height, covered);
  logStage("ROI DISCOVERY", scanId, {
    pass: "roi",
    width: dimensions.width,
    height: dimensions.height,
    elapsed: elapsedSince(started),
    text: JSON.stringify(rois),
    words: pass1Words.length,
    bboxes: rois.length,
  });

  const pass2Words = [];
  const pass2Lines = [];
  let pass2Text = "";
  let pass2FoundTckn = false;

  for (const roi of rois) {
    if (activeScanId !== scanId) break;
    const cropped = cropRgba(sourcePixels.image.data, dimensions.width, roi);
    const gray = grayscaleFromRgba(cropped.data, cropped.width, cropped.height);
    const band = cropTextBand(gray, cropped.width, cropped.height);
    const glyphBox = {
      x: roi.x + band.x,
      y: roi.y + band.y,
      width: band.width,
      height: band.height,
    };
    const roiOrigin = forceBadgeRoiPadding(glyphBox, dimensions.width, roi);
    const lineCrop = cropRgba(sourcePixels.image.data, dimensions.width, roiOrigin);
    const lineGray = grayscaleFromRgba(lineCrop.data, lineCrop.width, lineCrop.height);
    const scaled = upscaleGray(lineGray, lineCrop.width, lineCrop.height, OCR_ADAPTIVE_DEFAULTS.scale);
    logStage("PASS2 PREPROCESS", scanId, {
      pass: "pass2",
      width: scaled.width,
      height: scaled.height,
      elapsed: elapsedSince(started),
      text: `roi=${roiOrigin.x},${roiOrigin.y},${roiOrigin.width}x${roiOrigin.height} scale=${OCR_ADAPTIVE_DEFAULTS.scale}`,
    });
    for (const variant of numericVariants(scaled.gray, scaled.width, scaled.height)) {
      const canvas = canvasFromGray(variant.gray, scaled.width, scaled.height);
      const stats = grayscaleStats(variant.gray, scaled.width, scaled.height);
      warnIfCollapsed(stats, variant.name);
      logStage("PASS2 INPUT", scanId, {
        pass: "pass2",
        width: canvas.width,
        height: canvas.height,
        elapsed: elapsedSince(started),
        text: variant.name,
        words: 0,
        bboxes: 0,
      });
      const singleLine = scaled.height <= 320 && scaled.height < scaled.width * 0.5;
      const recognition = await recognizePreparedImage(worker, canvas, 1, {
        tessedit_char_whitelist: "0123456789",
        tessedit_pageseg_mode: singleLine ? "7" : "6",
      });
      releaseCanvas(canvas);
      const located = recognition.words.map((word) => relocateWord(word, roiOrigin, OCR_ADAPTIVE_DEFAULTS.scale, "pass2"));
      pass2Text = [pass2Text, recognition.text].filter(Boolean).join("\n");
      logStage("PASS2 RESULT", scanId, {
        pass: "pass2",
        width: scaled.width,
        height: scaled.height,
        elapsed: elapsedSince(started),
        words: located.length,
        bboxes: located.length,
        confidence: confidenceSummary(located),
      });
      const texts = findPass2TcknTexts(recognition.text);
      if (texts.length) {
        pass2FoundTckn = true;
        texts.forEach((text) => {
          const word = roiTcknWord(text, roiOrigin);
          pass2Words.push(word);
          pass2Lines.push(lineFromWord(word));
        });
        break;
      }
      if (classifyPassText(recognition.text) === "CASE 2") continue;
    }
  }

  if (activeScanId !== scanId) {
    console.debug("[OCR] Ignoring stale result", scanId);
    return null;
  }

  const words = mergeDistinctWords(pass1Words, pass2Words);
  const lines = first.lines.concat(pass2Lines);
  const text = [first.text, pass2Text].filter(Boolean).join("\n");
  const tcknHits = [];
  words.forEach((word) => {
    findTcknMatches(word.text).forEach((match) => {
      const evidence = tcknEvidence(match.text);
      if (evidence.valid) {
        tcknHits.push({ text: evidence.normalized, bbox: word.bbox, sourcePass: word.sourcePass || "pass1", evidence: evidence.evidence });
      }
    });
  });
  const distinct = [];
  tcknHits.forEach((hit) => {
    if (!distinct.some((kept) => sameTcknGlyph(kept.bbox, hit.bbox))) distinct.push(hit);
  });
  logStage("CANDIDATE EXTRACTION", scanId, {
    pass: "merge",
    width: dimensions.width,
    height: dimensions.height,
    elapsed: elapsedSince(started),
    text,
    words: words.length,
    bboxes: words.length,
  });
  logStage("MERGE", scanId, {
    pass: "merge",
    width: dimensions.width,
    height: dimensions.height,
    elapsed: elapsedSince(started),
    text: `distinct detections=${distinct.length}`,
    words: words.length,
    bboxes: distinct.length,
  });
  logStage("FINAL RESULT", scanId, {
    pass: "final",
    width: dimensions.width,
    height: dimensions.height,
    elapsed: elapsedSince(started),
    text: `TCKN detections=${distinct.length}`,
    words: words.length,
    bboxes: distinct.length,
    confidence: confidenceSummary(words),
  });
  return {
    scanId,
    text,
    blocks: first.blocks,
    words,
    lines,
    ocrScale: 1,
    sourceWidth: dimensions.width,
    sourceHeight: dimensions.height,
    tcknDetections: distinct,
  };
}

export async function recognizeScreenshot(
  imageSource,
  onProgress
) {
  if (!imageSource) {
    throw new Error(
      "An image source is required for OCR."
    );
  }

  const queuedRecognition =
    recognitionQueue.then(
      async () => {
        if (isTerminatingWorker) {
          throw new Error(
            "The OCR engine is currently shutting down."
          );
        }

        latestProgressHandler =
          typeof onProgress === "function"
            ? onProgress
            : null;

        return recognizeWithWorker(
          imageSource,
          onProgress
        );
      }
    );

  /*
   * Keep the queue usable even if one OCR job
   * fails. The caller still receives the error
   * through queuedRecognition.
   */
  recognitionQueue =
    queuedRecognition.then(
      () => undefined,
      () => undefined
    );

  return queuedRecognition;
}

export const SINGLE_OCR_WORKER_LIMIT = 1;

export async function recognizeImageSequence(imageSources, onItem) {
  const sources = Array.isArray(imageSources) ? imageSources : [];
  const results = [];
  for (let index = 0; index < sources.length; index += 1) {
    onItem?.({
      index,
      total: sources.length,
      status: "processing",
      progress: 0,
    });
    try {
      const result = await recognizeScreenshot(
        sources[index],
        (message) => {
          const progress = Number(message?.progress);
          onItem?.({
            index,
            total: sources.length,
            status: "processing",
            progress: Number.isFinite(progress) ? progress : 0,
          });
        }
      );
      results.push({ index, status: "completed", result });
      onItem?.({
        index,
        total: sources.length,
        status: "completed",
        progress: 1,
      });
    } catch (error) {
      results.push({ index, status: "failed", error });
      onItem?.({
        index,
        total: sources.length,
        status: "failed",
        progress: 0,
      });
    }
  }
  return results;
}

export async function terminateOcrWorker() {
  if (isTerminatingWorker) {
    await recognitionQueue;
    return;
  }

  isTerminatingWorker = true;

  try {
    /*
     * Do not terminate a worker while the worker
     * is processing a queued recognition job.
     */
    await recognitionQueue;

    let worker = ocrWorker;

    if (
      !worker &&
      workerInitializationPromise
    ) {
      try {
        worker =
          await workerInitializationPromise;
      } catch {
        worker = null;
      }
    }

    ocrWorker = null;
    workerInitializationPromise = null;
    latestProgressHandler = null;

    if (worker) {
      try {
        await worker.terminate();
      } catch (error) {
        console.warn(
          "Redaktix OCR worker could not be terminated cleanly.",
          error
        );
      }
    }
  } finally {
    recognitionQueue =
      Promise.resolve();

    isTerminatingWorker = false;
  }
}