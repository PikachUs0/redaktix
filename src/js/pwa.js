import { onLanguageChange, t } from "./i18n.js";

let offlineReadyState = false;
let updatePromptVisible = false;

function setOfflineReady(ready) {
  offlineReadyState = ready;
  const badge = document.getElementById("offlineReadyBadge");
  if (!badge) return;
  badge.hidden = false;
  const key = ready ? "badge.offlineReady" : "badge.localFirst";
  badge.setAttribute("data-i18n", key);
  badge.textContent = t(key);
}

function ensureUpdateBanner() {
  let banner = document.getElementById("pwaUpdateBanner");
  if (banner) return banner;
  banner = document.createElement("div");
  banner.id = "pwaUpdateBanner";
  banner.setAttribute("role", "status");
  banner.hidden = true;
  banner.style.cssText = [
    "position:fixed",
    "left:50%",
    "bottom:1.25rem",
    "transform:translateX(-50%)",
    "z-index:9999",
    "display:flex",
    "gap:0.75rem",
    "align-items:center",
    "padding:0.75rem 1rem",
    "border-radius:0.75rem",
    "background:#111827",
    "color:#f9fafb",
    "box-shadow:0 10px 30px rgba(0,0,0,.35)",
    "font:500 0.875rem/1.3 system-ui,sans-serif",
    "max-width:min(92vw,28rem)",
  ].join(";");
  const message = document.createElement("span");
  message.id = "pwaUpdateMessage";
  const button = document.createElement("button");
  button.id = "pwaUpdateReload";
  button.type = "button";
  button.style.cssText = [
    "border:0",
    "border-radius:999px",
    "padding:0.4rem 0.85rem",
    "background:#38bdf8",
    "color:#0f172a",
    "font:600 0.8rem/1 system-ui,sans-serif",
    "cursor:pointer",
    "white-space:nowrap",
  ].join(";");
  banner.append(message, button);
  document.body.append(banner);
  return banner;
}

function showUpdateAvailablePrompt(registration) {
  if (updatePromptVisible) return;
  updatePromptVisible = true;
  const banner = ensureUpdateBanner();
  const message = document.getElementById("pwaUpdateMessage");
  const button = document.getElementById("pwaUpdateReload");
  message.textContent = t("pwa.updateAvailable");
  button.textContent = t("pwa.reload");
  banner.hidden = false;
  button.onclick = () => {
    const waiting = registration?.waiting;
    if (waiting) {
      waiting.postMessage({ type: "SKIP_WAITING" });
    }
    window.location.reload();
  };
}

onLanguageChange(() => {
  setOfflineReady(offlineReadyState);
  if (updatePromptVisible) {
    const message = document.getElementById("pwaUpdateMessage");
    const button = document.getElementById("pwaUpdateReload");
    if (message) message.textContent = t("pwa.updateAvailable");
    if (button) button.textContent = t("pwa.reload");
  }
});

function watchForUpdates(registration) {
  if (!registration) return;
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      // A new worker finished installing while this page already had a controller.
      if (worker.state === "installed" && navigator.serviceWorker.controller) {
        showUpdateAvailablePrompt(registration);
      }
    });
  });
  if (registration.waiting && navigator.serviceWorker.controller) {
    showUpdateAvailablePrompt(registration);
  }
  // Re-check when the tab is focused so long-lived sessions pick up new builds.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      registration.update().catch(() => {});
    }
  });
}

export function registerRedaktixWorker() {
  setOfflineReady(Boolean(navigator.serviceWorker?.controller));
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("beforeinstallprompt", (event) => {
    window.__redaktixInstallPrompt = event;
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    setOfflineReady(true);
  });
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((registration) => {
    if (registration.active || navigator.serviceWorker.controller) setOfflineReady(true);
    watchForUpdates(registration);
    registration.update().catch(() => {});
  }).catch(() => {
    setOfflineReady(false);
  });
}
