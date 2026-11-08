import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("PWA install UI", () => {
  it("captures beforeinstallprompt, suppresses the mini-infobar, and triggers the stored prompt", () => {
    const source = read("src/js/pwa-install.js");
    assert.match(source, /beforeinstallprompt/);
    assert.match(source, /event\.preventDefault\(\)/);
    assert.match(source, /\.prompt\(\)/);
    assert.match(source, /export function initPwaInstall/);
  });

  it("mounts the install button into the shared header slot on every surface", () => {
    const source = read("src/js/pwa-install.js");
    assert.match(source, /data-pwa-install-mount/);
    assert.ok(read("index.html").includes("data-pwa-install-mount"), "index.html missing install mount");
    assert.ok(read("editor.html").includes("data-pwa-install-mount"), "editor.html missing install mount");
    assert.ok(
      read("src/tools/render-pages.js").includes("data-pwa-install-mount"),
      "generated tool pages missing install mount",
    );
  });

  it("is wired into the landing, editor, and tool-page entry points", () => {
    for (const entry of ["src/js/landing.js", "src/js/editor.js", "src/js/tool-page.js"]) {
      const source = read(entry);
      assert.match(source, /from "\.\/pwa-install\.js"/, `${entry} missing pwa-install import`);
      assert.match(source, /initPwaInstall\(\)/, `${entry} does not call initPwaInstall()`);
    }
  });
});

describe("service worker /tools/ route caching", () => {
  it("handles generated /tools/ routes with the network-first strategy", () => {
    const source = read("public/sw.js");
    assert.match(source, /const TOOL_ROUTE_PREFIX = "\/tools\/"/);
    assert.match(source, /function isToolRoute/);
    assert.match(source, /isToolRoute\(event\.request\)/);
    // Required helpers must remain intact (see tests/service-worker.test.js).
    assert.match(source, /function isHtmlOrJsRequest/);
    assert.match(source, /function networkFirst/);
  });

  it("ships the manifest with the expected install metadata", () => {
    assert.ok(existsSync(join(ROOT, "public", "manifest.webmanifest")), "manifest.webmanifest missing");
    const manifest = JSON.parse(read("public/manifest.webmanifest"));
    assert.equal(manifest.name, "Redaktix");
    assert.equal(manifest.short_name, "Redaktix");
    assert.equal(manifest.display, "standalone");
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, "manifest needs icons");
  });
});
