const MAX_PATTERN_LENGTH = 180;

const LEGACY_IBAN_PATTERN = "\\b[A-Z]{2}\\d{2}[A-Z0-9]{11,30}\\b";
const GROUPED_IBAN_PATTERN = "\\b[A-Z]{2}\\d{2}(?:[A-Z0-9]{11,30}|(?: [A-Z0-9]{4}){5} [A-Z0-9]{2})\\b";
export const TURKISH_IBAN_PATTERN = "(?<![A-Z0-9])(?:TR\\s?\\d{2}(?:\\s?\\d{4}){5}\\s?\\d{2}|[A-Z]{2}\\d{2}(?:\\s?[A-Z0-9]{4}){3,6}\\s?[A-Z0-9]{1,4})(?![A-Z0-9])";
const IBAN_PATTERNS_TO_UPGRADE = new Set([LEGACY_IBAN_PATTERN, GROUPED_IBAN_PATTERN]);

export const SAMPLE_CUSTOM_RULES = [
  {
    id: "iban",
    label: "Possible IBAN",
    pattern: TURKISH_IBAN_PATTERN,
    flags: "g",
  },
  {
    id: "custom-id",
    label: "Possible custom ID",
    pattern: "\\b(?:ID|REF|INV|CUS)[-_ ]?\\d{4,12}\\b",
    flags: "gi",
  },
];

function sanitizeFlags(flags) {
  const seen = new Set();
  const cleaned = [];
  for (const flag of String(flags || "")) {
    if (!"gimsuy".includes(flag) || seen.has(flag)) continue;
    seen.add(flag);
    cleaned.push(flag);
  }
  if (!seen.has("g")) cleaned.push("g");
  return cleaned.join("");
}

function isUnsafePattern(pattern) {
  return /(\([^)]*[+*][^)]*\))[+*{]|\{\d+,?\d*\}\s*[+*]/.test(pattern);
}

function rulePattern(rule) {
  const pattern = String(rule?.pattern || "").trim();
  if (rule?.id === "iban" && IBAN_PATTERNS_TO_UPGRADE.has(pattern)) return TURKISH_IBAN_PATTERN;
  return pattern;
}

export function compileCustomRule(rule) {
  const pattern = rulePattern(rule);
  const label = String(rule?.label || "").trim().slice(0, 80);
  if (!pattern || !label || pattern.length > MAX_PATTERN_LENGTH || isUnsafePattern(pattern)) {
    return null;
  }

  try {
    const expression = new RegExp(pattern, sanitizeFlags(rule?.flags));
    expression.lastIndex = 0;
    expression.test("redaktix");
    expression.lastIndex = 0;
    return {
      id: String(rule.id || label).slice(0, 40),
      label,
      pattern,
      flags: sanitizeFlags(rule?.flags),
      expression,
    };
  } catch {
    return null;
  }
}

export function extractCustomRuleMatches(rule, value) {
  try {
    const compiled = rule?.expression ? rule : compileCustomRule(rule);
    if (!compiled?.expression) return [];
    compiled.expression.lastIndex = 0;
    const matches = String(value || "").match(compiled.expression) || [];
    compiled.expression.lastIndex = 0;
    return [...new Set(matches.map((match) => String(match).trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

export const USER_CUSTOM_RULES_KEY = "redaktix_custom_rules";

function browserStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createUserRuleId() {
  const random = Math.random().toString(36).slice(2, 8);
  return `rule-${Date.now().toString(36)}-${random}`;
}

export function normalizeUserRule(input) {
  const type = input?.type === "keyword" ? "keyword" : input?.type === "regex" ? "regex" : "";
  const name = String(input?.name || "").trim().slice(0, 80);
  const pattern = String(input?.pattern || "").trim().slice(0, MAX_PATTERN_LENGTH);
  if (!type || !name || pattern.length < 2) return null;
  if (type === "regex" && (isUnsafePattern(pattern) || !canCompilePattern(pattern))) return null;
  return {
    id: String(input?.id || createUserRuleId()).slice(0, 40),
    name,
    pattern,
    type,
    enabled: input?.enabled !== false,
  };
}

function canCompilePattern(pattern) {
  try {
    const expression = new RegExp(pattern, "g");
    expression.lastIndex = 0;
    return expression instanceof RegExp;
  } catch {
    return false;
  }
}

function compileUserRule(rule) {
  const normalized = normalizeUserRule(rule);
  if (!normalized) return null;
  const pattern = normalized.type === "keyword"
    ? escapeRegExp(normalized.pattern)
    : normalized.pattern;
  return compileCustomRule({
    id: normalized.id,
    label: normalized.name,
    pattern,
    flags: normalized.type === "keyword" ? "gi" : "g",
  });
}

export function readUserCustomRules(storage = browserStorage()) {
  try {
    const stored = storage?.getItem?.(USER_CUSTOM_RULES_KEY)
      ?? storage?.getItem?.("privacylab_custom_rules");
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeUserRule).filter(Boolean);
  } catch {
    return [];
  }
}

export function writeUserCustomRules(rules, storage = browserStorage()) {
  const normalized = (Array.isArray(rules) ? rules : []).map(normalizeUserRule).filter(Boolean);
  try {
    storage?.setItem?.(USER_CUSTOM_RULES_KEY, JSON.stringify(normalized));
  } catch {
    // Storage can be blocked. The caller still receives the normalized list.
  }
  return normalized;
}

export function saveUserCustomRule(rule, storage = browserStorage()) {
  const normalized = normalizeUserRule(rule);
  const current = readUserCustomRules(storage);
  if (!normalized) return { ok: false, rules: current };
  const index = current.findIndex((item) => item.id === normalized.id);
  if (index >= 0) current[index] = normalized;
  else current.push(normalized);
  return { ok: true, rules: writeUserCustomRules(current, storage) };
}

export function deleteUserCustomRule(id, storage = browserStorage()) {
  return writeUserCustomRules(
    readUserCustomRules(storage).filter((rule) => rule.id !== id),
    storage
  );
}

export function setUserCustomRuleEnabled(id, enabled, storage = browserStorage()) {
  return writeUserCustomRules(
    readUserCustomRules(storage).map((rule) => (
      rule.id === id ? { ...rule, enabled: Boolean(enabled) } : rule
    )),
    storage
  );
}

export function testCustomPattern(pattern, sample, type = "regex") {
  const normalized = normalizeUserRule({
    id: "pattern-test",
    name: "Pattern test",
    pattern,
    type,
    enabled: true,
  });
  if (!normalized) {
    return { ok: false, matches: [], error: "This pattern could not be compiled." };
  }
  try {
    const compiled = compileUserRule(normalized);
    if (!compiled) return { ok: false, matches: [], error: "This pattern could not be compiled." };
    return { ok: true, matches: extractCustomRuleMatches(compiled, sample), error: "" };
  } catch {
    return { ok: false, matches: [], error: "This pattern could not be compiled." };
  }
}

export function loadCustomRules(storage = browserStorage()) {
  const builtIn = SAMPLE_CUSTOM_RULES.map(compileCustomRule).filter(Boolean);
  const userRules = readUserCustomRules(storage)
    .filter((rule) => rule.enabled)
    .map(compileUserRule)
    .filter(Boolean);
  return [...builtIn, ...userRules];
}
