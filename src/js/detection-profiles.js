export const DETECTION_PROFILE_IDS = Object.freeze({
  GLOBAL: "global",
  TURKEY: "turkey",
  GLOBAL_TURKEY: "global-turkey",
});

/** Single editor mode — always global-turkey. */
export const DEFAULT_DETECTION_PROFILE = DETECTION_PROFILE_IDS.GLOBAL_TURKEY;

/** Legacy localStorage key; no longer written. */
export const DETECTION_PROFILE_STORAGE_KEY = "redaktix_detection_profile";

export const DETECTION_PROFILE_OPTIONS = Object.freeze([
  Object.freeze({ id: DETECTION_PROFILE_IDS.GLOBAL_TURKEY, label: "Global + Turkey" }),
]);

export function detectionProfileLabel(_value) {
  return "Global + Turkey";
}

/**
 * Profile selection was removed. Always return single mode.
 * Safely ignore any legacy stored value (never throw).
 */
export function readStoredDetectionProfile(storage) {
  try {
    storage?.getItem?.(DETECTION_PROFILE_STORAGE_KEY);
    storage?.getItem?.("privacylab_detection_profile");
  } catch {
    // Storage can be blocked or throw — ignore.
  }
  return DEFAULT_DETECTION_PROFILE;
}

/**
 * No longer persists a profile id. Returns single mode; does not write storage.
 */
export function writeStoredDetectionProfile(_profileId, _storage) {
  try {
    // Intentionally do not setItem — leave any legacy key untouched.
  } catch {
    // ignore
  }
  return DEFAULT_DETECTION_PROFILE;
}

const SINGLE_MODE_DETECTORS = Object.freeze([
  "api_token",
  "email",
  "tckn",
  "vkn",
  "ipv4",
  "ipv6",
  "credit_card",
  "phone",
  "person_name",
  "location",
  "session_id",
  "custom_rule",
]);

export const ALWAYS_ON_DETECTORS = Object.freeze([
  "tckn",
  "vkn",
  "credit_card",
  "iban",
  "private_key",
  "bearer_token",
  "connection_url",
  "env_secret",
  "passport",
  "seed_phrase",
]);

export function isAlwaysOnDetector(detectorType) {
  return ALWAYS_ON_DETECTORS.includes(detectorType);
}

const SINGLE_PROFILE = Object.freeze({
  id: DETECTION_PROFILE_IDS.GLOBAL_TURKEY,
  detectors: SINGLE_MODE_DETECTORS,
});

/**
 * Always single mode (global-turkey). Legacy ids normalize to the same profile.
 */
export function normalizeDetectionProfile(_value) {
  return DEFAULT_DETECTION_PROFILE;
}

export function getDetectionProfile(_value) {
  return SINGLE_PROFILE;
}

export function filterDetectionsForProfile(detections, _profileId) {
  const allowed = new Set(SINGLE_MODE_DETECTORS);
  return (Array.isArray(detections) ? detections : []).filter((detection) =>
    isAlwaysOnDetector(detection?.type) ||
    detection?.ruleId === "iban" ||
    allowed.has(detection?.type)
  );
}

export function isDetectorEnabled(_profileId, detectorType) {
  if (isAlwaysOnDetector(detectorType)) return true;
  return SINGLE_MODE_DETECTORS.includes(detectorType);
}

/**
 * Tool pages prioritize `activeDetectors`, but NEVER drop ALWAYS_ON checksum types.
 * IBAN detections are usually `type: "custom_rule"` with `ruleId: "iban"`.
 */
export function limitToToolDetectors(detections, allow) {
  if (!Array.isArray(allow) || !allow.length) {
    return Array.isArray(detections) ? detections : [];
  }
  return (Array.isArray(detections) ? detections : []).filter((detection) =>
    allow.includes(detection?.type)
    || isAlwaysOnDetector(detection?.type)
    || detection?.ruleId === "iban"
  );
}
