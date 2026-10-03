import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EMPTY_DROPZONE_HINT,
  LOCAL_PROCESSING_BADGE_LABEL,
  REVIEW_COMPLETE_TITLE,
  REVIEW_SHORTCUT_LEGEND,
  easeOutCubic,
  exportReviewPrompt,
  focusIndexAfterRemoval,
  localProcessingExplanation,
  reviewPositionLabel,
  reviewShortcutDirection,
  reviewSummary,
  reviewZoomForBox,
  stepReviewIndex,
} from "../src/js/app.js";

describe("privacy review mode", () => {
  it("summarizes the number of potential sensitive areas", () => {
    assert.equal(reviewSummary(0), "Redaktix found 0 potential sensitive areas");
    assert.equal(reviewSummary(1), "Redaktix found 1 potential sensitive area");
    assert.equal(reviewSummary(4), "Redaktix found 4 potential sensitive areas");
  });

  it("cycles the review index and labels the current step", () => {
    assert.equal(reviewPositionLabel(0, 3), "1 of 3");
    assert.equal(stepReviewIndex(0, 3, 1), 1);
    assert.equal(stepReviewIndex(2, 3, 1), 0);
    assert.equal(stepReviewIndex(0, 3, -1), 2);
    assert.equal(stepReviewIndex(-1, 2, 1), 1);
    assert.equal(stepReviewIndex(0, 0, 1), -1);
  });

  it("moves to the next remaining item after a decision", () => {
    assert.equal(focusIndexAfterRemoval(1, 4), 1);
    assert.equal(focusIndexAfterRemoval(3, 4), 0);
    assert.equal(focusIndexAfterRemoval(0, 1), -1);
  });

  it("fits a detection box inside the viewport without passing the zoom limits", () => {
    const zoom = reviewZoomForBox(
      { width: 100, height: 40 },
      { width: 800, height: 600 },
      { min: 0.25, max: 3 }
    );
    assert.equal(zoom, 3);
    assert.equal(
      reviewZoomForBox(
        { width: 2000, height: 1000 },
        { width: 400, height: 300 },
        { min: 0.25, max: 3 }
      ),
      0.25
    );
  });

  it("eases motion from 0 to 1", () => {
    assert.equal(easeOutCubic(0), 0);
    assert.equal(easeOutCubic(1), 1);
    assert.ok(easeOutCubic(0.5) > 0.5);
  });

  it("asks before export only while suggestions are unresolved", () => {
    assert.equal(exportReviewPrompt(0), null);
    assert.equal(exportReviewPrompt(1), "You have 1 unreviewed suggestion.");
    assert.equal(exportReviewPrompt(3), "You have 3 unreviewed suggestions.");
  });

  it("keeps the launch polish copy stable", () => {
    assert.equal(LOCAL_PROCESSING_BADGE_LABEL, "🟢 100% Local Processing (Zero Data Upload)");
    assert.match(localProcessingExplanation(), /WebAssembly/);
    assert.match(localProcessingExplanation(), /external network/);
    assert.equal(REVIEW_COMPLETE_TITLE, "Privacy Check Complete - Ready to Export");
    assert.equal(EMPTY_DROPZONE_HINT, "Drop screenshot here, press Ctrl+V to paste, or browse files");
    assert.equal(
      REVIEW_SHORTCUT_LEGEND,
      "[← / →]: Next/Prev item | [Tab]: Focus actions | [Esc]: Cancel highlight"
    );
  });

  it("maps review navigation keys", () => {
    assert.equal(reviewShortcutDirection("ArrowRight"), 1);
    assert.equal(reviewShortcutDirection("ArrowLeft"), -1);
    assert.equal(reviewShortcutDirection("Tab", false), 1);
    assert.equal(reviewShortcutDirection("Tab", true), -1);
    assert.equal(reviewShortcutDirection("Enter"), 0);
  });
});
