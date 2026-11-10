import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderedPages, renderSitemap } from "../src/tools/render-pages.js";
import { writeServiceWorker } from "./write-sw.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

function assetHrefs() {
  try {
    const manifest = JSON.parse(readFileSync(resolve(dist, ".vite/manifest.json"), "utf8"));
    const entry = manifest["src/js/tool-page.js"];
    if (!entry?.file) return null;
    return {
      scriptSrc: `/${entry.file}`,
      styleHref: entry.css?.[0] ? `/${entry.css[0]}` : "/src/css/tool-page.css",
    };
  } catch {
    return {
      scriptSrc: "/src/js/tool-page.js",
      styleHref: "/src/css/tool-page.css",
    };
  }
}

export function writeToolPages(targetDir = dist, env = process.env) {
  const assets = assetHrefs();
  const options = { ...assets, env };
  for (const page of renderedPages(options)) {
    const file = resolve(targetDir, page.file);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, page.html);
  }
  writeFileSync(resolve(targetDir, "sitemap.xml"), renderSitemap(env));
}

/**
 * Vite emits the /verify/ MPA input at dist/src/verify/index.html because the
 * source lives under src/. Its asset URLs are root-absolute (/assets/...), so
 * move it to the public path it was registered under: dist/verify/index.html.
 */
export function moveVerifyPage(targetDir = dist) {
  const source = resolve(targetDir, "src/verify/index.html");
  if (!existsSync(source)) return false;
  const file = resolve(targetDir, "verify/index.html");
  mkdirSync(dirname(file), { recursive: true });
  renameSync(source, file);
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeToolPages();
  moveVerifyPage();
  const precache = writeServiceWorker(dist);
  console.log(`service worker ${precache.cacheName} (${precache.count} urls)`);
}
