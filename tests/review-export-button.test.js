/**
 * Review-complete Download/İndir must open export without synthesizing a header click
 * (document click listeners would immediately close the menu).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const EDITOR = readFileSync(join(ROOT, "src", "js", "editor.js"), "utf8");

describe("review-complete export button", () => {
  it("wires reviewExportButton through openExportFromReview with stopPropagation", () => {
    assert.match(EDITOR, /reviewExportButton/);
    assert.match(EDITOR, /openExportFromReview/);
    assert.match(
      EDITOR,
      /reviewExportButton[\s\S]{0,240}stopPropagation/,
      "click handler must stopPropagation so the document closer does not kill the menu"
    );
    assert.equal(
      /reviewExportButton[\s\S]{0,200}editorDownloadButton"\)\?\.click\(/.test(EDITOR),
      false,
      "must not call editorDownloadButton.click() from the review panel"
    );
  });
});
