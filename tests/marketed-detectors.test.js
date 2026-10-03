/**
 * Marketing copy must not claim detectors that sensitive-detectors.js does not implement.
 * Supported marketed names must have matching evidence in that module.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { messages } from "../src/js/i18n.js";
import { TOOLS } from "../src/tools/registry.js";
import { renderSecurityPage, renderToolsIndex } from "../src/tools/render-pages.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DETECTORS_SRC = readFileSync(join(ROOT, "src/js/sensitive-detectors.js"), "utf8");

/** Marketed detector names that are allowed only when evidence exists in sensitive-detectors.js. */
const SUPPORTED_MARKETED = [
  {
    name: "email",
    evidence: [/extractEmailCandidates/, /["']email["']/],
  },
  {
    name: "api_token",
    evidence: [/extractApiTokenCandidates/, /["']api_token["']/],
  },
  {
    name: "ipv4",
    evidence: [/detectIPv4|extractIpv4Candidates/, /["']ipv4["']/],
  },
  {
    name: "ipv6",
    evidence: [/extractIpv6Candidates/, /["']ipv6["']/],
  },
  {
    name: "phone",
    evidence: [/extractPhoneCandidates/, /["']phone["']/],
  },
  {
    name: "credit_card",
    evidence: [/extractCreditCardCandidates|passesLuhn/, /["']credit_card["']/],
  },
  {
    name: "person_name",
    evidence: [/extractPersonNameCandidates/, /["']person_name["']/],
  },
  {
    name: "location",
    evidence: [/extractLocationCandidates/, /["']location["']/],
  },
  {
    name: "tckn",
    evidence: [/findTcknMatches|isValidTckn/, /["']tckn["']/],
  },
  {
    name: "vkn",
    evidence: [/extractVknCandidates|isValidVkn/, /["']vkn["']/],
  },
  {
    name: "iban",
    evidence: [/isValidIban|extractIbanCandidates/, /ibanMod97|ruleId:\s*["']iban["']/],
  },
  {
    name: "session_id",
    evidence: [/["']session_id["']/],
  },
  {
    name: "private_key",
    evidence: [/extractPrivateKeyBlocks/, /findPrivateKeyMatchesFromLines/],
  },
  {
    name: "bearer_token",
    evidence: [/extractBearerTokenMatches/, /BEARER_TOKEN_PATTERN/],
  },
  {
    name: "connection_url",
    evidence: [/extractConnectionUrlCandidates/, /CONNECTION_URL_PATTERN/],
  },
  {
    name: "env_secret",
    evidence: [/extractEnvSecretMatches/, /ENV_SECRET_KEY_PATTERN/],
  },
  {
    name: "passport",
    evidence: [/extractPassportMatches/, /PASSPORT_LABEL_PATTERN/],
  },
  {
    name: "seed_phrase",
    evidence: [/extractSeedPhraseMatches/, /seed_phrase/],
  },
];

/**
 * Marketed capability phrases that have no matching detector.
 * Hits in user-facing copy fail the suite.
 */
const UNSUPPORTED_MARKETED = [
  { name: "license_plate", pattern: /\blicen[cs]e\s+plates?\b/i },
  { name: "ssn", pattern: /\bSSNs?\b/ },
  { name: "qr_barcode", pattern: /\bQR\s*codes?\b|\bbarcodes?\b|\bQR\s*kod/i },
  { name: "faces", pattern: /\bFaces\b|\bBiometric facial\b|\bYüzler\b|\bbiyometrik yüz\b/i },
];

function collectMarketingSurfaces() {
  const surfaces = [];
  for (const rel of ["index.html", "editor.html"]) {
    const path = join(ROOT, rel);
    if (existsSync(path)) surfaces.push({ id: rel, text: readFileSync(path, "utf8") });
  }
  surfaces.push({ id: "src/tools/registry.js", text: readFileSync(join(ROOT, "src/tools/registry.js"), "utf8") });
  surfaces.push({ id: "src/tools/render-pages.js", text: readFileSync(join(ROOT, "src/tools/render-pages.js"), "utf8") });
  surfaces.push({ id: "src/js/i18n.js", text: readFileSync(join(ROOT, "src/js/i18n.js"), "utf8") });
  surfaces.push({ id: "renderSecurityPage()", text: renderSecurityPage() });
  surfaces.push({ id: "renderToolsIndex()", text: renderToolsIndex() });
  for (const lang of ["en", "tr"]) {
    surfaces.push({ id: `i18n messages.${lang}`, text: Object.values(messages[lang]).join("\n") });
  }
  for (const tool of TOOLS) {
    surfaces.push({
      id: `TOOLS[${tool.slug}]`,
      text: [tool.title, tool.h1, tool.introText, tool.exampleCodeOrImage, ...tool.faqList.flatMap((f) => [f.question, f.answer])].join("\n"),
    });
  }
  const readmeCandidates = [
    join(ROOT, "README.md"),
    join(ROOT, "..", "README.md"),
  ];
  for (const path of readmeCandidates) {
    if (existsSync(path)) {
      surfaces.push({ id: path.includes("privacylab") ? "README.md" : "../README.md", text: readFileSync(path, "utf8") });
    }
  }
  return surfaces;
}

function lineHits(text, pattern) {
  const hits = [];
  const lines = String(text).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) hits.push(index + 1);
  }
  return hits;
}

describe("marketed detectors match sensitive-detectors.js", () => {
  it("every supported marketed detector name has matching detector evidence", () => {
    const missing = [];
    for (const entry of SUPPORTED_MARKETED) {
      for (const evidence of entry.evidence) {
        if (!evidence.test(DETECTORS_SRC)) {
          missing.push(`${entry.name}: missing ${evidence}`);
        }
      }
    }
    assert.deepEqual(missing, [], `Supported marketed detectors lack code evidence:\n${missing.join("\n")}`);
  });

  it("fails when marketing claims a detector name with no matching detector", () => {
    const surfaces = collectMarketingSurfaces();
    const hits = [];
    for (const claim of UNSUPPORTED_MARKETED) {
      // Guard: unsupported names must not also be implemented.
      const implementedHints = {
        passport: /passport/i,
        license_plate: /license.?plate|plaka/i,
        ssn: /\bSSN\b|social.?security/i,
        qr_barcode: /\bQR\b|barcode/i,
        faces: /facial|face.?detect|biometr/i,
        private_keys: /PRIVATE KEY|ssh-rsa|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE/i,
        bearer_tokens: /\bBearer\b/,
        env_files: /\.env\b/,
        seed_phrases: /seed.?phrase|bip39/i,
      };
      const hint = implementedHints[claim.name];
      // Only treat as implemented if it looks like a detector, not a comment/string in tests.
      // sensitive-detectors must not define these as detector types.
      if (hint && /type:\s*["'](?:passport|license_plate|ssn|qr|face|private_key|bearer|env|seed)/.test(DETECTORS_SRC)) {
        continue;
      }
      for (const surface of surfaces) {
        for (const line of lineHits(surface.text, claim.pattern)) {
          hits.push(`${surface.id}:${line} claims "${claim.name}" (no detector)`);
        }
      }
    }
    assert.deepEqual(hits, [], `Unsupported marketed detectors in user-facing text:\n${hits.join("\n")}`);
  });
});
