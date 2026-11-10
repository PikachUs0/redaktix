// src/ads/adguard.js
// The ONLY place ad-network code is ever injected. No <script> or
// <ins class="adsbygoogle"> may exist in static HTML. If the guard says no,
// no ad code is fetched and no ad DOM is created.
//
// Privacy gates (any one is enough to keep ads off):
//   ?privacy_mode=true|1, ?ref=hn|reddit|ph|..., sessionStorage sticky flag,
//   privacy referrer host, Global Privacy Control, /verify, /privacy,
//   and every /tools/* route while adsInToolPages is false.

/** AdSense loader origin. Kept here so the boundary test can scope the exception. */
export const AD_SCRIPT_SRC =
  "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";

export const DEFAULT_AD_CONFIG = Object.freeze({
  // No ads are injected until real values are configured.
  client: "", // TODO: real AdSense publisher ID, e.g. "ca-pub-0000000000000000"
  slots: {}, // TODO: real slot IDs, e.g. { export: "0000000000" }
  blockedPaths: [/^\/verify\/?$/, /^\/privacy\/?$/],
  toolPagePrefix: "/tools/",
  adsInToolPages: false,
  respectGPC: true,
  privacyRefs: [
    "hn",
    "reddit",
    "ph",
    "producthunt",
    "lobsters",
    "ih",
    "indiehackers",
    "alternativeto",
    "privacy",
  ],
  privacyHosts: [
    "news.ycombinator.com",
    "reddit.com",
    "redd.it",
    "producthunt.com",
    "lobste.rs",
    "indiehackers.com",
    "alternativeto.net",
  ],
  storageKey: "rdx_privacy_mode",
});

function safeGet(fn, fallback = null) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function browserRuntime() {
  return {
    location: typeof location !== "undefined"
      ? location
      : { pathname: "/", search: "" },
    document: typeof document !== "undefined" ? document : null,
    navigator: typeof navigator !== "undefined" ? navigator : {},
    sessionStorage: safeGet(() => sessionStorage, null),
    window: typeof window !== "undefined" ? window : {},
  };
}

function referrerHost(runtime) {
  const referrer = runtime.document?.referrer || runtime.location?.referrer || "";
  return safeGet(() => new URL(referrer).hostname.toLowerCase(), "");
}

function storageGet(storage, key) {
  return safeGet(() => storage?.getItem(key) ?? null, null);
}

function storageSet(storage, key, value) {
  safeGet(() => storage?.setItem(key, value));
}

function storageRemove(storage, key) {
  safeGet(() => storage?.removeItem(key));
}

/**
 * Pure decision function. Exported so tests can exercise every privacy signal
 * without a browser.
 *
 * @param {typeof DEFAULT_AD_CONFIG} config
 * @param {{ location?: object, document?: object, navigator?: object, sessionStorage?: object }} runtime
 * @returns {{ serve: boolean, reason: string, pending?: boolean }}
 */
export function evaluateAdDecision(config, runtime = {}) {
  const params = new URLSearchParams(runtime.location?.search || "");
  const path = runtime.location?.pathname || "/";
  const storage = runtime.sessionStorage;

  // Explicit way to clear the sticky flag while testing.
  if ((params.get("privacy_mode") || "").toLowerCase() === "off") {
    storageRemove(storage, config.storageKey);
  }

  if (config.blockedPaths.some((re) => re.test(path))) {
    return { serve: false, reason: "blocked-path" };
  }
  if (!config.adsInToolPages && path.startsWith(config.toolPagePrefix)) {
    return { serve: false, reason: "tool-page" };
  }

  const sticky = (reason) => {
    storageSet(storage, config.storageKey, reason);
    return { serve: false, reason };
  };

  const pm = (params.get("privacy_mode") || "").toLowerCase();
  if (pm === "true" || pm === "1") return sticky("param");

  const tag = (params.get("ref") || params.get("utm_source") || "").toLowerCase();
  if (tag && config.privacyRefs.includes(tag)) return sticky("ref-param");

  const stored = storageGet(storage, config.storageKey);
  if (stored) return { serve: false, reason: `session:${stored}` };

  const host = referrerHost(runtime);
  if (host && config.privacyHosts.some((h) => host === h || host.endsWith(`.${h}`))) {
    return sticky("referrer");
  }

  if (config.respectGPC && runtime.navigator?.globalPrivacyControl === true) {
    return { serve: false, reason: "gpc" };
  }

  // Ads stay off until a real publisher ID and slot ID are configured.
  if (!config.client || !config.slots || !Object.keys(config.slots).length) {
    return { serve: false, reason: "unconfigured" };
  }

  return { serve: true, reason: "organic" };
}

/**
 * Build a guard bound to a runtime. The default export at the bottom binds to
 * the real browser globals; tests pass a fake runtime.
 *
 * @param {{ config?: object, runtime?: object }} [options]
 */
export function createAdGuard(options = {}) {
  const config = {
    ...DEFAULT_AD_CONFIG,
    ...(options.config || {}),
    slots: { ...(options.config?.slots || DEFAULT_AD_CONFIG.slots) },
  };
  const runtime = options.runtime || browserRuntime();
  const decision = evaluateAdDecision(config, runtime);
  const doc = runtime.document;

  if (doc?.documentElement?.dataset) {
    doc.documentElement.dataset.ads = decision.serve ? "on" : "off";
    doc.documentElement.dataset.adsReason = decision.reason;
  }

  let loader = null;

  function loadAdSense() {
    if (!decision.serve) return Promise.resolve(false);
    if (loader) return loader;
    if (!doc?.head || typeof doc.createElement !== "function") {
      return Promise.resolve(false);
    }
    loader = new Promise((resolve) => {
      const script = doc.createElement("script");
      script.async = true;
      script.crossOrigin = "anonymous";
      script.src = `${AD_SCRIPT_SRC}?client=${encodeURIComponent(config.client)}`;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      doc.head.appendChild(script);
    });
    return loader;
  }

  /**
   * Mount an ad inside a container that is already placed away from every
   * button, dropzone and canvas. Returns false and leaves the container empty
   * and hidden when the guard declines.
   *
   * @param {Element|null} container
   * @param {string} [name]
   */
  async function mountSlot(container, name = "export") {
    if (!container) return false;
    const hide = () => {
      if (typeof container.replaceChildren === "function") {
        container.replaceChildren();
      } else {
        container.innerHTML = "";
      }
      container.hidden = true;
      return false;
    };
    if (!decision.serve) return hide();
    const slotId = config.slots?.[name];
    if (!slotId) return hide();
    if (!(await loadAdSense())) return hide();
    if (typeof doc?.createElement !== "function") return hide();

    const label = doc.createElement("p");
    label.className = "rdx-ad-label";
    label.textContent = "Advertisement";

    const ins = doc.createElement("ins");
    ins.className = "adsbygoogle";
    if (ins.style) ins.style.display = "block";
    if (ins.dataset) {
      ins.dataset.adClient = config.client;
      ins.dataset.adSlot = slotId;
      ins.dataset.adFormat = "auto";
      ins.dataset.fullWidthResponsive = "true";
    }

    if (typeof container.replaceChildren === "function") {
      container.replaceChildren(label, ins);
    } else {
      container.innerHTML = "";
      container.appendChild(label);
      container.appendChild(ins);
    }
    container.hidden = false;
    safeGet(() => {
      runtime.window.adsbygoogle = runtime.window.adsbygoogle || [];
      runtime.window.adsbygoogle.push({});
    });
    return true;
  }

  return {
    config,
    shouldServeAds: () => decision.serve,
    adDecision: () => ({ ...decision }),
    loadAdSense,
    mountSlot,
  };
}

const defaultGuard = createAdGuard();

export const shouldServeAds = defaultGuard.shouldServeAds;
export const adDecision = defaultGuard.adDecision;
export const loadAdSense = defaultGuard.loadAdSense;
export const mountSlot = defaultGuard.mountSlot;
