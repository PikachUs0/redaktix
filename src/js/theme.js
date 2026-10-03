const THEME_KEY = "redaktix-theme";

function applyTheme() {
  const root = document.documentElement;
  root.dataset.theme = "dark";
  root.classList.add("dark");
  root.style.colorScheme = "dark";

  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute("content", "#0a0f1d");
  localStorage.setItem(THEME_KEY, "dark");
}

function initializeTheme() {
  applyTheme();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeTheme);
} else {
  initializeTheme();
}
