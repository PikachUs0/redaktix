import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

const PRECACHE_EXTENSIONS = new Set([
  ".html",
  ".js",
  ".css",
  ".wasm",
  ".gz",
  ".woff",
  ".woff2",
  ".png",
  ".webmanifest",
  ".svg",
  ".xml",
  ".ico",
  ".webp",
]);

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

/** Content hash of the built dist tree (package version + vite manifest + precached bytes). */
export function computeBuildHash(distDir) {
  const dist = resolve(distDir);
  const urls = walk(dist)
    .map((file) => `/${relative(dist, file).replaceAll("\\", "/")}`)
    .filter((url) => url !== "/sw.js" && PRECACHE_EXTENSIONS.has(extname(url)))
    .sort();
  const signature = createHash("sha256");
  signature.update(String(packageJson.version || "0"));
  const manifestPath = resolve(dist, ".vite/manifest.json");
  try {
    signature.update(readFileSync(manifestPath));
  } catch {
    signature.update("no-manifest");
  }
  urls.forEach((url) => {
    if (url === "/") return;
    signature.update(url);
    signature.update(readFileSync(resolve(dist, url.slice(1))));
  });
  return signature.digest("hex").slice(0, 12);
}

export function listPrecacheUrls(distDir) {
  const dist = resolve(distDir);
  const urls = walk(dist)
    .map((file) => `/${relative(dist, file).replaceAll("\\", "/")}`)
    .filter((url) => url !== "/sw.js" && PRECACHE_EXTENSIONS.has(extname(url)))
    .sort();
  return ["/", ...urls.filter((url) => url !== "/")];
}

/**
 * Stamp dist/sw.js with a content-hashed BUILD_HASH so CACHE
 * (`redaktix-offline-${BUILD_HASH}`) changes on every distinct build and
 * activate() deletes prior Cache Storage entries.
 */
export function writeServiceWorker(distDir) {
  const dist = resolve(distDir);
  const precache = listPrecacheUrls(dist);
  const buildHash = computeBuildHash(dist);
  const cacheName = `redaktix-offline-${buildHash}`;
  const swPath = resolve(dist, "sw.js");
  const source = readFileSync(swPath, "utf8")
    .replace(/const BUILD_HASH = "[^"]*";/, `const BUILD_HASH = "${buildHash}";`)
    .replace(/const PRECACHE = \[[\s\S]*?\];/, `const PRECACHE = ${JSON.stringify(precache, null, 2)};`);
  writeFileSync(swPath, source);
  return { cacheName, buildHash, count: precache.length };
}
