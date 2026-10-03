import "../css/fonts.css";
import { registerRedaktixWorker } from "./pwa.js";
import { startI18n, t } from "./i18n.js";
import { initMarketingAnalytics } from "./marketing-analytics.js";

document.addEventListener("DOMContentLoaded", () => {
  // Marketing surfaces only — never imported by the editor/app bundle.
  initMarketingAnalytics();
  const sectionLinks = {
    product: "#product",
    "how it works": "#how-it-works",
    "use cases": "#use-cases",
    security: "#security",
  };

  const links = document.querySelectorAll("a");

  links.forEach((link) => {
    const linkText = link.textContent.trim().toLowerCase();
    const targetSection = sectionLinks[linkText];

    if (targetSection) {
      link.setAttribute("href", targetSection);
    }

    if (linkText === "try it free") {
      link.setAttribute("href", "/editor.html");
    }
  });

  const logoLinks = document.querySelectorAll(
    'a[data-path="home"]'
  );

  logoLinks.forEach((logoLink) => {
    logoLink.setAttribute("href", "#product");
  });

  const editorButtonTexts = [
    "paste or upload a screenshot",
    "choose an image",
    "try redaktix free",
  ];

  const buttons = document.querySelectorAll("button");

  buttons.forEach((button) => {
    const buttonText = button.textContent
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

    const shouldOpenEditor = editorButtonTexts.some((text) =>
      buttonText.includes(text)
    );

    if (shouldOpenEditor) {
      button.addEventListener("click", () => {
        window.location.href = "/editor.html";
      });
    }
  });

  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      const targetId = link.getAttribute("href");

      if (!targetId || targetId === "#") {
        return;
      }

      const targetElement = document.querySelector(targetId);

      if (!targetElement) {
        return;
      }

      event.preventDefault();

      targetElement.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  });

  function fixLandingBrand() {
  const brandLink = document.querySelector(
    'header a[data-path="home"]'
  );

  if (!brandLink) {
    console.warn("Landing page brand link was not found.");
    return;
  }

  brandLink.setAttribute("href", "/");
  brandLink.setAttribute("aria-label", "Redaktix home");

  brandLink.innerHTML = `
    <span
      class="redaktix-brand-icon"
      aria-hidden="true"
    >
      <span class="material-symbols-outlined" translate="no">
        shield_lock
      </span>
    </span>

    <span class="redaktix-brand-text">
      Redaktix
    </span>
  `;
}

fixLandingBrand();
  initializeLocalProcessingBadge();
  registerRedaktixWorker();

  document.querySelectorAll("[data-open-dialog]").forEach((button) => {
    button.addEventListener("click", () => {
      const dialog = document.getElementById(button.getAttribute("data-open-dialog"));
      if (dialog && typeof dialog.showModal === "function") dialog.showModal();
    });
  });

  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => {
      button.closest("dialog")?.close();
    });
  });

  startI18n();
  console.log("Redaktix landing navigation loaded");
});

function initializeLocalProcessingBadge() {
  const badge = document.getElementById("localProcessingBadge");
  if (!badge) return;
  badge.setAttribute("data-i18n", "badge.local");
  badge.textContent = t("badge.local");
  if (badge.tagName === "A") badge.setAttribute("href", "/security/");
  const popover = document.getElementById("localProcessingPopover");
  const message = popover?.querySelector("p");
  if (message) {
    message.setAttribute("data-i18n", "badge.popover");
    message.textContent = t("badge.popover");
  }
}