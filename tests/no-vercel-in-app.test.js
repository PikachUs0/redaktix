/**
 * Vercel analytics must stay on marketing landing only.
 * Fail if "_vercel" or "va.vercel-scripts" appears in editor / tool pages / dist editor.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { renderedPages } from "../src/tools/render-pages.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const FORBIDDEN = ["_vercel", "va.vercel-scripts"];

function containsForbidden(text) {
  return FORBIDDEN.filter((snippet) => text.includes(snippet));
}

function walkHtmlJs(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkHtmlJs(full, out);
    else if (/\.(html|js)$/.test(name)) out.push(full);
  }
  return out;
}

describe("no Vercel analytics in the redaction app", () => {
  it("editor.html and src app modules do not contain _vercel or va.vercel-scripts", () => {
    const hits = [];
    const targets = [
      join(ROOT, "editor.html"),
      ...walkHtmlJs(join(ROOT, "src", "js")).filter((file) => {
        const rel = relative(ROOT, file).replaceAll("\\", "/");
        return !rel.endsWith("/landing.js") && !rel.endsWith("/marketing-analytics.js");
      }),
      ...walkHtmlJs(join(ROOT, "src", "tools")),
    ];
    for (const file of targets) {
      if (!existsSync(file)) continue;
      const rel = relative(ROOT, file).replaceAll("\\", "/");
      const found = containsForbidden(readFileSync(file, "utf8"));
      for (const snippet of found) hits.push(`${rel}: ${snippet}`);
    }
    assert.deepEqual(hits, [], `Vercel analytics leaked into app sources:\n${hits.join("\n")}`);
  });

  it("rendered tool/security pages do not contain _vercel or va.vercel-scripts", () => {
    const hits = [];
    for (const page of renderedPages()) {
      const found = containsForbidden(page.html);
      for (const snippet of found) hits.push(`${page.path}: ${snippet}`);
    }
    assert.deepEqual(hits, [], `Vercel analytics leaked into tool pages:\n${hits.join("\n")}`);
  });

  it("dist/editor.html and non-landing dist assets forbid _vercel / va.vercel-scripts (fail if missing when CI=1)", () => {
    const dist = join(ROOT, "dist");
    const ci = process.env.CI === "1" || process.env.CI === "true";
    if (!existsSync(dist)) {
      assert.ok(!ci, "dist/ is required when CI=1; run npm run build first");
      console.log("skipping dist vercel-app check: absent (non-CI)");
      return;
    }
    const hits = [];
    const editorHtml = join(dist, "editor.html");
    assert.ok(existsSync(editorHtml), "dist/editor.html missing after build");
    for (const snippet of containsForbidden(readFileSync(editorHtml, "utf8"))) {
      hits.push(`dist/editor.html: ${snippet}`);
    }
    for (const file of walkHtmlJs(dist)) {
      const rel = relative(ROOT, file).replaceAll("\\", "/");
      if (rel === "dist/index.html" || /dist\/assets\/landing/.test(rel)) continue;
      const found = containsForbidden(readFileSync(file, "utf8"));
      for (const snippet of found) hits.push(`${rel}: ${snippet}`);
    }
    assert.deepEqual(hits, [], `Vercel analytics leaked into app dist:\n${hits.join("\n")}`);
  });

  it("index.html may include _vercel insights (marketing only)", () => {
    const landing = readFileSync(join(ROOT, "index.html"), "utf8");
    assert.ok(landing.includes("_vercel"), "landing should host Vercel insights script path");
  });
});
