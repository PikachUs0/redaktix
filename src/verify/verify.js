/*
 * /verify/ page behaviour.
 *
 * Two read-only helpers, both same-origin and both optional: if either fails
 * the page still works, because every claim it makes is in the static HTML.
 *
 *  1. Build fingerprint — read from the deployed service worker's stamped
 *     `BUILD_HASH` so visitors can compare it with a local build.
 *  2. Live CSP — fetch one Redaktix page and print the Content-Security-Policy
 *     header the host actually sends.
 *
 * No file data is ever involved, and no third-party origin is contacted.
 */

import { initPwaInstall } from "../js/pwa-install.js";

// Same shell behaviour as the generated tool pages: the header carries
// data-pwa-install-mount, so give it the install control.
initPwaInstall();

const cspRoute = document.getElementById("csp-route");
const cspButton = document.getElementById("csp-btn");
const cspOutput = document.getElementById("csp-out");
const buildLabel = document.getElementById("build");

/** Show the deployed build fingerprint, when the host sends a real build. */
async function showBuildFingerprint() {
  if (!buildLabel) return;
  buildLabel.textContent = "Build: checking…";
  try {
    const response = await fetch("/sw.js", { cache: "no-store", credentials: "omit" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const source = await response.text();
    const match = source.match(/const BUILD_HASH = "([^"]*)";/);
    const hash = match ? match[1] : "";
    if (hash && hash !== "dev") {
      buildLabel.textContent = `Build: ${hash}`;
      buildLabel.setAttribute("data-sha", hash);
      return;
    }
    buildLabel.textContent = "Build: local dev (unversioned)";
  } catch {
    buildLabel.textContent = "Build: unavailable";
  }
}

/** Print the Content-Security-Policy header the host returns for a route. */
async function showLivePolicy() {
  if (!cspRoute || !cspButton || !cspOutput) return;
  const route = cspRoute.value;
  cspButton.disabled = true;
  cspOutput.textContent = `Requesting ${route} …`;
  try {
    // HEAD keeps the check to headers only; the route itself is a static page.
    const response = await fetch(route, { method: "HEAD", cache: "no-store", credentials: "omit" });
    const policy = response.headers.get("content-security-policy");
    if (!policy) {
      cspOutput.textContent = `No Content-Security-Policy header on ${route} (HTTP ${response.status}). `
        + "Headers are sent by the host from vercel.json, so they appear only on a deployed build, not on the local dev server.";
      return;
    }
    cspOutput.textContent = `${route} — HTTP ${response.status}\n\n${policy}`;
  } catch (error) {
    cspOutput.textContent = `Could not read headers for ${route}: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    cspButton.disabled = false;
  }
}

cspButton?.addEventListener("click", () => {
  void showLivePolicy();
});

void showBuildFingerprint();
