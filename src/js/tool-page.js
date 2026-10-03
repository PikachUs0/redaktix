import "../css/tool-page.css";
import { loadOcrModule } from "./ocr-loader.js";
import { stashPendingToolFile } from "./tool-handoff.js";

const root = document.querySelector("[data-tool-slug]");
const slug = root?.dataset.toolSlug || "";
const zone = document.querySelector("[data-tool-dropzone]");
const input = document.getElementById("toolFileInput");
const status = document.querySelector("[data-tool-status]");

async function acceptToolFile(file) {
  if (!file || !slug) return;
  if (status) status.textContent = "Opening the local editor…";
  loadOcrModule().catch(() => {});
  try {
    await stashPendingToolFile(slug, file);
  } catch {
    if (status) status.textContent = "Open the editor and drop the image there. Storage was unavailable.";
  }
  window.location.href = `/editor.html?tool=${encodeURIComponent(slug)}`;
}

if (zone && input) {
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
  });
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    acceptToolFile(event.dataTransfer?.files?.[0]);
  });
  input.addEventListener("change", () => {
    acceptToolFile(input.files?.[0]);
  });
  document.addEventListener("paste", (event) => {
    const items = Array.from(event.clipboardData?.items || []);
    const image = items.find((item) => item.type.startsWith("image/"));
    const file = image?.getAsFile();
    if (file) acceptToolFile(file);
  });
}
