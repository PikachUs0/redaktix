import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { writeServiceWorker } from "../scripts/write-sw.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST_SW = join(ROOT, "dist", "sw.js");
const PUBLIC_SW = join(ROOT, "public", "sw.js");

const REQUIRED_OCR_PRECACHE = [
  "/assets/ocr/worker/worker.min.js",
  "/assets/ocr/lang/eng.traineddata.gz",
  "/assets/ocr/lang/tur.traineddata.gz",
  "/assets/ocr/core/tesseract-core-lstm.js",
  "/assets/ocr/core/tesseract-core-lstm.wasm",
  "/assets/ocr/core/tesseract-core-lstm.wasm.js",
];

const SW_TEMPLATE = `const BUILD_HASH = "dev";
const CACHE = \`redaktix-offline-\${BUILD_HASH}\`;

const PRECACHE = [
  "/",
  "/index.html",
];

self.addEventListener("install", () => {});
`;

function seedDist(root, { jsBody = "console.log(1);\n", htmlBody = "<html>one</html>\n" } = {}) {
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(join(root, "sw.js"), SW_TEMPLATE);
  writeFileSync(join(root, "index.html"), htmlBody);
  writeFileSync(join(root, "assets", "app.js"), jsBody);
}

function readCacheName(swPath) {
  const source = readFileSync(swPath, "utf8");
  const hash = source.match(/const BUILD_HASH = "([^"]*)";/);
  assert.ok(hash, "BUILD_HASH missing from generated sw.js");
  return `redaktix-offline-${hash[1]}`;
}

describe("service worker build stamping", () => {
  it("changes the generated sw.js cache name when build output changes", () => {
    const dist = mkdtempSync(join(tmpdir(), "redaktix-sw-"));
    try {
      seedDist(dist, { jsBody: "console.log('build-a');\n" });
      const first = writeServiceWorker(dist);
      const firstName = readCacheName(join(dist, "sw.js"));
      assert.equal(first.cacheName, firstName);
      assert.match(firstName, /^redaktix-offline-[a-f0-9]{12}$/);

      // Change a precached asset; rebuild stamp must invalidate the old cache name.
      writeFileSync(join(dist, "assets", "app.js"), "console.log('build-b');\n");
      // Reset template fields that writeServiceWorker stamps (hash + precache list).
      writeFileSync(join(dist, "sw.js"), SW_TEMPLATE);
      const second = writeServiceWorker(dist);
      const secondName = readCacheName(join(dist, "sw.js"));
      assert.equal(second.cacheName, secondName);
      assert.notEqual(firstName, secondName);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });

  it("keeps network-first helpers for HTML/JS in the sw template", () => {
    const source = readFileSync(PUBLIC_SW, "utf8");
    assert.match(source, /function isHtmlOrJsRequest/);
    assert.match(source, /function networkFirst/);
    assert.match(source, /skipWaiting/);
    assert.match(source, /clients\.claim/);
  });

  it("template PRECACHE lists OCR worker, lang, and core files", () => {
    const source = readFileSync(PUBLIC_SW, "utf8");
    for (const url of REQUIRED_OCR_PRECACHE) {
      assert.ok(source.includes(`"${url}"`) || source.includes(`'${url}'`), `public/sw.js missing ${url}`);
    }
  });

  it("dist/sw.js PRECACHE includes OCR assets so the editor works offline (fail if missing when CI=1)", () => {
    const ci = process.env.CI === "1" || process.env.CI === "true";
    if (!existsSync(DIST_SW)) {
      assert.ok(!ci, "dist/sw.js is required when CI=1; run npm run build first");
      console.log("skipping dist/sw.js OCR precache check: absent (non-CI)");
      return;
    }
    const source = readFileSync(DIST_SW, "utf8");
    const match = source.match(/const PRECACHE = (\[[\s\S]*?\]);/);
    assert.ok(match, "PRECACHE array missing from dist/sw.js");
    const precache = JSON.parse(match[1]);
    const missing = REQUIRED_OCR_PRECACHE.filter((url) => !precache.includes(url));
    assert.deepEqual(missing, [], `dist/sw.js PRECACHE missing OCR assets:\n${missing.join("\n")}`);
  });
});
