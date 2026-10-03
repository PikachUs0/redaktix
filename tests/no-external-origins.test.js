/**
 * Fail if scanned app surfaces load third-party http(s) origins.
 *
 * Allowlist (keep small):
 * - W3C / schema.org / sitemaps.org namespace & JSON-LD vocabulary URLs
 * - Own canonical domain: redaktix.com
 *
 * dist/ is scanned when present (HTML fully; JS only for analytics snippets,
 * because vendor bundles embed docs/CDN strings that are not runtime fetches).
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** Own site canonical / OG / sitemap locs. */
const ALLOWED_HOSTS = new Set(["redaktix.com", "www.redaktix.com"]);

/**
 * XML namespace / JSON-LD vocabulary URLs (not runtime network fetches).
 * http://www.w3.org/*, https://schema.org, http://www.sitemaps.org/*
 */
const ALLOWED_NAMESPACE_PREFIXES = [
  "http://www.w3.org/",
  "https://www.w3.org/",
  "https://schema.org",
  "http://www.sitemaps.org/",
  "https://www.sitemaps.org/",
];

const SCAN_EXTENSIONS = new Set([".html", ".js", ".css", ".webmanifest", ".xml", ".json"]);
const URL_RE = /https?:\/\/[^\s"'`<>)\\]+/gi;

const FORBIDDEN_SNIPPETS = [
  "googletagmanager.com",
  "google-analytics.com",
  "gtag(",
  "dataLayer",
  "G-B3QRTQ9TH8",
  "lh3.googleusercontent.com",
];

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

function collectSourceTargets() {
  return [
    join(ROOT, "index.html"),
    join(ROOT, "editor.html"),
    ...walk(join(ROOT, "src")),
    ...walk(join(ROOT, "public")),
  ].filter((file) => existsSync(file));
}

describe("no external origins in app surfaces", () => {
  it("rejects analytics hosts, gtag/dataLayer, and non-allowlisted http(s) URLs in sources", () => {
    const hits = [];
    for (const file of collectSourceTargets()) {
      const rel = relative(ROOT, file).replaceAll("\\", "/");
      if (/(^|\/)(ocr-backup|editor-backup|index-old|.*-reference.*)\./i.test(rel)) continue;
      const text = readFileSync(file, "utf8");
      for (const snippet of FORBIDDEN_SNIPPETS) {
        if (text.includes(snippet)) hits.push(`${rel}: forbidden snippet ${snippet}`);
      }
      for (const match of text.matchAll(URL_RE)) {
        const url = match[0];
        if (!isAllowedUrl(url)) hits.push(`${rel}: ${url}`);
      }
    }
    assert.deepEqual(hits, [], `Unexpected external origins:\n${hits.join("\n")}`);
  });

  it("rejects analytics/tracker snippets in dist/ (fail if missing when CI=1)", () => {
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
      for (const snippet of FORBIDDEN_SNIPPETS) {
        if (text.includes(snippet)) hits.push(`${rel}: forbidden snippet ${snippet}`);
      }
      // Full URL allowlist on HTML only (JS bundles embed vendor docs strings).
      if (rel.endsWith(".html")) {
        for (const match of text.matchAll(URL_RE)) {
          const url = match[0];
          if (!isAllowedUrl(url)) hits.push(`${rel}: ${url}`);
        }
      }
    }
    assert.deepEqual(hits, [], `Unexpected external origins in dist/:\n${hits.join("\n")}`);
  });
});
