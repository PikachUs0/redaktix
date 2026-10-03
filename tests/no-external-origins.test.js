/**
 * Architecture boundary for network / telemetry.
 *
 * APP surfaces (editor, redaction/OCR modules, tool pages, shared app JS):
 *   ZERO analytics, ZERO telemetry, ZERO non-allowlisted external origins.
 *
 * MARKETING surfaces (index.html, landing.js, marketing-analytics.js):
 *   Still forbid third-party trackers (gtag/GA/GTM).
 *   May include a first-party same-origin cookieless collect hook only.
 *
 * Allowlist (keep small):
 * - W3C / schema.org / sitemaps.org namespace & JSON-LD vocabulary URLs
 * - Own canonical domain: redaktix.com
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** Own site canonical / OG / sitemap locs. */
const ALLOWED_HOSTS = new Set(["redaktix.com", "www.redaktix.com"]);

const ALLOWED_NAMESPACE_PREFIXES = [
  "http://www.w3.org/",
  "https://www.w3.org/",
  "https://schema.org",
  "http://www.sitemaps.org/",
  "https://www.sitemaps.org/",
];

const SCAN_EXTENSIONS = new Set([".html", ".js", ".css", ".webmanifest", ".xml", ".json"]);
const URL_RE = /https?:\/\/[^\s"'`<>)\\]+/gi;

/** Third-party trackers — forbidden on BOTH app and marketing. */
const FORBIDDEN_THIRD_PARTY = [
  "googletagmanager.com",
  "google-analytics.com",
  "gtag(",
  "dataLayer",
  "G-B3QRTQ9TH8",
  "lh3.googleusercontent.com",
];

/** App-only: any telemetry / collect wiring is banned in the redaction product. */
const FORBIDDEN_APP_TELEMETRY = [
  ...FORBIDDEN_THIRD_PARTY,
  "initMarketingAnalytics",
  "redaktix-analytics-endpoint",
  "marketing-analytics",
  "sendBeacon",
  "/_vercel/insights/script.js",
  "window.vaq",
];

const MARKETING_REL = new Set([
  "index.html",
  "src/js/landing.js",
  "src/js/marketing-analytics.js",
]);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const full = join(dir, name);
    const st = statSync(full);
    const norm = full.replaceAll("\\", "/");
    if (st.isDirectory()) {
      if (norm.includes("/public/assets/ocr") || norm.includes("/dist/assets/ocr")) continue;
      walk(full, out);
    } else if (SCAN_EXTENSIONS.has(extname(name))) {
      out.push(full);
    }
  }
  return out;
}

function isAllowedUrl(raw) {
  const cleaned = raw.replace(/[.,;)]+$/g, "");
  if (ALLOWED_NAMESPACE_PREFIXES.some((prefix) => cleaned.startsWith(prefix))) return true;
  try {
    const url = new URL(cleaned);
    return ALLOWED_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function isMarketingRel(rel) {
  return MARKETING_REL.has(rel);
}

function collectAllSourceTargets() {
  return [
    join(ROOT, "index.html"),
    join(ROOT, "editor.html"),
    ...walk(join(ROOT, "src")),
    ...walk(join(ROOT, "public")),
  ].filter((file) => existsSync(file));
}

function skipDeadRel(rel) {
  return /(^|\/)(ocr-backup|editor-backup|index-old|.*-reference.*)\./i.test(rel);
}

describe("no external origins — app vs marketing boundary", () => {
  it("keeps the redaction app free of telemetry and non-allowlisted http(s) URLs", () => {
    const hits = [];
    for (const file of collectAllSourceTargets()) {
      const rel = relative(ROOT, file).replaceAll("\\", "/");
      if (skipDeadRel(rel) || isMarketingRel(rel)) continue;
      const text = readFileSync(file, "utf8");
      for (const snippet of FORBIDDEN_APP_TELEMETRY) {
        // sendBeacon is only banned in app JS/HTML product code; ignore vendor OCR wasm glue in public if any.
        if (snippet === "sendBeacon" && rel.includes("/public/assets/ocr/")) continue;
        if (text.includes(snippet)) hits.push(`${rel}: forbidden app telemetry ${snippet}`);
      }
      for (const match of text.matchAll(URL_RE)) {
        const url = match[0];
        if (!isAllowedUrl(url)) hits.push(`${rel}: ${url}`);
      }
    }
    assert.deepEqual(hits, [], `App surface violations:\n${hits.join("\n")}`);
  });

  it("forbids third-party trackers on marketing surfaces (first-party hook only)", () => {
    const hits = [];
    for (const rel of MARKETING_REL) {
      const file = join(ROOT, ...rel.split("/"));
      if (!existsSync(file)) {
        hits.push(`${rel}: missing`);
        continue;
      }
      const text = readFileSync(file, "utf8");
      for (const snippet of FORBIDDEN_THIRD_PARTY) {
        if (text.includes(snippet)) hits.push(`${rel}: forbidden third-party ${snippet}`);
      }
      // Marketing HTML may use canonical/OG redaktix.com URLs; still no other hosts.
      for (const match of text.matchAll(URL_RE)) {
        const url = match[0];
        if (!isAllowedUrl(url)) hits.push(`${rel}: ${url}`);
      }
    }
    assert.deepEqual(hits, [], `Marketing surface violations:\n${hits.join("\n")}`);
  });

  it("scans dist/ with the same boundary (fail if missing when CI=1)", () => {
    const dist = join(ROOT, "dist");
    const ci = process.env.CI === "1" || process.env.CI === "true";
    if (!existsSync(dist)) {
      assert.ok(!ci, "dist/ is required when CI=1; run npm run build first");
      console.log("skipping dist/: directory absent (non-CI)");
      return;
    }
    const hits = [];
    for (const file of walk(dist)) {
      const rel = relative(ROOT, file).replaceAll("\\", "/");
      const text = readFileSync(file, "utf8");
      const isLandingDist =
        rel === "dist/index.html"
        || /dist\/assets\/landing[^/]*\.(js|css)$/.test(rel);

      for (const snippet of FORBIDDEN_THIRD_PARTY) {
        if (text.includes(snippet)) hits.push(`${rel}: forbidden third-party ${snippet}`);
      }

      if (!isLandingDist) {
        for (const snippet of [
          "initMarketingAnalytics",
          "redaktix-analytics-endpoint",
          "marketing-analytics",
          "/_vercel/insights/script.js",
          "window.va",
          "window.vaq",
        ]) {
          if (text.includes(snippet)) hits.push(`${rel}: marketing analytics leaked into app dist (${snippet})`);
        }
      }

      if (rel.endsWith(".html")) {
        for (const match of text.matchAll(URL_RE)) {
          const url = match[0];
          if (!isAllowedUrl(url)) hits.push(`${rel}: ${url}`);
        }
      }
    }
    assert.deepEqual(hits, [], `Unexpected origins/telemetry in dist/:\n${hits.join("\n")}`);
  });
});
