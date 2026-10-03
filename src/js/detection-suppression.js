/**
 * Overlap / shadow suppression for OCR detections (extracted from editor.js).
 *
 * Strong types are never dropped by overlap. Only weak types may be suppressed.
 * Structure-valid IBAN detections suppress overlapping weak types only.
 */
import { isValidIban, passesLuhn } from "./sensitive-detectors.js";

const OVERLAP_THRESHOLD = 0.45;

/** Never suppressed by overlap with any other detection. */
const NEVER_SUPPRESS_TYPES = new Set([
  "api_token",
  "tckn",
  "vkn",
  "email",
  "private_key",
  "bearer_token",
  "connection_url",
  "env_secret",
  "passport",
  "seed_phrase",
]);

/** Only these types may be removed by overlap suppression. */
const WEAK_SUPPRESSIBLE_TYPES = new Set([
  "phone",
  "person_name",
  "location",
  "session_id",
]);

export function calculateOverlap(first, second) {
  const firstRect = {
    x: Number(first?.normX),
    y: Number(first?.normY),
    width: Number(first?.normWidth),
    height: Number(first?.normHeight),
  };
  const secondRect = {
    x: Number(second?.normX),
    y: Number(second?.normY),
    width: Number(second?.normWidth),
    height: Number(second?.normHeight),
  };
  const width = Math.max(
    0,
    Math.min(firstRect.x + firstRect.width, secondRect.x + secondRect.width)
      - Math.max(firstRect.x, secondRect.x)
  );
  const height = Math.max(
    0,
    Math.min(firstRect.y + firstRect.height, secondRect.y + secondRect.height)
      - Math.max(firstRect.y, secondRect.y)
  );
  const overlapArea = width * height;
  const smallerArea = Math.max(
    1e-8,
    Math.min(firstRect.width * firstRect.height, secondRect.width * secondRect.height)
  );
  return overlapArea / smallerArea;
}

export function isIbanDetection(detection) {
  if (!detection) return false;
  if (detection.ruleId === "iban") return true;
  return detection.type === "custom_rule" && /iban/i.test(String(detection.label || ""));
}

export function isStructureValidIbanDetection(detection) {
  if (!isIbanDetection(detection)) return false;
  return isValidIban(detection.text).structureValid;
}

function isLuhnValidCreditCard(detection) {
  return detection?.type === "credit_card" && passesLuhn(detection.text);
}

function isCustomIdDetection(detection) {
  return detection?.type === "custom_rule" && detection?.ruleId === "custom-id";
}

/** Strong / checksum types that must never be dropped by overlap. */
export function isProtectedFromSuppression(detection) {
  if (!detection) return false;
  if (isIbanDetection(detection)) return true;
  if (NEVER_SUPPRESS_TYPES.has(detection.type)) return true;
  if (isLuhnValidCreditCard(detection)) return true;
  return false;
}

/** Weak types that IBAN (and higher-rank peers) may suppress. */
export function isWeakSuppressionTarget(detection) {
  if (!detection || isProtectedFromSuppression(detection)) return false;
  if (WEAK_SUPPRESSIBLE_TYPES.has(detection.type)) return true;
  if (isCustomIdDetection(detection)) return true;
  return false;
}

function detectionRank(detection) {
  // IBAN outranks every other detector for suppressing weak overlaps.
  if (isIbanDetection(detection)) return 0;
  const priority = {
    api_token: 1,
    email: 2,
    tckn: 3,
    vkn: 3,
    ipv4: 4,
    ipv6: 4,
    credit_card: 5,
    phone: 6,
    person_name: 7,
    location: 8,
    session_id: 9,
  };
  return priority[detection?.type] ?? 9;
}

export function suppressShadowedDetections(detections) {
  const list = Array.isArray(detections) ? detections : [];
  return list.filter((candidate) => {
    // Strong types are never suppressed by overlap.
    if (!isWeakSuppressionTarget(candidate)) return true;

    // Structure-valid IBAN suppresses overlapping weak types only.
    const insideStructureValidIban = list.some((other) => {
      if (other === candidate || !isStructureValidIbanDetection(other)) return false;
      return calculateOverlap(candidate, other) >= OVERLAP_THRESHOLD;
    });
    if (insideStructureValidIban) return false;

    // Among weak types, a higher-priority detection may still shadow another weak one.
    const candidateRank = detectionRank(candidate);
    return !list.some((other) => {
      if (other === candidate) return false;
      return detectionRank(other) < candidateRank
        && calculateOverlap(candidate, other) >= OVERLAP_THRESHOLD;
    });
  });
}
