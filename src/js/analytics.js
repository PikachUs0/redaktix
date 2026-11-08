/**
 * First-party, origin-free product-event shim shared by every Redaktix surface.
 *
 * HARD BOUNDARY (enforced by the telemetry boundary test suite):
 * - This module issues no network request of its own and references no vendor
 *   analytics globals, endpoints, or tracker identifiers.
 * - trackEvent() only forwards to a same-page sink that the host page registered
 *   at globalThis[ANALYTICS_SINK_KEY]. Only the marketing landing page registers a
 *   sink (see landing.js), so on the redaction app surfaces the calls are inert.
 */

export const ANALYTICS_SINK_KEY = "__redaktixTrackEvent";

/**
 * Forward a first-party product event to the page's registered sink, if one exists.
 * Never throws and never sends anything on its own.
 *
 * @param {string} name Event name, e.g. "file_selected".
 * @param {Record<string, string | number | boolean | null>} [props] Flat event data.
 */
export function trackEvent(name, props) {
  const eventName = typeof name === "string" ? name.trim() : "";
  if (!eventName) return;
  try {
    const sink = globalThis[ANALYTICS_SINK_KEY];
    if (typeof sink !== "function") return;
    sink(eventName, props && typeof props === "object" ? { ...props } : {});
  } catch {
    // Analytics must never interrupt a redaction flow.
  }
}
