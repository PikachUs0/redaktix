/**
 * Marketing-only, first-party, cookieless aggregate traffic hook.
 *
 * HARD BOUNDARY:
 * - Import ONLY from landing.js (marketing/landing page).
 * - NEVER import from editor.js, tool-page.js, or any redaction/OCR module.
 * - No third-party scripts (no gtag, GA, GTM, pixels).
 * - Requests are same-origin only; disabled when no endpoint is configured.
 *
 * Configure on the landing page:
 *   <meta name="redaktix-analytics-endpoint" content="/collect">
 * Leave content empty (or omit) to keep analytics fully off.
 */

const META_NAME = "redaktix-analytics-endpoint";

function readConfiguredEndpoint() {
  try {
    const meta = document.querySelector(`meta[name="${META_NAME}"]`);
    const raw = String(meta?.getAttribute("content") || "").trim();
    return raw;
  } catch {
    return "";
  }
}

/**
 * Resolve and validate a same-origin collect URL.
 * @param {string} endpoint
 * @returns {URL | null}
 */
export function resolveSameOriginEndpoint(endpoint, origin = globalThis.location?.origin) {
  const raw = String(endpoint || "").trim();
  if (!raw || !origin) return null;
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Build a cookieless aggregate payload (no client id, no cookies).
 */
export function buildPageviewPayload({ pathname, referrerHostname, ts } = {}) {
  return {
    t: "pageview",
    p: String(pathname || "/"),
    r: String(referrerHostname || ""),
    ts: Number.isFinite(ts) ? ts : Date.now(),
  };
}

function referrerHostname(referrer) {
  try {
    if (!referrer) return "";
    return new URL(referrer).hostname || "";
  } catch {
    return "";
  }
}

/**
 * @param {{ endpoint?: string, send?: (url: URL, body: string) => boolean | void }} [options]
 * @returns {boolean} true if a beacon/fetch was attempted
 */
export function initMarketingAnalytics(options = {}) {
  if (typeof window === "undefined" || typeof document === "undefined") return false;

  // Defense in depth: never run on the editor surface.
  const path = String(window.location?.pathname || "");
  if (/editor\.html$/i.test(path) || path.includes("/editor")) return false;

  const endpoint = options.endpoint ?? readConfiguredEndpoint();
  const url = resolveSameOriginEndpoint(endpoint, window.location.origin);
  if (!url) return false;

  const payload = buildPageviewPayload({
    pathname: window.location.pathname || "/",
    referrerHostname: referrerHostname(document.referrer),
    ts: Date.now(),
  });
  const body = JSON.stringify(payload);

  if (typeof options.send === "function") {
    options.send(url, body);
    return true;
  }

  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      return Boolean(navigator.sendBeacon(url.pathname + url.search, blob));
    }
  } catch {
    // fall through to fetch
  }

  try {
    if (typeof fetch === "function") {
      fetch(url.pathname + url.search, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
        credentials: "omit",
        mode: "same-origin",
      }).catch(() => {});
      return true;
    }
  } catch {
    return false;
  }

  return false;
}
