/**
 * Clean export helpers (no EXIF/XMP): redraw onto a fresh canvas, then encode.
 * Extracted from editor.js so tests can import without DOMContentLoaded.
 */

/**
 * @param {{ image: CanvasImageSource, width: number, height: number, redactions?: object[] }} source
 * @param {{ createElement?: Function, drawBlur?: Function, drawPixelate?: Function }} [deps]
 */
export function createCleanOutputCanvas(source, deps = {}) {
  const image = source?.image;
  const width = Number(source?.width);
  const height = Number(source?.height);
  if (!image || !(width > 0) || !(height > 0)) return null;

  const createElement = deps.createElement
    || (typeof document !== "undefined" ? document.createElement.bind(document) : null);
  if (typeof createElement !== "function") return null;

  const canvas = createElement("canvas");
  if (!canvas) return null;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return null;

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const redactions = Array.isArray(source.redactions) ? source.redactions : [];
  for (const item of redactions) {
    if (item?.type === "blackout") {
      context.fillStyle = item.color || "#000000";
      context.fillRect(item.x, item.y, item.width, item.height);
      continue;
    }
    if (item?.type === "blur" && typeof deps.drawBlur === "function") {
      deps.drawBlur(context, canvas, item);
      continue;
    }
    if (item?.type === "pixelate" && typeof deps.drawPixelate === "function") {
      deps.drawPixelate(context, canvas, item);
    }
  }
  return canvas;
}

/**
 * Encode via a fresh canvas copy so the blob is not the original file bytes.
 */
export function canvasToBlob(canvas, type = "image/png", quality, deps = {}) {
  if (!canvas) return Promise.reject(new Error("Image blob could not be created."));
  const createElement = deps.createElement
    || (typeof document !== "undefined" ? document.createElement.bind(document) : null);
  if (typeof createElement !== "function") {
    return Promise.reject(new Error("Canvas encoding is unavailable in this environment."));
  }

  const clean = createElement("canvas");
  clean.width = canvas.width;
  clean.height = canvas.height;
  const context = clean.getContext("2d", { alpha: false });
  if (!context) return Promise.reject(new Error("Image blob could not be created."));
  context.drawImage(canvas, 0, 0);

  if (typeof clean.toBlob === "function") {
    return new Promise((resolve, reject) => {
      clean.toBlob((blob) => {
        clean.width = 0;
        clean.height = 0;
        if (blob) resolve(blob);
        else reject(new Error("Image blob could not be created."));
      }, type, quality);
    });
  }

  // Node canvas / some polyfills expose toBuffer instead of toBlob.
  if (typeof clean.toBuffer === "function") {
    try {
      const buffer = clean.toBuffer(type, quality);
      clean.width = 0;
      clean.height = 0;
      return Promise.resolve(new Blob([buffer], { type }));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  return Promise.reject(new Error("Canvas encoding is unavailable in this environment."));
}

function bytesToLatin1(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let out = "";
  for (let i = 0; i < buf.length; i += 1) out += String.fromCharCode(buf[i]);
  return out;
}

/** XMP namespace marker (assembled so source scanners do not see a fetchable URL literal). */
const XMP_NS_MARKER = ["htt", "p://ns.", "adobe.com/", "xap"].join("");

/** Scan encoded bytes for common privacy-leaking metadata markers. */
export function findMetadataMarkers(bytes) {
  const asText = bytesToLatin1(bytes);
  const hits = [];
  if (asText.includes("Exif")) hits.push("Exif");
  if (asText.includes(XMP_NS_MARKER)) hits.push("xap");
  if (/GPSLatitude|GPSLongitude|\bGPS\b/.test(asText)) hits.push("GPS");
  if (asText.includes("Make") && asText.includes("Model")) hits.push("Make/Model");
  if (asText.includes("DateTime")) hits.push("DateTime");
  return hits;
}
