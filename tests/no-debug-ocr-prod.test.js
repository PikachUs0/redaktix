/**
 * Ensure ?debugOcr / ocr-debug are not shipped in production bundles.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST = join(ROOT, "dist");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|html|css|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

describe("production build excludes OCR debug helper", () => {
  it("editor only loads ocr-debug behind import.meta.env.DEV", () => {
    const editor = readFileSync(join(ROOT, "src/js/editor.js"), "utf8");
    assert.equal(
      /import\s*\{[^}]*logDebugOcrTargetLines[^}]*\}\s*from\s*["']\.\/ocr-debug\.js["']/.test(editor),
      false,
      "static import of ocr-debug.js would keep it in the production graph"
    );
    assert.match(
      editor,
      /import\.meta\.env\.DEV/,
      "editor.js must gate debug OCR on import.meta.env.DEV"
    );
    assert.match(
      editor,
      /import\(\s*["']\.\/ocr-debug\.js["']\s*\)/,
      "ocr-debug.js must be loaded via dynamic import inside a DEV-only path"
    );
  });

  it("production dist/ assets do not contain debugOcr (fail if missing when CI=1)", () => {
    const ci = process.env.CI === "1" || process.env.CI === "true";
    if (!existsSync(DIST)) {
      assert.ok(!ci, "dist/ is required when CI=1; run npm run build first");
      console.log("skipping dist/ debugOcr check: directory absent (non-CI)");
      return;
    }
    const hits = [];
    for (const file of walk(DIST)) {
      const text = readFileSync(file, "utf8");
      if (text.includes("debugOcr")) {
        hits.push(relative(ROOT, file).replaceAll("\\", "/"));
      }
    }
    assert.deepEqual(hits, [], `debugOcr found in production assets:\n${hits.join("\n")}`);
  });
});
