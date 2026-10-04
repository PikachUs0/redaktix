/**
 * Mobile editor layout guards (no browser): CSS mobile rules and panel i18n keys.
 * Full overflow / overlap verification requires a real phone or Playwright.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { messages } from "../src/js/i18n.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CSS = readFileSync(join(ROOT, "src", "css", "editor.css"), "utf8");

const PANEL_I18N_KEYS = [
  "editor.reviewSummary",
  "editor.reviewSummaryOne",
  "editor.reviewPosition",
  "editor.reviewPrevious",
  "editor.reviewNext",
  "editor.reviewRedact",
  "editor.reviewDismiss",
  "editor.reviewKeep",
  "editor.redactionStyle",
  "editor.ocrConfidenceHint",
  "editor.ocrConfidenceLow",
  "editor.ocrMayMisread",
  "editor.collapsePanel",
  "editor.clientSideFooter",
  "editor.scanAlwaysOnNote",
  "editor.suggest",
  "editor.privacyReview",
  "editor.privacyReviewCount",
  "editor.privacyReviewCountOne",
  "editor.expandPanel",
  "editor.localAnalysis",
  "badge.localCompact",
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

describe("mobile editor layout CSS and i18n", () => {
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

  it("defines TR/EN i18n keys for review panel and scan-note strings", () => {
    const missing = [];
    for (const key of PANEL_I18N_KEYS) {
      if (!messages.en[key]) missing.push(`en:${key}`);
      if (!messages.tr[key]) missing.push(`tr:${key}`);
    }
    assert.deepEqual(missing, [], `Missing panel i18n keys:\n${missing.join("\n")}`);
    assert.match(messages.en["editor.reviewSummary"], /\{n\}/);
    assert.match(messages.tr["editor.reviewSummary"], /\{n\}/);
    assert.match(messages.tr["editor.privacyReviewCount"], /\{n\}/);
    assert.match(messages.tr["editor.privacyReviewCount"], /potansiyel sorun/);
  });

  it("editor wires scan-note toggle and panel collapse without detection changes", () => {
    const editor = readFileSync(join(ROOT, "src", "js", "editor.js"), "utf8");
    assert.match(editor, /editor-scan-note-toggle/);
    assert.match(editor, /reviewPanelCollapseButton/);
    assert.match(editor, /editor\.reviewSummary/);
    assert.match(editor, /editor\.ocrConfidenceLow/);
    assert.match(editor, /privacyReviewHeading/);
    assert.match(editor, /editor\.privacyReviewCount/);
    assert.match(editor, /syncUnifiedMobileToolbar/);
    assert.match(editor, /editorDrawingToolsSlot/);
    assert.match(editor, /review-sheet-body/);
  });
});
