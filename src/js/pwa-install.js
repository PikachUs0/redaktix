/**
 * PWA install UI.
 *
 * Captures the browser's `beforeinstallprompt` event (suppressing the built-in
 * mini-infobar) and exposes a single "Install App" control that is injected into
 * the page's global header/navigation area on every surface — the landing page,
 * the editor, and the generated /tools/ pages.
 *
 * No network requests, no external origins: everything here is local DOM work.
 */

import { trackEvent } from "./analytics.js";

const BUTTON_ID = "redaktixInstallButton";
const STYLES_ID = "redaktixInstallStyles";
const MOUNT_SELECTOR = "[data-pwa-install-mount]";

const DOWNLOAD_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>`;

let deferredPrompt = null;
let initialized = false;

function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches === true
    || window.navigator.standalone === true;
}

function whenReady(callback) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", callback, { once: true });
  } else {
    callback();
  }
}

function mountTarget() {
  return document.querySelector(MOUNT_SELECTOR)
    || document.querySelector("header")
    || document.body;
}

function ensureStyles() {
  if (document.getElementById(STYLES_ID)) return;
  const style = document.createElement("style");
  style.id = STYLES_ID;
  style.textContent = [
    `#${BUTTON_ID} { display:inline-flex; align-items:center; gap:6px; border:1px solid rgba(96,165,250,.5);`
      + " border-radius:999px; padding:6px 12px; background:rgba(37,99,235,.18); color:#bfdbfe;"
      + " font:600 12px/1.2 system-ui,sans-serif; cursor:pointer; white-space:nowrap; }",
    `#${BUTTON_ID}:hover { background:rgba(37,99,235,.34); color:#e0ecff; }`,
    `#${BUTTON_ID}[hidden] { display:none; }`,
    `#${BUTTON_ID} svg { width:15px; height:15px; flex:0 0 auto; }`,
  ].join("\n");
  document.head.append(style);
}

function ensureButton() {
  const existing = document.getElementById(BUTTON_ID);
  if (existing) return existing;
  ensureStyles();
  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.hidden = true;
  button.setAttribute("aria-label", "Install the Redaktix app on this device");
  button.innerHTML = `${DOWNLOAD_ICON}<span>Install App</span>`;
  button.addEventListener("click", handleInstallClick);
  mountTarget().append(button);
  return button;
}

function showButton() {
  whenReady(() => { ensureButton().hidden = false; });
}

function hideButton() {
  const button = document.getElementById(BUTTON_ID);
  if (button) button.hidden = true;
}

async function handleInstallClick() {
  const prompt = deferredPrompt;
  if (!prompt) return;
  trackEvent("pwa_install_clicked");
  // A captured prompt event can only be used once.
  deferredPrompt = null;
  window.__redaktixInstallPrompt = null;
  prompt.prompt();
  try {
    await prompt.userChoice;
  } catch {
    // The user dismissed the dialog or the prompt could not be shown.
  }
  hideButton();
}

export function initPwaInstall() {
  if (initialized || typeof document === "undefined") return;
  initialized = true;

  // Seed from the shared capture in pwa.js in case the event fired before this ran.
  if (window.__redaktixInstallPrompt) deferredPrompt = window.__redaktixInstallPrompt;

  window.addEventListener("beforeinstallprompt", (event) => {
    // Suppress the browser mini-infobar; the prompt is driven by our own button.
    event.preventDefault();
    deferredPrompt = event;
    window.__redaktixInstallPrompt = event;
    if (!isStandalone()) showButton();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    window.__redaktixInstallPrompt = null;
    hideButton();
  });

  if (!isStandalone()) {
    whenReady(() => {
      ensureButton();
      if (deferredPrompt) showButton();
    });
  }
}
