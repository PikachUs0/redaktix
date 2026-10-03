import { detectionsForAutomaticRedaction } from "./sensitive-detectors.js";

export function reviewSummary(count) {
  const total = Math.max(0, Number(count) || 0);
  const noun = total === 1 ? "area" : "areas";
  return `Redaktix found ${total} potential sensitive ${noun}`;
}

export function reviewPositionLabel(index, count) {
  const total = Math.max(0, Number(count) || 0);
  if (!total) return "";
  const safeIndex = ((Number(index) % total) + total) % total;
  return `${safeIndex + 1} of ${total}`;
}

export function stepReviewIndex(index, count, direction) {
  const total = Math.max(0, Number(count) || 0);
  if (!total) return -1;
  const current = Number.isInteger(index) && index >= 0 ? index : 0;
  const delta = direction < 0 ? -1 : 1;
  return (current + delta + total) % total;
}

export function focusIndexAfterRemoval(removedIndex, countBefore) {
  const remaining = Math.max(0, Number(countBefore) || 0) - 1;
  if (remaining <= 0) return -1;
  const index = Number.isInteger(removedIndex) && removedIndex >= 0 ? removedIndex : 0;
  if (index >= remaining) return 0;
  return index;
}

export function reviewZoomForBox(box, viewport, limits = {}) {
  const width = Math.max(1, Number(box?.width) || 1);
  const height = Math.max(1, Number(box?.height) || 1);
  const pad = 72;
  const availableWidth = Math.max(1, Number(viewport?.width) - pad * 2);
  const availableHeight = Math.max(1, Number(viewport?.height) - pad * 2);
  const fitted = Math.min(availableWidth / width, availableHeight / height);
  const min = Number.isFinite(limits.min) ? limits.min : 0.25;
  const max = Number.isFinite(limits.max) ? limits.max : 3;
  return Math.min(max, Math.max(min, fitted));
}

export function easeOutCubic(progress) {
  const t = Math.min(1, Math.max(0, Number(progress) || 0));
  return 1 - (1 - t) ** 3;
}

export function exportReviewPrompt(count) {
  const total = Math.max(0, Number(count) || 0);
  if (!total) return null;
  const noun = total === 1 ? "suggestion" : "suggestions";
  return `You have ${total} unreviewed ${noun}.`;
}

export function reviewShortcutDirection(key, shiftKey = false) {
  if (key === "ArrowRight") return 1;
  if (key === "ArrowLeft") return -1;
  if (key === "Tab") return shiftKey ? -1 : 1;
  return 0;
}

export const LOCAL_PROCESSING_BADGE_LABEL = "🟢 100% Local Processing (Zero Data Upload)";

export function localProcessingExplanation() {
  return "OCR runs in WebAssembly inside your browser. Recognition stays on this device and does not depend on an external network.";
}

export const REVIEW_COMPLETE_TITLE = "Privacy Check Complete - Ready to Export";

export const EMPTY_DROPZONE_HINT = "Drop screenshot here, press Ctrl+V to paste, or browse files";

export const REVIEW_SHORTCUT_LEGEND = "[← / →]: Next/Prev item | [Tab]: Focus actions | [Esc]: Cancel highlight";

export const BATCH_IMAGE_LIMIT = 20;

export function selectBatchFiles(files, { allowedTypes, maxBytes, limit = BATCH_IMAGE_LIMIT, existingCount = 0 } = {}) {
  const accepted = [];
  let skipped = 0;
  for (const file of Array.isArray(files) ? files : []) {
    const typeOk = !allowedTypes || allowedTypes.includes(file?.type);
    const sizeOk = !(maxBytes > 0) || Number(file?.size) <= maxBytes;
    if (!typeOk || !sizeOk) {
      skipped += 1;
      continue;
    }
    if (existingCount + accepted.length >= limit) {
      skipped += 1;
      continue;
    }
    accepted.push(file);
  }
  return { accepted, skipped };
}

export function batchStatusLabel(status, progress = 0) {
  if (status === "queued") return "Queued";
  if (status === "processing") return `Processing (${Math.max(0, Math.min(100, Math.round(Number(progress) || 0)))}%)`;
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  return "Queued";
}

export function batchOverallLabel(items) {
  const list = Array.isArray(items) ? items : [];
  const total = list.length;
  if (!total) return "";
  const processingIndex = list.findIndex((item) => item?.status === "processing");
  if (processingIndex >= 0) return `Processing image ${processingIndex + 1} of ${total}...`;
  const finished = list.filter((item) => item?.status === "completed" || item?.status === "failed").length;
  if (finished >= total) {
    const noun = total === 1 ? "image" : "images";
    return `${total} ${noun} ready`;
  }
  return `Processing image ${finished + 1} of ${total}...`;
}

export async function runSequentialQueue(items, worker) {
  const list = Array.isArray(items) ? items : [];
  const results = [];
  let active = 0;
  let maxActive = 0;
  for (let index = 0; index < list.length; index += 1) {
    active += 1;
    maxActive = Math.max(maxActive, active);
    try {
      const value = await worker(list[index], index);
      results.push({ index, status: "completed", value });
    } catch (error) {
      results.push({ index, status: "failed", error });
    }
    active -= 1;
  }
  return { results, maxActive };
}

export function blackoutDetections(detections, width, height) {
  const pixelWidth = Number(width);
  const pixelHeight = Number(height);
  if (!(pixelWidth > 0) || !(pixelHeight > 0)) return [];
  return detectionsForAutomaticRedaction(detections).map((detection) => {
    const rect = {
      x: Number(detection?.normX) * pixelWidth,
      y: Number(detection?.normY) * pixelHeight,
      width: Number(detection?.normWidth) * pixelWidth,
      height: Number(detection?.normHeight) * pixelHeight,
    };
    if (!(rect.width > 0) || !(rect.height > 0)) return null;
    return {
      id: `batch-redaction-${detection.id}`,
      type: "blackout",
      source: "automatic-detection",
      detectionType: detection.type,
      originalText: detection.text,
      ...rect,
      color: "#000000",
    };
  }).filter(Boolean);
}

export function uniqueZipNames(names) {
  const seen = new Map();
  return (Array.isArray(names) ? names : []).map((name) => {
    const base = String(name || "image.png").split(/[/\\]/).pop() || "image.png";
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    if (!count) return base;
    const dot = base.lastIndexOf(".");
    if (dot <= 0) return `${base}-${count + 1}`;
    return `${base.slice(0, dot)}-${count + 1}${base.slice(dot)}`;
  });
}

const CRC32_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC32_TABLE[index] = value >>> 0;
}

export function crc32(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data || []);
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStamp(date) {
  const stamp = date instanceof Date ? date : new Date(0);
  const time = (stamp.getUTCHours() << 11) | (stamp.getUTCMinutes() << 5) | Math.floor(stamp.getUTCSeconds() / 2);
  const day = ((stamp.getUTCFullYear() - 1980) << 9) | ((stamp.getUTCMonth() + 1) << 5) | stamp.getUTCDate();
  return { time, day };
}

export function createStoredZip(files, date = new Date(0)) {
  const entries = (Array.isArray(files) ? files : []).map((file) => {
    const name = new TextEncoder().encode(String(file?.name || "image.png"));
    const data = file?.data instanceof Uint8Array ? file.data : new Uint8Array(file?.data || []);
    return { name, data, crc: crc32(data) };
  });
  const { time, day } = zipStamp(date);
  const locals = [];
  const centrals = [];
  let offset = 0;
  entries.forEach((entry) => {
    const local = new Uint8Array(30 + entry.name.length + entry.data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, time, true);
    localView.setUint16(12, day, true);
    localView.setUint32(14, entry.crc, true);
    localView.setUint32(18, entry.data.length, true);
    localView.setUint32(22, entry.data.length, true);
    localView.setUint16(26, entry.name.length, true);
    local.set(entry.name, 30);
    local.set(entry.data, 30 + entry.name.length);
    locals.push(local);

    const central = new Uint8Array(46 + entry.name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, day, true);
    centralView.setUint32(16, entry.crc, true);
    centralView.setUint32(20, entry.data.length, true);
    centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, entry.name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(entry.name, 46);
    centrals.push(central);
    offset += local.length;
  });
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  const zip = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  locals.forEach((part) => {
    zip.set(part, cursor);
    cursor += part.length;
  });
  centrals.forEach((part) => {
    zip.set(part, cursor);
    cursor += part.length;
  });
  zip.set(end, cursor);
  return zip;
}
