import { extractCustomRuleMatches, TURKISH_IBAN_PATTERN } from "./custom-rules.js";
import {
  buildCrossLineWindows,
  groupWordsByLine,
  wordsForJoinedRange,
} from "./cross-line.js";
import { BIP39_ENGLISH_SET } from "./data/bip39-english.js";

const GIVEN_NAMES = new Set([
  "ada", "ahmet", "ali", "asli", "asya", "ayse", "aylin", "azra", "banu", "baran",
  "belgin", "berk", "beyza", "burak", "busra", "cagla", "can", "cem", "cemal", "cenk",
  "ceren", "damla", "defne", "deniz", "derya", "didem", "duygu", "ebru", "ece", "ekin",
  "elif", "elisa", "emine", "emre", "enes", "esra", "eylul", "fatma", "feride", "fikret",
  "filiz", "gamze", "gozde", "gul", "gulsah", "gulsen", "hande", "hasan", "hatice", "hazal",
  "hulya", "huseyin", "ibrahim", "ilayda", "ilknur", "ipek", "irem", "ismail", "jale", "kader",
  "kemal", "kerem", "kubra", "lale", "leyla", "mahmut", "mehmet", "melis", "melisa", "melek",
  "merve", "mine", "miray", "murat", "mustafa", "nalan", "naz", "nehir", "nil", "nisa",
  "nur", "nurgul", "omer", "onur", "osman", "ozge", "ozlem", "pelin", "perihan", "pinar",
  "ramazan", "recep", "reyhan", "rumeysa", "ruya", "salih", "seda", "selin", "sena", "serhat",
  "serkan", "sevgi", "sevil", "sibel", "simge", "sude", "suleyman", "tolga", "tuba", "tugba",
  "tugce", "ugur", "ulku", "volkan", "yagmur", "yasemin", "yasin", "yeliz", "yunus", "yusuf",
  "zafer", "zehra", "zeliha", "zeynep",
]);

const SURNAMES = new Set([
  "acar", "aksoy", "aktas", "alkan", "altin", "arslan", "aslan", "ates", "avci", "aydin",
  "bayrak", "bulut", "cakir", "can", "celik", "cetin", "coskun", "demir", "demirci", "dogan",
  "duman", "erdem", "erdogan", "eren", "ergin", "guler", "gunay", "gunes", "inanc", "isik",
  "kara", "karaca", "karaman", "kaya", "keles", "kilic", "koc", "kocak", "korkmaz", "kurt",
  "ozer", "ozcan", "ozdemir", "ozkan", "ozturk", "polat", "sahin", "sari", "sezer", "simsek",
  "tan", "tekin", "tuna", "turan", "uysal", "uzun", "yalcin", "yaman", "yavuz", "yilmaz",
  "yildirim", "yildiz", "yuce", "yucel",
]);

const NAME_STOPWORDS = new Set([
  "adres", "ama", "and", "api", "area", "bir", "blackout", "blur", "bu", "card", "city",
  "copy", "customer", "data", "download", "email", "error", "file", "free", "from", "icin",
  "ile", "image", "info", "key", "live", "local", "location", "name", "new", "password",
  "phone", "pixelate", "possible", "privacy", "pro", "ready", "redaktix", "region", "review",
  "saved", "scan", "secret", "security", "select", "sensitive", "status", "support", "team",
  "test", "the", "token", "turkey", "turkiye", "user", "ve", "warning", "with", "zoom",
]);

const TITLE_PATTERN = "(?:sayın|sayin|bay|bayan|sn|dr|prof|av|mr|mrs|ms|miss|sir|madam|bey|hanım|hanim)";
const NAME_FIELD_LABELS = [
  "account holder",
  "customer name",
  "employee name",
  "contact person",
  "profile name",
  "assigned to",
  "created by",
  "requested by",
  "approved by",
  "full name",
  "user name",
  "musteri adi",
  "calisan adi",
  "ilgili kisi",
  "hesap sahibi",
  "atanan kisi",
  "talep eden",
  "ad soyad",
  "customer",
  "employee",
  "contact",
  "recipient",
  "musteri",
  "calisan",
  "olusturan",
  "kullanici",
  "onaylayan",
  "owner",
  "soyad",
  "alici",
  "name",
  "user",
  "ad",
];
const NAME_VALUE_STOPWORDS = new Set([
  ...NAME_STOPWORDS,
  "account",
  "book",
  "center",
  "contact",
  "details",
  "employee",
  "full",
  "guide",
  "holder",
  "office",
  "owner",
  "person",
  "profile",
  "recipient",
  "selector",
  "settings",
  "tools",
]);
const NAME_TOKEN = "[A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü.'’-]{1,24}";
const TURKISH_NAME_SUFFIXES = [
  "ndan", "nden", "nin", "nun", "dan", "den", "tan", "ten", "yla", "yle",
  "dir", "dur", "tir", "tur", "nda", "nde", "nca", "nce", "na", "ne",
  "yi", "yu", "in", "un", "da", "de", "ta", "te",
].sort((first, second) => second.length - first.length);

const PROVINCES = [
  ["adana", "Adana"], ["adiyaman", "Adıyaman"], ["afyonkarahisar", "Afyonkarahisar"],
  ["agri", "Ağrı"], ["aksaray", "Aksaray"], ["amasya", "Amasya"], ["ankara", "Ankara"],
  ["antalya", "Antalya"], ["ardahan", "Ardahan"], ["artvin", "Artvin"], ["aydin", "Aydın"],
  ["balikesir", "Balıkesir"], ["bartin", "Bartın"], ["batman", "Batman"], ["bayburt", "Bayburt"],
  ["bilecik", "Bilecik"], ["bingol", "Bingöl"], ["bitlis", "Bitlis"], ["bolu", "Bolu"],
  ["burdur", "Burdur"], ["bursa", "Bursa"], ["canakkale", "Çanakkale"], ["cankiri", "Çankırı"],
  ["corum", "Çorum"], ["denizli", "Denizli"], ["diyarbakir", "Diyarbakır"], ["duzce", "Düzce"],
  ["edirne", "Edirne"], ["elazig", "Elazığ"], ["erzincan", "Erzincan"], ["erzurum", "Erzurum"],
  ["eskisehir", "Eskişehir"], ["gaziantep", "Gaziantep"], ["giresun", "Giresun"],
  ["gumushane", "Gümüşhane"], ["hakkari", "Hakkâri"], ["hatay", "Hatay"], ["igdir", "Iğdır"],
  ["isparta", "Isparta"], ["istanbul", "İstanbul"], ["izmir", "İzmir"],
  ["kahramanmaras", "Kahramanmaraş"], ["karabuk", "Karabük"], ["karaman", "Karaman"],
  ["kars", "Kars"], ["kastamonu", "Kastamonu"], ["kayseri", "Kayseri"], ["kilis", "Kilis"],
  ["kirikkale", "Kırıkkale"], ["kirklareli", "Kırklareli"], ["kirsehir", "Kırşehir"],
  ["kocaeli", "Kocaeli"], ["konya", "Konya"], ["kutahya", "Kütahya"], ["malatya", "Malatya"],
  ["manisa", "Manisa"], ["mardin", "Mardin"], ["mersin", "Mersin"], ["mugla", "Muğla"],
  ["mus", "Muş"], ["nevsehir", "Nevşehir"], ["nigde", "Niğde"], ["ordu", "Ordu"],
  ["osmaniye", "Osmaniye"], ["rize", "Rize"], ["sakarya", "Sakarya"], ["samsun", "Samsun"],
  ["sanliurfa", "Şanlıurfa"], ["siirt", "Siirt"], ["sinop", "Sinop"], ["sirnak", "Şırnak"],
  ["sivas", "Sivas"], ["tekirdag", "Tekirdağ"], ["tokat", "Tokat"], ["trabzon", "Trabzon"],
  ["tunceli", "Tunceli"], ["usak", "Uşak"], ["van", "Van"], ["yalova", "Yalova"],
  ["yozgat", "Yozgat"], ["zonguldak", "Zonguldak"],
];

export function foldTurkish(value) {
  return String(value || "")
    .replace(/İ/g, "i")
    .replace(/I/g, "i")
    .replace(/Ş/g, "s")
    .replace(/ş/g, "s")
    .replace(/Ğ/g, "g")
    .replace(/ğ/g, "g")
    .replace(/Ü/g, "u")
    .replace(/ü/g, "u")
    .replace(/Ö/g, "o")
    .replace(/ö/g, "o")
    .replace(/Ç/g, "c")
    .replace(/ç/g, "c")
    .replace(/ı/g, "i")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/û/g, "u")
    .toLowerCase();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function isValidVkn(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!/^\d{10}$/.test(digits)) return false;
  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    const tmp = (Number(digits[index]) + (9 - index)) % 10;
    let contribution = (tmp * (2 ** (9 - index))) % 9;
    if (tmp !== 0 && contribution === 0) contribution = 9;
    sum += contribution;
  }
  return ((10 - (sum % 10)) % 10) === Number(digits[9]);
}

/** Official IBAN lengths by country code (SWIFT registry). */
export const IBAN_COUNTRY_LENGTHS = Object.freeze({
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BI: 28,
  BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DJ: 27, DK: 18, DO: 28,
  EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18,
  GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30,
  KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, LY: 25, MC: 27,
  MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28,
  PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, RU: 33, SA: 24, SC: 31, SD: 18, SE: 24,
  SI: 19, SK: 24, SM: 27, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22,
  VG: 24, XK: 20,
});

export const IBAN_CHECKSUM_FAILED_WARNING = "IBAN structure valid, checksum failed";

function compactIban(value) {
  return String(value || "").replace(/[\s-]+/g, "").toUpperCase();
}

function ibanMod97(compact) {
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const piece = /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of piece) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder;
}

/**
 * @returns {{ structureValid: boolean, checksumValid: boolean, country: string|null }}
 */
export function isValidIban(value) {
  const compact = compactIban(value);
  const country = /^[A-Z]{2}/.test(compact) ? compact.slice(0, 2) : null;
  const expected = country ? IBAN_COUNTRY_LENGTHS[country] : undefined;
  const structureValid = Boolean(
    expected
    && compact.length === expected
    && /^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(compact)
  );
  const checksumValid = structureValid && ibanMod97(compact) === 1;
  return { structureValid, checksumValid, country };
}

/** OCR letter → digit confusions (O/0, I/l/|/1, S/5, B/8, Z/2). */
const IBAN_LETTER_TO_DIGIT = {
  O: "0", o: "0",
  I: "1", l: "1", "|": "1",
  S: "5", s: "5",
  B: "8", b: "8",
  Z: "2", z: "2",
};

/** OCR digit → letter confusions on IBAN country codes (6→G, 0→O, …). */
const IBAN_DIGIT_TO_LETTER = {
  6: "G",
  0: "O",
  1: "I",
  5: "S",
  8: "B",
  2: "Z",
  4: "A",
};

/** Pattern allowing OCR-damaged country codes (digit/letter in first two chars). */
const OCR_IBAN_CANDIDATE_PATTERN = "(?<![A-Z0-9])[A-Z0-9]{2}\\d{2}(?:\\s?[A-Z0-9]{4}){3,6}\\s?[A-Z0-9]{1,4}(?![A-Z0-9])";

function countryCodeCharOptions(char) {
  const upper = String(char || "").toUpperCase();
  const options = new Set();
  if (/[A-Z]/.test(upper)) options.add(upper);
  const mapped = IBAN_DIGIT_TO_LETTER[upper];
  if (mapped) options.add(mapped);
  return [...options];
}

/** Rewrite the first two alnum characters of a spaced IBAN to a repaired country. */
function applyIbanCountryPrefix(original, country) {
  let seen = 0;
  let out = "";
  for (const char of String(original || "")) {
    if (/[A-Za-z0-9]/.test(char) && seen < 2) {
      out += country[seen];
      seen += 1;
    } else {
      out += char;
    }
  }
  return out;
}

/**
 * Repair IBAN country code via digit→letter OCR confusions.
 * Returns spaced text with repaired country, or "" if none structure-valid.
 */
export function repairIbanCountryCode(value) {
  const original = String(value || "");
  const compact = compactIban(original);
  if (compact.length < 5) return "";
  const rest = compact.slice(2);
  let best = "";
  for (const first of countryCodeCharOptions(compact[0])) {
    for (const second of countryCodeCharOptions(compact[1])) {
      const country = `${first}${second}`;
      if (!IBAN_COUNTRY_LENGTHS[country]) continue;
      const candidateCompact = country + rest;
      const validation = isValidIban(candidateCompact);
      if (!validation.structureValid) continue;
      const spaced = applyIbanCountryPrefix(original, country);
      if (validation.checksumValid) return spaced;
      if (!best) best = spaced;
    }
  }
  return best;
}

export function ibanLabelPrecedes(source, matchText) {
  const text = String(source || "");
  const span = String(matchText || "");
  const index = text.indexOf(span);
  const before = foldTurkish(index >= 0 ? text.slice(Math.max(0, index - 48), index) : text);
  return /(?:^|[^a-z])iban\b/.test(before);
}

/** Try changing exactly one confusable letter glyph so mod-97 passes. */
export function repairIbanSingleGlyph(value) {
  const compact = compactIban(value);
  const baseline = isValidIban(compact);
  if (!baseline.structureValid || baseline.checksumValid) return "";
  const chars = [...compact];
  for (let index = 0; index < chars.length; index += 1) {
    const digit = IBAN_LETTER_TO_DIGIT[chars[index]];
    if (!digit || digit === chars[index]) continue;
    const next = chars.slice();
    next[index] = digit;
    const candidate = next.join("");
    if (isValidIban(candidate).checksumValid) return candidate;
  }
  return "";
}

/**
 * Review / auto-apply policy for an IBAN pattern match.
 * @param {string} value matched span (original OCR text)
 * @param {string} [sourceText] full line/source for IBAN label context
 * @returns {{ text: string, ibanPatternOnly?: boolean, ibanChecksumValid?: boolean,
 *   ibanChecksumFailed?: boolean, ocrCorrected?: boolean }}
 */
export function ibanReviewHints(value, sourceText = "") {
  const source = String(value || "");
  let working = source;
  let ocrCorrected = false;
  let countryRepaired = false;

  let validation = isValidIban(working);
  if (!validation.structureValid) {
    const repairedCountry = repairIbanCountryCode(working);
    if (repairedCountry) {
      working = repairedCountry;
      ocrCorrected = true;
      countryRepaired = true;
      validation = isValidIban(working);
    }
  }

  if (validation.checksumValid) {
    return { text: working, ibanChecksumValid: true, ocrCorrected };
  }

  if (validation.structureValid) {
    const glyphRepaired = repairIbanSingleGlyph(working);
    if (glyphRepaired) {
      return { text: glyphRepaired, ibanChecksumValid: true, ocrCorrected: true };
    }
    // Country-code OCR repair: auto-apply only with checksum OR an IBAN label.
    if (countryRepaired) {
      if (ibanLabelPrecedes(sourceText, source)) {
        return { text: working, ibanChecksumFailed: true, ocrCorrected: true };
      }
      return { text: working, ibanPatternOnly: true, ocrCorrected: true };
    }
    return { text: working, ibanChecksumFailed: true, ocrCorrected };
  }

  return { text: source, ibanPatternOnly: true };
}

export function isValidTckn(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!/^[1-9]\d{10}$/.test(digits)) return false;
  const numbers = digits.split("").map(Number);
  const [d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11] = numbers;
  const checksum10 = ((((d1 + d3 + d5 + d7 + d9) * 7) - (d2 + d4 + d6 + d8)) % 10 + 10) % 10;
  const checksum11 = (d1 + d2 + d3 + d4 + d5 + d6 + d7 + d8 + d9 + d10) % 10;
  return d10 === checksum10 && d11 === checksum11;
}

const TCKN_OCR_GLYPH = /[0-9OoIl|SsBb]/;

function correctTcknOcr(value) {
  return String(value || "")
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[Ss]/g, "5")
    .replace(/[Bb]/g, "8");
}

export function tcknEvidence(value) {
  const normalized = correctTcknOcr(String(value || "")).replace(/\D/g, "");
  const evidence = [];
  if (normalized.length === 11) evidence.push("11-digit");
  if (/^[1-9]/.test(normalized)) evidence.push("first-digit-nonzero");
  if (isValidTckn(normalized)) evidence.push("checksum-valid");
  return {
    valid: evidence.includes("checksum-valid"),
    normalized,
    evidence,
  };
}

function acceptedTcknWindow(raw) {
  const normalized = correctTcknOcr(raw);
  if (!/^[0-9]{11}$/.test(normalized) || !isValidTckn(normalized)) return "";
  return normalized;
}

export function sanitizeOcrToken(value) {
  return String(value || "").trim().replace(/[.,;:!]+$/g, "");
}

export function sanitizeOcrText(value) {
  return String(value || "")
    .split(/(\s+)/)
    .map((part) => (/\s/.test(part) ? part : part.replace(/[.,;:!]+$/g, "")))
    .join("")
    .replace(/[^\S\n]+/g, " ")
    .trim();
}

const TCKN_CANDIDATE = /(?<!\d)[0-9OoIl|SsBb]{11}(?!\d)/g;

export function findTcknMatches(value) {
  const source = String(value ?? "");
  const matches = [];
  const spanCounts = new Map();

  for (const found of source.matchAll(TCKN_CANDIDATE)) {
    const raw = found[0];
    const before = source[found.index - 1];
    const after = source[found.index + raw.length];
    const gluedToLetters = (before && !TCKN_OCR_GLYPH.test(before)) || (after && !TCKN_OCR_GLYPH.test(after) && !/\d/.test(after));
    const insideGlyphRun = TCKN_OCR_GLYPH.test(before || "") || TCKN_OCR_GLYPH.test(after || "");
    if (!gluedToLetters && insideGlyphRun) continue;
    const text = acceptedTcknWindow(raw);
    if (!text) continue;
    const occurrence = spanCounts.get(raw) || 0;
    spanCounts.set(raw, occurrence + 1);
    matches.push({
      text,
      span: raw,
      ...(occurrence > 0 ? { occurrence } : {}),
      labeled: false,
      confidence: 0.98,
      padding: 0,
    });
  }

  return matches;
}

export function extractTcknCandidates(value) {
  return findTcknMatches(value).map((match) => match.text);
}

export function findPass2TcknTexts(value) {
  const direct = [...new Set(findTcknMatches(value).map((match) => match.text))];
  if (direct.length) return direct;
  const token = correctTcknOcr(String(value || "").replace(/\s+/g, ""));
  if (!/^[0-9]{12,13}$/.test(token)) return [];
  const found = [];
  for (let index = 0; index <= token.length - 11; index += 1) {
    const window = token.slice(index, index + 11);
    if (isValidTckn(window)) found.push(window);
  }
  return [...new Set(found)];
}

const TURKISH_MOBILE_PREFIXES = new Set(["50", "51", "52", "53", "54", "55", "56", "59"]);

function hasTurkishCarrierPrefix(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("0090")) digits = digits.slice(4);
  else if (digits.startsWith("90") && digits.length >= 12) digits = digits.slice(2);
  else if (digits.startsWith("0") && digits.length >= 11) digits = digits.slice(1);
  if (digits.length !== 10) return false;
  if (digits.startsWith("5")) return TURKISH_MOBILE_PREFIXES.has(digits.slice(0, 2));
  return /^[2-4]\d{9}$/.test(digits);
}

function rewriteTrunkLetterO(value) {
  return String(value || "").replace(
    /(^|[^A-Za-z0-9])[OoΟοОоØø](?=\s*\d)/gu,
    (match, prefix) => `${prefix}0`
  );
}

function hasPhoneLabelBefore(source, index) {
  const before = String(source || "").slice(Math.max(0, index - 24), index);
  return /(?:^|[^a-z])(?:tel|telefon|phone)\s*:?\s*$/i.test(before);
}

export function phoneReviewHints(source, phoneText) {
  const original = String(source || "");
  const rewritten = rewriteTrunkLetterO(original);
  const phone = String(phoneText || "");
  const index = phone ? rewritten.indexOf(phone) : -1;
  const labelBased = index >= 0 && hasPhoneLabelBefore(rewritten, index);
  const ocrCorrected = index >= 0 && original.slice(index, index + phone.length) !== phone;
  const carrierSkipped = labelBased && /^\s*0(?!0)/.test(phone) && !hasTurkishCarrierPrefix(phone);
  return { labelBased, ocrCorrected, carrierSkipped };
}

export function extractPhoneCandidates(value) {
  const source = rewriteTrunkLetterO(value);
  const patterns = [
    /\+90[\s().-]*5\d{2}(?:[\s().-]*\d){7}\b/g,
    /\+\d{1,3}(?:[\s().-]*\d){8,14}\b/g,
    /\b0[\s.-]*5\d{2}(?:[\s().-]*\d){7}\b/g,
    /\b0[\s.-]*\d{2,4}(?:[\s().-]*\d){6,12}\b/g,
    /(?:^|\s)\(\d{2,4}\)(?:[\s.-]*\d){7,14}\b/g,
  ];
  const found = patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => ({
    text: match[0].trim(),
    index: match.index + (match[0].length - match[0].trimStart().length),
  })));
  const uniqueMatches = [];
  found.forEach((match) => {
    if (uniqueMatches.some((kept) => kept.text === match.text)) return;
    uniqueMatches.push(match);
  });
  const accepted = uniqueMatches.filter((match) => {
    if (!isValidPhone(match.text)) return false;
    const digits = match.text.replace(/\D/g, "");
    if (digits.startsWith("000")) return false;
    const turkish = /^\s*(?:\+90|0090)/.test(match.text)
      || digits.startsWith("0090")
      || /^\s*0(?!0)/.test(match.text)
      || (digits.startsWith("90") && !digits.startsWith("00"));
    const labeledLocal = /^\s*0(?!0)/.test(match.text) && hasPhoneLabelBefore(source, match.index);
    return turkish && !labeledLocal ? hasTurkishCarrierPrefix(match.text) : true;
  });
  return accepted
    .filter((match) => !accepted.some((other) => other.text !== match.text && other.text.includes(match.text)))
    .map((match) => match.text);
}

function phoneOcrToken(text) {
  const value = String(text || "").trim();
  if (/^[OoΟοОоØø]$/u.test(value)) return "0";
  return value;
}

function samePhoneRow(first, second) {
  if (first?.lineId && first.lineId === second?.lineId) return true;
  const firstBox = wordCorners(first);
  const secondBox = wordCorners(second);
  if (!firstBox || !secondBox) return false;
  const firstCenter = (firstBox.y0 + firstBox.y1) / 2;
  const secondCenter = (secondBox.y0 + secondBox.y1) / 2;
  const band = Math.max(firstBox.y1 - firstBox.y0, secondBox.y1 - secondBox.y0, 1);
  return Math.abs(firstCenter - secondCenter) <= Math.max(10, band * 1.15);
}

function groupPhoneWords(words) {
  const parent = words.map((_, index) => index);
  const find = (index) => {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };
  words.forEach((word, index) => {
    for (let other = index + 1; other < words.length; other += 1) {
      if (!samePhoneRow(word, words[other])) continue;
      const left = find(index);
      const right = find(other);
      if (left !== right) parent[right] = left;
    }
  });
  const groups = new Map();
  words.forEach((word, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(word);
  });
  return [...groups.values()];
}

export function extractPhoneMatchesFromOcrWords(words) {
  const valid = (Array.isArray(words) ? words : []).filter((word) => wordCorners(word) && String(word.text || "").trim());
  const matches = [];
  groupPhoneWords(valid).forEach((lineWords) => {
    const sorted = [...lineWords]
      .sort((first, second) => wordCorners(first).x0 - wordCorners(second).x0)
      .map((word) => {
        const text = phoneOcrToken(word.text);
        return {
          ...word,
          text,
          ocrCorrected: text !== String(word.text || "").trim(),
        };
      });
    const run = wordRun(sorted);
    extractPhoneCandidates(run.text).forEach((phone) => {
      const range = findMatchRange(run.text, phone);
      if (!range) return;
      const matchEnd = range.start + range.length;
      const covered = [];
      run.spans.forEach((span) => {
        if (Math.max(span.start, range.start) < Math.min(span.end, matchEnd)) covered.push(span.word);
      });
      if (!covered.length) return;
      const hints = phoneReviewHints(run.text, phone);
      matches.push({
        text: phone,
        words: covered,
        ocrCorrected: covered.some((word) => word.ocrCorrected) || hints.ocrCorrected,
        labelBased: hints.labelBased,
        carrierSkipped: hints.carrierSkipped,
      });
    });
  });
  return matches;
}

export function detectPhonesInScan(words, imageWidth, imageHeight) {
  const width = Number(imageWidth);
  const height = Number(imageHeight);
  if (!(width > 0) || !(height > 0)) return [];
  return extractPhoneMatchesFromOcrWords(words).flatMap((match) => {
    const envelope = envelopeForMatchedWords(match.words, match.text);
    const normalized = envelope ? normalizeBox(envelope, width, height) : null;
    if (!normalized) return [];
    const normX = Math.min(1, Math.max(0, normalized.normX));
    const normY = Math.min(1, Math.max(0, normalized.normY));
    const normWidth = Math.min(Math.max(0, normalized.normWidth), 1 - normX);
    const normHeight = Math.min(Math.max(0, normalized.normHeight), 1 - normY);
    if (normWidth <= 0 || normHeight <= 0) return [];
    const confidence = Math.min(...match.words.map((word) => Number(word.confidence || 0)));
    return [{
      type: "phone",
      label: "Possible phone number",
      text: match.text,
      confidence,
      normX,
      normY,
      normWidth,
      normHeight,
      review: buildDetectionReview({
        type: "phone",
        text: match.text,
        confidence,
        labelBased: match.labelBased,
        ocrCorrected: match.ocrCorrected,
        carrierSkipped: match.carrierSkipped,
      }),
    }];
  });
}

function isValidPhone(value) {
  const text = String(value || "").trim();
  const digits = text.replace(/\D/g, "");
  const hasClearFormat = text.startsWith("+") || text.startsWith("0") || text.startsWith("(");
  return hasClearFormat &&
    digits.length >= 10 &&
    digits.length <= 15 &&
    /^\+?\(?\d[\d\s().-]{8,22}\d$/.test(text);
}

export function extractApiTokenCandidates(value) {
  const prepared = String(value || "")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/[＿﹍﹎]/g, "_")
    .replace(/\s*_\s*/g, "_")
    .replace(/\s*-\s*/g, "-")
    .replace(/\bapi\s+(test|live)\s+/gi, "api_$1_");
  const patterns = [
    /\bapi[_-]+(?:test|live)[_-]+[a-z0-9_-]{8,}\b/gi,
    /\bapi[_-]+(?:test|live)[_-]+[a-z0-9_-]{4,}(?:[ \t]+[a-z0-9_-]*\d[a-z0-9_-]*)+\b/gi,
    /\bghp_[a-z0-9]{20,}\b/gi,
    /\bghp_[a-z0-9]{8,}(?:[ \t]+[a-z0-9]*\d[a-z0-9]*)?\b/gi,
    /\bgh[pousr]_[a-z0-9]{36,}\b/gi,
    /\bgithub_pat_[a-z0-9_]{20,}\b/gi,
    /\bgithub_pat_[a-z0-9_]{8,}(?:[ \t]+[a-z0-9_]*\d[a-z0-9_]*)?\b/gi,
    /\bapi(?:test|live)[a-z0-9]{8,}\b/gi,
    /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    /\bsk-(?:proj-|admin-|[A-Za-z0-9]{20,})[A-Za-z0-9_-]+/g,
    /(?<![A-Z0-9])(?:AKIA|ASIA|AROA|AIDA)[A-Z0-9]{16}(?![A-Z0-9])/g,
  ];
  const matches = [
    ...extractStripeSecrets(value),
    ...patterns.flatMap((pattern) => prepared.match(pattern) || []),
    ...extractConnectionUrlCandidates(value),
    ...extractAwsSecretKeys(prepared),
    ...extractHighEntropyTokens(prepared),
  ];
  return unique(matches.map(formatApiToken)).filter(acceptApiToken);
}

// OCR whitespace becomes \0 (non-word) so \\b still works; \\0 is allowed inside the URL.
const CONNECTION_URL_PATTERN =
  /\b(?:mysql|mongodb(?:\+srv)?|redis|amqp|mssql|postgresql):\/\/[A-Za-z0-9._~+-]+:[^\0@]+@[A-Za-z0-9.-]+\0*(?::\d{1,5})?(?:\/[A-Za-z0-9._~+=\/%-]*)?/gi;

/**
 * Replace whitespace with a non-word sentinel so scheme \\b anchors survive while
 * OCR gaps inside a URL (e.g. before :6379) can still be spanned.
 */
function connectionUrlSearchText(lineText) {
  const source = String(lineText || "");
  let text = "";
  const map = [];
  for (let index = 0; index < source.length; index += 1) {
    if (/\s/.test(source[index])) {
      text += "\0";
      map.push(index);
      continue;
    }
    text += source[index];
    map.push(index);
  }
  return { text, map };
}

/**
 * Credentialed database / broker URLs (user:pass@host). Schemes without credentials are ignored.
 * Shared by api_token extraction (postgresql legacy path) and connection_url detections.
 * Matches on whitespace-collapsed text so OCR splits like "...com" + ":6379" stay one URL.
 */
export function extractConnectionUrlCandidates(value) {
  const source = String(value || "");
  if (!source) return [];
  const search = connectionUrlSearchText(source);
  const pattern = new RegExp(CONNECTION_URL_PATTERN.source, "gi");
  const found = [];
  let match;
  while ((match = pattern.exec(search.text)) !== null) {
    let length = match[0].length;
    while (length > 0 && /[.,;!?)\0]/.test(match[0][length - 1])) length -= 1;
    if (length <= 0) continue;
    const span = spanFromMap(search.map, match.index, length);
    if (!span) continue;
    const cleaned = source
      .slice(span.start, span.start + span.length)
      .replace(/\s+/g, "")
      .replace(/[.,;!?)]+$/g, "");
    // Require explicit user:password@ before host.
    if (!/:\/\/[^/@]+:[^/@]+@/.test(cleaned)) continue;
    found.push(cleaned);
  }
  return unique(found);
}

function acceptApiToken(token) {
  const raw = String(token || "");
  const compact = raw.replace(/\s+/g, "");
  const explicitPrefix = /^(?:sk|pk|rk)_(?:live|test)_|^sk-(?:proj-|admin-)?|^gh[pousr]_|^github_pat_|^api_(?:test|live)_|^eyJ|^(?:AKIA|ASIA|AROA|AIDA)|^(?:mysql|mongodb(?:\+srv)?|redis|amqp|mssql|postgresql):\/\//i.test(compact);
  if (/\s/.test(raw) && !explicitPrefix) return false;
  if (compact.length < 16) return false;
  if (/^ghp_/i.test(compact) && compact.length < 24 && !/\d/.test(compact)) return false;
  if (/^github_pat_/i.test(compact) && compact.length < 31 && !/\d/.test(compact)) return false;
  return true;
}

export function isTruncatedCredential(token) {
  const compact = String(token || "").replace(/\s+/g, "");
  const stripe = compact.match(/^(?:sk|pk|rk)_(?:live|test)_(.*)$/i);
  if (stripe) return stripe[1].length < 24;
  if (/^ghp_/i.test(compact)) return compact.length < 24;
  if (/^github_pat_/i.test(compact)) return compact.length < 31;
  return false;
}

const LOW_OCR_CONFIDENCE = 70;

export function buildDetectionReview({
  type,
  text,
  confidence,
  labelBased = false,
  ocrCorrected = false,
  truncated = false,
  carrierSkipped = false,
  ibanPatternOnly = false,
  ibanChecksumValid = false,
  ibanChecksumFailed = false,
  vknUnlabeledChecksumFailed = false,
  customIdReview = false,
  envSecretShort = false,
  passportUnlabeled = false,
  seedPhraseReview = false,
} = {}) {
  const ocrConfidence = Number(confidence);
  const safeConfidence = Number.isFinite(ocrConfidence) ? ocrConfidence : null;
  const checksumFailed = type === "tckn" && !isValidTckn(text);
  const credentialTruncated = Boolean(truncated) || (type === "api_token" && isTruncatedCredential(text));
  const ibanUnverified = Boolean(ibanPatternOnly);
  const ibanFailedChecksum = Boolean(ibanChecksumFailed);
  const ibanPassedChecksum = Boolean(ibanChecksumValid);
  const unlabeledVkn = Boolean(vknUnlabeledChecksumFailed);
  const customIdNeedsReview = Boolean(customIdReview);
  const shortEnvSecret = Boolean(envSecretShort) || (type === "env_secret" && String(text || "").length < 8);
  const unlabeledPassport = Boolean(passportUnlabeled);
  const seedNeedsReview = Boolean(seedPhraseReview) || type === "seed_phrase";
  let validation = "unverified";
  if (unlabeledVkn || ibanUnverified || customIdNeedsReview || shortEnvSecret || unlabeledPassport || seedNeedsReview) {
    validation = "unverified";
  } else if (ibanPassedChecksum || type === "credit_card" || (type === "tckn" && !checksumFailed)) validation = "checksum";
  else if (ibanFailedChecksum) validation = "unverified";
  else if (type === "person_name" || type === "location" || checksumFailed || carrierSkipped) validation = "contextual";
  else if ([
    "email", "phone", "ipv4", "ipv6", "vkn", "api_token", "session_id", "custom_rule",
    "env_secret", "passport", "bearer_token", "connection_url", "private_key",
  ].includes(type)) validation = "pattern";

  const warnings = [];
  if (unlabeledVkn) {
    warnings.push(VKN_UNLABELED_CHECKSUM_WARNING);
  }
  if (customIdNeedsReview) {
    warnings.push(CUSTOM_ID_REVIEW_WARNING);
  }
  if (shortEnvSecret) {
    warnings.push("This .env value is short. Confirm it before sharing.");
  }
  if (unlabeledPassport) {
    warnings.push("Passport-like value without a Passport/Pasaport label. Confirm before redacting.");
  }
  if (seedNeedsReview) {
    warnings.push("Possible seed phrase. Review carefully before redacting.");
  }
  if (ibanUnverified) {
    warnings.push("This value matches an IBAN pattern, but its checksum was not validated.");
  }
  if (ibanFailedChecksum) {
    warnings.push(IBAN_CHECKSUM_FAILED_WARNING);
  }
  if (checksumFailed) {
    warnings.push("Shown because of a nearby identity label. The checksum did not match.");
  }
  if (carrierSkipped) {
    warnings.push("Shown because of a phone label. The carrier prefix was not confirmed.");
  }
  if (ocrCorrected) {
    warnings.push("OCR changed a character in this value. Compare it with the image.");
  }
  if (credentialTruncated) {
    warnings.push("This credential looks incomplete. Confirm the full value before sharing.");
  }
  if (type === "person_name" || type === "location") {
    warnings.push("Suggested from surrounding context. This is not confirmed by a checksum.");
  }
  if (safeConfidence !== null && safeConfidence < LOW_OCR_CONFIDENCE) {
    warnings.push(type === "ipv4" || type === "ipv6"
      ? "OCR may have misread a digit. Verify the highlighted image area manually."
      : "OCR confidence is low. That percentage does not prove this value is correct.");
  }

  const review = {
    ocrConfidence: safeConfidence,
    validation,
    labelBased: Boolean(labelBased) || type === "location" || checksumFailed,
    ocrCorrected: Boolean(ocrCorrected),
    truncated: credentialTruncated,
    warnings,
  };
  if (ibanUnverified || unlabeledVkn || customIdNeedsReview || shortEnvSecret || unlabeledPassport || seedNeedsReview) {
    review.needsReview = true;
    if (ibanUnverified || customIdNeedsReview || shortEnvSecret || unlabeledPassport || seedNeedsReview) {
      review.patternMatched = true;
    }
    if (unlabeledVkn) review.lowConfidence = true;
  }
  return review;
}

export function detectionsForAutomaticRedaction(detections, confirmed = false) {
  const list = Array.isArray(detections) ? detections : [];
  if (confirmed) return list.slice();
  return list.filter((detection) => !detection?.review?.needsReview);
}

export function matchCustomRules(rules, value) {
  const matches = [];
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (rule?.enabled === false) continue;
    try {
      const label = String(rule.label || rule.name || "Custom rule");
      const ruleId = String(rule.id || label);
      const texts = ruleId === "iban"
        ? extractIbanCandidates(value)
        : extractCustomRuleMatches(rule, value);
      for (const text of texts) {
        matches.push({
          ruleId,
          label,
          text,
        });
      }
    } catch {
      // One malformed rule must not stop the rest of the scan.
    }
  }
  return matches;
}

export function cloneDetectionForHistory(detection) {
  if (!detection || typeof detection !== "object") return detection;
  const copy = { ...detection, isFlashing: false };
  if (copy.review && typeof copy.review === "object") {
    copy.review = {
      ...copy.review,
      warnings: Array.isArray(copy.review.warnings) ? copy.review.warnings.slice() : [],
    };
  }
  return copy;
}

function extractStripeSecrets(value) {
  const prepared = String(value || "")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/[＿﹍﹎]/g, "_")
    .replace(/\s*_\s*/g, "_")
    .replace(/\s*-\s*/g, "-")
    .replace(/\b(sk|pk|rk)\s+(live|test)\b/gi, "$1_$2_");
  const secrets = [];
  const finder = /\b((?:sk|pk|rk)_(?:live|test)_|(?:sk|pk|rk)(?:live|test))/gi;

  for (const match of prepared.matchAll(finder)) {
    let index = match.index + match[0].length;
    let body = "";

    while (index < prepared.length) {
      const char = prepared[index];
      if (/[A-Za-z0-9]/.test(char)) {
        body += char;
        index += 1;
        continue;
      }
      if (/\s/.test(char)) {
        const rest = prepared.slice(index).match(/^\s+([A-Za-z0-9]+)/);
        if (!rest || /^[a-z]{3,}$/.test(rest[1])) break;
        body += rest[1];
        index += rest[0].length;
        continue;
      }
      break;
    }

    if (body.length < 8 || (body.length < 24 && !/\d/.test(body))) continue;
    const compact = match[1].match(/^(sk|pk|rk)(live|test)$/i);
    const prefix = compact
      ? `${compact[1].toLowerCase()}_${compact[2].toLowerCase()}_`
      : match[1];
    secrets.push(`${prefix}${body}`);
  }

  return secrets;
}

function formatApiToken(value) {
  const compactStripe = String(value || "").match(/^(sk|pk|rk)(live|test)([A-Za-z0-9]{24,})$/i);
  if (compactStripe) {
    return `${compactStripe[1].toLowerCase()}_${compactStripe[2].toLowerCase()}_${compactStripe[3]}`;
  }
  const compactApi = String(value || "").match(/^api(test|live)([a-z0-9_-]{8,})$/i);
  if (compactApi) {
    return `api_${compactApi[1].toLowerCase()}_${compactApi[2]}`;
  }
  return String(value || "");
}

function stripTurkishNameSuffix(token) {
  const value = String(token || "");
  const folded = foldTurkish(value);
  const splitAt = Math.max(
    folded.lastIndexOf("'"),
    folded.lastIndexOf("’"),
    folded.lastIndexOf("´"),
    folded.lastIndexOf("`")
  );
  if (splitAt < 2) return value;
  const suffix = folded.slice(splitAt + 1);
  if (!TURKISH_NAME_SUFFIXES.includes(suffix)) return value;
  return value.slice(0, splitAt);
}

export function canonicalPersonNameKey(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .map((token) => foldTurkish(stripTurkishNameSuffix(token)).replace(/[^a-z0-9]/g, ""))
    .filter(Boolean)
    .join("");
}

function uniquePersonNames(names) {
  const seen = new Set();
  const uniqueNames = [];
  names.forEach((name) => {
    const key = canonicalPersonNameKey(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    uniqueNames.push(name);
  });
  return uniqueNames;
}

function readLabeledPersonName(source, start) {
  let index = start;
  const words = [];

  while (words.length < 3) {
    const match = source.slice(index).match(/^\s*([A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğıöşü.'’-]{1,24})\b/u);
    if (!match) break;
    const word = stripTurkishNameSuffix(match[1]);
    if (word.length < 2 || /\d/.test(word) || NAME_VALUE_STOPWORDS.has(foldTurkish(word))) break;
    words.push(word);
    index += match[0].length;
  }

  if (!words.length || words.join(" ").length > 48) return null;
  if (words.length === 1 && words[0].length < 3) return null;
  return words.join(" ");
}

function extractLabeledPersonNames(source) {
  const folded = foldTurkish(source);
  const labels = NAME_FIELD_LABELS
    .slice()
    .sort((first, second) => second.length - first.length)
    .map((label) => label.replace(/ /g, "\\s+"));
  const pattern = new RegExp(
    `(?:^|[^a-z0-9])(?:${labels.join("|")})(?![a-z0-9])\\s*[:\\-–]\\s*`,
    "gi"
  );
  const names = [];
  let match = pattern.exec(folded);

  while (match) {
    const name = readLabeledPersonName(source, match.index + match[0].length);
    if (name) names.push(name);
    if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
    match = pattern.exec(folded);
  }

  return names;
}

function extendTurkishSuffix(line, range) {
  if (!range) return null;
  const tail = String(line || "").slice(range.start + range.length);
  const foldedTail = foldTurkish(tail);
  if (foldedTail.length !== tail.length) return range;
  const marker = foldedTail.match(/^['’´`]/);
  if (!marker) return range;
  const rest = foldedTail.slice(marker[0].length);
  const suffix = TURKISH_NAME_SUFFIXES.find((candidate) => rest.startsWith(candidate));
  if (!suffix) return range;
  const next = rest[suffix.length];
  if (next && /[a-z0-9]/.test(next)) return range;
  return {
    start: range.start,
    length: range.length + marker[0].length + suffix.length,
  };
}

export function extractPersonNameCandidates(value) {
  const source = String(value || "");
  const pattern = new RegExp(
    `(?:\\b(${TITLE_PATTERN})\\.?\\s+)?\\b(${NAME_TOKEN})\\s+(${NAME_TOKEN})\\b`,
    "giu"
  );
  const names = [];
  for (const match of source.matchAll(pattern)) {
    const title = match[1];
    const first = stripTurkishNameSuffix(match[2]);
    const second = stripTurkishNameSuffix(match[3]);
    if (first.length < 2 || second.length < 2) continue;
    const firstFold = foldTurkish(first);
    const secondFold = foldTurkish(second);
    if (NAME_STOPWORDS.has(firstFold) || NAME_STOPWORDS.has(secondFold)) continue;
    const knownFirst = GIVEN_NAMES.has(firstFold);
    const knownLast = SURNAMES.has(secondFold);
    const capitalish = /^[A-ZÇĞİÖŞÜ]/.test(first) && /^[A-ZÇĞİÖŞÜ]/.test(second);
    const accepted = (title && capitalish) || (knownFirst && (knownLast || capitalish)) || (knownFirst && knownLast);
    if (!accepted) continue;
    names.push(`${first} ${second}`);
  }
  names.push(...extractLabeledPersonNames(source));
  return uniquePersonNames(names);
}

const LOCATION_FIELD_LABELS = [
  "billing address",
  "shipping address",
  "postal address",
  "street address",
  "home address",
  "work address",
  "ip location",
  "postal code",
  "zip code",
  "fatura adresi",
  "teslimat adresi",
  "posta adresi",
  "sokak adresi",
  "ev adresi",
  "is adresi",
  "posta kodu",
  "location",
  "address",
  "country",
  "province",
  "region",
  "office",
  "state",
  "city",
  "konum",
  "adres",
  "sehir",
  "ulke",
  "ilce",
  "bolge",
  "ofis",
  "il",
];

const LOCATION_VALUE_REJECTS = new Set([
  "book",
  "guide",
  "selector",
  "settings",
  "tools",
]);

function locationLabelPattern(labels) {
  return labels
    .slice()
    .sort((first, second) => second.length - first.length)
    .map((label) => label.replace(/ /g, "\\s+"))
    .join("|");
}

function readLabeledLocationValue(source, start) {
  const rest = source.slice(start);
  const foldedRest = foldTurkish(rest);
  const stop = foldedRest.search(new RegExp(
    `(?:^|[^a-z0-9])(?:${locationLabelPattern(LOCATION_FIELD_LABELS)}|email|e-mail|phone|tel|name|customer|employee|ad\\s+soyad|musteri)\\s*[:\\-–]`,
    "i"
  ));
  const slice = stop > 0 ? rest.slice(0, stop) : rest;
  const value = slice.replace(/\s+/g, " ").trim().replace(/[,;:]+$/g, "").trim();
  const words = value.split(/\s+/).filter(Boolean);
  const foldedValue = foldTurkish(value);
  if (!value || value.length > 96 || words.length > 12) return null;
  if (LOCATION_VALUE_REJECTS.has(foldedValue)) return null;
  if (!/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(value) && !/^\d{4,10}$/.test(value.replace(/\s+/g, ""))) return null;
  return value;
}

function extractLabeledLocations(source) {
  const folded = foldTurkish(source);
  const pattern = new RegExp(
    `(?:^|[^a-z0-9])(?:${locationLabelPattern(LOCATION_FIELD_LABELS)})(?![a-z0-9])\\s*[:\\-–]\\s*`,
    "gi"
  );
  const values = [];
  let match = pattern.exec(folded);

  while (match) {
    const value = readLabeledLocationValue(source, match.index + match[0].length);
    if (value) values.push(value);
    if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
    match = pattern.exec(folded);
  }

  return values;
}

export function extractLocationCandidates(value) {
  const source = String(value || "");
  const folded = foldTurkish(source);
  const found = [];

  PROVINCES.forEach(([foldedName]) => {
    const city = foldedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const context = new RegExp(
      `\\b(?:sehir|ilce|il|konum|adres|lokasyon|location|city|province|yer)\\b\\s*[:\\-–]\\s*(?:[a-z0-9.'’\\s/-]{0,48})?${city}\\b|\\b${city}\\s+(?:ili|ilinde|merkez|sehri|sehrinde)\\b|\\b(?:in|at)\\s+${city}\\b`,
      "i"
    );
    const match = folded.match(context);
    if (!match) return;
    const cityIndex = folded.indexOf(foldedName, match.index);
    if (cityIndex < 0) return;
    found.push(source.slice(cityIndex, cityIndex + foldedName.length));
  });

  return unique([...extractLabeledLocations(source), ...found]).filter((item, _, list) => (
    !list.some((other) => other !== item && other.includes(item))
  ));
}

function wordCorners(word) {
  const bbox = word?.bbox || word;
  if (!bbox) return null;
  const x0 = Number(bbox.x0 ?? bbox.x);
  const y0 = Number(bbox.y0 ?? bbox.y);
  const x1 = Number.isFinite(Number(bbox.x1))
    ? Number(bbox.x1)
    : x0 + Number(bbox.width);
  const y1 = Number.isFinite(Number(bbox.y1))
    ? Number(bbox.y1)
    : y0 + Number(bbox.height);
  if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) return null;
  return { x0, y0, x1, y1 };
}

function compactLineMap(lineText, keep) {
  const folded = foldTurkish(lineText);
  let text = "";
  const map = [];
  for (let index = 0; index < lineText.length; index += 1) {
    if (lineText[index] === "\n") {
      text += "\n";
      map.push(index);
      continue;
    }
    if (!keep(lineText[index])) continue;
    text += folded[index];
    map.push(index);
  }
  return { text, map };
}

function spanFromMap(map, start, length) {
  if (start < 0 || length <= 0 || start + length > map.length) return null;
  const first = map[start];
  const last = map[start + length - 1];
  return { start: first, length: last - first + 1 };
}

function indexOfOccurrence(haystack, needle, occurrence = 0) {
  if (!haystack || !needle) return -1;
  let from = 0;
  let found = -1;
  const count = Math.max(0, Number(occurrence) || 0);
  for (let index = 0; index <= count; index += 1) {
    found = haystack.indexOf(needle, from);
    if (found < 0) return -1;
    from = found + needle.length;
  }
  return found;
}

function findMatchRange(lineText, matchText, occurrence = 0) {
  const original = String(lineText || "");
  const match = String(matchText || "").trim();
  if (!original || !match) return null;
  const digits = match.replace(/\D/g, "");
  const line = digits.startsWith("0") && digits.length >= 10
    ? rewriteTrunkLetterO(original)
    : original;

  const foldedLine = foldTurkish(line);
  const foldedMatch = foldTurkish(match);
  const direct = indexOfOccurrence(foldedLine, foldedMatch, occurrence);
  if (direct >= 0) return extendTurkishSuffix(line, { start: direct, length: foldedMatch.length });

  const withoutSpaces = compactLineMap(line, (char) => !/\s/.test(char));
  const compactMatch = foldedMatch.replace(/\s+/g, "");
  const compactFound = indexOfOccurrence(withoutSpaces.text, compactMatch, occurrence);
  if (compactFound >= 0) {
    return extendTurkishSuffix(line, spanFromMap(withoutSpaces.map, compactFound, compactMatch.length));
  }

  const withoutSeparators = compactLineMap(line, (char) => !/[\s_-]/.test(char));
  const strippedMatch = compactMatch.replace(/[_-]/g, "");
  const strippedFound = indexOfOccurrence(withoutSeparators.text, strippedMatch, occurrence);
  if (strippedFound >= 0) {
    return extendTurkishSuffix(line, spanFromMap(withoutSeparators.map, strippedFound, strippedMatch.length));
  }

  return null;
}

function ocrLineKey(word) {
  if (Number.isFinite(Number(word?.lineIndex))) return `line:${word.lineIndex}`;
  if (word?.lineId) return `id:${word.lineId}`;
  const corners = wordCorners(word);
  const height = Math.max(1, corners.y1 - corners.y0);
  const center = (corners.y0 + corners.y1) / 2;
  return `y:${Math.round(center / Math.max(6, height * 0.6))}`;
}

export function buildOcrCharacterIndex(words) {
  const valid = (Array.isArray(words) ? words : [])
    .filter((word) => wordCorners(word) && String(word.text ?? "") !== "");
  const groups = new Map();
  valid.forEach((word) => {
    const key = ocrLineKey(word);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(word);
  });
  const lines = [...groups.values()]
    .map((lineWords) => {
      const sorted = [...lineWords].sort((first, second) =>
        wordCorners(first).x0 - wordCorners(second).x0 || wordCorners(first).y0 - wordCorners(second).y0
      );
      return {
        words: sorted,
        y: Math.min(...sorted.map((word) => wordCorners(word).y0)),
      };
    })
    .sort((first, second) => first.y - second.y);

  let text = "";
  const chars = [];
  const spans = [];
  lines.forEach((line, lineNumber) => {
    if (lineNumber > 0) {
      text += "\n";
      chars.push(null);
    }
    line.words.forEach((word, wordIndex) => {
      if (wordIndex > 0) {
        text += " ";
        chars.push(null);
      }
      const corners = wordCorners(word);
      const lineIndex = Number.isFinite(Number(word.lineIndex)) ? Number(word.lineIndex) : lineNumber;
      const entry = {
        word,
        bbox: {
          x0: corners.x0,
          y0: corners.y0,
          x1: corners.x1,
          y1: corners.y1,
          lineIndex,
        },
        lineIndex,
      };
      const start = text.length;
      for (const char of String(word.text)) {
        text += char;
        chars.push(entry);
      }
      spans.push({ start, end: text.length, word, lineIndex });
    });
  });

  return { text, chars, spans };
}

function wordRun(words) {
  const indexed = buildOcrCharacterIndex(words);
  return { text: indexed.text, spans: indexed.spans };
}

function boxFromEntries(entries) {
  const x0 = Math.min(...entries.map((entry) => entry.bbox.x0));
  const y0 = Math.min(...entries.map((entry) => entry.bbox.y0));
  const x1 = Math.max(...entries.map((entry) => entry.bbox.x1));
  const y1 = Math.max(...entries.map((entry) => entry.bbox.y1));
  return { x0, y0, x1, y1, x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * OCR fragment that may be a split tail of a token/URL (not prose punctuation).
 */
function isTokenLikeOcrFragment(text) {
  const raw = String(text || "").trim();
  if (!raw || raw.length > 24) return false;
  if (/[.!?,;"'()[\]{}]/.test(raw)) return false;
  if (!/^[A-Za-z0-9+/_=:.#@~-]+$/.test(raw)) return false;
  if (raw.length <= 3) return true;
  // Longer tails (e.g. :6379) need a digit or URL/base64 punctuation — not plain words like Hello.
  return /[\d+/=@:#]/.test(raw);
}

/**
 * When a match ends at/near an OCR word boundary, optionally include the next
 * same-line word if the gap is within ~1 average character width (split artifact).
 */
function extendMatchedEntriesForOcrSplit(words, matched) {
  if (!matched.length) return matched;
  const extended = matched.slice();
  const seen = new Set(extended.map((entry) => entry.word));
  const byLine = new Map();
  for (const word of words) {
    if (!wordCorners(word)) continue;
    const lineIndex = Number.isFinite(Number(word.lineIndex)) ? Number(word.lineIndex) : 0;
    if (!byLine.has(lineIndex)) byLine.set(lineIndex, []);
    byLine.get(lineIndex).push(word);
  }
  for (const lineWords of byLine.values()) {
    lineWords.sort((a, b) => wordCorners(a).x0 - wordCorners(b).x0);
  }

  let guard = 0;
  while (guard < 8) {
    guard += 1;
    const last = extended[extended.length - 1];
    const lineIndex = last.lineIndex;
    const lineWords = byLine.get(lineIndex) || [];
    const lastPos = lineWords.indexOf(last.word);
    if (lastPos < 0 || lastPos >= lineWords.length - 1) break;
    const next = lineWords[lastPos + 1];
    if (seen.has(next) || !isTokenLikeOcrFragment(next.text)) break;
    const lastBox = wordCorners(last.word);
    const nextBox = wordCorners(next);
    const avgChar = lastBox.width / Math.max(1, String(last.word.text || "").length);
    const gap = nextBox.x0 - lastBox.x1;
    if (!(gap <= avgChar * 1.15 + 0.5)) break;
    const entry = {
      word: next,
      bbox: {
        x0: nextBox.x0,
        y0: nextBox.y0,
        x1: nextBox.x1,
        y1: nextBox.y1,
        lineIndex,
      },
      lineIndex,
    };
    extended.push(entry);
    seen.add(next);
  }
  return extended;
}

/**
 * Returns one bbox for a single-line match, or one bbox per line (array) when the
 * match spans a newline. Cross-line search treats newlines as spaces so indices stay aligned.
 * @param {object} [options]
 * @param {boolean} [options.extendAdjacentToken] — glue tight OCR-split token tails
 */
export function getMatchBoundingBoxes(words, matchText, occurrence = 0, options = {}) {
  if (!Array.isArray(words) || !words.length) return null;
  const indexed = buildOcrCharacterIndex(words);
  // Newlines become spaces (same length) so compact/direct search can span lines.
  const searchText = indexed.text.replace(/\n/g, " ");
  const range = findMatchRange(searchText, matchText, occurrence);
  if (!range) return null;

  const start = range.start;
  const end = Math.min(indexed.chars.length, range.start + range.length);
  let matched = [];
  const seen = new Set();
  for (let index = start; index < end; index += 1) {
    const entry = indexed.chars[index];
    if (!entry || seen.has(entry.word)) continue;
    seen.add(entry.word);
    matched.push(entry);
  }
  if (!matched.length) return null;

  // Span ending inside a word already includes the full word bbox via entry.bbox.
  if (options.extendAdjacentToken) {
    matched = extendMatchedEntriesForOcrSplit(words, matched);
  }

  const coveredText = indexed.text.slice(start, end);
  const spansLines = coveredText.includes("\n")
    || new Set(matched.map((entry) => entry.lineIndex)).size > 1;
  if (!spansLines) {
    const lineIndex = matched[0].lineIndex;
    const kept = matched.filter((entry) => entry.lineIndex === lineIndex);
    return kept.length ? boxFromEntries(kept) : null;
  }

  const byLine = new Map();
  for (const entry of matched) {
    if (!byLine.has(entry.lineIndex)) byLine.set(entry.lineIndex, []);
    byLine.get(entry.lineIndex).push(entry);
  }
  const lineRects = [...byLine.keys()]
    .sort((first, second) => first - second)
    .map((lineIndex) => boxFromEntries(byLine.get(lineIndex)));
  return lineRects.length ? lineRects : null;
}

export function envelopeForMatchedWords(words, matchText, occurrence = 0, options = {}) {
  const boxes = getMatchBoundingBoxes(words, matchText, occurrence, options);
  if (!boxes) return null;
  if (!Array.isArray(boxes)) return boxes;
  return boxFromEntries(boxes.map((box) => ({ bbox: box })));
}

export function normalizeBox(box, imageWidth, imageHeight) {
  const width = Number(imageWidth);
  const height = Number(imageHeight);
  const x = Number(box?.x0 ?? box?.x);
  const y = Number(box?.y0 ?? box?.y);
  const boxWidth = Number.isFinite(Number(box?.x1)) ? Number(box.x1) - x : Number(box?.width);
  const boxHeight = Number.isFinite(Number(box?.y1)) ? Number(box.y1) - y : Number(box?.height);
  if (!(width > 0) || !(height > 0) || ![x, y, boxWidth, boxHeight].every(Number.isFinite)) {
    return null;
  }
  if (boxWidth <= 0 || boxHeight <= 0) return null;

  return {
    normX: x / width,
    normY: y / height,
    normWidth: boxWidth / width,
    normHeight: boxHeight / height,
  };
}

function isLogIdentifier(token) {
  const pieces = String(token || "")
    .split(/[_=+/-]+/)
    .flatMap((part) => part.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/))
    .filter(Boolean);
  if (pieces.length < 3) return false;
  const letters = String(token || "").replace(/[^A-Za-z]/g, "");
  if (!letters) return false;
  const wordLetters = pieces
    .filter((part) => /^[A-Za-z]{4,}$/.test(part))
    .reduce((sum, part) => sum + part.length, 0);
  return wordLetters / letters.length >= 0.75;
}

function extractAwsSecretKeys(value) {
  const matches = String(value || "").match(/(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/g) || [];
  return matches.filter((token) => {
    if (/\s/.test(token) || isLogIdentifier(token)) return false;
    const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(token)).length;
    return kinds >= 3;
  });
}

function attachOcrSplitTokenTail(source, token) {
  const text = String(source || "");
  const base = String(token || "");
  if (!text || !base) return base;
  let from = 0;
  while (from <= text.length) {
    const at = text.indexOf(base, from);
    if (at < 0) break;
    const after = text.slice(at + base.length);
    const glued = after.match(/^ ([A-Za-z0-9+/_=:.-]{1,12})(?![A-Za-z0-9+/_=:.-])/);
    if (glued && isTokenLikeOcrFragment(glued[1])) {
      // Compact form so acceptApiToken keeps it; boxing uses space-insensitive match.
      return `${base}${glued[1]}`;
    }
    from = at + 1;
  }
  return base;
}

function extractHighEntropyTokens(value) {
  const source = String(value || "");
  const matches = source.match(/\b[A-Za-z0-9+/_=-]{40,}\b/g) || [];
  return matches
    .filter((token) => {
      if (/\s/.test(token)) return false;
      const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(token)).length;
      return kinds >= 3 && !/^[A-Za-z]+$/.test(token) && !isLogIdentifier(token);
    })
    .map((token) => attachOcrSplitTokenTail(source, token));
}

export function passesLuhn(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alternate = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (alternate) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function asDetection(text, type, confidence, bbox) {
  const detection = { text: String(text), type, confidence };
  if (bbox) detection.bbox = bbox;
  return detection;
}

export function detectTCKN(value, bbox) {
  return findTcknMatches(value).map((match) => asDetection(
    match.text,
    "tckn",
    match.confidence,
    match.padding ? padBoundingBox(bbox, match.padding) : bbox
  ));
}

export function padBoundingBox(box, padding = 2) {
  const pad = Number(padding);
  if (!box || !(pad > 0)) return box || null;
  const x0 = Number(box.x0 ?? box.x) - pad;
  const y0 = Number(box.y0 ?? box.y) - pad;
  const x1 = (Number.isFinite(Number(box.x1)) ? Number(box.x1) : Number(box.x) + Number(box.width)) + pad;
  const y1 = (Number.isFinite(Number(box.y1)) ? Number(box.y1) : Number(box.y) + Number(box.height)) + pad;
  if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) return box;
  return { x0, y0, x1, y1, x: x0, y: y0, width: x1 - x0, height: y1 - y0, w: x1 - x0, h: y1 - y0 };
}

export function extractEmailCandidates(value) {
  const matches = String(value || "").match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  return unique(matches.map((email) => String(email).replace(/[.,;:!?)]+$/g, "")).filter(Boolean));
}

export function detectEmail(value, bbox) {
  return extractEmailCandidates(value).map((text) => asDetection(text, "email", 0.9, bbox));
}

export function detectPhone(value, bbox) {
  return extractPhoneCandidates(value).map((text) => asDetection(text, "phone", 0.86, bbox));
}

const VKN_TOKEN = /(?<![0-9OoIl|SsBb])[0-9OoIl|SsBb]{10}(?![0-9OoIl|SsBb])/g;
export const VKN_UNLABELED_CHECKSUM_WARNING = "unlabeled 10-digit number, checksum failed";
export const CUSTOM_ID_REVIEW_WARNING = "possible ID, verify";

function correctVknGlyph(char) {
  if (/[Oo]/.test(char)) return "0";
  if (/[Il|]/.test(char)) return "1";
  if (/[Ss]/.test(char)) return "5";
  if (/[Bb]/.test(char)) return "8";
  return char;
}

function vknLabelPrecedes(source, index) {
  const before = foldTurkish(String(source || "").slice(Math.max(0, index - 48), index));
  return /(?:^|[^a-z])vergi(?:\s*no)?\b|\bvkn\b/.test(before);
}

function singleGlyphVknRepair(raw) {
  let changes = 0;
  let repaired = "";
  for (const char of String(raw || "")) {
    const next = correctVknGlyph(char);
    if (next !== char) changes += 1;
    repaired += next;
  }
  if (changes !== 1 || !isValidVkn(repaired)) return "";
  return repaired;
}

function reviewOnlyVkn(text) {
  return { text, needsReview: true, warning: VKN_UNLABELED_CHECKSUM_WARNING };
}

export function extractVknCandidates(value) {
  const source = String(value || "");
  const kept = [];
  const review = [];
  for (const found of source.matchAll(VKN_TOKEN)) {
    const raw = found[0];
    if (/^\d{10}$/.test(raw) && isValidVkn(raw)) {
      kept.push(raw);
      continue;
    }
    if (vknLabelPrecedes(source, found.index)) {
      const labeled = /^\d{10}$/.test(raw) ? raw : [...raw].map(correctVknGlyph).join("");
      if (/^\d{10}$/.test(labeled)) kept.push(labeled);
      continue;
    }
    const repaired = singleGlyphVknRepair(raw);
    if (repaired) {
      kept.push(repaired);
      continue;
    }
    const digits = [...raw].map(correctVknGlyph).join("");
    review.push(reviewOnlyVkn(/^\d{10}$/.test(raw) ? raw : digits));
  }
  return [...unique(kept), ...review];
}

export function detectVkn(value, bbox) {
  return extractVknCandidates(value).map((candidate) => {
    const text = typeof candidate === "string" ? candidate : candidate.text;
    const needsReview = Boolean(candidate && typeof candidate === "object" && candidate.needsReview);
    const detection = asDetection(text, "vkn", needsReview ? 0.4 : 0.9, bbox);
    if (needsReview) {
      detection.review = buildDetectionReview({
        type: "vkn",
        text,
        vknUnlabeledChecksumFailed: true,
      });
    }
    return detection;
  });
}

export function detectIPv4(value, bbox) {
  const matches = String(value || "").match(/(?<!\d)(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?::[0-9]{1,5})?(?!\d)/g) || [];
  return unique(matches).filter((ip) => {
    const [address, port] = ip.split(":");
    if (!address.split(".").every((part) => Number(part) <= 255)) return false;
    if (port === undefined) return true;
    const portNumber = Number(port);
    return portNumber >= 1 && portNumber <= 65535;
  }).map((text) => asDetection(text, "ipv4", 0.8, bbox));
}

const IPV6_HEXTET = "[0-9a-f]{1,4}";
const IPV6_FULL = `(?:${IPV6_HEXTET}:){7}${IPV6_HEXTET}`;
const IPV6_COMPRESSED = `(?:${IPV6_HEXTET}(?::${IPV6_HEXTET}){0,6})?::(?:${IPV6_HEXTET}(?::${IPV6_HEXTET}){0,6})?`;
const IPV6_PORT = ":\\d{1,5}";
export const IPV6_PATTERN_SOURCE = `(?<![0-9a-f:])(?:\\[(?:${IPV6_FULL}|${IPV6_COMPRESSED})\\]${IPV6_PORT}|${IPV6_FULL}(?:${IPV6_PORT})?|${IPV6_COMPRESSED})(?![0-9a-f:])`;

function isIpv6Hextet(value) {
  return /^[0-9a-f]{1,4}$/i.test(value);
}

function isIpv6Body(body) {
  if (!body || !/^[0-9a-f:]+$/i.test(body) || body.includes(":::")) return false;
  const halves = body.split("::");
  if (halves.length > 2) return false;
  const groups = (half) => (half === "" ? [] : half.split(":"));
  if (halves.length === 1) {
    const parts = groups(body);
    return parts.length === 8 && parts.every(isIpv6Hextet);
  }
  const left = groups(halves[0]);
  const right = groups(halves[1]);
  if (!left.length && !right.length) return false;
  if (left.length + right.length >= 8) return false;
  return left.every(isIpv6Hextet) && right.every(isIpv6Hextet);
}

function isValidIpv6Token(token) {
  const text = String(token || "").trim();
  const bracket = text.match(/^\[([0-9a-f:]+)\]:(\d{1,5})$/i);
  if (bracket) {
    const port = Number(bracket[2]);
    return isIpv6Body(bracket[1]) && port >= 1 && port <= 65535;
  }
  if (isIpv6Body(text)) return true;
  const plainPort = text.match(/^(.*):(\d{1,5})$/);
  if (!plainPort) return false;
  const port = Number(plainPort[2]);
  return isIpv6Body(plainPort[1]) && port >= 1 && port <= 65535;
}

export function extractIpv6Candidates(value) {
  const matches = String(value || "").match(new RegExp(IPV6_PATTERN_SOURCE, "gi")) || [];
  return unique(matches.filter(isValidIpv6Token));
}

function isIpv6Fragment(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 80) return false;
  if (/^[0-9a-f]{1,4}$/i.test(text) || /^:+$/.test(text)) return true;
  if (/^:[0-9a-f]{1,4}$/i.test(text) || /^\]:\d{1,5}$/.test(text)) return true;
  if (/^(?:\[?(?:[0-9a-f]{1,4}:){1,7}[0-9a-f]{0,4}\]?(?::\d{1,5})?)$/i.test(text)) return true;
  return /^\[?[0-9a-f:]*::[0-9a-f:]*\]?(?::\d{1,5})?$/i.test(text) && /[0-9a-f]/i.test(text);
}

function joinIpv6Fragments(parts) {
  return parts.reduce((joined, part) => {
    if (!joined) return part;
    if (/:$/.test(joined) || /^:/.test(part)) return joined + part;
    return `${joined}:${part}`;
  }, "");
}

function ipv6WordsAdjacent(first, second) {
  const firstBox = wordCorners(first);
  const secondBox = wordCorners(second);
  if (!firstBox || !secondBox) return false;
  const height = Math.max(firstBox.y1 - firstBox.y0, secondBox.y1 - secondBox.y0, 1);
  const firstCenter = (firstBox.y0 + firstBox.y1) / 2;
  const secondCenter = (secondBox.y0 + secondBox.y1) / 2;
  const gap = secondBox.x0 - firstBox.x1;
  return Math.abs(firstCenter - secondCenter) <= Math.max(5, height * 0.6) &&
    gap >= -height * 0.2 &&
    gap <= Math.max(20, height * 2.2);
}

function unionWordBox(words) {
  const corners = words.map(wordCorners).filter(Boolean);
  if (!corners.length) return null;
  const x0 = Math.min(...corners.map((corner) => corner.x0));
  const y0 = Math.min(...corners.map((corner) => corner.y0));
  const x1 = Math.max(...corners.map((corner) => corner.x1));
  const y1 = Math.max(...corners.map((corner) => corner.y1));
  return { x0, y0, x1, y1, x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function mergeIpv6OcrWords(words) {
  const valid = (Array.isArray(words) ? words : []).filter((word) => wordCorners(word) && String(word.text || "").trim());
  const matches = [];
  groupPhoneWords(valid).forEach((lineWords) => {
    const sorted = [...lineWords].sort((first, second) => wordCorners(first).x0 - wordCorners(second).x0);
    let index = 0;
    while (index < sorted.length) {
      if (!isIpv6Fragment(sorted[index].text)) {
        index += 1;
        continue;
      }
      let end = index + 1;
      while (end < sorted.length && isIpv6Fragment(sorted[end].text) && ipv6WordsAdjacent(sorted[end - 1], sorted[end])) {
        end += 1;
      }
      const run = sorted.slice(index, end);
      let chosen = null;
      for (let sliceEnd = run.length; sliceEnd > 0; sliceEnd -= 1) {
        const slice = run.slice(0, sliceEnd);
        const text = joinIpv6Fragments(slice.map((word) => String(word.text).trim()));
        const found = extractIpv6Candidates(text);
        if (found.length === 1 && found[0].toLowerCase() === text.toLowerCase()) {
          chosen = { text: found[0], words: slice, bbox: unionWordBox(slice) };
          break;
        }
      }
      if (!chosen) {
        index += 1;
        continue;
      }
      matches.push(chosen);
      index += chosen.words.length;
    }
  });
  return matches;
}

export function detectIPv6(value, bbox) {
  return extractIpv6Candidates(value).map((text) => asDetection(text, "ipv6", 0.8, bbox));
}

export function detectIpv6InScan(words, imageWidth, imageHeight) {
  const width = Number(imageWidth);
  const height = Number(imageHeight);
  if (!(width > 0) || !(height > 0)) return [];
  return mergeIpv6OcrWords(words).flatMap((match) => {
    const normalized = match.bbox ? normalizeBox(match.bbox, width, height) : null;
    if (!normalized) return [];
    const normX = Math.min(1, Math.max(0, normalized.normX));
    const normY = Math.min(1, Math.max(0, normalized.normY));
    const normWidth = Math.min(Math.max(0, normalized.normWidth), 1 - normX);
    const normHeight = Math.min(Math.max(0, normalized.normHeight), 1 - normY);
    if (normWidth <= 0 || normHeight <= 0) return [];
    const confidence = Math.min(...match.words.map((word) => Number(word.confidence || 0)));
    return [{
      type: "ipv6",
      label: "Possible IPv6 address",
      text: match.text,
      confidence,
      normX,
      normY,
      normWidth,
      normHeight,
      review: buildDetectionReview({ type: "ipv6", text: match.text, confidence }),
    }];
  });
}

function isRepeatedDigitCard(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return /^(\d)\1{12,18}$/.test(digits);
}

const CARD_CANDIDATE = /(?<!\d)(?:\d[ \t-]?){12,18}\d(?!\d)/g;

export function extractCreditCardCandidates(value) {
  const matches = String(value || "").match(CARD_CANDIDATE) || [];
  return unique(matches.map((match) => match.replace(/[ \t-]+$/g, "")).filter((match) => {
    const digits = match.replace(/\D/g, "");
    return digits.length >= 13 && digits.length <= 19 && passesLuhn(match) && !isRepeatedDigitCard(match);
  }));
}

export function detectCreditCard(value, bbox) {
  return extractCreditCardCandidates(value).map((text) => asDetection(text, "credit_card", 0.93, bbox));
}

/** Common English stopwords — windows dominated by these are almost never seed phrases. */
const SEED_PHRASE_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "than", "that", "this", "these", "those",
  "to", "of", "in", "on", "for", "with", "as", "at", "by", "from", "into", "over", "under",
  "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
  "will", "would", "could", "should", "may", "might", "must", "can", "shall",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
  "my", "your", "his", "its", "our", "their", "not", "no", "yes", "so", "very", "just",
  "about", "above", "after", "again", "all", "also", "any", "because", "before", "between",
  "both", "each", "few", "more", "most", "other", "some", "such", "only", "own", "same",
  "too", "up", "down", "out", "off", "here", "there", "when", "where", "why", "how",
  "what", "which", "who", "whom", "while", "during", "through", "until", "once",
]);

/**
 * 12 or 24 consecutive lowercase BIP39 English words (review-only).
 * Rejects ordinary prose via wordlist membership + stopword density checks.
 */
export function extractSeedPhraseMatches(value) {
  const source = String(value || "");
  if (!source.trim()) return [];
  if (!BIP39_ENGLISH_SET || BIP39_ENGLISH_SET.size < 1000) return [];

  const tokens = source.trim().split(/\s+/);
  const matches = [];
  for (const count of [24, 12]) {
    for (let index = 0; index + count <= tokens.length; index += 1) {
      const slice = tokens.slice(index, index + count);
      if (!slice.every((word) => /^[a-z]+$/.test(word))) continue;
      const avg = slice.reduce((sum, word) => sum + word.length, 0) / slice.length;
      if (avg < 3) continue;

      // Require every token to be an official BIP39 English word.
      if (!slice.every((word) => BIP39_ENGLISH_SET.has(word))) continue;

      const stopCount = slice.filter((word) => SEED_PHRASE_STOPWORDS.has(word)).length;
      // Real seed phrases rarely cluster this many function words.
      if (stopCount > Math.floor(count * 0.35)) continue;

      const unique = new Set(slice).size;
      if (unique < Math.ceil(count * 0.75)) continue;

      const text = slice.join(" ");
      const occurrence = matches.filter((item) => item.span === text).length;
      matches.push({
        text,
        span: text,
        needsReview: true,
        ...(occurrence > 0 ? { occurrence } : {}),
      });
      break;
    }
    if (matches.length) break;
  }
  return matches;
}

/**
 * Cross-line seed phrases via buildCrossLineWindows (single-line hits stay on the
 * structured-lines per-line extract path). Emits one match per line fragment.
 * Always needsReview. Overlapping shorter single-line hits should be deduped by callers
 * preferring the longer multi-line text when both exist.
 */
export function findSeedPhraseMatchesFromLines(lines) {
  const list = Array.isArray(lines) ? lines : [];
  const results = [];
  const seenKeys = new Set();

  for (const window of buildCrossLineWindows(list)) {
    const matches = extractSeedPhraseMatches(window.text);
    for (const match of matches) {
      const span = match.span || match.text;
      const start = window.text.indexOf(span);
      if (start < 0) continue;
      const words = wordsForJoinedRange(window, start, start + span.length);
      const lineIds = new Set(words.map((word) => Number(word.lineIndex)));
      // Only multi-line spans (dedupe vs single-line extractSeedPhraseMatches).
      if (lineIds.size < 2) continue;
      const groups = groupWordsByLine(words);
      for (const group of groups) {
        const boxText = group.words.map((word) => String(word.text || "")).join(" ");
        const key = `${group.lineIndex}:${match.text}:${boxText}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        results.push({
          text: match.text,
          span: boxText,
          boxText,
          words: group.words,
          confidence: 88,
          lineIndex: group.lineIndex,
          needsReview: true,
        });
      }
    }
  }

  return results;
}

const PASSPORT_LABEL_PATTERN = /\b(?:Pasaport|Passport)(?:\s*No\.?)?\s*:?/i;
const PASSPORT_ID_PATTERN = /\b([A-Z0-9]{5,9})\b/i;

/**
 * Labeled passport / pasaport numbers (5–9 alphanumeric).
 * Auto-apply only when a Passport/Pasaport label is present on the same line.
 */
export function extractPassportMatches(value) {
  const source = String(value || "");
  if (!source) return [];
  const label = source.match(PASSPORT_LABEL_PATTERN);
  if (!label) return [];
  const afterLabel = source.slice(label.index + label[0].length);
  const idMatch = afterLabel.match(PASSPORT_ID_PATTERN);
  if (!idMatch) return [];
  const text = idMatch[1].toUpperCase();
  if (!/^[A-Z0-9]{5,9}$/.test(text)) return [];
  // Prefer the original-case span for boxing when possible.
  const span = idMatch[1];
  return [{
    text,
    span,
    labeled: true,
    needsReview: false,
  }];
}

const ENV_SECRET_KEY_PATTERN =
  /(?:SECRET|TOKEN|PASSWORD|PASSWD|PWD|API_KEY|PRIVATE_KEY|ACCESS_KEY|CLIENT_SECRET)/i;
const ENV_SECRET_LINE_PATTERN =
  /\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;

/**
 * .env-style KEY=value where the key name looks sensitive.
 * Returns value-only spans (box the secret, not the key name).
 * Auto-apply when value length >= 8; shorter non-empty values are review-only.
 */
export function extractEnvSecretMatches(value) {
  const source = String(value || "");
  if (!source) return [];
  const matches = [];
  const pattern = new RegExp(ENV_SECRET_LINE_PATTERN.source, "g");
  let found;
  while ((found = pattern.exec(source)) !== null) {
    const key = found[1];
    if (!ENV_SECRET_KEY_PATTERN.test(key)) continue;
    const rawValue = found[2] ?? found[3] ?? found[4] ?? "";
    if (!String(rawValue).length) continue;
    const text = String(rawValue);
    const span = text;
    const occurrence = matches.filter((item) => item.span === span).length;
    matches.push({
      text,
      span,
      key,
      needsReview: text.length < 8,
      ...(occurrence > 0 ? { occurrence } : {}),
    });
  }
  return matches;
}

const BEARER_TOKEN_BODY = /[A-Za-z0-9._~+/=-]{16,}/;
const BEARER_TOKEN_PATTERN = /\b(?:Authorization\s*:\s*)?Bearer\s+([A-Za-z0-9._~+/=-]{16,})/gi;

/**
 * Match "Authorization: Bearer <token>" or "Bearer <token>".
 * Returns spans that cover "Bearer <token>" (not the Authorization: prefix).
 */
export function extractBearerTokenMatches(value) {
  const source = String(value || "");
  if (!source) return [];
  const matches = [];
  const pattern = new RegExp(BEARER_TOKEN_PATTERN.source, "gi");
  let found;
  while ((found = pattern.exec(source)) !== null) {
    const token = found[1];
    if (!BEARER_TOKEN_BODY.test(token)) continue;
    const full = found[0];
    const bearerOffset = full.search(/Bearer\s+/i);
    const span = bearerOffset >= 0 ? full.slice(bearerOffset) : `Bearer ${token}`;
    const text = `Bearer ${token}`;
    const occurrence = matches.filter((item) => item.span === span).length;
    matches.push({
      text,
      span,
      ...(occurrence > 0 ? { occurrence } : {}),
    });
  }
  return matches;
}

const BEARER_LINE_WRAP_TAIL =
  /\bBearer(?:\s+([A-Za-z0-9._~+/=-]+))?\s*$/i;
const BEARER_LINE_WRAP_CONTINUE =
  /^[A-Za-z0-9._~+/=-]{4,}(?:\s*$|\b)/;

/**
 * Cross-line Bearer tokens. Line joining is decided only by buildCrossLineWindows;
 * this function applies Bearer wrap domain rules on those windows.
 * Returns one match per line fragment so boxing yields one rect per line.
 */
export function findBearerTokenMatchesFromLines(lines) {
  const list = Array.isArray(lines) ? lines : [];
  const matches = [];
  for (const window of buildCrossLineWindows(list, { maxLines: 2 })) {
    if (window.lines.length < 2) continue;
    const first = window.lines[0];
    const second = window.lines[1];
    const index = window.lineIndexes[0];
    const firstText = String(first?.text || "");
    const secondText = String(second?.text || "");
    if (!firstText || !secondText) continue;
    // Already a complete same-line Bearer — skip wrap.
    if (extractBearerTokenMatches(firstText).length) continue;

    const tail = firstText.match(BEARER_LINE_WRAP_TAIL);
    if (!tail) continue;
    const prefix = tail[1] || "";
    // Reject prose like "Bearer of …" (space-separated words after Bearer before EOL).
    const afterBearer = firstText.slice(firstText.toLowerCase().lastIndexOf("bearer") + 6);
    if (/\s+\S+\s+\S+/.test(afterBearer.trimStart())) continue;

    const contMatch = secondText.match(BEARER_LINE_WRAP_CONTINUE);
    if (!contMatch) continue;
    const continuation = contMatch[0].trim();
    // Continuation line must be token-like (no multi-word prose).
    if (/\s/.test(continuation)) continue;
    const token = `${prefix}${continuation}`;
    if (!BEARER_TOKEN_BODY.test(token)) continue;

    const text = `Bearer ${token}`;
    const firstSpan = prefix ? `Bearer ${prefix}` : "Bearer";
    const firstWords = Array.isArray(first?.words) ? first.words : [];
    const secondWords = Array.isArray(second?.words) ? second.words : [];
    matches.push({
      text,
      span: firstSpan,
      boxText: firstSpan,
      words: firstWords,
      confidence: Number(first?.confidence) || 90,
      lineIndex: Number.isFinite(Number(first?.lineIndex)) ? Number(first.lineIndex) : index,
    });
    matches.push({
      text,
      span: continuation,
      boxText: continuation,
      words: secondWords,
      confidence: Number(second?.confidence) || 90,
      lineIndex: Number.isFinite(Number(second?.lineIndex))
        ? Number(second.lineIndex)
        : window.lineIndexes[1],
    });
  }
  return matches;
}

// Dashes 3–6, optional spaces, OCR O/0 I/l; requires PRIVATE KEY and/or RSA|EC|OPENSSH|ENCRYPTED|PRIVATE|KEY tokens.
const PRIVATE_KEY_HEADER =
  /-{3,6}\s*B[E0]G[I1L]N(?:[ \t]+(?:RSA|EC|OPENSSH|ENCRYPTED|PRIVATE|KEY))+\s*-{0,6}/gi;
const PRIVATE_KEY_END =
  /-{3,6}\s*END(?:[ \t]+(?:RSA|EC|OPENSSH|ENCRYPTED|PRIVATE|KEY))+\s*-{0,6}/i;
const PRIVATE_KEY_MAX_FOLLOWING_LINES = 40;

function looksLikePublicPemHeader(text) {
  return /CERTIFICATE|(?:^|[^A-Z])PUBLIC[ \t]+KEY/i.test(String(text || ""));
}

function isPemBase64BodyLine(text) {
  const compact = String(text || "").replace(/\s+/g, "");
  if (compact.length < 20) return false;
  if (/^-{3,}/.test(compact)) return false;
  return /^[A-Za-z0-9+/=]+$/.test(compact);
}

function isBrokenPrivateKeyHeaderLine(text) {
  const raw = String(text || "");
  if (!raw.trim() || looksLikePublicPemHeader(raw)) return false;
  const folded = raw
    .toUpperCase()
    .replace(/0/g, "O")
    .replace(/1/g, "I");
  return /\bBEGIN\b/.test(folded)
    || /\bPRIVATE\b/.test(folded)
    || /\bKEY\b/.test(folded);
}

/**
 * Extract PEM private-key blocks from line-oriented text.
 * Matches BEGIN … PRIVATE KEY through END … PRIVATE KEY, or up to 40 following lines.
 * Public CERTIFICATE / PUBLIC KEY blocks are ignored.
 */
export function extractPrivateKeyBlocks(value) {
  const source = String(value || "");
  if (!source) return [];
  const blocks = [];
  const headerRe = new RegExp(PRIVATE_KEY_HEADER.source, "gi");
  let match;
  while ((match = headerRe.exec(source)) !== null) {
    if (looksLikePublicPemHeader(match[0])) {
      headerRe.lastIndex = match.index + match[0].length;
      continue;
    }
    const start = match.index;
    const afterHeader = start + match[0].length;
    const rest = source.slice(afterHeader);
    const endMatch = rest.match(PRIVATE_KEY_END);
    let end;
    if (endMatch) {
      end = afterHeader + endMatch.index + endMatch[0].length;
    } else {
      const fromStart = source.slice(start);
      const lines = fromStart.split(/\n/);
      const taken = lines.slice(0, PRIVATE_KEY_MAX_FOLLOWING_LINES + 1).join("\n");
      end = start + taken.length;
    }
    const block = source.slice(start, end).replace(/\s+$/g, "");
    if (block) blocks.push(block);
    headerRe.lastIndex = Math.max(headerRe.lastIndex, start + match[0].length);
  }
  return unique(blocks);
}

function wordsOverlappingEnvelope(words, envelope) {
  if (!envelope) return [];
  const matched = [];
  for (const word of words) {
    const corners = wordCorners(word);
    if (!corners) continue;
    const overlaps = !(
      corners.x1 < envelope.x0
      || corners.x0 > envelope.x1
      || corners.y1 < envelope.y0
      || corners.y0 > envelope.y1
    );
    if (overlaps) matched.push(word);
  }
  return matched;
}

/**
 * Fallback when BEGIN is unreadable: a line with BEGIN/PRIVATE/KEY (not CERTIFICATE/PUBLIC KEY)
 * followed by 2+ consecutive base64 body lines (≥20 chars), until END or 40 lines.
 */
function findPrivateKeyFallbackMatchesFromLines(lines) {
  const list = Array.isArray(lines) ? lines : [];
  const matches = [];
  for (let index = 0; index < list.length; index += 1) {
    const headerLine = list[index];
    if (!isBrokenPrivateKeyHeaderLine(headerLine?.text)) continue;
    const bodyLines = [];
    let endIndex = -1;
    const limit = Math.min(list.length, index + 1 + PRIVATE_KEY_MAX_FOLLOWING_LINES);
    for (let cursor = index + 1; cursor < limit; cursor += 1) {
      const line = list[cursor];
      const text = String(line?.text || "");
      if (/-{3,6}\s*END/i.test(text)) {
        endIndex = cursor;
        break;
      }
      if (isPemBase64BodyLine(text)) {
        bodyLines.push(line);
        continue;
      }
      if (bodyLines.length >= 2) break;
      // Non-body before collecting 2 lines cancels this header candidate.
      bodyLines.length = 0;
      break;
    }
    if (bodyLines.length < 2) continue;
    const blockLines = list.slice(
      index,
      (endIndex >= 0 ? endIndex + 1 : index + 1 + bodyLines.length)
    );
    const text = blockLines.map((line) => String(line?.text || "")).join("\n");
    const bodyWords = bodyLines.flatMap((line) => (Array.isArray(line?.words) ? line.words : []));
    const headerWords = Array.isArray(headerLine?.words) ? headerLine.words : [];
    const endWords = endIndex >= 0 && Array.isArray(list[endIndex]?.words)
      ? list[endIndex].words
      : [];
    matches.push({
      text,
      boxText: text.replace(/\n/g, " "),
      words: [...headerWords, ...bodyWords, ...endWords],
      confidence: 92,
      lineIndex: Number.isFinite(Number(headerLine?.lineIndex)) ? Number(headerLine.lineIndex) : index,
    });
  }
  return matches;
}

/**
 * Map PEM blocks in OCR lines to word runs for bounding boxes.
 */
export function findPrivateKeyMatchesFromLines(lines) {
  const list = Array.isArray(lines) ? lines : [];
  const words = list.flatMap((line) => (Array.isArray(line?.words) ? line.words : []));
  if (!words.length) {
    const joined = list.map((line) => String(line?.text || "")).join("\n");
    return extractPrivateKeyBlocks(joined).map((text) => ({
      text,
      boxText: text.replace(/\n/g, " "),
      words: [],
      confidence: 90,
      lineIndex: 0,
    }));
  }
  const indexed = buildOcrCharacterIndex(words);
  const blocks = extractPrivateKeyBlocks(indexed.text);
  const fromHeaders = blocks.map((text) => {
    const boxText = text.replace(/\n/g, " ");
    const boxes = getMatchBoundingBoxes(words, boxText, 0, { extendAdjacentToken: true });
    let matchedWords = [];
    if (boxes) {
      const envelope = Array.isArray(boxes) ? boxFromEntries(boxes.map((box) => ({ bbox: box }))) : boxes;
      matchedWords = wordsOverlappingEnvelope(words, envelope);
    }
    const lineIndex = Number.isFinite(Number(matchedWords[0]?.lineIndex))
      ? Number(matchedWords[0].lineIndex)
      : 0;
    return {
      text,
      boxText,
      words: matchedWords.length ? matchedWords : words,
      confidence: 95,
      lineIndex,
    };
  }).filter((match) => match.text);

  if (fromHeaders.length) return fromHeaders;
  return findPrivateKeyFallbackMatchesFromLines(list);
}

export function extractIbanCandidates(value) {
  const source = String(value || "");
  const normal = new RegExp(TURKISH_IBAN_PATTERN, "g");
  const ocrBroken = new RegExp(OCR_IBAN_CANDIDATE_PATTERN, "g");
  const found = [
    ...(source.match(normal) || []),
    ...(source.match(ocrBroken) || []),
  ].map((match) => match.trim()).filter(Boolean);

  return unique(found.filter((match) => {
    if (isValidIban(match).structureValid) return true;
    return Boolean(repairIbanCountryCode(match));
  }));
}

/**
 * Join a trailing partial IBAN on line N with a digit-leading continuation on line N+1
 * when the joined compact value is structure-valid for that country.
 * Line joining is decided only by buildCrossLineWindows.
 */
export function findCrossLineIbanMatches(lines) {
  const list = Array.isArray(lines) ? lines : [];
  const matches = [];
  for (const window of buildCrossLineWindows(list, { maxLines: 2 })) {
    if (window.lines.length < 2) continue;
    const current = window.lines[0];
    const next = window.lines[1];
    const index = window.lineIndexes[0];
    const currentText = String(current?.text || "");
    const nextText = String(next?.text || "");
    const prefixMatch = currentText.match(/([A-Za-z]{2}\d{2}(?:[\s-]*[A-Za-z0-9]+)*)\s*$/);
    if (!prefixMatch) continue;
    const prefix = prefixMatch[1];
    const compactPrefix = compactIban(prefix);
    const country = compactPrefix.slice(0, 2);
    const expected = IBAN_COUNTRY_LENGTHS[country];
    if (!expected || compactPrefix.length >= expected) continue;
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]*$/.test(compactPrefix)) continue;

    const suffixMatch = nextText.match(/^\s*(\d[\dA-Za-z\s-]*)/);
    if (!suffixMatch) continue;

    let suffixCompact = "";
    let suffixDisplay = "";
    for (const char of suffixMatch[1]) {
      if (/[\s-]/.test(char)) {
        if (suffixCompact.length) suffixDisplay += char === "-" ? "-" : " ";
        continue;
      }
      if (!/[A-Za-z0-9]/.test(char)) break;
      if (compactPrefix.length + suffixCompact.length >= expected) break;
      suffixCompact += char.toUpperCase();
      suffixDisplay += char;
    }
    if (!suffixCompact) continue;

    const joinedCompact = compactPrefix + suffixCompact;
    if (!isValidIban(joinedCompact).structureValid) continue;

    const joinedText = `${prefix.trim()} ${suffixDisplay.trim()}`.replace(/\s+/g, " ");
    const words = [
      ...(Array.isArray(current?.words) ? current.words : []),
      ...(Array.isArray(next?.words) ? next.words : []),
    ];
    matches.push({
      text: joinedText,
      boxText: joinedText,
      words,
      lineIndex: Number.isFinite(Number(current?.lineIndex)) ? Number(current.lineIndex) : index,
      confidence: Math.min(Number(current?.confidence || 0), Number(next?.confidence || 0)),
      prefixCompact: compactPrefix,
      joinedCompact,
    });
  }
  return matches;
}

function groupedSecretHit(parts) {
  const spaced = parts.map((word) => String(word.text).trim()).join(" ");
  const compact = parts.map((word) => String(word.text).trim()).join("");
  const iban = extractIbanCandidates(spaced).find((item) => item === spaced);
  if (iban) return { type: "custom_rule", label: "Possible IBAN", text: iban, ruleId: "iban" };
  const card = extractCreditCardCandidates(spaced).find((item) => item === spaced);
  if (card) return { type: "credit_card", label: "Possible card number", text: card };
  const email = extractEmailCandidates(compact).find((item) => item === compact);
  if (email) return { type: "email", label: "Possible email", text: email };
  const tcknPieces = parts.every((word) => /^[0-9OoIl|SsBb]+$/.test(String(word.text).trim()));
  const tckn = tcknPieces ? findTcknMatches(compact).find((item) => correctTcknOcr(compact) === item.text) : null;
  if (tckn) return { type: "tckn", label: "Turkish ID Number", text: tckn.text };
  return null;
}

export function mergeGroupedOcrWords(words) {
  const valid = (Array.isArray(words) ? words : []).filter((word) => wordCorners(word) && String(word.text || "").trim());
  const matches = [];
  groupPhoneWords(valid).forEach((lineWords) => {
    const sorted = [...lineWords].sort((first, second) => wordCorners(first).x0 - wordCorners(second).x0);
    let index = 0;
    while (index < sorted.length) {
      let best = null;
      const parts = [];
      for (let end = index; end < sorted.length && end - index < 12; end += 1) {
        if (end > index && !ipv6WordsAdjacent(sorted[end - 1], sorted[end])) break;
        parts.push(sorted[end]);
        if (parts.length < 2) continue;
        const hit = groupedSecretHit(parts);
        if (hit) best = { ...hit, words: parts.slice(), bbox: unionWordBox(parts) };
      }
      if (!best) {
        index += 1;
        continue;
      }
      matches.push(best);
      index += best.words.length;
    }
  });
  return matches;
}

export function detectGroupedSecretsInScan(words, imageWidth, imageHeight) {
  const width = Number(imageWidth);
  const height = Number(imageHeight);
  if (!(width > 0) || !(height > 0)) return [];
  return mergeGroupedOcrWords(words).flatMap((match) => {
    const isIban = match.ruleId === "iban";
    const ibanContext = match.words?.map((word) => String(word.text || "")).join(" ") || match.text;
    const ibanHints = isIban ? ibanReviewHints(match.text, ibanContext) : null;
    const text = ibanHints?.text || match.text;
    const normalized = match.bbox ? normalizeBox(match.bbox, width, height) : null;
    if (!normalized) return [];
    const normX = Math.min(1, Math.max(0, normalized.normX));
    const normY = Math.min(1, Math.max(0, normalized.normY));
    const normWidth = Math.min(Math.max(0, normalized.normWidth), 1 - normX);
    const normHeight = Math.min(Math.max(0, normalized.normHeight), 1 - normY);
    if (normWidth <= 0 || normHeight <= 0) return [];
    const confidence = Math.min(...match.words.map((word) => Number(word.confidence || 0)));
    const lineIndex = Number.isFinite(Number(match.words[0]?.lineIndex))
      ? Number(match.words[0].lineIndex)
      : Math.round(normY * 10000);
    const boxY0 = Math.round(match.bbox.y0);
    const boxX0 = Math.round(match.bbox.x0);
    const reviewHints = isIban
      ? {
          ibanPatternOnly: Boolean(ibanHints.ibanPatternOnly),
          ibanChecksumValid: Boolean(ibanHints.ibanChecksumValid),
          ibanChecksumFailed: Boolean(ibanHints.ibanChecksumFailed),
          ocrCorrected: Boolean(ibanHints.ocrCorrected),
        }
      : {};
    return [{
      id: `detection-${match.type}-line${lineIndex}-y0${boxY0}-x0${boxX0}`,
      type: match.type,
      label: match.label,
      text,
      ruleId: match.ruleId,
      lineIndex,
      y0: boxY0,
      confidence,
      normX,
      normY,
      normWidth,
      normHeight,
      evidence: match.type === "tckn" ? tcknEvidence(match.text).evidence : undefined,
      review: buildDetectionReview({
        type: match.type,
        text,
        confidence,
        ...reviewHints,
      }),
    }];
  });
}

export function detectAPIKeys(value, bbox) {
  return extractApiTokenCandidates(value).map((text) => asDetection(text, "api_token", 0.9, bbox));
}

export function mapNormalizedBox(detection, canvasWidth, canvasHeight) {
  const width = Number(canvasWidth);
  const height = Number(canvasHeight);
  if (!(width > 0) || !(height > 0)) return null;
  return {
    x: Number(detection.normX) * width,
    y: Number(detection.normY) * height,
    width: Number(detection.normWidth) * width,
    height: Number(detection.normHeight) * height,
  };
}
