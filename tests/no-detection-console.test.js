/**
 * Fail if src/ (except ocr-debug.js) still contains console logging of detection values.
 * Also scans dist/ when present; fails if dist/ is missing when CI=1.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SRC = join(ROOT, "src");
const DIST = join(ROOT, "dist");

const FORBIDDEN = [
  /console\.(log|debug|info)\(\s*["']TCKN candidate/,
  /console\.(log|debug|info)\(\s*["']\[PASS1 WORDS\]/,
  /console\.(log|debug|info)\(\s*["']\[PASS2 WORDS\]/,
  /console\.(log|debug|info)\(\s*`\[TCKN VALIDATION\]/,
  /console\.(log|debug|info)\(\s*["']OCR words/,
  /console\.(log|debug|info)\([\s\S]{0,80}raw\s*,/,
  /text=\$\{evidence\.normalized\}/,
  /console\.(log|debug|info)\([\s\S]{0,120}IBAN/,
];

function walkJs(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkJs(full, out);
    else if (name.endsWith(".js") && !name.includes("backup") && !name.includes("reference")) {
      out.push(full);
    }
  }
  return out;
}

function collectHits(files) {
  const hits = [];
  for (const file of files) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    if (rel.includes("ocr-debug.js")) continue;
    const text = readFileSync(file, "utf8");
    for (const pattern of FORBIDDEN) {
      if (pattern.test(text)) {
        hits.push(`${rel}: matches ${pattern}`);
      }
    }
  }
  return hits;
}

describe("no detection-value console logging", () => {
  it("fails when console logs print TCKN/IBAN/OCR detection values outside ocr-debug.js", () => {
    const hits = collectHits(walkJs(SRC));
    assert.deepEqual(hits, [], `Detection-value console logs remain:\n${hits.join("\n")}`);
  });

  it("scans dist/ for detection-value console logs (fail if missing when CI=1)", () => {
    const ci = process.env.CI === "1" || process.env.CI === "true";
    if (!existsSync(DIST)) {
      assert.ok(!ci, "dist/ is required when CI=1; run npm run build first");
      console.log("skipping dist/ detection-console check: directory absent (non-CI)");
      return;
    }
    const hits = collectHits(walkJs(DIST));
    assert.deepEqual(hits, [], `Detection-value console logs in dist/:\n${hits.join("\n")}`);
  });
});
