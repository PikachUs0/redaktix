/**
 * Mobile editor layout guards (no browser): CSS mobile rules and review-panel copy.
 * Full overflow / overlap verification requires a real phone or Playwright.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CSS = readFileSync(join(ROOT, "src", "css", "editor.css"), "utf8");
const EDITOR = readFileSync(join(ROOT, "src", "js", "editor.js"), "utf8");

/** English review-panel and scan-note copy that must stay directly in the editor source. */
const PANEL_COPY = [
  "Previous",
  "Next",
  "Redact",
  "Dismiss",
  "Keep Visible",
  "Redaction style",
  "OCR confidence. This percentage does not prove the value is valid.",
  "Sensitive Data",
  "Hide all",
  "Analysis runs locally in this browser",
  "Expand review panel",
  "Collapse review panel",
  "Cards, IBAN, TCKN, VKN, API keys and private keys are always scanned.",
];

/** Extract @media (max-width: Npx) blocks for N <= 640. */
function extractMobileMediaBlocks(css) {
  const blocks = [];
  const re = /@media\s*\(\s*max-width\s*:\s*(\d+)px\s*\)\s*\{/g;
  let match;
  while ((match = re.exec(css))) {
    const max = Number(match[1]);
    if (max > 640) continue;
    const start = match.index + match[0].length - 1;
    let depth = 0;
    for (let i = start; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          blocks.push({ max, body: css.slice(start + 1, i) });
          break;
        }
      }
    }
  }
  return blocks;
}

describe("mobile editor layout CSS and copy", () => {
  it("mobile rules (max-width <= 640px) do not set hard-coded min-width above 360px", () => {
    const blocks = extractMobileMediaBlocks(CSS);
    assert.ok(blocks.length > 0, "expected mobile @media blocks");
    const hits = [];
    for (const block of blocks) {
      const minWidthRe = /min-width\s*:\s*(\d+(?:\.\d+)?)(px)/gi;
      let m;
      while ((m = minWidthRe.exec(block.body))) {
        const px = Number(m[1]);
        if (px > 360) hits.push(`@media (max-width: ${block.max}px) min-width: ${px}px`);
      }
    }
    assert.deepEqual(hits, [], `Hard min-width > 360px in mobile rules:\n${hits.join("\n")}`);
  });

  it("mobile rules turn the review panel into a capped bottom sheet", () => {
    const blocks = extractMobileMediaBlocks(CSS);
    const mobileCss = blocks.map((b) => b.body).join("\n");
    assert.ok(mobileCss.includes("#sensitiveDataPanel"), "missing mobile block that styles #sensitiveDataPanel");
    assert.match(mobileCss, /max-height\s*:\s*min\(\s*45vh/);
    assert.match(mobileCss, /height\s*:\s*min\(\s*45vh/);
    assert.match(mobileCss, /position\s*:\s*fixed/);
    assert.match(mobileCss, /#editorWorkspace[\s\S]*min-height\s*:\s*45vh/);
    assert.match(mobileCss, /safe-area-inset/);
    assert.match(mobileCss, /\.editor-scan-note-toggle/);
    assert.match(mobileCss, /\.editor-clipboard-notification/);
    assert.match(mobileCss, /\.review-sheet-body/);
    assert.match(mobileCss, /\.editor-unified-tool-rail/);
  });

  it("keeps the review panel and scan-note copy in English inside the editor source", () => {
    const missing = PANEL_COPY.filter((copy) => !EDITOR.includes(copy));
    assert.deepEqual(missing, [], `Missing English panel copy:\n${missing.join("\n")}`);
    assert.match(EDITOR, /`Redaktix found \$\{detections\.length\} potential sensitive/);
    assert.match(EDITOR, /`\$\{reviewIndex \+ 1\} of \$\{detections\.length\}`/);
  });

  it("editor wires scan-note toggle and panel collapse without detection changes", () => {
    assert.match(EDITOR, /editor-scan-note-toggle/);
    assert.match(EDITOR, /reviewPanelCollapseButton/);
    assert.match(EDITOR, /privacyReviewHeading/);
    assert.match(EDITOR, /syncUnifiedMobileToolbar/);
    assert.match(EDITOR, /editorDrawingToolsSlot/);
    assert.match(EDITOR, /review-sheet-body/);
  });
});
