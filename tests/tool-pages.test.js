import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ocrModuleRequested } from "../src/js/ocr-loader.js";
import { TOOLS, getToolBySlug, sitemapPaths, toolPublicPath } from "../src/tools/registry.js";
import { renderSecurityPage, renderSitemap, renderToolPage, renderToolsIndex } from "../src/tools/render-pages.js";

const REQUIRED_FIELDS = [
  "slug",
  "lang",
  "title",
  "h1",
  "keyword",
  "presetProfile",
  "activeDetectors",
  "introText",
  "exampleCodeOrImage",
  "faqList",
  "relatedSlugs",
];

describe("tool registry", () => {
  it("lists the English and Turkish intent tools with unique copy", () => {
    assert.deepEqual(TOOLS.map((entry) => entry.slug), [
      "hide-api-key",
      "blur-email",
      "redact-phone-number",
      "hide-ip-address",
      "redact-credit-card",
      "hide-jwt-token",
      "tckn-gizle",
      "ekran-goruntusu-telefon-gizle",
    ]);
    const intros = new Set(TOOLS.map((entry) => entry.introText));
    assert.equal(intros.size, TOOLS.length);
    for (const entry of TOOLS) {
      for (const field of REQUIRED_FIELDS) assert.ok(entry[field], field);
      assert.ok(entry.faqList.length >= 2);
      assert.ok(entry.activeDetectors.length >= 1);
      assert.equal(getToolBySlug(entry.slug), entry);
    }
    assert.equal(toolPublicPath(getToolBySlug("hide-api-key")), "/tools/hide-api-key/");
    assert.equal(toolPublicPath(getToolBySlug("tckn-gizle")), "/tr/tckn-gizle/");
  });

  it("pre-renders SEO text, canonical tags, and schema into the HTML", () => {
    const page = renderToolPage(getToolBySlug("hide-api-key"));
    assert.match(page, /<h1>Hide an API key in a screenshot<\/h1>/);
    assert.match(page, /Paste a bug report or dashboard capture/);
    assert.match(page, /<link rel="canonical" href="\/tools\/hide-api-key\/">/);
    assert.match(page, /"@type":"WebApplication"/);
    assert.match(page, /"@type":"BreadcrumbList"/);
    assert.match(page, /Does this page upload the screenshot\?/);
    assert.match(page, /data-tool-dropzone/);
    const security = renderSecurityPage();
    assert.match(security, /<link rel="canonical" href="\/security\/">/);
    assert.match(security, /Verify in Chrome DevTools/);
    assert.match(security, /Screenshot pixels/);
    const index = renderToolsIndex();
    assert.match(index, /href="\/tr\/tckn-gizle\/"/);
  });

  it("builds a sitemap for the home page, security page, tool hub, and every tool", () => {
    const xml = renderSitemap({ REDAKTIX_ORIGIN: "https://example.test" });
    for (const path of sitemapPaths()) {
      assert.match(xml, new RegExp(`<loc>https://example.test${path.replaceAll("/", "\\/")}<\\/loc>`));
    }
    assert.equal(sitemapPaths().includes("/"), true);
    assert.equal(sitemapPaths().includes("/security/"), true);
    assert.equal(sitemapPaths().includes("/tools/"), true);
  });

  it("keeps the OCR worker module off the initial import graph", () => {
    const loader = readFileSync(new URL("../src/js/ocr-loader.js", import.meta.url), "utf8");
    const toolPage = readFileSync(new URL("../src/js/tool-page.js", import.meta.url), "utf8");
    assert.equal(ocrModuleRequested(), false);
    assert.match(loader, /import\("\.\/ocr\.js"\)/);
    assert.doesNotMatch(loader, /tesseract/);
    assert.doesNotMatch(toolPage, /from "\.\/ocr\.js"/);
    assert.match(toolPage, /loadOcrModule\(/);
  });
});