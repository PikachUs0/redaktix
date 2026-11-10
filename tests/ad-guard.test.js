/**
 * Ad guard + per-route CSP (Task 2).
 *
 * The guard is the only code allowed to inject ad-network code. These tests
 * pin two promises:
 *  1. Any privacy signal keeps ads off: no googlesyndication <script> is
 *     appended and no `window.adsbygoogle` global is created.
 *  2. Only the editor route's policy names ad origins; /tools/*, /verify and
 *     /privacy stay strict (`connect-src 'self'`, zero ad origins).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  AD_SCRIPT_SRC,
  DEFAULT_AD_CONFIG,
  createAdGuard,
  evaluateAdDecision,
} from "../src/ads/adguard.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** A fully configured publisher, so a "serve" verdict is otherwise possible. */
const CONFIGURED = {
  ...DEFAULT_AD_CONFIG,
  client: "ca-pub-0000000000000000",
  slots: { export: "0000000000" },
};

const AD_HOST_RE = /googlesyndication|doubleclick|googleadservices|adservice\.google/i;

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    dump: () => Object.fromEntries(map),
  };
}

function fakeNavigator({ gpc = false } = {}) {
  return gpc ? { globalPrivacyControl: true } : {};
}

/** Minimal DOM good enough for the guard: head, createElement, one container. */
function fakeDocument({ referrer = "" } = {}) {
  const head = { children: [], appendChild(node) { this.children.push(node); return node; } };
  const created = [];
  const doc = {
    referrer,
    head,
    documentElement: { dataset: {} },
    createElement(tagName) {
      const el = {
        tagName: String(tagName).toUpperCase(),
        className: "",
        textContent: "",
        style: {},
        dataset: {},
        children: [],
        appendChild(child) { this.children.push(child); return child; },
        replaceChildren(...nodes) { this.children = nodes; },
      };
      let src = "";
      Object.defineProperty(el, "src", {
        get: () => src,
        set(value) {
          src = value;
          queueMicrotask(() => el.onload?.());
        },
      });
      created.push(el);
      return el;
    },
  };
  return { doc, head, created };
}

function fakeContainer() {
  return { hidden: true, children: [], replaceChildren(...nodes) { this.children = nodes; } };
}

function makeGuard({ pathname = "/editor.html", search = "", referrer = "", gpc = false, storage = fakeStorage(), config } = {}) {
  const { doc, head, created } = fakeDocument({ referrer });
  const win = {};
  const guard = createAdGuard({
    config: config ?? CONFIGURED,
    runtime: {
      location: { pathname, search },
      document: doc,
      navigator: fakeNavigator({ gpc }),
      sessionStorage: storage,
      window: win,
    },
  });
  return { guard, doc, head, created, win, storage };
}

function scriptSources(head) {
  return head.children.map((node) => node.src || "");
}

describe("ad guard — privacy gate decisions", () => {
  const cases = [
    ["privacy_mode=true", { search: "?privacy_mode=true" }, "param"],
    ["privacy_mode=1", { search: "?privacy_mode=1" }, "param"],
    ["ref=hn", { search: "?ref=hn" }, "ref-param"],
    ["ref=reddit", { search: "?ref=reddit" }, "ref-param"],
    ["ref=ph", { search: "?ref=ph" }, "ref-param"],
    ["utm_source=reddit", { search: "?utm_source=reddit" }, "ref-param"],
    ["Hacker News referrer", { referrer: "https://news.ycombinator.com/item?id=1" }, "referrer"],
    ["reddit referrer", { referrer: "https://old.reddit.com/r/privacy/" }, "referrer"],
    ["session flag", { storage: fakeStorage({ [DEFAULT_AD_CONFIG.storageKey]: "param" }) }, "session:param"],
    ["Global Privacy Control", { gpc: true }, "gpc"],
    ["/verify/", { pathname: "/verify/" }, "blocked-path"],
    ["/privacy/", { pathname: "/privacy/" }, "blocked-path"],
    ["tool page", { pathname: "/tools/redact-ssn-pdf/" }, "tool-page"],
  ];

  for (const [label, options, reason] of cases) {
    it(`keeps ads off for ${label}`, () => {
      const { guard, head, created, win } = makeGuard(options);
      assert.equal(guard.shouldServeAds(), false);
      assert.equal(guard.adDecision().reason, reason);
      assert.deepEqual(scriptSources(head), []);
      assert.equal(created.some((node) => node.tagName === "SCRIPT"), false);
      assert.equal(win.adsbygoogle, undefined);
    });
  }

  it("keeps ads off while the publisher ID / slots are unconfigured", () => {
    const decision = evaluateAdDecision(DEFAULT_AD_CONFIG, {
      location: { pathname: "/editor.html", search: "" },
      document: { referrer: "" },
      navigator: {},
      sessionStorage: fakeStorage(),
    });
    assert.deepEqual(decision, { serve: false, reason: "unconfigured" });
  });

  it("serves only on an organic editor visit with real IDs", () => {
    const decision = evaluateAdDecision(CONFIGURED, {
      location: { pathname: "/editor.html", search: "" },
      document: { referrer: "https://example.com/" },
      navigator: {},
      sessionStorage: fakeStorage(),
    });
    assert.deepEqual(decision, { serve: true, reason: "organic" });
  });

  it("sticks the opt-out into sessionStorage and honours it later", () => {
    const storage = fakeStorage();
    evaluateAdDecision(CONFIGURED, {
      location: { pathname: "/editor.html", search: "?privacy_mode=true" },
      document: { referrer: "" },
      navigator: {},
      sessionStorage: storage,
    });
    assert.equal(storage.getItem(DEFAULT_AD_CONFIG.storageKey), "param");

    const later = evaluateAdDecision(CONFIGURED, {
      location: { pathname: "/editor.html", search: "" },
      document: { referrer: "" },
      navigator: {},
      sessionStorage: storage,
    });
    assert.deepEqual(later, { serve: false, reason: "session:param" });
  });

  it("privacy_mode=off clears the sticky flag", () => {
    const storage = fakeStorage({ [DEFAULT_AD_CONFIG.storageKey]: "param" });
    const decision = evaluateAdDecision(CONFIGURED, {
      location: { pathname: "/editor.html", search: "?privacy_mode=off" },
      document: { referrer: "" },
      navigator: {},
      sessionStorage: storage,
    });
    assert.deepEqual(decision, { serve: true, reason: "organic" });
    assert.equal(storage.getItem(DEFAULT_AD_CONFIG.storageKey), null);
  });
});

describe("ad guard — no ad code is fetched or created when declined", () => {
  for (const [label, options] of [
    ["privacy_mode=true", { search: "?privacy_mode=true" }],
    ["ref=hn", { search: "?ref=hn" }],
    ["ref=reddit", { search: "?ref=reddit" }],
    ["ref=ph", { search: "?ref=ph" }],
    ["privacy referrer", { referrer: "https://news.ycombinator.com/" }],
    ["session flag", { storage: fakeStorage({ [DEFAULT_AD_CONFIG.storageKey]: "referrer" }) }],
    ["GPC", { gpc: true }],
    ["/verify/", { pathname: "/verify/" }],
    ["/privacy/", { pathname: "/privacy/" }],
  ]) {
    it(`${label}: no googlesyndication script and no adsbygoogle global`, async () => {
      const { guard, head, win, created } = makeGuard(options);
      assert.equal(await guard.loadAdSense(), false);

      const container = fakeContainer();
      assert.equal(await guard.mountSlot(container), false);

      assert.deepEqual(scriptSources(head), []);
      assert.equal(created.some((node) => AD_HOST_RE.test(node.src || "")), false);
      assert.equal(win.adsbygoogle, undefined);
      assert.equal(container.hidden, true, "declined slot stays hidden");
      assert.deepEqual(container.children, [], "declined slot stays empty");
    });
  }

  it("refuses to mount even when asked for an unknown slot name", async () => {
    const { guard } = makeGuard({ config: { client: CONFIGURED.client, slots: {} } });
    const container = fakeContainer();
    assert.equal(await guard.mountSlot(container, "export"), false);
    assert.equal(container.hidden, true);
  });
});

describe("ad guard — the only positive path", () => {
  it("injects the loader and mounts a labelled slot on an organic editor visit", async () => {
    const { guard, head, win } = makeGuard();
    assert.equal(guard.shouldServeAds(), true);

    assert.equal(await guard.loadAdSense(), true);
    assert.equal(head.children.length, 1);
    assert.match(head.children[0].src, /^https:\/\/pagead2\.googlesyndication\.com\//);
    assert.equal(head.children[0].src.startsWith(AD_SCRIPT_SRC), true);

    const container = fakeContainer();
    assert.equal(await guard.mountSlot(container, "export"), true);
    assert.equal(container.hidden, false);

    const label = container.children[0];
    assert.equal(label.className, "rdx-ad-label");
    assert.equal(label.textContent, "Advertisement");

    const ins = container.children[1];
    assert.equal(ins.className, "adsbygoogle");
    assert.equal(ins.dataset.adClient, CONFIGURED.client);
    assert.equal(ins.dataset.adSlot, CONFIGURED.slots.export);

    assert.equal(Array.isArray(win.adsbygoogle), true);
    assert.equal(win.adsbygoogle.length, 1);
  });

  it("marks the document element with the decision for debugging", () => {
    const { doc } = makeGuard({ search: "?privacy_mode=true" });
    assert.equal(doc.documentElement.dataset.ads, "off");
    assert.equal(doc.documentElement.dataset.adsReason, "param");
  });
});

describe("ad guard — static markup and wiring", () => {
  function walk(dir, out = []) {
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".git") continue;
      const full = join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full, out);
      else if ([".html", ".js"].includes(extname(name))) out.push(full);
    }
    return out;
  }

  it("no HTML ships a static AdSense script or <ins class=adsbygoogle>", () => {
    const htmlFiles = [
      join(ROOT, "index.html"),
      join(ROOT, "editor.html"),
      ...walk(join(ROOT, "src")).filter((file) => file.endsWith(".html")),
    ].filter((file) => existsSync(file));

    assert.equal(htmlFiles.length > 2, true, "expected the app HTML to be scanned");

    const hits = [];
    for (const file of htmlFiles) {
      const rel = relative(ROOT, file).replaceAll("\\", "/");
      const text = readFileSync(file, "utf8");
      if (/class\s*=\s*["'][^"']*\badsbygoogle\b/i.test(text)) hits.push(`${rel}: static adsbygoogle <ins>`);
      if (/<script[^>]*adsbygoogle\.js/i.test(text)) hits.push(`${rel}: static AdSense loader`);
      if (/<ins[^>]*\badsbygoogle\b/i.test(text)) hits.push(`${rel}: static AdSense <ins>`);
    }
    assert.deepEqual(hits, [], `Static ad markup leaked:\n${hits.join("\n")}`);
  });

  it("ad-network code lives only in the ad guard module", () => {
    const hits = [];
    for (const file of walk(join(ROOT, "src"))) {
      const rel = relative(ROOT, file).replaceAll("\\", "/");
      if (rel === "src/ads/adguard.js") continue;
      const text = readFileSync(file, "utf8");
      if (/googlesyndication/i.test(text)) hits.push(rel);
    }
    assert.deepEqual(hits, [], `Ad origin outside the guard:\n${hits.join("\n")}`);
  });

  it("the editor declares the export slot and mounts it through the guard", () => {
    const editorHtmlLike = readFileSync(join(ROOT, "src/js/editor.js"), "utf8");
    assert.match(editorHtmlLike, /import\s*\{\s*mountSlot\s*\}\s*from\s*"\.\.\/ads\/adguard\.js"/);
    assert.match(editorHtmlLike, /data-rdx-ad-slot="export"\s+hidden/);
    assert.match(editorHtmlLike, /mountSlot\(adSlot,\s*"export"\)/);
  });
});

describe("per-route CSP", () => {
  const vercelPath = join(ROOT, "vercel.json");

  it("ships per-route headers with a strict policy on /tools/*, /verify and /privacy", () => {
    assert.equal(existsSync(vercelPath), true, "vercel.json is required for per-route headers");
    const config = JSON.parse(readFileSync(vercelPath, "utf8"));
    assert.equal(Array.isArray(config.headers), true);

    const cspFor = (source) => {
      const rule = config.headers.find((entry) => entry.source === source);
      assert.ok(rule, `missing header rule for ${source}`);
      const csp = rule.headers.find((header) => header.key === "Content-Security-Policy");
      assert.ok(csp, `missing CSP for ${source}`);
      return csp.value;
    };

    for (const source of ["/tools/(.*)", "/verify", "/verify/(.*)", "/privacy", "/privacy/(.*)"]) {
      const csp = cspFor(source);
      assert.match(csp, /connect-src 'self'/, `${source} must allow only same-origin requests`);
      assert.doesNotMatch(csp, /connect-src 'none'/, `${source} must allow same-origin fetches`);
      assert.doesNotMatch(csp, AD_HOST_RE, `${source} must not name an ad network`);
      assert.match(csp, /object-src 'none'/);
      assert.match(csp, /form-action 'none'/);
    }
  });

  it("names ad origins in no other route", () => {
    const config = JSON.parse(readFileSync(vercelPath, "utf8"));
    const adRoutes = config.headers
      .filter((rule) => rule.headers.some((header) => AD_HOST_RE.test(header.value)))
      .map((rule) => rule.source);
    assert.deepEqual(adRoutes, [], "ad origins must not be allowed on any header route; only the editor meta CSP names them");
  });

  it("the editor meta CSP is the single place ad origins are admitted", () => {
    const editor = readFileSync(join(ROOT, "editor.html"), "utf8");
    const meta = editor.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/i);
    assert.ok(meta, "editor.html must carry a CSP meta tag");
    const csp = meta[1];
    assert.match(csp, /connect-src 'self'/);
    assert.match(csp, /pagead2\.googlesyndication\.com/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /form-action 'none'/);
    assert.match(csp, /base-uri 'self'/);
  });

  it("the other app pages keep a strict, ad-free CSP", () => {
    const landing = readFileSync(join(ROOT, "index.html"), "utf8");
    const meta = landing.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/i);
    assert.ok(meta, "index.html must carry a CSP meta tag");
    assert.doesNotMatch(meta[1], AD_HOST_RE);
  });
});
