import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { sitemapPaths } from "../src/tools/registry.js";
import { renderSitemap } from "../src/tools/render-pages.js";
import { messages } from "../src/js/i18n.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const VERIFY_HTML = read("src/verify/index.html");
const VERIFY_JS = read("src/verify/verify.js");
const VERIFY_CSS = read("src/verify/verify.css");
const VITE_CONFIG = read("vite.config.js");

describe("/verify/ page integration", () => {
  it("is registered as a Vite MPA input and served in dev", () => {
    assert.match(VITE_CONFIG, /verify:\s*resolve\(\s*import\.meta\.dirname,\s*"src\/verify\/index\.html"\s*\)/);
    assert.match(VITE_CONFIG, /url === "\/verify" \|\| url === "\/verify\/"/);
  });

  it("is listed in the sitemap used in dev, production, and the committed copy", () => {
    assert.equal(sitemapPaths().includes("/verify/"), true);
    const xml = renderSitemap({ REDAKTIX_ORIGIN: "https://example.test" });
    assert.match(xml, /<loc>https:\/\/example\.test\/verify\/<\/loc>/);
    assert.match(read("public/sitemap.xml"), /<loc>https:\/\/redaktix\.com\/verify\/<\/loc>/);
  });

  it("reuses the tool-page shell instead of a bespoke header/footer", () => {
    assert.match(VERIFY_HTML, /<header class="tool-header" data-pwa-install-mount>/);
    assert.match(VERIFY_HTML, /class="tool-brand" href="\/">Redaktix</);
    assert.match(VERIFY_HTML, /class="tool-trust" href="\/security\/"/);
    assert.match(VERIFY_HTML, /<main class="tool-main verify-main">/);
    assert.match(VERIFY_HTML, /<footer class="tool-footer">/);
    assert.match(VERIFY_HTML, /href="\/src\/css\/tool-page\.css"/);
    assert.match(VERIFY_HTML, /href="\/src\/verify\/verify\.css"/);
    assert.doesNotMatch(VERIFY_HTML, /class="site"/);
  });

  it("stays compatible with the strict CSP: no inline scripts, styles, or handlers", () => {
    for (const match of VERIFY_HTML.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      assert.match(match[1], /\bsrc=/, "every script tag must be an external module");
      assert.equal(match[2].trim(), "", "script tags must not carry inline code");
    }
    assert.match(VERIFY_HTML, /<script type="module" src="\/src\/verify\/verify\.js"><\/script>/);
    assert.doesNotMatch(VERIFY_HTML, /<style\b/i);
    assert.doesNotMatch(VERIFY_HTML, /\sstyle=/i);
    assert.doesNotMatch(VERIFY_HTML, /\son[a-z]+\s*=/i);
  });

  it("names no third-party origin and loads no ad code", () => {
    const urls = [...VERIFY_HTML.matchAll(/https?:\/\/[^\s"'<>]+/g)].map((match) => match[0]);
    assert.deepEqual(urls, ["https://redaktix.com/verify/"]);
    assert.doesNotMatch(VERIFY_HTML, /googlesyndication|adsbygoogle/i);
    assert.doesNotMatch(VERIFY_HTML, /<ins\b/i);
    assert.doesNotMatch(VERIFY_JS, /https?:\/\//);
  });

  it("documents the same policy the host applies to this route", () => {
    const headers = JSON.parse(read("vercel.json"));
    const verifyRule = headers.headers.find((rule) => rule.source === "/verify/(.*)");
    const policy = verifyRule.headers.find((header) => header.key === "Content-Security-Policy").value;
    for (const directive of ["default-src 'self'", "connect-src 'self'", "form-action 'none'", "object-src 'none'"]) {
      assert.ok(policy.includes(directive), `vercel.json must keep ${directive}`);
      assert.ok(VERIFY_HTML.includes(directive), `/verify/ must document ${directive}`);
    }
    assert.ok(!/googlesyndication|doubleclick|adservice/.test(policy));
  });

  it("keeps the SSN wording on validation rules and the ABA/Luhn wording on checksums", () => {
    assert.match(VERIFY_HTML, /SSN-shaped numbers checked against the official validity rules/);
    assert.match(VERIFY_HTML, /ABA checksum/);
    assert.match(VERIFY_HTML, /Luhn checksum/);
    assert.doesNotMatch(VERIFY_HTML, /SSN[^.]{0,80}checksum/i);
  });

  it("is linked from the landing header, footer, privacy policy, export panel, and README", () => {
    const landing = read("index.html");
    assert.match(landing, /data-path="verify"\s+href="\/verify\/"\s+data-i18n="nav\.verify"/);
    assert.match(landing, /data-path="verify" href="\/verify\/"\s+data-i18n="footer\.verify"/);
    assert.match(landing, /<a href="\/verify\/" data-i18n="legal\.verifyLink">/);
    assert.match(read("src/js/editor.js"), /class="review-verify-link" href="\/verify\/"/);
    assert.match(read("README.md"), /\(\/verify\/\)/);
    assert.ok(messages.en["nav.verify"] && messages.en["footer.verify"] && messages.en["editor.verifyLink"]);
    assert.ok(messages.tr["nav.verify"] && messages.tr["footer.verify"] && messages.tr["editor.verifyLink"]);
  });

  it("ships the page-local stylesheet and build fingerprint helper", () => {
    assert.match(VERIFY_CSS, /\.tool-footer\b/);
    assert.match(VERIFY_CSS, /\.verify-main\b/);
    assert.match(VERIFY_JS, /const BUILD_HASH = /);
    assert.match(VERIFY_JS, /fetch\("\/sw\.js", \{ cache: "no-store", credentials: "omit" \}\)/);
    assert.match(VERIFY_JS, /content-security-policy/);
  });

  it("initialises the shell install control the header asks for", () => {
    assert.match(VERIFY_JS, /import \{ initPwaInstall \} from "\.\.\/js\/pwa-install\.js"/);
    assert.match(VERIFY_JS, /^initPwaInstall\(\);$/m);
  });
});
