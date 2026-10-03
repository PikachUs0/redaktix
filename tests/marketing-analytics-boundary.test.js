/**
 * Architecture boundary: marketing may load a first-party cookieless hook;
 * the redaction app (editor + tool pages + shared app modules) must never.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const HOOK = "marketing-analytics.js";

const APP_JS_DIRS = [
  join(ROOT, "src", "js"),
  join(ROOT, "src", "tools"),
];

const APP_ENTRY_HTML = [
  join(ROOT, "editor.html"),
];

const FORBIDDEN_THIRD_PARTY = [
  "googletagmanager.com",
  "google-analytics.com",
  "gtag(",
  "dataLayer",
  "G-B3QRTQ9TH8",
];

function walkJs(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkJs(full, out);
    else if (name.endsWith(".js")) out.push(full);
  }
  return out;
}

function isMarketingModule(rel) {
  return (
    rel === `src/js/${HOOK}`
    || rel === "src/js/landing.js"
    || rel === "index.html"
  );
}

describe("marketing analytics architecture boundary", () => {
  it("defines a first-party cookieless marketing hook module", async () => {
    const path = join(ROOT, "src", "js", HOOK);
    assert.ok(existsSync(path), `${HOOK} must exist for marketing surfaces`);
    const source = readFileSync(path, "utf8");
    assert.match(source, /export function initMarketingAnalytics/, "hook must export an initializer");
    assert.match(source, /sendBeacon|fetch/, "hook must support a same-origin beacon/fetch path");
    assert.match(source, /location\.origin/, "hook must enforce same-origin endpoint");
    for (const snippet of FORBIDDEN_THIRD_PARTY) {
      assert.equal(source.includes(snippet), false, `${HOOK} must not contain ${snippet}`);
    }
    const mod = await import(`../src/js/${HOOK}`);
    assert.equal(mod.resolveSameOriginEndpoint("https://evil.example/x", "https://redaktix.com"), null);
    assert.equal(
      mod.resolveSameOriginEndpoint("/collect", "https://redaktix.com")?.href,
      "https://redaktix.com/collect"
    );
    assert.equal(mod.resolveSameOriginEndpoint("", "https://redaktix.com"), null);
  });

  it("landing.js initializes the marketing hook; editor/tool modules never import it", () => {
    const landing = readFileSync(join(ROOT, "src", "js", "landing.js"), "utf8");
    assert.match(
      landing,
      new RegExp(`${HOOK.replace(".", "\\.")}`),
      "landing.js must import marketing-analytics.js"
    );
    assert.match(landing, /initMarketingAnalytics/, "landing.js must call initMarketingAnalytics");

    const hits = [];
    for (const file of [...APP_ENTRY_HTML, ...APP_JS_DIRS.flatMap((dir) => walkJs(dir))]) {
      const rel = relative(ROOT, file).replaceAll("\\", "/");
      if (isMarketingModule(rel)) continue;
      if (rel.endsWith(`/${HOOK}`)) continue;
      const text = readFileSync(file, "utf8");
      if (text.includes(HOOK) || text.includes("initMarketingAnalytics")) {
        hits.push(rel);
      }
    }
    assert.deepEqual(hits, [], `App modules must not reference marketing analytics:\n${hits.join("\n")}`);
  });

  it("index.html documents an optional same-origin analytics endpoint meta tag", () => {
    const html = readFileSync(join(ROOT, "index.html"), "utf8");
    assert.match(
      html,
      /meta\s+name=["']redaktix-analytics-endpoint["']/,
      "landing must expose redaktix-analytics-endpoint meta for first-party config"
    );
    assert.equal(html.includes("googletagmanager.com"), false);
    assert.equal(html.includes("gtag("), false);
  });

  it("production editor/tool bundles do not include the marketing hook (when dist present)", () => {
    const dist = join(ROOT, "dist");
    const ci = process.env.CI === "1" || process.env.CI === "true";
    if (!existsSync(dist)) {
      assert.ok(!ci, "dist/ is required when CI=1; run npm run build first");
      console.log("skipping dist marketing-boundary check: absent (non-CI)");
      return;
    }
    const hits = [];
    function walk(dir) {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(js|html)$/.test(name)) {
          const rel = relative(ROOT, full).replaceAll("\\", "/");
          // Landing bundles may include the hook; editor/tool must not.
          if (rel.includes("landing") || rel.endsWith("dist/index.html") || rel === "dist/index.html") {
            continue;
          }
          if (!/editor|toolPage|ocr|pwa|web-/.test(rel) && !rel.endsWith("editor.html")) {
            // Still scan non-landing HTML/JS that is part of the app shell.
            if (!rel.includes("/assets/") && !rel.endsWith(".html")) continue;
          }
          const text = readFileSync(full, "utf8");
          if (
            text.includes("initMarketingAnalytics")
            || text.includes("redaktix-analytics-endpoint")
            || text.includes("marketing-analytics")
          ) {
            // Allow only if this is clearly the landing chunk (hashed name may omit "landing").
            if (rel.includes("landing") || rel.endsWith("index.html")) continue;
            hits.push(rel);
          }
        }
      }
    }
    walk(dist);
    // Narrow: editor.html + any asset referenced only by editor must be clean.
    const editorHtml = join(dist, "editor.html");
    if (existsSync(editorHtml)) {
      const html = readFileSync(editorHtml, "utf8");
      assert.equal(html.includes("initMarketingAnalytics"), false);
      assert.equal(html.includes("redaktix-analytics-endpoint"), false);
      assert.equal(html.includes("marketing-analytics"), false);
    }
    assert.deepEqual(hits, [], `Marketing hook leaked into app dist assets:\n${hits.join("\n")}`);
  });
});
