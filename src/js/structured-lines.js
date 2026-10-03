import { loadCustomRules } from "./custom-rules.js";
import {
  isAlwaysOnDetector,
  isDetectorEnabled,
} from "./detection-profiles.js";
import {
  buildDetectionReview,
  detectCreditCard,
  envelopeForMatchedWords,
  extractApiTokenCandidates,
  extractBearerTokenMatches,
  extractConnectionUrlCandidates,
  extractEnvSecretMatches,
  extractPassportMatches,
  extractSeedPhraseMatches,
  findBearerTokenMatchesFromLines,
  findSeedPhraseMatchesFromLines,
  extractIpv6Candidates,
  extractLocationCandidates,
  extractPersonNameCandidates,
  extractPhoneCandidates as extractDetectedPhoneCandidates,
  extractVknCandidates,
  findCrossLineIbanMatches,
  findPrivateKeyMatchesFromLines,
  findTcknMatches,
  ibanReviewHints,
  matchCustomRules,
  normalizeBox,
  padBoundingBox,
  phoneReviewHints,
  tcknEvidence,
} from "./sensitive-detectors.js";

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

/** Same helpers as editor.js (kept here so structured-line scans stay self-contained). */
export function extractEmailCandidates(value) {
  const matches = String(value || "").match(
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
  );
  if (!matches) return [];
  return [...new Set(matches.map(trimGluedEmailTld).filter(Boolean))];
}

function trimGluedEmailTld(email) {
  const parts = String(email || "").match(/^(.*\.)([a-z]{2,24})$/i);
  if (!parts) return email;
  const tld = parts[2].toLowerCase();
  const knownTlds = [
    "com", "net", "org", "edu", "gov", "io", "co", "tr", "uk", "de", "fr",
    "info", "biz", "app", "dev", "me", "us", "ca", "au", "nl", "se", "no",
    "fi", "ch", "at", "be", "it", "es", "pt", "pl", "ru", "jp", "kr", "cn",
    "in", "br", "xyz", "online", "site", "store", "tech", "email", "cloud",
    "company", "network", "systems", "digital", "group", "global",
  ];
  if (knownTlds.includes(tld)) return `${parts[1]}${tld}`;
  const knownPrefix = knownTlds
    .filter((item) => tld.startsWith(item) && tld.length > item.length)
    .sort((first, second) => second.length - first.length)[0];
  return knownPrefix ? `${parts[1]}${knownPrefix}` : email;
}

export function extractIpv4Candidates(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/[·•]/g, ".")
    .replace(/(\d)\s*\.\s*(\d)/g, "$1.$2");
  const matches = normalized.match(
    /(?<!\d)(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?::[0-9]{1,5})?(?!\d)/g
  );
  if (!matches) return [];
  return [...new Set(matches)].filter((match) => {
    const [ipAddress, port] = match.split(":");
    if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ipAddress)) return false;
    if (!ipAddress.split(".").map(Number).every((part) => part >= 0 && part <= 255)) return false;
    if (port === undefined) return true;
    const portNumber = Number(port);
    return Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535;
  });
}

export function extractCreditCardCandidates(value) {
  return detectCreditCard(value).map((detection) => detection.text);
}

export function extractPhoneCandidatesForLines(value) {
  const source = String(value || "")
    .replace(/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?::\d{1,5})?\b/g, " ")
    .replace(/(?<!\d)(?:\d[ \t-]?){12,18}\d(?!\d)/g, " ");
  return extractDetectedPhoneCandidates(source);
}

export function normalizeCredential(value) {
  return String(value || "")
    .trim()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/[＿﹍﹎]/g, "_")
    .replace(/\s*_\s*/g, "_")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, "")
    .replace(/[.,;:!?]+$/, "");
}

function detectionSourceWords(source) {
  if (Array.isArray(source?.words) && source.words.length) return source.words;
  if (source?.bbox && String(source.text || "").trim()) return [source];
  return [];
}

function resolveDetectionLine(source, linesById) {
  const lineId = source?.lineId || source?.id || source?.words?.find((word) => word?.lineId)?.lineId;
  if (lineId && linesById?.has?.(lineId)) return linesById.get(lineId);
  if (source?.id && source?.bbox && typeof source.text === "string") return source;
  return null;
}

/**
 * @param {object} deps
 * @param {{width:number,height:number}} deps.imageSize
 * @param {Map} [deps.linesById]
 */
const OCR_SPLIT_BOX_EXTEND_TYPES = new Set([
  "api_token",
  "connection_url",
  "private_key",
  "bearer_token",
  "env_secret",
  "passport",
  "seed_phrase",
]);

export function createDetection(source, type, label, text, options = {}, deps = {}) {
  const imageSize = deps.imageSize || { width: 0, height: 0 };
  const linesById = deps.linesById || new Map();
  const boxText = options.boxText || text;
  const occurrence = Number(options.matchOccurrence) || 0;
  const boxOptions = OCR_SPLIT_BOX_EXTEND_TYPES.has(type)
    ? { extendAdjacentToken: true }
    : {};
  const sourceWords = detectionSourceWords(source);
  const line = resolveDetectionLine(source, linesById);
  const lineWords = Array.isArray(line?.words) && line.words.length ? line.words : [];
  const sourceEnvelope = sourceWords.length
    ? envelopeForMatchedWords(sourceWords, boxText, occurrence, boxOptions)
    : null;
  const words = sourceEnvelope ? sourceWords : lineWords;
  let envelope = sourceEnvelope || (
    words.length ? envelopeForMatchedWords(words, boxText, occurrence, boxOptions) : null
  );
  if (envelope && options.padding) {
    envelope = padBoundingBox(envelope, options.padding);
    if (imageSize.width > 0 && imageSize.height > 0) {
      const x0 = Math.max(0, envelope.x0);
      const y0 = Math.max(0, envelope.y0);
      const x1 = Math.min(imageSize.width, envelope.x1);
      const y1 = Math.min(imageSize.height, envelope.y1);
      envelope = x1 > x0 && y1 > y0
        ? { x0, y0, x1, y1, x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
        : null;
    }
  }
  const normalized = envelope
    ? normalizeBox(envelope, imageSize.width, imageSize.height)
    : null;
  if (!normalized) return null;

  const normX = clamp(normalized.normX, 0, 1);
  const normY = clamp(normalized.normY, 0, 1);
  const normWidth = Math.min(Math.max(0, normalized.normWidth), 1 - normX);
  const normHeight = Math.min(Math.max(0, normalized.normHeight), 1 - normY);
  if (normWidth <= 0 || normHeight <= 0) return null;

  const confidence = Number(source.confidence || line?.confidence || 0);
  const lineIndex = Number.isFinite(Number(words[0]?.lineIndex))
    ? Number(words[0].lineIndex)
    : Number.isFinite(Number(source?.lineIndex))
      ? Number(source.lineIndex)
      : Math.round(normY * 10000);
  const boxY0 = Math.round(Number(envelope.y0 ?? envelope.y ?? 0));
  const boxX0 = Math.round(Number(envelope.x0 ?? envelope.x ?? 0));
  const hints = options.reviewHints || {};
  const ibanMarked = Boolean(
    options.ruleId === "iban"
    || hints.ibanChecksumValid
    || hints.ibanChecksumFailed
    || hints.ibanPatternOnly
  );
  const ruleId = options.ruleId
    || (type === "tckn" ? "tckn" : undefined)
    || (ibanMarked ? "iban" : undefined);
  return {
    id: `detection-${type}-line${lineIndex}-y0${boxY0}-x0${boxX0}`,
    ruleId,
    type,
    label,
    text,
    lineIndex,
    y0: boxY0,
    evidence: type === "tckn" ? tcknEvidence(text).evidence : undefined,
    sourcePass: source?.sourcePass || "pass1",
    confidence,
    normX,
    normY,
    normWidth,
    normHeight,
    review: buildDetectionReview({
      type,
      text,
      confidence,
      ...hints,
    }),
  };
}

/**
 * @param {object[]} lines
 * @param {object} deps
 * @param {string} deps.profileId
 * @param {{width:number,height:number}} deps.imageSize
 * @param {Map} [deps.linesById]
 * @param {Function} [deps.extractEmailCandidates]
 * @param {Function} [deps.extractIpv4Candidates]
 * @param {Function} [deps.extractCreditCardCandidates]
 * @param {Function} [deps.extractPhoneCandidates]
 * @param {Function} [deps.loadCustomRules]
 */
export function detectStructuredDataFromLines(lines, deps = {}) {
  if (!Array.isArray(lines) || !lines.length) return [];

  const profileId = deps.profileId;
  const imageSize = deps.imageSize || { width: 0, height: 0 };
  const linesById = deps.linesById || new Map(lines.map((line) => [line.id, line]));
  const emailExtract = deps.extractEmailCandidates || extractEmailCandidates;
  const ipv4Extract = deps.extractIpv4Candidates || extractIpv4Candidates;
  const cardExtract = deps.extractCreditCardCandidates || extractCreditCardCandidates;
  const phoneExtract = deps.extractPhoneCandidates || extractPhoneCandidatesForLines;
  const rulesLoader = deps.loadCustomRules || loadCustomRules;

  const detections = [];
  const definitions = [
    { type: "api_token", label: "Possible API token", extract: extractApiTokenCandidates },
    {
      type: "bearer_token",
      label: "Possible Bearer token",
      extract: (value) => extractBearerTokenMatches(value),
    },
    {
      type: "connection_url",
      label: "Possible connection URL",
      extract: extractConnectionUrlCandidates,
    },
    {
      type: "env_secret",
      label: "Possible .env secret",
      extract: extractEnvSecretMatches,
    },
    {
      type: "passport",
      label: "Possible passport number",
      extract: extractPassportMatches,
    },
    {
      type: "seed_phrase",
      label: "Possible seed phrase",
      extract: extractSeedPhraseMatches,
    },
    { type: "email", label: "Possible email", extract: emailExtract },
    { type: "tckn", label: "Turkish ID Number", extract: findTcknMatches },
    { type: "vkn", label: "Tax ID Number", extract: extractVknCandidates },
    { type: "person_name", label: "Possible name", extract: extractPersonNameCandidates },
    { type: "location", label: "Possible location", extract: extractLocationCandidates },
    { type: "ipv4", label: "Possible IP address", extract: ipv4Extract },
    { type: "ipv6", label: "Possible IPv6 address", extract: extractIpv6Candidates },
    { type: "credit_card", label: "Possible card number", extract: cardExtract },
    { type: "phone", label: "Possible phone number", extract: phoneExtract },
    {
      type: "session_id",
      label: "Possible session ID",
      pattern: /\b(?:sess|session)[_-]+[a-z0-9][a-z0-9_-]{5,}\b/gi,
    },
    ...rulesLoader().map((rule) => ({
      type: "custom_rule",
      label: rule.label,
      ruleId: rule.id,
      extract: (value) => {
        try {
          return matchCustomRules([rule], value).map((match) => match.text);
        } catch {
          return [];
        }
      },
    })),
  ];

  lines.forEach((line) => {
    const sourceText = String(line?.text || "");
    if (!line?.bbox || !sourceText.trim()) return;

    definitions.forEach((definition) => {
      if (
        !isAlwaysOnDetector(definition.type) &&
        definition.ruleId !== "iban" &&
        !isDetectorEnabled(profileId, definition.type)
      ) return;
      let matches = [];
      try {
        matches = definition.extract
          ? definition.extract(sourceText)
          : (definition.pattern.lastIndex = 0, normalizeCredential(sourceText).match(definition.pattern) || []);
      } catch {
        matches = [];
      }

      matches.forEach((match) => {
        const rawText = typeof match === "string" ? match : match?.text;
        if (!rawText) return;
        if (definition.validate && !definition.validate(rawText)) return;
        const ibanHints = definition.ruleId === "iban"
          ? ibanReviewHints(rawText, sourceText)
          : null;
        const text = ibanHints?.text || rawText;
        const reviewHints = {
          ...(definition.type === "phone"
            ? phoneReviewHints(sourceText, rawText)
            : ibanHints
              ? {
                  ibanPatternOnly: Boolean(ibanHints.ibanPatternOnly),
                  ibanChecksumValid: Boolean(ibanHints.ibanChecksumValid),
                  ibanChecksumFailed: Boolean(ibanHints.ibanChecksumFailed),
                  ocrCorrected: Boolean(ibanHints.ocrCorrected),
                }
              : definition.ruleId === "custom-id"
                ? { customIdReview: true }
              : (typeof match === "object" && match ? { labelBased: Boolean(match.labeled) } : {})),
          ...(match && typeof match === "object" && match.needsReview && definition.type === "vkn"
            ? { vknUnlabeledChecksumFailed: true }
            : {}),
          ...(match && typeof match === "object" && match.needsReview && definition.type === "env_secret"
            ? { envSecretShort: true }
            : {}),
          ...(match && typeof match === "object" && match.needsReview && definition.type === "passport"
            ? { passportUnlabeled: true }
            : {}),
          ...(match && typeof match === "object" && match.needsReview && definition.type === "seed_phrase"
            ? { seedPhraseReview: true }
            : {}),
          ...(definition.type === "seed_phrase" ? { seedPhraseReview: true } : {}),
        };
        const detection = createDetection(line, definition.type, definition.label, text, {
          boxText: typeof match === "string" ? rawText : (match.span || rawText),
          matchOccurrence: typeof match === "object" && match ? Number(match.occurrence || 0) : 0,
          padding: typeof match === "object" && match ? Number(match.padding || 0) : 0,
          ruleId: definition.ruleId,
          reviewHints,
        }, { imageSize, linesById });
        if (detection) detections.push(detection);
      });
    });
  });

  for (const match of findPrivateKeyMatchesFromLines(lines)) {
    const source = {
      words: match.words,
      confidence: match.confidence,
      lineIndex: match.lineIndex,
    };
    const detection = createDetection(source, "private_key", "Possible private key", match.text, {
      boxText: match.boxText || match.text.replace(/\n/g, " "),
    }, { imageSize, linesById });
    if (detection) detections.push(detection);
  }

  for (const match of findBearerTokenMatchesFromLines(lines)) {
    const source = {
      words: match.words,
      confidence: match.confidence,
      lineIndex: match.lineIndex,
    };
    const detection = createDetection(source, "bearer_token", "Possible Bearer token", match.text, {
      boxText: match.boxText || match.span || match.text,
    }, { imageSize, linesById });
    if (detection) detections.push(detection);
  }

  for (const match of findSeedPhraseMatchesFromLines(lines)) {
    const source = {
      words: match.words,
      confidence: match.confidence,
      lineIndex: match.lineIndex,
    };
    const detection = createDetection(source, "seed_phrase", "Possible seed phrase", match.text, {
      boxText: match.boxText || match.span || match.text,
      reviewHints: { seedPhraseReview: true },
    }, { imageSize, linesById });
    if (detection) detections.push(detection);
  }

  const crossLine = findCrossLineIbanMatches(lines);
  for (const match of crossLine) {
    const labelSource = match.words?.map((word) => word.text).join(" ") || match.boxText || match.text;
    const ibanHints = ibanReviewHints(match.text, labelSource);
    const text = ibanHints.text;
    const source = {
      words: match.words,
      confidence: match.confidence,
      lineIndex: match.lineIndex,
    };
    const detection = createDetection(source, "custom_rule", "Possible IBAN", text, {
      boxText: match.boxText,
      ruleId: "iban",
      reviewHints: {
        ibanPatternOnly: Boolean(ibanHints.ibanPatternOnly),
        ibanChecksumValid: Boolean(ibanHints.ibanChecksumValid),
        ibanChecksumFailed: Boolean(ibanHints.ibanChecksumFailed),
        ocrCorrected: Boolean(ibanHints.ocrCorrected),
      },
    }, { imageSize, linesById });
    if (detection) detections.push(detection);
  }

  if (crossLine.length) {
    const joinedCompacts = new Set(crossLine.map((match) => match.joinedCompact));
    return detections.filter((detection) => {
      if (detection.ruleId !== "iban" && !(detection.type === "custom_rule" && /iban/i.test(detection.label || ""))) {
        return true;
      }
      const compact = String(detection.text || "").replace(/[\s-]+/g, "").toUpperCase();
      for (const joined of joinedCompacts) {
        if (compact !== joined && joined.startsWith(compact)) return false;
      }
      return true;
    });
  }

  return detections;
}
