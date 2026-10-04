import "../css/fonts.css";
import { Capacitor } from "@capacitor/core";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import "./theme.js";
import { applyI18n, onLanguageChange, startI18n, t } from "./i18n.js";
import { registerRedaktixWorker } from "./pwa.js";
import {
  deleteUserCustomRule,
  loadCustomRules,
  readUserCustomRules,
  saveUserCustomRule,
  setUserCustomRuleEnabled,
  testCustomPattern,
} from "./custom-rules.js";
import {
  DEFAULT_DETECTION_PROFILE,
  filterDetectionsForProfile,
  isAlwaysOnDetector,
  isDetectorEnabled,
  limitToToolDetectors,
} from "./detection-profiles.js";
import {
  BATCH_IMAGE_LIMIT,
  batchOverallLabel,
  batchStatusLabel,
  blackoutDetections,
  createStoredZip,
  easeOutCubic,
  EMPTY_DROPZONE_HINT,
  exportReviewPrompt,
  focusIndexAfterRemoval,
  REVIEW_COMPLETE_TITLE,
  REVIEW_SHORTCUT_LEGEND,
  reviewPositionLabel,
  reviewShortcutDirection,
  reviewSummary,
  reviewZoomForBox,
  selectBatchFiles,
  stepReviewIndex,
  uniqueZipNames,
} from "./app.js";
import { loadOcrModule, ocrModuleRequested } from "./ocr-loader.js";
import { sameTcknGlyph, spatiallyDuplicate } from "./ocr-adaptive.js";
import { getToolBySlug } from "../tools/registry.js";
import { takePendingToolFile } from "./tool-handoff.js";
import { canvasToBlob, createCleanOutputCanvas as buildCleanOutputCanvas } from "./export-clean.js";
let activeRedaktixEditor = null;

export class RedaktixEditor {
  applyAllDetections(type = "blackout") {
    return activeRedaktixEditor?.applyAllDetections(type);
  }

  hideSingleDetection(id) {
    return activeRedaktixEditor?.hideSingleDetection(id);
  }

  destroy() {
    return activeRedaktixEditor?.destroy() ?? Promise.resolve();
  }
}

import {
  envelopeForMatchedWords,
  findTcknMatches,
  tcknEvidence,
  mapNormalizedBox,
  normalizeBox,
  padBoundingBox,
  extractApiTokenCandidates,
  extractIpv6Candidates,
  extractLocationCandidates,
  canonicalPersonNameKey,
  extractPersonNameCandidates,
  extractPhoneCandidates as extractDetectedPhoneCandidates,
  detectPhonesInScan,
  detectIpv6InScan,
  detectGroupedSecretsInScan,
  extractVknCandidates,
  detectCreditCard,
  buildDetectionReview,
  detectionsForAutomaticRedaction,
  cloneDetectionForHistory,
  matchCustomRules,
  phoneReviewHints,
} from "./sensitive-detectors.js";
import {
  createDetection as createStructuredDetection,
  detectStructuredDataFromLines as detectStructuredLines,
} from "./structured-lines.js";
import { suppressShadowedDetections } from "./detection-suppression.js";
const FIXED_UI_SELECTOR = ".material-symbols-outlined, kbd, code";

function markFixedUi(node) {
  if (!(node instanceof Element)) return;
  const elements = node.matches(FIXED_UI_SELECTOR) ? [node] : [];
  node.querySelectorAll(FIXED_UI_SELECTOR).forEach((element) => elements.push(element));
  elements.forEach((element) => element.setAttribute("translate", "no"));
}

function watchFixedUi() {
  markFixedUi(document.body);
  const observer = new MutationObserver((records) => {
    records.forEach((record) => {
      record.addedNodes.forEach((node) => markFixedUi(node));
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

document.addEventListener("DOMContentLoaded", () => {
  watchFixedUi();
  startI18n();
  removeDuplicateBrandText();

  const workspace = document.getElementById("editorWorkspace");
  const sensitiveDataPanel = document.getElementById("sensitiveDataPanel");

  if (!workspace) {
    console.error("Editor workspace could not be found.");
    return;
  }

  let ocrLinesById = new Map();

  const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
  const maximumFileSize = 25 * 1024 * 1024;

  const editorState = {
    file: null,
    image: null,
    canvas: null,
    context: null,
    objectUrl: null,
    zoom: 1,
    minimumZoom: 0.25,
    maximumZoom: 3,
    zoomMode: "fit",
    activeTool: "blackout",
    redactionStyle: "blackout",
    blurRadius: 10,
    pixelSize: 8,
    selectedRedactionId: null,
    selectionInteraction: null,
    selectionResizeHandle: null,
    selectionOriginalWidth: 0,
    selectionOriginalHeight: 0,
    selectionStartX: 0,
    selectionStartY: 0,
    selectionOriginalX: 0,
    selectionOriginalY: 0,
    selectionHasMoved: false,
    isAdjustingRegionStrength: false,
    regionStrengthOriginalValue: null,
    redactions: [],
    detections: [],
    detectionProfile: DEFAULT_DETECTION_PROFILE,
    isScanning: false,
    scanRequestId: 0,
    history: [],
    historyIndex: -1,
    isRestoringHistory: false,
    isDrawing: false,
    startX: 0,
    startY: 0,
    previewX: 0,
    previewY: 0,
    compareMode: false,
    compareSplit: 0.5,
    exportFormat: "png",
    exportQuality: 0.92,
    pinchGesture: null,
    reviewActive: false,
    reviewFinished: false,
    reviewIndex: -1,
    reviewFocusId: null,
    reviewPulse: 0,
    reviewMotionId: 0,
    reviewMotionFrame: 0,
    reviewPulseFrame: 0,
    batchItems: [],
    batchActiveId: null,
    batchRunning: false,
    batchPinned: false,
    batchAutoRedact: false,
    scanImageOverride: null,
    toolDetectors: null,
  };

  const activePointers = new Map();

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.id = "imageFileInput";
  fileInput.accept = allowedTypes.join(",");
  fileInput.multiple = true;
  fileInput.hidden = true;
  document.body.appendChild(fileInput);

  const emptyState = document.createElement("div");
  emptyState.id = "editorEmptyState";
  emptyState.className = "editor-empty-state";
  emptyState.innerHTML = `
    <div class="editor-empty-card">
      <div class="editor-empty-icon" aria-hidden="true">
        <span class="material-symbols-outlined" translate="no">screenshot</span>
      </div>
      <h1 data-i18n="editor.pasteTitle">Paste or drop a screenshot</h1>
      <p class="editor-empty-description" data-i18n="editor.dropHint">
        ${EMPTY_DROPZONE_HINT}
      </p>
      <div class="editor-empty-actions">
        <button id="chooseImageButton" class="editor-empty-button" type="button">
          <span class="material-symbols-outlined" translate="no" aria-hidden="true">add_photo_alternate</span>
          <span data-i18n="drop.choose">Choose an image</span>
        </button>
        <kbd translate="no">Ctrl + V</kbd>
      </div>
      <p id="selectedFileMessage" class="editor-selected-file" hidden></p>
      <span class="editor-supported-formats">PNG, JPG and WebP</span>
      <div class="editor-local-message">
        <span class="material-symbols-outlined" translate="no" aria-hidden="true">lock</span>
        <span data-i18n="editor.stays">Your image stays on this device</span>
      </div>
      <p class="editor-shortcut-legend">${REVIEW_SHORTCUT_LEGEND}</p>
    </div>
  `;
  workspace.appendChild(emptyState);
  applyI18n(emptyState);
  onLanguageChange(() => {
    renderSensitiveDataPanel();
    syncToolIntensityBar();
    const statusKey = {
      select: "editor.statusSelect",
      blackout: "editor.statusBlackout",
      blur: "editor.statusBlur",
      pixelate: "editor.statusPixelate",
    }[editorState.activeTool];
    if (statusKey) updateActiveToolStatus(t(statusKey));
    updateHistoryButtons();
    applyI18n(document);
  });
  applyI18n(emptyState);
  onLanguageChange(() => {
    applyI18n(document);
    renderSensitiveDataPanel();
    syncToolIntensityBar();
    const statusKey = {
      select: "editor.statusSelect",
      blackout: "editor.statusBlackout",
      blur: "editor.statusBlur",
      pixelate: "editor.statusPixelate",
    }[editorState.activeTool];
    if (statusKey) updateActiveToolStatus(t(statusKey));
  });

  const chooseImageButton = document.getElementById("chooseImageButton");
  const selectedFileMessage = document.getElementById("selectedFileMessage");

  chooseImageButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    openDeviceImagePicker();
  });
  emptyState.addEventListener("click", () => openDeviceImagePicker());
  fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files || []);
    fileInput.value = "";
    if (files.length > 1 || editorState.batchItems.length) acceptBatchFiles(files);
    else if (files[0]) loadImageFile(files[0]);
  });



  document.addEventListener("paste", handlePaste);
  initializeDragAndDrop();
  initializeHeaderButtons();
  initializeToolIntensityControls();
  initializeHistoryButtons();
  initializeHistoryShortcuts();
  initializeEditorShortcuts();
  initializeLocalProcessingBadge();
  registerRedaktixWorker();
  initializeToolShortcutLabels();
  initializeZoomControls();
  ensureReviewViewportObserver();
  consumeToolHandoff();
  renderSensitiveDataPanel();

  function imageFileFromClipboard(clipboardData) {
    if (!clipboardData) return null;
    const fileImage = Array.from(clipboardData.files || []).find((file) => file.type.startsWith("image/"));
    if (fileImage) return fileImage;
    const imageItem = Array.from(clipboardData.items || []).find(
      (item) => item.kind === "file" && item.type.startsWith("image/")
    );
    return imageItem?.getAsFile() || null;
  }

  function handlePaste(event) {
    const blob = imageFileFromClipboard(event.clipboardData);
    if (!blob) return;

    event.preventDefault();
    if (!allowedTypes.includes(blob.type)) {
      showStatus("Clipboard image must be PNG, JPG or WebP.", true);
      return;
    }

    const extension = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
    }[blob.type] || "png";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = new File([blob], `pasted-screenshot-${timestamp}.${extension}`, {
      type: blob.type,
      lastModified: Date.now(),
    });

    showStatus("Opening pasted screenshot...");
    loadImageFile(file);
  }

  function initializeDragAndDrop() {
    let dragDepth = 0;

    document.addEventListener("dragenter", (event) => {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      dragDepth += 1;
      showDropOverlay();
    });

    document.addEventListener("dragover", (event) => {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      showDropOverlay();
    });

    document.addEventListener("dragleave", (event) => {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) hideDropOverlay();
    });

    document.addEventListener("drop", (event) => {
      event.preventDefault();
      dragDepth = 0;
      hideDropOverlay();

      const files = Array.from(event.dataTransfer?.files || []);
      if (files.length > 1 || editorState.batchItems.length) {
        acceptBatchFiles(files);
        return;
      }
      const imageFile = files.find((file) => allowedTypes.includes(file.type));
      if (!imageFile) {
        showStatus("Please drop a PNG, JPG or WebP image.", true);
        return;
      }

      showStatus("Opening dropped image...");
      loadImageFile(imageFile);
    });
  }

  function loadImageFile(file) {
    loadOcrModule().catch(() => {});
    if (!allowedTypes.includes(file.type)) {
      showFileError("Please choose a PNG, JPG or WebP image.");
      return;
    }
    if (file.size > maximumFileSize) {
      showFileError("The selected image must be smaller than 25 MB.");
      return;
    }

    clearPreviousObjectUrl();
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    selectedFileMessage.hidden = false;
    selectedFileMessage.classList.remove("is-error");
    selectedFileMessage.textContent = "Loading image...";

    const handleImageError = () => {
      URL.revokeObjectURL(objectUrl);
      showFileError("The selected image could not be opened.");
    };

    image.addEventListener("load", () => {
      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = image.naturalWidth;
      sourceCanvas.height = image.naturalHeight;
      sourceCanvas.getContext("2d", { alpha: false })?.drawImage(image, 0, 0);
      image.removeEventListener("error", handleImageError);
      editorState.sourceName = file.name;
      editorState.imageWidth = image.naturalWidth;
      editorState.imageHeight = image.naturalHeight;
      editorState.file = null;
      editorState.image = sourceCanvas;
      editorState.objectUrl = null;
      URL.revokeObjectURL(objectUrl);
      image.src = "";
      editorState.redactions = [];
      editorState.detections = [];
      editorState.reviewFinished = false;
      stopReviewSession();
      editorState.zoom = 1;
      editorState.zoomMode = "fit";
      editorState.compareMode = false;
      editorState.compareSplit = 0.5;
      editorState.pinchGesture = null;
      activePointers.clear();
      editorState.selectedRedactionId = null;
      editorState.selectionInteraction = null;
      editorState.selectionResizeHandle = null;

      editorState.selectionOriginalWidth = 0;
      editorState.selectionOriginalHeight = 0;

      editorState.selectionHasMoved = false;

      editorState.isAdjustingRegionStrength = false;
      editorState.regionStrengthOriginalValue = null;
      editorState.scanRequestId += 1;
      editorState.isScanning = false;
      resetHistory();
      renderSensitiveDataPanel();
      showCanvas(sourceCanvas, file);
    });

    image.addEventListener("error", handleImageError);

    image.src = objectUrl;
  }

  function showCanvas(image, file) {
    emptyState.hidden = true;
    document.getElementById("editorCanvasStage")?.remove();

    const stage = document.createElement("div");
    stage.id = "editorCanvasStage";
    stage.className = "editor-canvas-stage";
    stage.innerHTML = `
      <div class="editor-image-toolbar">
        <div class="editor-file-summary">
          <span class="material-symbols-outlined" aria-hidden="true">image</span>
          <div>
            <strong id="activeFileName"></strong>
            <span id="activeImageDimensions"></span>
          </div>
        </div>
        <div class="editor-toolbar-actions">
          <span id="activeToolStatus" class="editor-active-tool-status" data-i18n="editor.statusBlackout">Blackout tool active</span>
          <button id="compareViewButton" class="editor-compare-button" type="button" aria-pressed="false">
            <span class="material-symbols-outlined" aria-hidden="true">compare</span>
            <span data-i18n="editor.compare">Compare</span>
          </button>
          <div class="editor-scan-group">
            <button id="scanSensitiveDataButton" class="editor-scan-button" type="button">
              <span class="material-symbols-outlined" aria-hidden="true">document_scanner</span>
              <span data-i18n="editor.scan">Scan sensitive data</span>
            </button>
            <button
              type="button"
              class="editor-scan-note-toggle"
              data-i18n-aria="editor.scanAlwaysOnNote"
              data-i18n-title="editor.scanAlwaysOnNote"
              aria-expanded="false"
              aria-controls="editorScanAlwaysOnNote"
            >
              <span class="material-symbols-outlined" aria-hidden="true">info</span>
            </button>
            <p id="editorScanAlwaysOnNote" class="editor-scan-always-on-note" data-i18n="editor.scanAlwaysOnNote" hidden>
              Cards, IBAN, TCKN, VKN, API keys and private keys are always scanned.
            </p>
          </div>
          <button id="replaceImageButton" class="editor-replace-image-button" type="button">
            <span class="material-symbols-outlined" aria-hidden="true">upload</span>
            <span data-i18n="editor.openAnother">Open another image</span>
          </button>
        </div>
      </div>
      <div
  id="selectedRegionInspector"
  class="selected-region-inspector"
  hidden
></div>
      <div class="editor-canvas-viewport">
        <div class="editor-canvas-wrapper">
          <div class="editor-canvas-frame">
            <canvas id="imageCanvas" aria-label="Screenshot editing canvas"></canvas>
            <canvas id="overlayCanvas" class="editor-overlay-canvas" aria-hidden="true"></canvas>
            <div id="compareOverlay" class="editor-compare-overlay" hidden>
              <span class="editor-compare-label editor-compare-before">Before</span>
              <span class="editor-compare-label editor-compare-after">After</span>
              <div id="compareSlider" class="editor-compare-slider" role="slider" tabindex="0" aria-label="Before and after split" aria-valuemin="2" aria-valuemax="98" aria-valuenow="50">
                <span class="editor-compare-line" aria-hidden="true"></span>
                <span class="editor-compare-handle" aria-hidden="true"></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    workspace.appendChild(stage);

    const canvas = document.getElementById("imageCanvas");
    const context = canvas?.getContext("2d", { alpha: false, willReadFrequently: true });
    const scanButton = document.getElementById("scanSensitiveDataButton");
    const replaceButton = document.getElementById("replaceImageButton");

    if (!canvas || !context || !scanButton || !replaceButton) {
      console.error("Canvas interface could not be created.");
      return;
    }

    const scanNoteToggle = stage.querySelector(".editor-scan-note-toggle");
    const scanNote = stage.querySelector("#editorScanAlwaysOnNote");
    scanNoteToggle?.addEventListener("click", () => {
      const open = scanNote?.hasAttribute("hidden") ?? true;
      if (!scanNote) return;
      if (open) scanNote.removeAttribute("hidden");
      else scanNote.setAttribute("hidden", "");
      scanNoteToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    canvas.tabIndex = 0;
    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    canvas.width = imageWidth;
    canvas.height = imageHeight;
    const overlay = document.getElementById("overlayCanvas");
    overlay.width = canvas.width;
    overlay.height = canvas.height;
    editorState.canvas = canvas;
    editorState.context = context;
    editorState.overlay = overlay;
    editorState.overlayContext = overlay.getContext("2d");

    document.getElementById("activeFileName").textContent = file.name;
    document.getElementById("activeImageDimensions").textContent =
      `${imageWidth} × ${imageHeight} px`;

    scanButton.addEventListener("click", () => scanImageForSensitiveData(scanButton));
    replaceButton.addEventListener("click", () => openDeviceImagePicker());

    addCanvasEvents(canvas);
    initializeCompareControls();
    initializeToolButtons();
    updateHeaderFileName(file.name);
    renderCanvas();
    updateCanvasCursor();
    saveHistory();

    window.requestAnimationFrame(() => {
      fitCanvasToViewport();
    });
    scanImageForSensitiveData(scanButton);
  }

  function addCanvasEvents(canvas) {
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", cancelDrawing);
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  function beginPinchGesture() {
    const points = [...activePointers.values()];
    if (points.length < 2 || !editorState.canvas) return;

    if (
      editorState.selectionInteraction === "move" ||
      editorState.selectionInteraction === "resize"
    ) {
      const redaction = getSelectedRedaction();
      if (redaction) {
        redaction.x = editorState.selectionOriginalX;
        redaction.y = editorState.selectionOriginalY;
        redaction.width = editorState.selectionOriginalWidth;
        redaction.height = editorState.selectionOriginalHeight;
      }
    }

    const wasInteracting = editorState.isDrawing || editorState.selectionInteraction;
    editorState.isDrawing = false;
    editorState.selectionInteraction = null;
    editorState.selectionResizeHandle = null;
    editorState.selectionHasMoved = false;

    const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    editorState.pinchGesture = {
      startDistance: Math.max(distance, 1),
      startZoom: Number(editorState.zoom || 1),
    };

    for (const pointerId of activePointers.keys()) {
      try {
        editorState.canvas.setPointerCapture(pointerId);
      } catch {
        /* The pointer may already be captured. */
      }
    }

    if (wasInteracting) renderCanvas();
  }

  function applyPinchZoom() {
    const gesture = editorState.pinchGesture;
    const points = [...activePointers.values()];
    if (!gesture || points.length < 2) return;

    const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    const nextZoom = gesture.startZoom * (distance / gesture.startDistance);
    zoomAroundClientPoint(
      nextZoom,
      (points[0].x + points[1].x) / 2,
      (points[0].y + points[1].y) / 2
    );
  }


  function handlePointerDown(event) {
    if (
      !editorState.canvas ||
      event.button !== 0
    ) {
      return;
    }

    activePointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    if (activePointers.size >= 2) {
      event.preventDefault();
      beginPinchGesture();
      return;
    }

    if (editorState.pinchGesture) {
      return;
    }

    const point = getCanvasPoint(event);

    if (editorState.activeTool === "select") {
      const selectedRedaction =
        getSelectedRedaction();

      const resizeHandle =
        selectedRedaction
          ? getSelectionHandleAtPoint(
            point,
            selectedRedaction,
            event.pointerType === "touch" ? 22 : 12
          )
          : null;

      if (
        selectedRedaction &&
        resizeHandle
      ) {
        beginResizingSelectedRedaction(
          event,
          point,
          selectedRedaction,
          resizeHandle
        );

        return;
      }

      const redaction =
        findRedactionAtPoint(point);

      if (!redaction) {
        clearRedactionSelection();

        event.preventDefault();
        return;
      }

      editorState.selectedRedactionId =
        redaction.id;

      editorState.selectionInteraction =
        "move";

      editorState.selectionResizeHandle =
        null;

      editorState.selectionStartX =
        point.x;

      editorState.selectionStartY =
        point.y;

      editorState.selectionOriginalX =
        Number(redaction.x);

      editorState.selectionOriginalY =
        Number(redaction.y);

      editorState.selectionOriginalWidth =
        Number(redaction.width);

      editorState.selectionOriginalHeight =
        Number(redaction.height);

      editorState.selectionHasMoved =
        false;

      editorState.isDrawing = false;

      editorState.canvas.setPointerCapture(
        event.pointerId
      );

      renderCanvas();
      updateSelectionStatus();

      event.preventDefault();
      return;
    }

    if (
      ![
        "blackout",
        "blur",
        "pixelate",
      ].includes(editorState.activeTool)
    ) {
      return;
    }

    editorState.selectedRedactionId = null;
    editorState.selectionInteraction = null;
    editorState.selectionResizeHandle = null;

    editorState.isDrawing = true;
    editorState.startX = point.x;
    editorState.startY = point.y;
    editorState.previewX = point.x;
    editorState.previewY = point.y;

    editorState.canvas.setPointerCapture(
      event.pointerId
    );

    renderCanvas();
  }

  function getSelectionHandleAtPoint(
    point,
    redaction,
    screenRadius = 12
  ) {
    if (
      !point ||
      !redaction ||
      !editorState.canvas
    ) {
      return null;
    }

    const canvasRectangle =
      editorState.canvas.getBoundingClientRect();

    const scaleX =
      editorState.canvas.width /
      Math.max(canvasRectangle.width, 1);

    const scaleY =
      editorState.canvas.height /
      Math.max(canvasRectangle.height, 1);

    /*
      Ekranda yaklaşık 12 piksel büyüklüğünde
      tıklama alanı oluşturulur.
    */
    const hitRadiusX = Math.max(
      7,
      screenRadius * scaleX
    );

    const hitRadiusY = Math.max(
      7,
      screenRadius * scaleY
    );

    const x = Number(redaction.x);
    const y = Number(redaction.y);
    const width = Number(redaction.width);
    const height = Number(redaction.height);

    const handles = [
      {
        name: "top-left",
        x,
        y,
      },
      {
        name: "top-right",
        x: x + width,
        y,
      },
      {
        name: "bottom-left",
        x,
        y: y + height,
      },
      {
        name: "bottom-right",
        x: x + width,
        y: y + height,
      },
    ];

    const matchingHandle = handles.find(
      (handle) => {
        return (
          Math.abs(point.x - handle.x) <=
          hitRadiusX &&
          Math.abs(point.y - handle.y) <=
          hitRadiusY
        );
      }
    );

    return matchingHandle?.name || null;
  }

  function beginResizingSelectedRedaction(
    event,
    point,
    redaction,
    resizeHandle
  ) {
    editorState.selectionInteraction =
      "resize";

    editorState.selectionResizeHandle =
      resizeHandle;

    editorState.selectionStartX =
      point.x;

    editorState.selectionStartY =
      point.y;

    editorState.selectionOriginalX =
      Number(redaction.x);

    editorState.selectionOriginalY =
      Number(redaction.y);

    editorState.selectionOriginalWidth =
      Number(redaction.width);

    editorState.selectionOriginalHeight =
      Number(redaction.height);

    editorState.selectionHasMoved = false;
    editorState.isDrawing = false;

    editorState.canvas.setPointerCapture(
      event.pointerId
    );

    updateActiveToolStatus(
      `${getRedactionTypeLabel(
        redaction
      )} region resizing`
    );

    renderCanvas();

    event.preventDefault();
  }

  function findRedactionAtPoint(point) {
    if (!point) {
      return null;
    }

    for (
      let index =
        editorState.redactions.length - 1;
      index >= 0;
      index -= 1
    ) {
      const redaction =
        editorState.redactions[index];

      if (
        isPointInsideRedaction(
          point,
          redaction
        )
      ) {
        return redaction;
      }
    }

    return null;
  }

  function clearRedactionSelection() {
    editorState.selectedRedactionId =
      null;

    editorState.selectionInteraction =
      null;

    editorState.selectionResizeHandle =
      null;

    editorState.selectionHasMoved =
      false;

    editorState.isAdjustingRegionStrength =
      false;

    editorState.regionStrengthOriginalValue =
      null;

    editorState.isDrawing = false;

    renderCanvas();
    updateSelectionStatus();
    updateCanvasCursor();
  }

  function isPointInsideRedaction(
    point,
    redaction
  ) {
    if (
      !redaction ||
      !Number.isFinite(Number(redaction.x)) ||
      !Number.isFinite(Number(redaction.y)) ||
      !Number.isFinite(
        Number(redaction.width)
      ) ||
      !Number.isFinite(
        Number(redaction.height)
      )
    ) {
      return false;
    }

    const x = Number(redaction.x);
    const y = Number(redaction.y);
    const width = Number(redaction.width);
    const height = Number(redaction.height);

    return (
      point.x >= x &&
      point.x <= x + width &&
      point.y >= y &&
      point.y <= y + height
    );
  }

  function getRedactionTypeLabel(
    redaction
  ) {
    const typeLabels = {
      blackout: "Blackout",
      blur: "Blur",
      pixelate: "Pixelate",
    };

    return (
      typeLabels[redaction?.type] ||
      "Region"
    );
  }

  function updateSelectionStatus() {
    const selectedRedaction =
      getSelectedRedaction();

    if (!selectedRedaction) {
      updateActiveToolStatus(
        "Select tool active · Click a region"
      );

      renderSelectedRegionInspector();
      return;
    }

    const typeLabel =
      getRedactionTypeLabel(
        selectedRedaction
      );

    const selectedIndex =
      getSelectedRedactionIndex();

    const layerNumber =
      selectedIndex >= 0
        ? selectedIndex + 1
        : 0;

    const totalLayers =
      editorState.redactions.length;

    updateActiveToolStatus(
      `${typeLabel} selected · ` +
      `Layer ${layerNumber}/${totalLayers} · ` +
      `Drag or resize`
    );

    renderSelectedRegionInspector();
  }

  function renderSelectedRegionInspector() {
    const inspector =
      document.getElementById(
        "selectedRegionInspector"
      );

    if (!inspector) {
      return;
    }

    const redaction =
      getSelectedRedaction();

    if (
      editorState.activeTool !== "select" ||
      !redaction
    ) {
      inspector.hidden = true;
      inspector.innerHTML = "";
      return;
    }

    const selectedType =
      String(redaction.type || "blackout");

    const roundedX = Math.round(
      Number(redaction.x || 0)
    );

    const roundedY = Math.round(
      Number(redaction.y || 0)
    );

    const roundedWidth = Math.round(
      Number(redaction.width || 0)
    );

    const roundedHeight = Math.round(
      Number(redaction.height || 0)
    );

    const strengthMarkup =
      createRegionStrengthMarkup(redaction);

    inspector.innerHTML = `
    <div class="selected-region-inspector-main">
      <div class="selected-region-inspector-label">
        <span
          class="material-symbols-outlined"
          aria-hidden="true"
        >
          tune
        </span>

        <strong>Selected region</strong>
      </div>

      <label class="selected-region-field">
        <span>Type</span>

        <select
          id="selectedRegionType"
          aria-label="Selected region type"
        >
          <option
            value="blackout"
            ${selectedType === "blackout"
        ? "selected"
        : ""
      }
          >
            Blackout
          </option>

          <option
            value="blur"
            ${selectedType === "blur"
        ? "selected"
        : ""
      }
          >
            Blur
          </option>

          <option
            value="pixelate"
            ${selectedType === "pixelate"
        ? "selected"
        : ""
      }
          >
            Pixelate
          </option>
        </select>
      </label>

      ${strengthMarkup}

      <div class="selected-region-dimensions">
        <span title="Horizontal position">
          X ${roundedX}
        </span>

        <span title="Vertical position">
          Y ${roundedY}
        </span>

        <span title="Region width">
          W ${roundedWidth}
        </span>

        <span title="Region height">
          H ${roundedHeight}
        </span>
      </div>

      <div class="selected-region-actions">
        <button
          id="duplicateSelectedRegionButton"
          type="button"
          title="Duplicate selected region"
        >
          <span
            class="material-symbols-outlined"
            aria-hidden="true"
          >
            content_copy
          </span>

          <span>Duplicate</span>
        </button>

        <button
          id="deleteSelectedRegionButton"
          class="is-danger"
          type="button"
          title="Delete selected region"
        >
          <span
            class="material-symbols-outlined"
            aria-hidden="true"
          >
            delete
          </span>

          <span>Delete</span>
        </button>
      </div>
    </div>
  `;

    inspector.hidden = false;

    bindSelectedRegionInspectorEvents();
  }

  function updateSelectedRegionDimensions() {
    const redaction =
      getSelectedRedaction();

    const container =
      document.querySelector(
        ".selected-region-dimensions"
      );

    if (!redaction || !container) {
      return;
    }

    container.innerHTML = `
    <span title="Horizontal position">
      X ${Math.round(Number(redaction.x || 0))}
    </span>

    <span title="Vertical position">
      Y ${Math.round(Number(redaction.y || 0))}
    </span>

    <span title="Region width">
      W ${Math.round(Number(redaction.width || 0))}
    </span>

    <span title="Region height">
      H ${Math.round(Number(redaction.height || 0))}
    </span>
  `;
  }


  function createRegionStrengthMarkup(redaction) {
    if (!redaction) {
      return "";
    }

    if (redaction.type === "blur") {
      const blurStrength = clamp(
        Number(redaction.blurRadius || 10),
        1,
        50
      );

      return `
    <label
      class="selected-region-field selected-region-range-field"
    >
      <span>
        Blur strength

        <output id="selectedRegionStrengthValue">
          ${Math.round(blurStrength)}
        </output>
      </span>

      <input
        id="selectedRegionStrength"
        type="range"
        min="1"
        max="50"
        step="1"
        value="${blurStrength}"
        aria-label="Blur strength"
      >
      <span class="selected-region-strength-hint">
  ${blurStrength < 14
          ? "Light blur"
          : blurStrength < 24
            ? "Medium blur"
            : blurStrength < 36
              ? "Strong blur"
              : "Maximum blur"
        }
</span>
    </label>
  `;
    }

    if (redaction.type === "pixelate") {
      const pixelSize = clamp(
        Number(redaction.pixelSize || 8),
        2,
        40
      );

      return `
      <label
        class="selected-region-field selected-region-range-field"
      >
        <span>
          Pixel size

          <output id="selectedRegionStrengthValue">
            ${Math.round(pixelSize)} px
          </output>
        </span>

        <input
          id="selectedRegionStrength"
          type="range"
        min="2"
        max="40"
          step="1"
          value="${pixelSize}"
          aria-label="Pixelate block size"
        >
      </label>
    `;
    }

    return `
    <div class="selected-region-blackout-info">
      <span
        class="material-symbols-outlined"
        aria-hidden="true"
      >
        visibility_off
      </span>

      <span>Solid black redaction</span>
    </div>
  `;
  }

  function bindSelectedRegionInspectorEvents() {
    const typeSelect =
      document.getElementById(
        "selectedRegionType"
      );

    const strengthInput =
      document.getElementById(
        "selectedRegionStrength"
      );

    const duplicateButton =
      document.getElementById(
        "duplicateSelectedRegionButton"
      );

    const deleteButton =
      document.getElementById(
        "deleteSelectedRegionButton"
      );

    typeSelect?.addEventListener(
      "change",
      (event) => {
        changeSelectedRedactionType(
          event.target.value
        );
      }
    );

    strengthInput?.addEventListener(
      "input",
      (event) => {
        previewSelectedRedactionStrength(
          Number(event.target.value)
        );
      }
    );

    strengthInput?.addEventListener(
      "change",
      () => {
        commitSelectedRedactionStrength();
      }
    );

    duplicateButton?.addEventListener(
      "click",
      () => {
        duplicateSelectedRedaction();
      }
    );

    deleteButton?.addEventListener(
      "click",
      () => {
        deleteSelectedRedaction();
      }
    );
  }

  function changeSelectedRedactionType(
    nextType
  ) {
    const redaction =
      getSelectedRedaction();

    const supportedTypes = [
      "blackout",
      "blur",
      "pixelate",
    ];

    if (
      !redaction ||
      !supportedTypes.includes(nextType)
    ) {
      return;
    }

    if (redaction.type === nextType) {
      return;
    }
    editorState.isAdjustingRegionStrength = false;
    editorState.regionStrengthOriginalValue = null;

    redaction.type = nextType;

    if (nextType === "blackout") {
      redaction.color = "#000000";

      delete redaction.blurRadius;
      delete redaction.pixelSize;
    }

    if (nextType === "blur") {
      redaction.blurRadius = editorState.blurRadius;

      delete redaction.color;
      delete redaction.pixelSize;
    }

    if (nextType === "pixelate") {
      redaction.pixelSize = editorState.pixelSize;

      delete redaction.color;
      delete redaction.blurRadius;
    }

    saveHistory();
    renderCanvas();
    updateSelectionStatus();

    showStatus(
      `Region changed to ${getRedactionTypeLabel(
        redaction
      )}.`
    );
  }

  function previewSelectedRedactionStrength(
    value
  ) {
    const redaction =
      getSelectedRedaction();

    if (
      !redaction ||
      !["blur", "pixelate"].includes(
        redaction.type
      )
    ) {
      return;
    }

    if (
      !editorState.isAdjustingRegionStrength
    ) {
      editorState.isAdjustingRegionStrength =
        true;

      editorState.regionStrengthOriginalValue =
        redaction.type === "blur"
          ? Number(
            redaction.blurRadius || editorState.blurRadius
          )
          : Number(
            redaction.pixelSize || editorState.pixelSize
          );
    }

    const minimumValue =
      redaction.type === "blur"
        ? 1
        : 2;

    const maximumValue =
      redaction.type === "blur"
        ? 50
        : 40;

    const safeValue = clamp(
      Number(value || 0),
      minimumValue,
      maximumValue
    );

    if (redaction.type === "blur") {
      redaction.blurRadius =
        safeValue;
      editorState.blurRadius = safeValue;
    }

    if (redaction.type === "pixelate") {
      redaction.pixelSize =
        safeValue;
      editorState.pixelSize = safeValue;
    }

    const output =
      document.getElementById(
        "selectedRegionStrengthValue"
      );

    if (output) {
      output.textContent =
        redaction.type === "blur"
          ? `${Math.round(safeValue)}`
          : `${Math.round(safeValue)} px`;
    }
    const strengthHint =
      document.getElementById(
        "selectedRegionStrengthHint"
      );

    if (
      strengthHint &&
      redaction.type === "blur"
    ) {
      strengthHint.textContent =
        safeValue < 14
          ? "Light blur"
          : safeValue < 24
            ? "Medium blur"
            : safeValue < 36
              ? "Strong blur"
              : "Maximum blur";
    }

    renderCanvas();
  }

  function adjustSelectedRegionStrengthByKey(
    direction
  ) {
    const redaction =
      getSelectedRedaction();

    if (
      !redaction ||
      !["blur", "pixelate"].includes(
        redaction.type
      )
    ) {
      showStatus(
        "Select a Blur or Pixelate region first."
      );

      return;
    }

    const propertyName =
      redaction.type === "blur"
        ? "blurRadius"
        : "pixelSize";

    const minimumValue =
      redaction.type === "blur"
        ? 1
        : 2;

    const maximumValue =
      redaction.type === "blur"
        ? 50
        : 40;

    const step =
      redaction.type === "blur"
        ? 2
        : 1;

    const previousValue = clamp(
      Number(
        redaction[propertyName] ||
        (
          redaction.type === "blur"
            ? editorState.blurRadius
            : editorState.pixelSize
        )
      ),
      minimumValue,
      maximumValue
    );

    const nextValue = clamp(
      previousValue +
      direction * step,
      minimumValue,
      maximumValue
    );

    if (nextValue === previousValue) {
      showStatus(
        direction > 0
          ? "Maximum strength reached."
          : "Minimum strength reached."
      );

      return;
    }

    redaction[propertyName] =
      nextValue;

    saveHistory();
    renderCanvas();
    updateSelectionStatus();

    showStatus(
      redaction.type === "blur"
        ? `Blur strength: ${nextValue}`
        : `Pixel size: ${nextValue} px`
    );
  }

  function commitSelectedRedactionStrength() {
    const redaction =
      getSelectedRedaction();

    if (
      !redaction ||
      !editorState.isAdjustingRegionStrength
    ) {
      return;
    }

    const propertyName =
      redaction.type === "blur"
        ? "blurRadius"
        : redaction.type === "pixelate"
          ? "pixelSize"
          : null;

    if (!propertyName) {
      editorState.isAdjustingRegionStrength =
        false;

      editorState.regionStrengthOriginalValue =
        null;

      return;
    }

    const originalValue = Number(
      editorState.regionStrengthOriginalValue
    );

    const currentValue = Number(
      redaction[propertyName]
    );

    editorState.isAdjustingRegionStrength =
      false;

    editorState.regionStrengthOriginalValue =
      null;

    if (
      !Number.isFinite(originalValue) ||
      !Number.isFinite(currentValue) ||
      Math.abs(
        currentValue - originalValue
      ) < 0.01
    ) {
      return;
    }

    /*
      Önce eski durumun geçmişte bulunduğundan
      emin oluyoruz, sonra yeni durumu ekliyoruz.
    */
    redaction[propertyName] =
      originalValue;

    saveHistory();

    redaction[propertyName] =
      currentValue;

    saveHistory();

    renderCanvas();
    updateSelectionStatus();

    showStatus(
      redaction.type === "blur"
        ? "Blur intensity updated."
        : "Pixel size updated."
    );
  }

  function getSelectedRedaction() {
    if (!editorState.selectedRedactionId) {
      return null;
    }

    return (
      editorState.redactions.find(
        (redaction) =>
          redaction.id ===
          editorState.selectedRedactionId
      ) || null
    );
  }

  function handlePointerMove(event) {
    if (activePointers.has(event.pointerId)) {
      activePointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
    }

    if (editorState.pinchGesture) {
      event.preventDefault();
      applyPinchZoom();
      return;
    }

    if (
      editorState.activeTool === "select"
    ) {
      if (
        editorState.selectionInteraction ===
        "resize"
      ) {
        resizeSelectedRedaction(event);
        return;
      }

      if (
        editorState.selectionInteraction ===
        "move"
      ) {
        moveSelectedRedaction(event);
        return;
      }

      updateSelectionCursor(event);
    }

    if (!editorState.isDrawing) {
      return;
    }

    const point = getCanvasPoint(event);

    editorState.previewX = point.x;
    editorState.previewY = point.y;

    renderCanvas();
  }

  function updateSelectionCursor(event) {
    const canvas = editorState.canvas;

    if (
      !canvas ||
      editorState.activeTool !== "select"
    ) {
      return;
    }

    const point = getCanvasPoint(event);

    const selectedRedaction =
      getSelectedRedaction();

    const handle =
      selectedRedaction
        ? getSelectionHandleAtPoint(
          point,
          selectedRedaction,
          event.pointerType === "touch" ? 22 : 12
        )
        : null;

    if (
      handle === "top-left" ||
      handle === "bottom-right"
    ) {
      canvas.style.cursor =
        "nwse-resize";

      return;
    }

    if (
      handle === "top-right" ||
      handle === "bottom-left"
    ) {
      canvas.style.cursor =
        "nesw-resize";

      return;
    }

    const hoveredRedaction =
      findRedactionAtPoint(point);

    canvas.style.cursor =
      hoveredRedaction
        ? "move"
        : "default";
  }

  function updateCanvasCursor() {
    const canvas = editorState.canvas;

    if (!canvas) {
      return;
    }

    if (
      editorState.activeTool === "select"
    ) {
      canvas.style.cursor = "default";
      return;
    }

    canvas.style.cursor = "crosshair";
  }

  function resizeSelectedRedaction(event) {
    const redaction =
      getSelectedRedaction();

    const canvas = editorState.canvas;

    const handle =
      editorState.selectionResizeHandle;

    if (
      !redaction ||
      !canvas ||
      !handle
    ) {
      return;
    }

    const point = getCanvasPoint(event);

    const originalLeft =
      editorState.selectionOriginalX;

    const originalTop =
      editorState.selectionOriginalY;

    const originalRight =
      originalLeft +
      editorState.selectionOriginalWidth;

    const originalBottom =
      originalTop +
      editorState.selectionOriginalHeight;

    const minimumSize = 12;

    let left = originalLeft;
    let top = originalTop;
    let right = originalRight;
    let bottom = originalBottom;

    if (handle.includes("left")) {
      left = clamp(
        point.x,
        0,
        originalRight - minimumSize
      );
    }

    if (handle.includes("right")) {
      right = clamp(
        point.x,
        originalLeft + minimumSize,
        canvas.width
      );
    }

    if (handle.includes("top")) {
      top = clamp(
        point.y,
        0,
        originalBottom - minimumSize
      );
    }

    if (handle.includes("bottom")) {
      bottom = clamp(
        point.y,
        originalTop + minimumSize,
        canvas.height
      );
    }

    const nextWidth = Math.max(
      minimumSize,
      right - left
    );

    const nextHeight = Math.max(
      minimumSize,
      bottom - top
    );

    const hasChanged =
      Math.abs(
        left -
        editorState.selectionOriginalX
      ) >= 0.5 ||
      Math.abs(
        top -
        editorState.selectionOriginalY
      ) >= 0.5 ||
      Math.abs(
        nextWidth -
        editorState.selectionOriginalWidth
      ) >= 0.5 ||
      Math.abs(
        nextHeight -
        editorState.selectionOriginalHeight
      ) >= 0.5;

    if (hasChanged) {
      editorState.selectionHasMoved = true;
    }

    redaction.x = left;
    redaction.y = top;
    redaction.width = nextWidth;
    redaction.height = nextHeight;

    renderCanvas();
    updateSelectedRegionDimensions();

    updateActiveToolStatus(
      `${getRedactionTypeLabel(
        redaction
      )} region resizing · ` +
      `${Math.round(nextWidth)} × ` +
      `${Math.round(nextHeight)} px`
    );
  }

  function moveSelectedRedaction(event) {
    const selectedRedaction =
      getSelectedRedaction();

    if (
      !selectedRedaction ||
      !editorState.canvas
    ) {
      return;
    }

    const point = getCanvasPoint(event);

    const deltaX =
      point.x -
      editorState.selectionStartX;

    const deltaY =
      point.y -
      editorState.selectionStartY;

    const maximumX = Math.max(
      0,
      editorState.canvas.width -
      Number(
        selectedRedaction.width || 0
      )
    );

    const maximumY = Math.max(
      0,
      editorState.canvas.height -
      Number(
        selectedRedaction.height || 0
      )
    );

    const nextX = clamp(
      editorState.selectionOriginalX +
      deltaX,
      0,
      maximumX
    );

    const nextY = clamp(
      editorState.selectionOriginalY +
      deltaY,
      0,
      maximumY
    );

    const movementDistance =
      Math.abs(
        nextX -
        editorState.selectionOriginalX
      ) +
      Math.abs(
        nextY -
        editorState.selectionOriginalY
      );

    if (movementDistance >= 1) {
      editorState.selectionHasMoved =
        true;
    }

    selectedRedaction.x = nextX;
    selectedRedaction.y = nextY;

    renderCanvas();
    updateSelectedRegionDimensions();

    updateActiveToolStatus(
      `${getRedactionTypeLabel(
        selectedRedaction
      )} region moving`
    );
  }

  function handlePointerUp(event) {
    activePointers.delete(event.pointerId);

    if (editorState.pinchGesture) {
      if (editorState.canvas?.hasPointerCapture(event.pointerId)) {
        editorState.canvas.releasePointerCapture(event.pointerId);
      }
      if (activePointers.size < 2) {
        editorState.pinchGesture = null;
        editorState.isDrawing = false;
      }
      return;
    }

    if (
      editorState.activeTool === "select" &&
      (
        editorState.selectionInteraction ===
        "move" ||
        editorState.selectionInteraction ===
        "resize"
      )
    ) {
      finishSelectionInteraction(event);
      return;
    }

    if (
      !editorState.isDrawing ||
      !editorState.canvas
    ) {
      return;
    }


    const point = getCanvasPoint(event);
    const rectangle = normalizeRectangle(
      editorState.startX,
      editorState.startY,
      point.x,
      point.y
    );

    if (rectangle.width >= 4 && rectangle.height >= 4) {
      const redactionType =
        ["blur", "pixelate"].includes(
          editorState.activeTool
        )
          ? editorState.activeTool
          : "blackout";

      editorState.redactions.push({
        id: createId("redaction"),
        type: redactionType,

        x: rectangle.x,
        y: rectangle.y,
        width: rectangle.width,
        height: rectangle.height,

        color:
          redactionType === "blackout"
            ? "#000000"
            : undefined,

        blurRadius:
          redactionType === "blur"
            ? editorState.blurRadius
            : undefined,

        pixelSize:
          redactionType === "pixelate"
            ? editorState.pixelSize
            : undefined,
      });

      editorState.selectedRedactionId = null;

      saveHistory();
    }

    editorState.isDrawing = false;
    if (editorState.canvas.hasPointerCapture(event.pointerId)) {
      editorState.canvas.releasePointerCapture(event.pointerId);
    }
    renderCanvas();
    updateRegionStatus();
  }

  function finishSelectionInteraction(
    event
  ) {
    const canvas = editorState.canvas;

    if (!canvas) {
      return;
    }

    const redaction =
      getSelectedRedaction();

    const interactionType =
      editorState.selectionInteraction;

    if (
      canvas.hasPointerCapture(
        event.pointerId
      )
    ) {
      canvas.releasePointerCapture(
        event.pointerId
      );
    }

    const hasChanged =
      editorState.selectionHasMoved;

    editorState.selectionInteraction =
      null;

    editorState.selectionResizeHandle =
      null;

    editorState.selectionHasMoved =
      false;

    editorState.isDrawing = false;

    if (redaction && hasChanged) {
      saveHistory();

      showStatus(
        interactionType === "resize"
          ? "Selected region resized."
          : "Selected region moved."
      );
    }

    renderCanvas();
    updateSelectionStatus();
    updateCanvasCursor();
  }

  function cancelDrawing(event) {
    if (event?.pointerId != null) {
      activePointers.delete(event.pointerId);
    }
    if (editorState.pinchGesture && activePointers.size < 2) {
      editorState.pinchGesture = null;
    }

    if (
      editorState.selectionInteraction ===
      "move" ||
      editorState.selectionInteraction ===
      "resize"
    ) {
      const redaction =
        getSelectedRedaction();

      if (redaction) {
        redaction.x =
          editorState.selectionOriginalX;

        redaction.y =
          editorState.selectionOriginalY;

        redaction.width =
          editorState.selectionOriginalWidth;

        redaction.height =
          editorState.selectionOriginalHeight;
      }

      editorState.selectionInteraction =
        null;

      editorState.selectionResizeHandle =
        null;

      editorState.selectionHasMoved =
        false;
    }

    editorState.isDrawing = false;

    if (
      editorState.canvas?.hasPointerCapture(
        event.pointerId
      )
    ) {
      editorState.canvas.releasePointerCapture(
        event.pointerId
      );
    }

    renderCanvas();

    if (
      editorState.activeTool === "select"
    ) {
      updateSelectionStatus();
    }

    updateCanvasCursor();
  }

  function getCanvasPoint(event) {
    const canvas = editorState.canvas;
    const rect = canvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) * (canvas.width / rect.width), 0, canvas.width),
      y: clamp((event.clientY - rect.top) * (canvas.height / rect.height), 0, canvas.height),
    };
  }

  function normalizeRectangle(startX, startY, endX, endY) {
    return {
      x: Math.min(startX, endX),
      y: Math.min(startY, endY),
      width: Math.abs(endX - startX),
      height: Math.abs(endY - startY),
    };
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function createHistorySnapshot() {
    return {
      redactions: editorState.redactions.map(
        (item) => ({
          ...item,
        })
      ),

      detections: editorState.detections.map(cloneDetectionForHistory),
    };
  }

  function historySignature(snapshot) {
    const redactions = (snapshot?.redactions || []).map((item) =>
      [item.id, item.type, item.x, item.y, item.width, item.height, item.blurRadius || "", item.pixelSize || ""].join(":")
    ).join("|");
    const detections = (snapshot?.detections || []).map((item) =>
      [item.id, item.type, item.text, item.normX, item.normY, item.normWidth, item.normHeight].join(":")
    ).join("|");
    return `${redactions}#${detections}`;
  }

  function saveHistory() {
    if (editorState.isRestoringHistory) {
      return;
    }

    const snapshot = createHistorySnapshot();

    if (
      editorState.historyIndex <
      editorState.history.length - 1
    ) {
      editorState.history =
        editorState.history.slice(
          0,
          editorState.historyIndex + 1
        );
    }

    const currentSnapshot =
      editorState.history[
      editorState.historyIndex
      ];

    if (
      currentSnapshot &&
      historySignature(currentSnapshot) === historySignature(snapshot)
    ) {
      updateHistoryButtons();
      return;
    }

    snapshot.actionLabel = describeHistoryAction(currentSnapshot, snapshot);
    editorState.history.push(snapshot);

    const maximumHistoryLength = 50;

    if (
      editorState.history.length >
      maximumHistoryLength
    ) {
      editorState.history.shift();
    }

    editorState.historyIndex =
      editorState.history.length - 1;

    updateHistoryButtons();
  }

  function restoreHistorySnapshot(snapshot) {
    if (!snapshot) {
      return;
    }

    editorState.isRestoringHistory = true;

    try {
      editorState.redactions =
        snapshot.redactions.map((item) => ({
          ...item,
        }));

      editorState.detections = filterDetectionsForProfile(
        (snapshot.detections || []).map(cloneDetectionForHistory),
        editorState.detectionProfile
      );

      editorState.isDrawing = false;
      editorState.selectedRedactionId = null;
      editorState.selectionInteraction = null;
      editorState.selectionResizeHandle = null;
      editorState.selectionHasMoved = false;
      editorState.isAdjustingRegionStrength =
        false;

      editorState.regionStrengthOriginalValue =
        null;

      renderCanvas();
      renderSensitiveDataPanel();
      renderSelectedRegionInspector();
      updateRegionStatus();
      if (editorState.detections.length) {
        focusReviewDetection(0);
      } else {
        stopReviewSession();
      }
      updateCanvasCursor();
      updateHistoryButtons();
    } finally {
      editorState.isRestoringHistory = false;
    }
  }

  function undoEditorAction() {
    if (editorState.historyIndex <= 0) {
      showStatus("Nothing to undo.");
      return;
    }

    editorState.historyIndex -= 1;

    restoreHistorySnapshot(
      editorState.history[
      editorState.historyIndex
      ]
    );

    showStatus("Last action undone.");
  }

  function redoEditorAction() {
    if (
      editorState.historyIndex >=
      editorState.history.length - 1
    ) {
      showStatus("Nothing to redo.");
      return;
    }

    editorState.historyIndex += 1;

    restoreHistorySnapshot(
      editorState.history[
      editorState.historyIndex
      ]
    );

    showStatus("Action restored.");
  }

  function resetHistory() {
    editorState.history = [];
    editorState.historyIndex = -1;
    editorState.isRestoringHistory = false;

    updateHistoryButtons();
  }

  function initializeHistoryButtons() {
    const header = document.querySelector(
      "body > header"
    );

    if (!header) {
      return;
    }

    const buttons = Array.from(
      header.querySelectorAll("button")
    );

    const undoButton = buttons.find((button) => {
      const title = String(
        button.getAttribute("title") || ""
      ).toLowerCase();

      const ariaLabel = String(
        button.getAttribute("aria-label") || ""
      ).toLowerCase();

      const icon = button
        .querySelector(
          ".material-symbols-outlined"
        )
        ?.textContent
        .trim()
        .toLowerCase();

      return (
        title.includes("undo") ||
        ariaLabel.includes("undo") ||
        icon === "undo"
      );
    });

    const redoButton = buttons.find((button) => {
      const title = String(
        button.getAttribute("title") || ""
      ).toLowerCase();

      const ariaLabel = String(
        button.getAttribute("aria-label") || ""
      ).toLowerCase();

      const icon = button
        .querySelector(
          ".material-symbols-outlined"
        )
        ?.textContent
        .trim()
        .toLowerCase();

      return (
        title.includes("redo") ||
        ariaLabel.includes("redo") ||
        icon === "redo"
      );
    });

    if (undoButton) {
      undoButton.id = "editorUndoButton";

      undoButton.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          undoEditorAction();
        }
      );
    }

    if (redoButton) {
      redoButton.id = "editorRedoButton";

      redoButton.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          redoEditorAction();
        }
      );
    }

    initializeHistoryDrawer();
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    const undoButton =
      document.getElementById(
        "editorUndoButton"
      );

    const redoButton =
      document.getElementById(
        "editorRedoButton"
      );

    const canUndo =
      editorState.historyIndex > 0;

    const canRedo =
      editorState.historyIndex >= 0 &&
      editorState.historyIndex <
      editorState.history.length - 1;

    if (undoButton) {
      undoButton.disabled = !canUndo;

      undoButton.setAttribute("data-i18n-aria", canUndo ? "editor.undoLast" : "editor.nothingToUndo");
      undoButton.setAttribute(
        "aria-label",
        t(canUndo ? "editor.undoLast" : "editor.nothingToUndo")
      );
    }

    if (redoButton) {
      redoButton.disabled = !canRedo;

      redoButton.setAttribute("data-i18n-aria", canRedo ? "editor.redoLast" : "editor.nothingToRedo");
      redoButton.setAttribute(
        "aria-label",
        t(canRedo ? "editor.redoLast" : "editor.nothingToRedo")
      );
    }

    renderHistoryDrawer();
  }

  function describeHistoryAction(previousSnapshot, nextSnapshot) {
    if (!previousSnapshot) return "Original";

    const previousRedactions = previousSnapshot.redactions || [];
    const nextRedactions = nextSnapshot.redactions || [];
    const previousDetections = previousSnapshot.detections?.length || 0;
    const nextDetections = nextSnapshot.detections?.length || 0;

    if (nextDetections < previousDetections && nextRedactions.length > previousRedactions.length) {
      const added = nextRedactions.length - previousRedactions.length;
      return added === 1 ? "Hide PII" : `Hide ${added} areas`;
    }

    if (nextDetections < previousDetections) return "Dismiss PII";

    if (nextRedactions.length === previousRedactions.length + 1) {
      const added = nextRedactions.find((item) => !previousRedactions.some((older) => older.id === item.id));
      if (added?.source === "duplicated-region") return "Duplicate region";
      return describeAddedRedaction(added);
    }

    if (nextRedactions.length + 1 === previousRedactions.length) return "Remove region";

    const changed = nextRedactions.find((item) => {
      const older = previousRedactions.find((candidate) => candidate.id === item.id);
      return older && JSON.stringify(older) !== JSON.stringify(item);
    });

    if (!changed) return "Reorder region";

    const older = previousRedactions.find((candidate) => candidate.id === changed.id);
    if (older?.type !== changed.type) {
      return `Change to ${getRedactionTypeLabel(changed)}`;
    }
    if (changed.type === "blur" && older.blurRadius !== changed.blurRadius) {
      return `Blur ${changed.blurRadius}px`;
    }
    if (changed.type === "pixelate" && older.pixelSize !== changed.pixelSize) {
      return `Pixelate ${changed.pixelSize}px`;
    }
    if (older.width !== changed.width || older.height !== changed.height) return "Resize region";
    if (older.x !== changed.x || older.y !== changed.y) return "Move region";
    return "Edit region";
  }

  function describeAddedRedaction(redaction) {
    if (redaction?.type === "blackout") return "Blackout Box";
    if (redaction?.type === "blur") return `Blur ${redaction.blurRadius || editorState.blurRadius}px`;
    if (redaction?.type === "pixelate") return `Pixelate ${redaction.pixelSize || editorState.pixelSize}px`;
    return "Add region";
  }

  function initializeHistoryDrawer() {
    if (document.getElementById("historyDrawer")) return;
    const redoButton = document.getElementById("editorRedoButton");
    if (!redoButton) return;

    const toggle = document.createElement("button");
    toggle.id = "historyDrawerButton";
    toggle.type = "button";
    toggle.className = redoButton.className;
    toggle.title = t("editor.history");
    toggle.setAttribute("data-i18n-title", "editor.history");
    toggle.setAttribute("data-i18n-aria", "editor.history");
    toggle.setAttribute("aria-label", t("editor.history"));
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = `<span class="material-symbols-outlined text-[18px] block">history</span>`;
    const historyCluster = redoButton.closest(".hidden");
    if (historyCluster) {
      historyCluster.insertAdjacentElement("afterend", toggle);
    } else {
      redoButton.insertAdjacentElement("afterend", toggle);
    }

    const drawer = document.createElement("div");
    drawer.id = "historyDrawer";
    drawer.className = "history-drawer";
    drawer.hidden = true;
    drawer.innerHTML = `
      <header class="history-drawer-header">History</header>
      <ol id="historyDrawerList" class="history-drawer-list"></ol>
    `;
    document.body.appendChild(drawer);

    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const willOpen = drawer.hidden;
      drawer.hidden = !willOpen;
      toggle.setAttribute("aria-expanded", String(willOpen));
      if (willOpen) {
        positionAnchoredPanel(drawer, toggle);
        renderHistoryDrawer();
      }
    });

    drawer.addEventListener("click", (event) => {
      const step = event.target.closest("[data-history-index]");
      if (!step) return;
      jumpToHistoryIndex(Number(step.dataset.historyIndex));
    });
  }

  function renderHistoryDrawer() {
    const list = document.getElementById("historyDrawerList");
    const toggle = document.getElementById("historyDrawerButton");
    if (!list) return;

    if (!editorState.history.length) {
      list.innerHTML = `<li class="history-drawer-empty">History starts when an image is opened.</li>`;
      return;
    }

    list.innerHTML = editorState.history.map((snapshot, index) => {
      const current = index === editorState.historyIndex;
      return `
        <li>
          <button type="button" class="history-step${current ? " is-current" : ""}" data-history-index="${index}"${current ? ` aria-current="step"` : ""}>
            <span>${escapeHtml(snapshot.actionLabel || "Edit")}</span>
          </button>
        </li>
      `;
    }).reverse().join("");

    if (toggle) {
      toggle.setAttribute("aria-expanded", String(!document.getElementById("historyDrawer")?.hidden));
    }
  }

  function jumpToHistoryIndex(index) {
    const snapshot = editorState.history[index];
    if (!snapshot || index === editorState.historyIndex) return;
    editorState.historyIndex = index;
    restoreHistorySnapshot(snapshot);
    showStatus(snapshot.actionLabel || "History restored.");
  }

  function positionAnchoredPanel(panel, anchor) {
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    panel.hidden = false;
    panel.style.top = `${Math.min(rect.bottom + margin, window.innerHeight - panel.offsetHeight - margin)}px`;
    panel.style.left = `${Math.min(Math.max(margin, rect.right - panel.offsetWidth), window.innerWidth - panel.offsetWidth - margin)}px`;
  }

  function initializeHistoryShortcuts() {
    document.addEventListener(
      "keydown",
      (event) => {
        const activeElement =
          document.activeElement;

        const isTyping =
          activeElement instanceof
          HTMLInputElement ||
          activeElement instanceof
          HTMLTextAreaElement ||
          activeElement?.isContentEditable;

        if (isTyping) {
          return;
        }
        if (isShortcutDialogOpen()) {
          return;
        }
        if (
          editorState.activeTool === "select" &&
          editorState.selectedRedactionId
        ) {
          const modifierKey =
            event.ctrlKey || event.metaKey;

          if (
            modifierKey &&
            event.key.toLowerCase() === "d"
          ) {
            event.preventDefault();

            duplicateSelectedRedaction();
            return;
          }

          if (
            event.key === "PageUp" &&
            !modifierKey
          ) {
            event.preventDefault();

            bringSelectedRedactionForward();
            return;
          }

          if (
            event.key === "PageDown" &&
            !modifierKey
          ) {
            event.preventDefault();

            sendSelectedRedactionBackward();
            return;
          }

          if (
            event.key === "Home" &&
            !modifierKey
          ) {
            event.preventDefault();

            bringSelectedRedactionToFront();
            return;
          }

          if (
            event.key === "End" &&
            !modifierKey
          ) {
            event.preventDefault();

            sendSelectedRedactionToBack();
            return;
          }
        }

        if (
          editorState.activeTool === "select" &&
          event.key === "Escape"
        ) {
          event.preventDefault();

          clearRedactionSelection();

          return;
        }

        if (
          editorState.activeTool ===
          "select" &&
          (
            event.key === "Delete" ||
            event.key === "Backspace"
          )
        ) {
          if (
            editorState.selectedRedactionId
          ) {
            event.preventDefault();
            deleteSelectedRedaction();
          }

          return;
        }

        if (
          editorState.activeTool === "select" &&
          [
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
          ].includes(event.key)
        ) {
          if (
            editorState.selectedRedactionId
          ) {
            event.preventDefault();

            moveSelectedRedactionWithKeyboard(
              event.key,
              event.shiftKey
            );
          }

          return;
        }

        const modifierKey =
          event.ctrlKey || event.metaKey;

        if (!modifierKey) {
          return;
        }

        const key =
          event.key.toLowerCase();

        if (
          key === "z" &&
          !event.shiftKey
        ) {
          event.preventDefault();
          undoEditorAction();
          return;
        }

        if (
          key === "y" ||
          (
            key === "z" &&
            event.shiftKey
          )
        ) {
          event.preventDefault();
          redoEditorAction();
        }
      }
    );
  }

  function initializeEditorShortcuts() {
    document.addEventListener(
      "keydown",
      (event) => {
        const activeElement =
          document.activeElement;

        const isTyping =
          activeElement instanceof
          HTMLInputElement ||
          activeElement instanceof
          HTMLTextAreaElement ||
          activeElement instanceof
          HTMLSelectElement ||
          activeElement?.isContentEditable;

        if (isTyping) {
          return;
        }

        if (
          (
            event.ctrlKey ||
            event.metaKey
          ) &&
          event.key === "0"
        ) {
          event.preventDefault();

          fitCanvasToViewport();
          return;
        }

        if (
          (
            event.ctrlKey ||
            event.metaKey
          ) &&
          event.key === "1"
        ) {
          event.preventDefault();

          setCanvasZoom(1, {
            mode: "manual",
            centerViewport: true,
          });

          return;
        }

        if (
          (
            event.ctrlKey ||
            event.metaKey
          ) &&
          (
            event.key === "+" ||
            event.key === "="
          )
        ) {
          event.preventDefault();

          changeCanvasZoom(0.1);
          return;
        }

        if (
          (
            event.ctrlKey ||
            event.metaKey
          ) &&
          event.key === "-"
        ) {
          event.preventDefault();

          changeCanvasZoom(-0.1);
          return;
        }

        /*
          Ctrl, Cmd veya Alt basılıyken araç
          kısayolları çalıştırılmaz.
        */
        if (
          event.ctrlKey ||
          event.metaKey ||
          event.altKey
        ) {
          return;
        }

        if (
          isShortcutDialogOpen()
        ) {
          if (event.key === "Escape") {
            event.preventDefault();
            closeShortcutDialog();
          }

          return;
        }

        if (event.key === "Escape") {
          const popover = document.getElementById("localProcessingPopover");
          if (popover && !popover.hidden) {
            event.preventDefault();
            setLocalProcessingPopoverOpen(false);
            return;
          }
          const blockingDialog = ["exportReviewDialog", "customRulesDialog"].some((id) => {
            const dialog = document.getElementById(id);
            return dialog && !dialog.hidden;
          });
          if (!blockingDialog && editorState.reviewFocusId) {
            event.preventDefault();
            cancelReviewHighlight();
          }
          return;
        }

        if (
          event.key === "Tab" &&
          editorState.reviewActive &&
          editorState.detections.length &&
          event.target?.id !== "compareSlider" &&
          !event.target?.closest?.("#sensitiveDataPanel") &&
          !event.target?.closest?.("#exportReviewDialog")
        ) {
          event.preventDefault();
          const action = document.getElementById(event.shiftKey ? "reviewKeepButton" : "reviewRedactButton");
          action?.focus();
          return;
        }

        const reviewDirection = reviewShortcutDirection(event.key, event.shiftKey);
        if (
          reviewDirection &&
          event.key !== "Tab" &&
          editorState.reviewActive &&
          editorState.detections.length &&
          event.target?.id !== "compareSlider" &&
          !event.target?.closest?.("#exportReviewDialog") &&
          !(event.key === "Tab" && event.target?.closest?.("#sensitiveDataPanel"))
        ) {
          event.preventDefault();
          focusReviewDetection(stepReviewIndex(
            editorState.reviewIndex,
            editorState.detections.length,
            reviewDirection
          ));
          return;
        }

        const key =
          event.key.toLowerCase();

        const toolShortcuts = {
          v: "select",
          b: "blackout",
          u: "blur",
          p: "pixelate",
        };

        if (toolShortcuts[key]) {
          event.preventDefault();

          activateEditorTool(
            toolShortcuts[key],
            {
              showNotification: true,
            }
          );

          return;
        }

        if (
          event.key === "[" ||
          event.key === "]"
        ) {
          if (
            editorState.activeTool ===
            "select" &&
            editorState.selectedRedactionId
          ) {
            event.preventDefault();

            adjustSelectedRegionStrengthByKey(
              event.key === "]" ? 1 : -1
            );
          }

          return;
        }

        if (
          event.key === "?" ||
          (
            event.key === "/" &&
            event.shiftKey
          )
        ) {
          event.preventDefault();
          openShortcutDialog();
        }
      }
    );
  }

  function initializeToolShortcutLabels() {
    const shortcutDefinitions = {
      select: "V",
      blackout: "B",
      blur: "U",
      pixelate: "P",
    };

    Object.entries(
      shortcutDefinitions
    ).forEach(([toolName, shortcut]) => {
      const button =
        document.querySelector(
          `[data-tool="${toolName}"]`
        );

      if (!button) {
        return;
      }

      const existingTitle = String(
        button.getAttribute("title") ||
        getRedactionToolTitle(toolName)
      ).trim();

      button.setAttribute(
        "title",
        `${existingTitle} (${shortcut})`
      );

      button.setAttribute(
        "aria-keyshortcuts",
        shortcut
      );

      if (
        button.querySelector(
          ".editor-tool-shortcut"
        )
      ) {
        return;
      }

      const shortcutBadge =
        document.createElement("span");

      shortcutBadge.className =
        "editor-tool-shortcut";

      shortcutBadge.textContent =
        shortcut;

      shortcutBadge.setAttribute(
        "aria-hidden",
        "true"
      );

      button.appendChild(
        shortcutBadge
      );
    });
  }

  function openShortcutDialog() {
    let overlay =
      document.getElementById(
        "editorShortcutDialog"
      );

    if (!overlay) {
      overlay =
        document.createElement("div");

      overlay.id =
        "editorShortcutDialog";

      overlay.className =
        "editor-shortcut-dialog";

      overlay.setAttribute(
        "role",
        "dialog"
      );

      overlay.setAttribute(
        "aria-modal",
        "true"
      );

      overlay.setAttribute(
        "aria-labelledby",
        "editorShortcutDialogTitle"
      );

      overlay.innerHTML = `
      <div class="editor-shortcut-dialog-card">
        <div class="editor-shortcut-dialog-header">
          <div>
            <span
              class="material-symbols-outlined"
              aria-hidden="true"
            >
              keyboard
            </span>

            <div>
              <h2 id="editorShortcutDialogTitle">
                Keyboard shortcuts
              </h2>

              <p>
                Work faster without leaving the canvas.
              </p>
            </div>
          </div>

          <button
            id="closeEditorShortcutDialog"
            type="button"
            title="Close shortcuts"
            aria-label="Close keyboard shortcuts"
          >
            <span
              class="material-symbols-outlined"
              aria-hidden="true"
            >
              close
            </span>
          </button>
        </div>

        <div class="editor-shortcut-groups">
          ${createShortcutGroupMarkup(
        "Tools",
        [
          ["V", "Select"],
          ["B", "Blackout"],
          ["U", "Blur"],
          ["P", "Pixelate"],
        ]
      )}

      ${createShortcutGroupMarkup(
        "View",
        [
          ["Ctrl + +", "Zoom in"],
          ["Ctrl + -", "Zoom out"],
          ["Ctrl + 0", "Fit to screen"],
          ["Ctrl + 1", "Actual size"],
          ["Ctrl + Wheel", "Zoom at pointer"],
        ]
      )}

          ${createShortcutGroupMarkup(
        "Selected region",
        [
          ["Arrow keys", "Move 1 pixel"],
          ["Shift + Arrow", "Move 10 pixels"],
          ["[ / ]", "Adjust strength"],
          ["Ctrl + D", "Duplicate"],
          ["Delete", "Remove"],
          ["Escape", "Clear selection"],
        ]
      )}

          ${createShortcutGroupMarkup(
        "Layers and history",
        [
          ["Page Up", "Move forward"],
          ["Page Down", "Move backward"],
          ["Home", "Bring to front"],
          ["End", "Send to back"],
          ["Ctrl + Z", "Undo"],
          ["Ctrl + Y", "Redo"],
        ]
      )}
        </div>

        <div class="editor-shortcut-dialog-footer">
          <span>
            Press
            <kbd>?</kbd>
            to open this window.
          </span>

          <button
            id="confirmEditorShortcutDialog"
            type="button"
          >
            Got it
          </button>
        </div>
      </div>
    `;

      document.body.appendChild(
        overlay
      );

      overlay.addEventListener(
        "pointerdown",
        (event) => {
          if (event.target === overlay) {
            closeShortcutDialog();
          }
        }
      );

      document
        .getElementById(
          "closeEditorShortcutDialog"
        )
        ?.addEventListener(
          "click",
          closeShortcutDialog
        );

      document
        .getElementById(
          "confirmEditorShortcutDialog"
        )
        ?.addEventListener(
          "click",
          closeShortcutDialog
        );
    }

    overlay.classList.add(
      "is-visible"
    );

    document
      .getElementById(
        "closeEditorShortcutDialog"
      )
      ?.focus();
  }
  function createShortcutGroupMarkup(
    title,
    shortcuts
  ) {
    return `
    <section class="editor-shortcut-group">
      <h3>${escapeHtml(title)}</h3>

      <div class="editor-shortcut-list">
        ${shortcuts
        .map(
          ([shortcut, description]) => `
              <div class="editor-shortcut-row">
                <kbd translate="no">
                  ${escapeHtml(shortcut)}
                </kbd>

                <span>
                  ${escapeHtml(description)}
                </span>
              </div>
            `
        )
        .join("")}
      </div>
    </section>
  `;
  }

  function closeShortcutDialog() {
    const overlay =
      document.getElementById(
        "editorShortcutDialog"
      );

    if (!overlay) {
      return;
    }

    overlay.classList.remove(
      "is-visible"
    );

    editorState.canvas?.focus?.();
  }

  function isShortcutDialogOpen() {
    return Boolean(
      document
        .getElementById(
          "editorShortcutDialog"
        )
        ?.classList.contains(
          "is-visible"
        )
    );
  }

  function getRedactionToolTitle(
    toolName
  ) {
    const titles = {
      select: "Select",
      blackout: "Blackout",
      blur: "Blur",
      pixelate: "Pixelate",
    };

    return titles[toolName] || toolName;
  }

  function moveSelectedRedactionWithKeyboard(
    key,
    useLargeStep
  ) {
    const selectedRedaction =
      getSelectedRedaction();

    if (
      !selectedRedaction ||
      !editorState.canvas
    ) {
      return;
    }

    const step =
      useLargeStep ? 10 : 1;

    let deltaX = 0;
    let deltaY = 0;

    if (key === "ArrowLeft") {
      deltaX = -step;
    }

    if (key === "ArrowRight") {
      deltaX = step;
    }

    if (key === "ArrowUp") {
      deltaY = -step;
    }

    if (key === "ArrowDown") {
      deltaY = step;
    }

    const maximumX = Math.max(
      0,
      editorState.canvas.width -
      Number(
        selectedRedaction.width || 0
      )
    );

    const maximumY = Math.max(
      0,
      editorState.canvas.height -
      Number(
        selectedRedaction.height || 0
      )
    );

    const previousX =
      Number(selectedRedaction.x);

    const previousY =
      Number(selectedRedaction.y);

    selectedRedaction.x = clamp(
      previousX + deltaX,
      0,
      maximumX
    );

    selectedRedaction.y = clamp(
      previousY + deltaY,
      0,
      maximumY
    );

    if (
      selectedRedaction.x === previousX &&
      selectedRedaction.y === previousY
    ) {
      return;
    }

    saveHistory();
    renderCanvas();
    updateSelectionStatus();
  }

  function renderCanvas() {
    if (editorState.renderFrame) return;
    editorState.renderFrame = window.requestAnimationFrame(() => {
      editorState.renderFrame = 0;
      paintEditorSurfaces();
    });
  }

  function paintEditorSurfaces() {
    const {
      canvas,
      context,
      image,
      redactions,
      detections,
      isDrawing,
    } = editorState;

    if (!canvas || !context || !image) {
      return;
    }

    context.save();

    context.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    context.drawImage(
      image,
      0,
      0,
      canvas.width,
      canvas.height
    );

    redactions.forEach((redaction) => {
      if (redaction.type === "blackout") {
        context.fillStyle =
          redaction.color || "#000000";

        context.fillRect(
          redaction.x,
          redaction.y,
          redaction.width,
          redaction.height
        );

        return;
      }

      if (redaction.type === "blur") {
        drawBlurRedaction(
          context,
          redaction,
          image
        );

        return;
      }

      if (redaction.type === "pixelate") {
        drawPixelateRedaction(
          context,
          redaction,
          image
        );
      }
    });

    if (editorState.compareMode) {
      drawBeforeAfterSplit(context, image);
    }

    context.restore();
    paintOverlay(detections, isDrawing);
    syncCompareOverlay();
  }

  function drawBeforeAfterSplit(context, sourceImage) {
    const splitX = editorState.canvas.width * clamp(editorState.compareSplit, 0.02, 0.98);
    context.save();
    context.beginPath();
    context.rect(0, 0, splitX, editorState.canvas.height);
    context.clip();
    context.drawImage(sourceImage, 0, 0, editorState.canvas.width, editorState.canvas.height);
    context.restore();

    context.save();
    context.fillStyle = "#ffffff";
    context.fillRect(splitX - 1, 0, 2, editorState.canvas.height);
    context.restore();
  }

  function initializeCompareControls() {
    const button = document.getElementById("compareViewButton");
    const slider = document.getElementById("compareSlider");
    button?.addEventListener("click", () => {
      setCompareMode(!editorState.compareMode);
    });

    slider?.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      editorState.compareDragging = true;
      try {
        slider.setPointerCapture(event.pointerId);
      } catch {
        /* Pointer capture is optional; window moves still track the split. */
      }
      moveCompareSplit(event);
    });
    if (!initializeCompareControls.bound) {
      initializeCompareControls.bound = true;
      window.addEventListener("pointermove", (event) => {
        if (!editorState.compareDragging) return;
        event.preventDefault();
        moveCompareSplit(event);
      });
      window.addEventListener("pointerup", () => {
        editorState.compareDragging = false;
      });
      window.addEventListener("pointercancel", () => {
        editorState.compareDragging = false;
      });
    }
    slider?.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? 0.1 : 0.02;
      if (event.key === "ArrowLeft") {
        editorState.compareSplit = clamp(editorState.compareSplit - step, 0.02, 0.98);
      } else if (event.key === "ArrowRight") {
        editorState.compareSplit = clamp(editorState.compareSplit + step, 0.02, 0.98);
      } else {
        return;
      }
      event.preventDefault();
      renderCanvas();
    });
  }

  function setCompareMode(enabled) {
    editorState.compareMode = Boolean(enabled);
    const button = document.getElementById("compareViewButton");
    const overlay = document.getElementById("compareOverlay");
    button?.setAttribute("aria-pressed", String(editorState.compareMode));
    button?.classList.toggle("is-active", editorState.compareMode);
    if (overlay) overlay.hidden = !editorState.compareMode;
    renderCanvas();
  }

  function moveCompareSplit(event) {
    const canvas = editorState.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    editorState.compareSplit = clamp((event.clientX - rect.left) / Math.max(rect.width, 1), 0.02, 0.98);
    renderCanvas();
  }

  function syncCompareOverlay() {
    const overlay = document.getElementById("compareOverlay");
    const slider = document.getElementById("compareSlider");
    if (!overlay || !slider) return;
    overlay.hidden = !editorState.compareMode;
    const percent = Math.round(clamp(editorState.compareSplit, 0.02, 0.98) * 100);
    slider.style.left = `${percent}%`;
    slider.setAttribute("aria-valuenow", String(percent));
  }

  function drawBlurRedaction(
    targetContext,
    redaction,
    sourceImage
  ) {
    if (
      !targetContext ||
      !sourceImage ||
      !editorState.canvas
    ) {
      return;
    }

    const rectangle =
      clampRectangleToCanvas(redaction);

    if (
      rectangle.width < 2 ||
      rectangle.height < 2
    ) {
      return;
    }

    const blurredRegion =
      createStableBlurRegion(
        sourceImage,
        rectangle,
        redaction
      );

    if (!blurredRegion) {
      return;
    }

    targetContext.save();

    targetContext.beginPath();

    targetContext.rect(
      rectangle.x,
      rectangle.y,
      rectangle.width,
      rectangle.height
    );

    targetContext.clip();

    targetContext.imageSmoothingEnabled =
      true;

    targetContext.imageSmoothingQuality =
      "high";

    targetContext.drawImage(
      blurredRegion,
      0,
      0,
      blurredRegion.width,
      blurredRegion.height,
      rectangle.x,
      rectangle.y,
      rectangle.width,
      rectangle.height
    );

    targetContext.restore();
  }

  function createStableBlurRegion(
    source,
    rectangle,
    redaction
  ) {
    const sourceWidth = Math.max(
      1,
      Math.round(rectangle.width)
    );

    const sourceHeight = Math.max(
      1,
      Math.round(rectangle.height)
    );

    const strength = clamp(
      Number(redaction.blurRadius || 10),
      1,
      50
    );
    const sizeAdjustment = clamp(
      rectangle.height / 70,
      0.8,
      2
    );

    const effectiveStrength = clamp(
      strength * sizeAdjustment,
      1,
      80
    );

    /*
      Strength yükseldikçe örnekleme çözünürlüğü
      düşer. Bu işlem harf şekillerini önce yok
      eder, ardından Blur geçişleri uygulanır.
    */
    const reductionFactor = clamp(
      1 + effectiveStrength / 7,
      1.25,
      10
    );

    const reducedWidth = Math.max(
      2,
      Math.round(
        sourceWidth / reductionFactor
      )
    );

    const reducedHeight = Math.max(
      2,
      Math.round(
        sourceHeight / reductionFactor
      )
    );

    const sampleCanvas =
      document.createElement("canvas");

    sampleCanvas.width = reducedWidth;
    sampleCanvas.height = reducedHeight;

    const sampleContext =
      sampleCanvas.getContext("2d", {
        alpha: false,
      });

    if (!sampleContext) {
      return null;
    }

    sampleContext.imageSmoothingEnabled =
      true;

    sampleContext.imageSmoothingQuality =
      "high";

    sampleContext.drawImage(
      source,
      rectangle.x,
      rectangle.y,
      rectangle.width,
      rectangle.height,
      0,
      0,
      reducedWidth,
      reducedHeight
    );

    /*
      Yüksek kontrastlı yazı renklerini biraz
      bastırarak harf kenarlarının tekrar ortaya
      çıkmasını azaltır.
    */
    softenBlurSample(
      sampleContext,
      reducedWidth,
      reducedHeight,
      effectiveStrength
    );

    const outputCanvas =
      document.createElement("canvas");

    outputCanvas.width = sourceWidth;
    outputCanvas.height = sourceHeight;

    const outputContext =
      outputCanvas.getContext("2d", {
        alpha: false,
      });

    if (!outputContext) {
      return null;
    }

    outputContext.imageSmoothingEnabled =
      true;

    outputContext.imageSmoothingQuality =
      "high";

    const effectiveBlurRadius = clamp(
      effectiveStrength * 0.7,
      6,
      34
    );

    /*
      Kaynak kendi üzerine çizilmiyor. Böylece
      tarayıcıya göre değişen geri besleme ve
      keskinleşme davranışı oluşmuyor.
    */
    outputContext.filter =
      `blur(${effectiveBlurRadius}px)`;

    const expansion = Math.min(
      effectiveBlurRadius * 2,
      Math.min(
        sourceWidth,
        sourceHeight
      ) * 0.35
    );

    outputContext.drawImage(
      sampleCanvas,
      -expansion,
      -expansion,
      sourceWidth + expansion * 2,
      sourceHeight + expansion * 2
    );

    outputContext.filter = "none";

    /*
      İkinci geçiş, yüksek değerlerde kalan
      büyük harf siluetlerini yumuşatır.
    */
    if (effectiveStrength >= 22) {
      const secondPassCanvas =
        document.createElement("canvas");

      secondPassCanvas.width = sourceWidth;
      secondPassCanvas.height = sourceHeight;

      const secondPassContext =
        secondPassCanvas.getContext("2d", {
          alpha: false,
        });

      if (secondPassContext) {
        secondPassContext.drawImage(
          outputCanvas,
          0,
          0
        );

        outputContext.clearRect(
          0,
          0,
          sourceWidth,
          sourceHeight
        );

        outputContext.filter =
          `blur(${Math.max(
            4,
            effectiveBlurRadius * 0.45
          )}px)`;

        outputContext.drawImage(
          secondPassCanvas,
          -expansion / 2,
          -expansion / 2,
          sourceWidth + expansion,
          sourceHeight + expansion
        );

        outputContext.filter = "none";
      }
    }

    return outputCanvas;
  }

  function softenBlurSample(
    context,
    width,
    height,
    effectiveStrength
  ) {
    if (
      effectiveStrength < 16 ||
      width < 1 ||
      height < 1 ||
      !context.canvas
    ) {
      return;
    }

    const contrast = 100 - clamp((effectiveStrength - 14) * 0.85, 6, 40);
    const copy = document.createElement("canvas");
    copy.width = width;
    copy.height = height;
    const copyContext = copy.getContext("2d", { alpha: false });
    if (!copyContext) return;
    copyContext.drawImage(context.canvas, 0, 0);
    context.filter = `contrast(${contrast}%)`;
    context.drawImage(copy, 0, 0);
    context.filter = "none";
  }

  function drawPixelateRedaction(
    targetContext,
    redaction,
    sourceImage
  ) {
    if (
      !targetContext ||
      !sourceImage ||
      !editorState.canvas
    ) {
      return;
    }

    const rectangle =
      clampRectangleToCanvas(redaction);

    if (
      rectangle.width < 2 ||
      rectangle.height < 2
    ) {
      return;
    }

    const pixelSize = Math.max(
      2,
      Number(redaction.pixelSize || 8)
    );

    const sampleWidth = Math.max(
      1,
      Math.ceil(
        rectangle.width / pixelSize
      )
    );

    const sampleHeight = Math.max(
      1,
      Math.ceil(
        rectangle.height / pixelSize
      )
    );

    const temporaryCanvas =
      document.createElement("canvas");

    temporaryCanvas.width = sampleWidth;
    temporaryCanvas.height = sampleHeight;

    const temporaryContext =
      temporaryCanvas.getContext("2d", {
        alpha: false,
      });

    if (!temporaryContext) {
      return;
    }

    temporaryContext.imageSmoothingEnabled =
      false;

    temporaryContext.drawImage(
      sourceImage,

      rectangle.x,
      rectangle.y,
      rectangle.width,
      rectangle.height,

      0,
      0,
      sampleWidth,
      sampleHeight
    );

    targetContext.save();

    targetContext.beginPath();

    targetContext.rect(
      rectangle.x,
      rectangle.y,
      rectangle.width,
      rectangle.height
    );

    targetContext.clip();

    targetContext.imageSmoothingEnabled =
      false;

    targetContext.drawImage(
      temporaryCanvas,

      0,
      0,
      sampleWidth,
      sampleHeight,

      rectangle.x,
      rectangle.y,
      rectangle.width,
      rectangle.height
    );

    targetContext.restore();
  }

  function clampRectangleToCanvas(
    rectangle
  ) {
    const canvas = editorState.canvas;

    if (!canvas) {
      return {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      };
    }

    return clampRectangleToBounds(
      rectangle,
      canvas.width,
      canvas.height
    );
  }

  function clampRectangleToBounds(
    rectangle,
    maximumWidth,
    maximumHeight
  ) {
    const rawX = Number(
      rectangle?.x || 0
    );

    const rawY = Number(
      rectangle?.y || 0
    );

    const rawWidth = Number(
      rectangle?.width || 0
    );

    const rawHeight = Number(
      rectangle?.height || 0
    );

    const left = clamp(
      rawX,
      0,
      maximumWidth
    );

    const top = clamp(
      rawY,
      0,
      maximumHeight
    );

    const right = clamp(
      rawX + rawWidth,
      0,
      maximumWidth
    );

    const bottom = clamp(
      rawY + rawHeight,
      0,
      maximumHeight
    );

    return {
      x: left,
      y: top,
      width: Math.max(
        0,
        right - left
      ),
      height: Math.max(
        0,
        bottom - top
      ),
    };
  }

  function paintOverlay(detections, isDrawing) {
    const overlay = editorState.overlay;
    const overlayContext = editorState.overlayContext;
    if (!overlay || !overlayContext) return;
    overlayContext.clearRect(0, 0, overlay.width, overlay.height);
    detections.forEach((detection) => drawDetectionBox(overlayContext, detection));
    const selectedRedaction = getSelectedRedaction();
    if (editorState.activeTool === "select" && selectedRedaction) {
      drawSelectedRedactionOutline(overlayContext, selectedRedaction);
    }
    if (isDrawing) drawSelectionPreview(overlayContext);
  }

  function drawDetectionBox(context, detection) {
    const rect = detectionRenderRect(detection);
    if (!rect) return;
    context.save();
    const isActive = detection.id === editorState.reviewFocusId;
    const pulse = isActive ? editorState.reviewPulse : 0;
    context.strokeStyle = pulse > 0.2
      ? `rgba(253, 224, 71, ${0.65 + pulse * 0.35})`
      : isActive
        ? "rgba(250, 204, 21, 0.95)"
        : "rgba(249, 115, 22, 0.85)";
    context.lineWidth = isActive ? 2 + pulse * 2 : 1;
    context.strokeRect(
      rect.x + 0.5,
      rect.y + 0.5,
      Math.max(0, rect.width - 1),
      Math.max(0, rect.height - 1)
    );
    context.restore();
  }

  function sourceImagePixels() {
    const source = editorState.scanImageOverride || editorState.image;
    return {
      width: Number(source?.naturalWidth || (source === editorState.image ? editorState.imageWidth : 0) || source?.width || 0),
      height: Number(source?.naturalHeight || (source === editorState.image ? editorState.imageHeight : 0) || source?.height || 0),
    };
  }

  function detectionRenderRect(detection) {
    const canvas = editorState.canvas;
    if (!canvas) return null;
    return mapNormalizedBox(detection, canvas.width, canvas.height);
  }

  function drawSelectedRedactionOutline(
    context,
    redaction
  ) {
    if (!context || !redaction) {
      return;
    }

    const rectangle =
      clampRectangleToCanvas(
        redaction
      );

    if (
      rectangle.width < 2 ||
      rectangle.height < 2
    ) {
      return;
    }

    context.save();

    /*
      Beyaz dış çizgi, mavi çizginin koyu ve
      açık arka planlarda görünmesini sağlar.
    */
    context.strokeStyle =
      "rgba(255, 255, 255, 0.95)";

    context.lineWidth = 5;

    context.setLineDash([]);

    context.strokeRect(
      rectangle.x,
      rectangle.y,
      rectangle.width,
      rectangle.height
    );

    context.strokeStyle = "#2563eb";
    context.lineWidth = 2;
    context.setLineDash([8, 5]);

    context.strokeRect(
      rectangle.x,
      rectangle.y,
      rectangle.width,
      rectangle.height
    );

    drawSelectionHandles(
      context,
      rectangle
    );

    context.restore();
  }

  function drawSelectionHandles(
    context,
    rectangle
  ) {
    const handleSize = 10;
    const halfHandle = handleSize / 2;

    const points = [
      {
        x: rectangle.x,
        y: rectangle.y,
      },
      {
        x:
          rectangle.x +
          rectangle.width,
        y: rectangle.y,
      },
      {
        x: rectangle.x,
        y:
          rectangle.y +
          rectangle.height,
      },
      {
        x:
          rectangle.x +
          rectangle.width,
        y:
          rectangle.y +
          rectangle.height,
      },
    ];

    context.setLineDash([]);
    context.lineWidth = 2;

    points.forEach((point) => {
      context.fillStyle = "#ffffff";

      context.fillRect(
        point.x - halfHandle,
        point.y - halfHandle,
        handleSize,
        handleSize
      );

      context.strokeStyle = "#2563eb";

      context.strokeRect(
        point.x - halfHandle,
        point.y - halfHandle,
        handleSize,
        handleSize
      );
    });
  }

  function deleteSelectedRedaction() {
    const selectedRedaction =
      getSelectedRedaction();

    if (!selectedRedaction) {
      showStatus(
        "Select a region before deleting."
      );

      return;
    }

    editorState.redactions =
      editorState.redactions.filter(
        (redaction) =>
          redaction.id !==
          selectedRedaction.id
      );

    editorState.selectedRedactionId = null;
    editorState.isAdjustingRegionStrength = false;
    editorState.regionStrengthOriginalValue = null;

    saveHistory();
    renderCanvas();
    updateSelectionStatus();

    showStatus(
      "Selected region removed."
    );
  }

  function duplicateSelectedRedaction() {
    const selectedRedaction =
      getSelectedRedaction();

    if (
      !selectedRedaction ||
      !editorState.canvas
    ) {
      showStatus(
        "Select a region before duplicating."
      );

      return;
    }

    const offset = 16;

    const maximumX = Math.max(
      0,
      editorState.canvas.width -
      Number(selectedRedaction.width || 0)
    );

    const maximumY = Math.max(
      0,
      editorState.canvas.height -
      Number(selectedRedaction.height || 0)
    );

    let nextX = clamp(
      Number(selectedRedaction.x || 0) +
      offset,
      0,
      maximumX
    );

    let nextY = clamp(
      Number(selectedRedaction.y || 0) +
      offset,
      0,
      maximumY
    );

    /*
      Bölge sağ veya alt sınıra dayanmışsa
      kopyayı ters yönde kaydır.
    */
    if (
      nextX ===
      Number(selectedRedaction.x || 0)
    ) {
      nextX = clamp(
        Number(selectedRedaction.x || 0) -
        offset,
        0,
        maximumX
      );
    }

    if (
      nextY ===
      Number(selectedRedaction.y || 0)
    ) {
      nextY = clamp(
        Number(selectedRedaction.y || 0) -
        offset,
        0,
        maximumY
      );
    }

    const duplicatedRedaction = {
      ...selectedRedaction,

      id: createId("redaction"),

      x: nextX,
      y: nextY,

      source: "duplicated-region",
    };

    editorState.redactions.push(
      duplicatedRedaction
    );

    editorState.selectedRedactionId =
      duplicatedRedaction.id;

    editorState.selectionInteraction = null;
    editorState.selectionResizeHandle = null;
    editorState.selectionHasMoved = false;

    saveHistory();
    renderCanvas();
    updateSelectionStatus();

    showStatus(
      "Selected region duplicated."
    );
  }

  function getSelectedRedactionIndex() {
    if (!editorState.selectedRedactionId) {
      return -1;
    }

    return editorState.redactions.findIndex(
      (redaction) =>
        redaction.id ===
        editorState.selectedRedactionId
    );
  }

  function bringSelectedRedactionForward() {
    const currentIndex =
      getSelectedRedactionIndex();

    if (currentIndex < 0) {
      showStatus(
        "Select a region first."
      );

      return;
    }

    const lastIndex =
      editorState.redactions.length - 1;

    if (currentIndex >= lastIndex) {
      showStatus(
        "Selected region is already in front."
      );

      return;
    }

    const nextIndex = currentIndex + 1;

    [
      editorState.redactions[currentIndex],
      editorState.redactions[nextIndex],
    ] = [
        editorState.redactions[nextIndex],
        editorState.redactions[currentIndex],
      ];

    saveHistory();
    renderCanvas();
    updateSelectionStatus();

    showStatus(
      "Selected region moved forward."
    );
  }

  function sendSelectedRedactionBackward() {
    const currentIndex =
      getSelectedRedactionIndex();

    if (currentIndex < 0) {
      showStatus(
        "Select a region first."
      );

      return;
    }

    if (currentIndex === 0) {
      showStatus(
        "Selected region is already behind."
      );

      return;
    }

    const previousIndex = currentIndex - 1;

    [
      editorState.redactions[currentIndex],
      editorState.redactions[previousIndex],
    ] = [
        editorState.redactions[previousIndex],
        editorState.redactions[currentIndex],
      ];

    saveHistory();
    renderCanvas();
    updateSelectionStatus();

    showStatus(
      "Selected region moved backward."
    );
  }
  function bringSelectedRedactionToFront() {
    const currentIndex =
      getSelectedRedactionIndex();

    if (currentIndex < 0) {
      showStatus(
        "Select a region first."
      );

      return;
    }

    const lastIndex =
      editorState.redactions.length - 1;

    if (currentIndex === lastIndex) {
      showStatus(
        "Selected region is already in front."
      );

      return;
    }

    const [selectedRedaction] =
      editorState.redactions.splice(
        currentIndex,
        1
      );

    editorState.redactions.push(
      selectedRedaction
    );

    saveHistory();
    renderCanvas();
    updateSelectionStatus();

    showStatus(
      "Selected region brought to front."
    );
  }

  function sendSelectedRedactionToBack() {
    const currentIndex =
      getSelectedRedactionIndex();

    if (currentIndex < 0) {
      showStatus(
        "Select a region first."
      );

      return;
    }

    if (currentIndex === 0) {
      showStatus(
        "Selected region is already behind."
      );

      return;
    }

    const [selectedRedaction] =
      editorState.redactions.splice(
        currentIndex,
        1
      );

    editorState.redactions.unshift(
      selectedRedaction
    );

    saveHistory();
    renderCanvas();
    updateSelectionStatus();

    showStatus(
      "Selected region sent to back."
    );
  }

  function drawSelectionPreview(context) {
    const rectangle = normalizeRectangle(
      editorState.startX,
      editorState.startY,
      editorState.previewX,
      editorState.previewY
    );
    context.save();
    const previewFillColors = {
      blackout: "rgba(0, 0, 0, 0.82)",
      blur: "rgba(59, 130, 246, 0.20)",
      pixelate: "rgba(168, 85, 247, 0.20)",
    };

    context.fillStyle =
      previewFillColors[
      editorState.activeTool
      ] ||
      previewFillColors.blackout;
    context.fillRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
    const previewStrokeColors = {
      blackout: "#60a5fa",
      blur: "#38bdf8",
      pixelate: "#a855f7",
    };

    context.strokeStyle =
      previewStrokeColors[
      editorState.activeTool
      ] ||
      previewStrokeColors.blackout;
    context.lineWidth = 2;
    context.setLineDash([6, 4]);
    context.strokeRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
    context.restore();
  }

  async function scanImageForSensitiveData(scanButton) {
    if (editorState.batchRunning) {
      showStatus("A batch is still processing through the single OCR worker.");
      return;
    }
    if (!editorState.image || editorState.isScanning) {
      if (editorState.isScanning) showStatus("A sensitive-data scan is already running.");
      return;
    }

    editorState.isScanning = true;
    editorState.scanRequestId += 1;
    const requestId = editorState.scanRequestId;
    const buttonLabel = scanButton.querySelector("span:last-child");

    editorState.detections = [];
    editorState.reviewFinished = false;
    stopReviewSession();
    renderCanvas();
    renderSensitiveDataPanel();
    scanButton.disabled = true;
    scanButton.classList.add("is-scanning");

    try {
      const detections = await detectImageCanvas(
        editorState.image,
        (message) => updateOcrProgress(message, buttonLabel)
      );

      if (requestId !== editorState.scanRequestId) return;

      editorState.detections = detections;
      editorState.reviewFinished = false;
      if (detections.length) {
        focusReviewDetection(0);
      } else {
        stopReviewSession();
        renderSensitiveDataPanel();
        renderCanvas();
      }

      const label = detections.length === 1 ? "potential item" : "potential items";
      updateActiveToolStatus(
        detections.length
          ? `${detections.length} ${label} found · Review highlighted areas`
          : "Text scan complete · No supported sensitive data found"
      );
      showStatus(
        detections.length
          ? `${detections.length} ${label} found.`
          : "Text scan complete. No supported sensitive data was found."
      );
    } catch (error) {
      if (requestId !== editorState.scanRequestId) return;
      console.error("Redaktix OCR failed:", error);
      updateActiveToolStatus("Text scan unavailable · Manual tools still work");
      showStatus("Automatic text detection could not be completed.", true);
    } finally {
      if (requestId === editorState.scanRequestId) {
        editorState.isScanning = false;
        scanButton.disabled = false;
        scanButton.classList.remove("is-scanning");
        if (buttonLabel) {
        buttonLabel.setAttribute("data-i18n", "editor.scan");
        buttonLabel.textContent = t("editor.scan");
      }
      }
    }
  }

  function acceptBatchFiles(files) {
    const selected = selectBatchFiles(files, {
      allowedTypes,
      maxBytes: maximumFileSize,
      limit: BATCH_IMAGE_LIMIT,
      existingCount: editorState.batchItems.length,
    });
    if (!selected.accepted.length) {
      showStatus("Choose up to 20 PNG, JPG, or WebP images under 25 MB.", true);
      return;
    }
    loadOcrModule().catch(() => {});
    if (!editorState.batchItems.length && selected.accepted.length === 1) {
      loadImageFile(selected.accepted[0]);
      return;
    }
    const items = selected.accepted.map((file) => ({
      id: createId("batch"),
      name: file.name,
      file,
      status: "queued",
      progress: 0,
      thumbnailUrl: "",
      detections: [],
      redactions: [],
      width: 0,
      height: 0,
    }));
    editorState.batchItems.push(...items);
    if (selected.skipped) {
      showStatus(`Added ${items.length} images. ${selected.skipped} ${selected.skipped === 1 ? "file was" : "files were"} skipped. The batch limit is ${BATCH_IMAGE_LIMIT}.`);
    }
    renderBatchDrawer();
    processBatchQueue();
  }

  function syncActiveBatchItem() {
    const item = editorState.batchItems.find((entry) => entry.id === editorState.batchActiveId);
    if (!item || !editorState.image) return;
    item.detections = editorState.detections.map(cloneDetectionForHistory);
    item.redactions = editorState.redactions.map((redaction) => ({ ...redaction }));
    item.width = editorState.image.width || editorState.imageWidth;
    item.height = editorState.image.height || editorState.imageHeight;
  }

  function decodeFileToCanvas(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext("2d", { alpha: false })?.drawImage(image, 0, 0);
        URL.revokeObjectURL(url);
        image.src = "";
        resolve(canvas);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("The image could not be opened."));
      };
      image.src = url;
    });
  }

  function thumbnailForCanvas(canvas) {
    const scale = Math.min(1, 112 / Math.max(canvas.width, 1), 112 / Math.max(canvas.height, 1));
    const thumb = document.createElement("canvas");
    thumb.width = Math.max(1, Math.round(canvas.width * scale));
    thumb.height = Math.max(1, Math.round(canvas.height * scale));
    thumb.getContext("2d", { alpha: false })?.drawImage(canvas, 0, 0, thumb.width, thumb.height);
    try {
      return thumb.toDataURL("image/jpeg", 0.72);
    } catch {
      return "";
    }
  }

  function releaseCanvas(canvas) {
    if (!canvas || canvas === editorState.image) return;
    canvas.width = 0;
    canvas.height = 0;
  }

  async function detectImageCanvas(imageCanvas, onProgress) {
    const previousOverride = editorState.scanImageOverride;
    const previousLines = ocrLinesById;
    editorState.scanImageOverride = imageCanvas;
    try {
      const ocrModule = await loadOcrModule();
      const sequence = await ocrModule.recognizeImageSequence([imageCanvas], (update) => {
        if (update.status === "processing") onProgress?.({ progress: update.progress });
      });
      const outcome = sequence[0];
      if (!outcome || outcome.status === "failed") throw outcome?.error || new Error("OCR failed");
      return buildDetectionsFromOcr(outcome.result);
    } finally {
      editorState.scanImageOverride = previousOverride;
      if (editorState.image !== imageCanvas) ocrLinesById = previousLines;
    }
  }

  function buildDetectionsFromOcr(result) {
    const words = Array.isArray(result?.words)
      ? result.words.filter((word) => word?.bbox && String(word.text || "").trim())
      : [];
    const lines = Array.isArray(result?.lines)
      ? result.lines.filter((line) => line?.bbox && String(line.text || "").trim())
      : [];
    ocrLinesById = new Map(lines.map((line) => [line.id, line]));
    const candidates = createDetectionCandidates(words);
    const labeledValueDetections = detectValuesBesideSensitiveLabels(words);
    const beforeSuppress = removeDuplicateDetections(
      filterDetectionsForProfile([
        ...detectApiTokenCandidates(candidates),
        ...detectEmailCandidates(candidates),
        ...detectTcknCandidates(candidates),
        ...detectIpv4Candidates(candidates),
        ...detectIpv6FromOcrWords(words),
        ...detectGroupedSecretsFromOcrWords(words),
        ...detectCreditCardCandidates(candidates),
        ...detectPhoneCandidates(candidates),
        ...detectPhonesFromOcrWords(words),
        ...detectPersonNameCandidates(candidates),
        ...detectLocationCandidates(candidates),
        ...detectSessionIdCandidates(candidates),
        ...detectStructuredDataFromLines(lines),
        ...labeledValueDetections,
      ], editorState.detectionProfile)
    );
    const afterSuppress = suppressShadowedDetections(beforeSuppress);
    if (import.meta.env.DEV) {
      void import("./ocr-debug.js").then(({ isDebugOcrEnabled, logDebugOcrTargetLines }) => {
        if (isDebugOcrEnabled()) {
          logDebugOcrTargetLines(lines, words, beforeSuppress, afterSuppress);
        }
      });
    }
    return limitToToolDetectors(afterSuppress, editorState.toolDetectors);
  }

  async function consumeToolHandoff() {
    const slug = new URLSearchParams(window.location.search).get("tool");
    if (!slug) return;
    const preset = getToolBySlug(slug);
    if (!preset) return;
    editorState.toolDetectors = preset.activeDetectors.slice();
    editorState.detectionProfile = DEFAULT_DETECTION_PROFILE;
    try {
      const pending = await takePendingToolFile(slug);
      if (pending) {
        loadImageFile(pending);
        return;
      }
    } catch {
      // The preset still applies when storage is blocked.
    }
    showStatus(`${preset.h1}. Drop a screenshot, then click Scan sensitive data.`);
  }

  async function processBatchQueue() {
    if (editorState.batchRunning) return;
    editorState.batchRunning = true;
    renderBatchDrawer();
    try {
      for (const item of editorState.batchItems) {
        if (item.status !== "queued") continue;
        item.status = "processing";
        item.progress = 0;
        renderBatchDrawer();
        let canvas = null;
        try {
          canvas = await decodeFileToCanvas(item.file);
          item.width = canvas.width;
          item.height = canvas.height;
          item.thumbnailUrl = thumbnailForCanvas(canvas);
          renderBatchDrawer();
          const showOnCanvas = !editorState.batchPinned;
          if (showOnCanvas) presentBatchCanvas(item, canvas);
          const detections = await detectImageCanvas(canvas, (message) => {
            const progress = Number(message?.progress);
            if (!Number.isFinite(progress)) return;
            const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
            if (percent === item.progress) return;
            item.progress = percent;
            updateBatchRow(item);
          });
          item.detections = detections.map(cloneDetectionForHistory);
          item.progress = 100;
          item.status = "completed";
          if (editorState.batchAutoRedact && item.detections.length) {
            item.redactions.push(...blackoutDetections(item.detections, item.width, item.height));
            item.detections = item.detections.filter((detection) => detection?.review?.needsReview);
          }
          if (editorState.batchActiveId === item.id) {
            editorState.detections = item.detections.map(cloneDetectionForHistory);
            editorState.redactions = item.redactions.map((redaction) => ({ ...redaction }));
            editorState.reviewFinished = false;
            if (item.detections.length) focusReviewDetection(0);
            else {
              stopReviewSession();
              renderCanvas();
              renderSensitiveDataPanel();
            }
          }
          if (!editorState.batchPinned) editorState.batchPinned = true;
        } catch (error) {
          console.error("Redaktix batch image failed:", error);
          item.status = "failed";
          item.progress = 0;
        } finally {
          releaseCanvas(canvas);
        }
        renderBatchDrawer();
      }
    } finally {
      editorState.batchRunning = false;
      renderBatchDrawer();
      const ready = editorState.batchItems.filter((item) => item.status === "completed").length;
      if (ready) showStatus(batchOverallLabel(editorState.batchItems));
    }
  }

  function presentBatchCanvas(item, canvas) {
    syncActiveBatchItem();
    const previousImage = editorState.image;
    editorState.batchActiveId = item.id;
    editorState.sourceName = item.name;
    editorState.imageWidth = canvas.width;
    editorState.imageHeight = canvas.height;
    editorState.file = null;
    editorState.image = canvas;
    if (previousImage && previousImage !== canvas) releaseCanvas(previousImage);
    editorState.redactions = item.redactions.map((redaction) => ({ ...redaction }));
    editorState.detections = item.detections.map(cloneDetectionForHistory);
    editorState.reviewFinished = false;
    stopReviewSession();
    editorState.zoom = 1;
    editorState.zoomMode = "fit";
    editorState.compareMode = false;
    editorState.selectedRedactionId = null;
    resetHistory();
    renderSensitiveDataPanel();
    showCanvas(canvas, item.file);
    if (editorState.detections.length) focusReviewDetection(0);
  }

  async function openBatchItem(id) {
    const item = editorState.batchItems.find((entry) => entry.id === id);
    if (!item || item.status === "queued" || item.status === "processing") return;
    if (item.status === "failed") {
      showStatus(`${item.name} could not be processed.`, true);
      return;
    }
    syncActiveBatchItem();
    editorState.batchPinned = true;
    const canvas = await decodeFileToCanvas(item.file);
    presentBatchCanvas(item, canvas);
    renderBatchDrawer();
  }

  function batchAutoRedactAll() {
    syncActiveBatchItem();
    editorState.batchAutoRedact = true;
    editorState.batchItems.forEach((item) => {
      if (!item.detections.length || !(item.width > 0)) return;
      item.redactions.push(...blackoutDetections(item.detections, item.width, item.height));
      item.detections = item.detections.filter((detection) => detection?.review?.needsReview);
    });
    const active = editorState.batchItems.find((item) => item.id === editorState.batchActiveId);
    if (active) {
      editorState.detections = active.detections.map(cloneDetectionForHistory);
      editorState.redactions = active.redactions.map((redaction) => ({ ...redaction }));
      editorState.reviewFinished = editorState.detections.length === 0;
      if (editorState.detections.length) focusReviewDetection(0);
      else stopReviewSession();
      saveHistory();
      renderCanvas();
      renderSensitiveDataPanel();
    }
    renderBatchDrawer();
    showStatus("Blackout applied to every detected area in this batch.");
  }

  async function downloadBatchZip() {
    syncActiveBatchItem();
    const ready = editorState.batchItems.filter((item) => item.status === "completed");
    if (!ready.length || editorState.batchRunning) {
      showStatus("Wait until the batch finishes before downloading.", true);
      return;
    }
    const unresolved = editorState.batchItems.reduce((sum, item) => sum + item.detections.length, 0);
    if (!(await confirmExportWithUnresolvedSuggestions(unresolved, () => {
      const next = editorState.batchItems.find((item) => item.detections.length);
      if (next) openBatchItem(next.id);
    }))) return;
    try {
      const names = uniqueZipNames(ready.map((item) => item.name.replace(/\.[^.]+$/, "") + ".png"));
      const files = [];
      for (let index = 0; index < ready.length; index += 1) {
        const bytes = await renderBatchPng(ready[index]);
        files.push({ name: names[index], data: bytes });
      }
      const zip = createStoredZip(files);
      const blob = new Blob([zip], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "redaktix-batch.zip";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      showStatus("Image exported with EXIF metadata stripped");
    } catch (error) {
      console.error("Batch ZIP failed:", error);
      showStatus("The batch ZIP could not be created.", true);
    }
  }

  async function renderBatchPng(item) {
    const source = await decodeFileToCanvas(item.file);
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext("2d", { alpha: false });
    context.drawImage(source, 0, 0);
    item.redactions.forEach((redaction) => {
      if (redaction.type === "blackout") {
        context.fillStyle = redaction.color || "#000000";
        context.fillRect(redaction.x, redaction.y, redaction.width, redaction.height);
        return;
      }
      if (redaction.type === "blur") drawBlurOnOutputCanvas(context, canvas, redaction);
      if (redaction.type === "pixelate") drawPixelateOnOutputCanvas(context, canvas, redaction);
    });
    releaseCanvas(source);
    const blob = await canvasToBlob(canvas, "image/png");
    releaseCanvas(canvas);
    return new Uint8Array(await blob.arrayBuffer());
  }

  function ensureBatchDrawer() {
    let drawer = document.getElementById("batchDrawer");
    if (drawer) return drawer;
    drawer = document.createElement("aside");
    drawer.id = "batchDrawer";
    drawer.className = "batch-drawer";
    drawer.hidden = true;
    drawer.setAttribute("aria-label", "Batch images");
    drawer.innerHTML = `
      <div class="batch-drawer-header">
        <strong>Batch</strong>
        <p id="batchOverallLabel"></p>
      </div>
      <div class="batch-drawer-actions">
        <button id="batchRedactAllButton" class="review-action review-action-redact" type="button">Batch Auto-Redact All</button>
        <button id="batchDownloadZipButton" class="review-nav-button" type="button">Download All (ZIP)</button>
      </div>
      <ul id="batchDrawerList" class="batch-drawer-list"></ul>
    `;
    document.body.appendChild(drawer);
    drawer.querySelector("#batchRedactAllButton")?.addEventListener("click", batchAutoRedactAll);
    drawer.querySelector("#batchDownloadZipButton")?.addEventListener("click", () => downloadBatchZip());
    return drawer;
  }

  function updateBatchRow(item) {
    const status = document.querySelector(`[data-batch-status="${item.id}"]`);
    if (status) status.textContent = batchStatusLabel(item.status, item.progress);
    const overall = document.getElementById("batchOverallLabel");
    if (overall) overall.textContent = batchOverallLabel(editorState.batchItems);
  }

  function renderBatchDrawer() {
    const drawer = ensureBatchDrawer();
    const items = editorState.batchItems;
    drawer.hidden = items.length === 0;
    const overall = drawer.querySelector("#batchOverallLabel");
    if (overall) overall.textContent = batchOverallLabel(items);
    const zipButton = drawer.querySelector("#batchDownloadZipButton");
    if (zipButton) zipButton.disabled = editorState.batchRunning || !items.some((item) => item.status === "completed");
    const list = drawer.querySelector("#batchDrawerList");
    if (!list) return;
    list.innerHTML = items.map((item) => `
      <li>
        <button class="batch-item ${item.id === editorState.batchActiveId ? "is-active" : ""}" type="button" data-batch-open="${escapeHtml(item.id)}" ${item.status === "completed" ? "" : "disabled"}>
          ${item.thumbnailUrl ? `<img alt="" src="${escapeHtml(item.thumbnailUrl)}">` : `<span class="batch-item-placeholder"></span>`}
          <span>
            <strong>${escapeHtml(item.name)}</strong>
            <em data-batch-status="${escapeHtml(item.id)}">${escapeHtml(batchStatusLabel(item.status, item.progress))}</em>
          </span>
        </button>
      </li>
    `).join("");
    list.querySelectorAll("[data-batch-open]").forEach((button) => {
      button.addEventListener("click", () => openBatchItem(button.dataset.batchOpen));
    });
  }

  function createDetectionCandidates(words) {
    const validWords = Array.isArray(words)
      ? words.filter((word) => word?.bbox && String(word.text || "").trim())
      : [];
    const candidates = [...validWords];
    const groups = new Map();

    validWords.forEach((word) => {
      const key = word.lineId || createVisualLineKey(word);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(word);
    });

    groups.forEach((lineWords) => {
      const sorted = [...lineWords].sort((a, b) => a.bbox.x - b.bbox.x);
      for (let start = 0; start < sorted.length; start += 1) {
        const window = [];
        for (
          let index = start;
          index < sorted.length &&
          window.length < 12;
          index += 1
        ) {
          const current = sorted[index];
          if (window.length && !areWordsAdjacent(window[window.length - 1], current)) break;
          window.push(current);
          if (window.length >= 2) candidates.push(combineWords(window));
        }
      }
    });

    return removeDuplicateCandidates(candidates.filter(Boolean));
  }

  function createVisualLineKey(word) {
    const height = Number(word.bbox.height || 1);
    const centerY = Number(word.bbox.y) + height / 2;
    return `visual-${Math.round(centerY / Math.max(6, height * 0.6))}`;
  }

  function areWordsAdjacent(first, second) {
    const firstHeight = Number(first.bbox.height || 0);
    const secondHeight = Number(second.bbox.height || 0);
    const height = Math.max(firstHeight, secondHeight, 1);
    const firstCenterY = Number(first.bbox.y) + firstHeight / 2;
    const secondCenterY = Number(second.bbox.y) + secondHeight / 2;
    const gap = Number(second.bbox.x) - (Number(first.bbox.x) + Number(first.bbox.width));
    return Math.abs(firstCenterY - secondCenterY) <= Math.max(5, height * 0.6) &&
      gap >= -height * 0.2 && gap <= Math.max(20, height * 2.2);
  }

  function combineWords(words) {
    const left = Math.min(...words.map((word) => Number(word.bbox.x)));
    const top = Math.min(...words.map((word) => Number(word.bbox.y)));
    const right = Math.max(...words.map((word) => Number(word.bbox.x) + Number(word.bbox.width)));
    const bottom = Math.max(...words.map((word) => Number(word.bbox.y) + Number(word.bbox.height)));
    const parts = words.map((word) => String(word.text || "").trim());
    return {
      text: parts.join(""),
      spacedText: parts.join(" "),
      confidence: Math.min(...words.map((word) => Number(word.confidence || 0))),
      bbox: { x: left, y: top, width: right - left, height: bottom - top },
      words: words.slice(),
      lineId: words.find((word) => word.lineId)?.lineId || null,
    };
  }

  function removeDuplicateCandidates(candidates) {
    const seen = new Set();
    return candidates.filter((candidate) => {
      if (!candidate?.bbox) return false;
      const text = normalizeDetectionText(candidate.text);
      const key = `${text}|${Math.round(candidate.bbox.x / 4)}|${Math.round(candidate.bbox.y / 4)}|${Math.round(candidate.bbox.width / 4)}`;
      if (!text || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function detectEmailCandidates(candidates) {
    const detections = [];

    candidates.forEach((candidate) => {
      if (!candidate?.bbox || Number(candidate.confidence || 0) < 25) {
        return;
      }

      const spacedMatches = extractEmailCandidates(candidate.spacedText || candidate.text);
      const compactMatches = extractEmailCandidates(candidate.text);
      const accepted = new Set(spacedMatches.map((email) => email.toLowerCase()));

      compactMatches.forEach((email) => {
        const lower = email.toLowerCase();
        const extendsSpacedMatch = [...accepted].some((kept) =>
          lower.startsWith(kept) && lower.length > kept.length
        );
        if (!extendsSpacedMatch) {
          accepted.add(lower);
        }
      });

      [...spacedMatches, ...compactMatches].forEach((email) => {
        const lower = email.toLowerCase();
        if (!accepted.has(lower)) {
          return;
        }
        accepted.delete(lower);
        const detection = createDetection(candidate, "email", "Possible email", email);
        if (detection) detections.push(detection);
      });
    });

    return detections;
  }

  function detectIpv4Candidates(candidates) {
    return detectByValues(candidates, (value) =>
      extractIpv4Candidates(value).map((text) => ({ type: "ipv4", label: "Possible IP address", text }))
    );
  }

  function detectIpv6FromOcrWords(words) {
    const image = sourceImagePixels();
    return detectIpv6InScan(words, image.width, image.height).map((detection) => ({
      ...detection,
      id: createId("detection"),
    }));
  }

  function detectGroupedSecretsFromOcrWords(words) {
    const image = sourceImagePixels();
    return detectGroupedSecretsInScan(words, image.width, image.height)
      .filter((detection) =>
        isAlwaysOnDetector(detection.type) ||
        detection.ruleId === "iban" ||
        isDetectorEnabled(editorState.detectionProfile, detection.type)
      );
  }

  function detectCreditCardCandidates(candidates) {
    return detectByValues(candidates, (value) =>
      extractCreditCardCandidates(value).map((text) => ({
        type: "credit_card",
        label: "Possible card number",
        text,
      }))
    );
  }

  function detectPhoneCandidates(candidates) {
    return detectByValues(candidates, (value) =>
      extractPhoneCandidates(value).map((text) => ({
        type: "phone",
        label: "Possible phone number",
        text,
        reviewHints: phoneReviewHints(value, text),
      }))
    );
  }

  function detectPhonesFromOcrWords(words) {
    const image = sourceImagePixels();
    return detectPhonesInScan(words, image.width, image.height).map((detection) => ({
      ...detection,
      id: createId("detection"),
    }));
  }

  function detectSessionIdCandidates(candidates) {
    return detectByValues(
      candidates,
      (value) => {
        const normalizedValue =
          normalizeCredential(value);

        const patterns = [
          /\b(?:sess|session)[_-]+[a-z0-9][a-z0-9_-]{5,}\b/gi,

          /*
            OCR alt çizgileri tamamen kaçırmışsa,
            başlangıcı sess/session olan uzun yapıyı
            inceleme önerisi olarak kabul et.
          */
          /\b(?:sess|session)[a-z0-9]{10,}\b/gi,
        ];

        const matches = patterns.flatMap(
          (pattern) =>
            normalizedValue.match(pattern) || []
        );

        return [...new Set(matches)].map(
          (match) => ({
            type: "session_id",
            label: "Possible session ID",
            text: formatDetectedCredential(
              match,
              "session_id"
            ),
          })
        );
      }
    );
  }

  function detectApiTokenCandidates(candidates) {
    const detections = [];
    candidates.forEach((candidate) => {
      if (!candidate?.bbox) return;
      const spaced = candidate.spacedText;
      const value = spaced && /\s/.test(spaced) ? spaced : (spaced || candidate.text);
      if (!value) return;
      extractApiTokenCandidates(value).forEach((text) => {
        const detection = createDetection(candidate, "api_token", "Possible API token", text);
        if (detection) detections.push(detection);
      });
    });
    return detections;
  }

  function detectTcknCandidates(candidates) {
    const detections = [];
    candidates.forEach((candidate) => {
      if (!candidate?.bbox) return;
      const values = [...new Set([candidate.text, candidate.spacedText].filter(Boolean))];
      values.forEach((value) => {
        findTcknMatches(value).forEach((match) => {
          const detection = createDetection(candidate, "tckn", "Turkish ID Number", match.text, {
            boxText: match.span,
            matchOccurrence: match.occurrence,
            padding: match.padding,
            reviewHints: { labelBased: Boolean(match.labeled) },
          });
          if (detection) detections.push(detection);
        });
      });
    });
    return detections;
  }

  function detectPersonNameCandidates(candidates) {
    return detectByValues(candidates, (value) =>
      extractPersonNameCandidates(value).map((text) => ({
        type: "person_name",
        label: "Possible name",
        text,
      }))
    );
  }

  function detectLocationCandidates(candidates) {
    return detectByValues(candidates, (value) =>
      extractLocationCandidates(value).map((text) => ({
        type: "location",
        label: "Possible location",
        text,
      }))
    );
  }

  function detectByValues(candidates, detector) {
    const detections = [];
    candidates.forEach((candidate) => {
      if (!candidate?.bbox) return;
      const values = [...new Set([candidate.text, candidate.spacedText].filter(Boolean))];
      values.forEach((value) => {
        detector(value).forEach((match) => {
          const detection = createDetection(candidate, match.type, match.label, match.text, {
            reviewHints: match.reviewHints,
          });
          if (detection) detections.push(detection);
        });
      });
    });
    return detections;
  }

  function detectStructuredDataFromVisualLines(words) {
    if (!Array.isArray(words)) {
      return [];
    }

    const validWords = words.filter((word) => {
      return (
        word?.bbox &&
        String(word.text || "").trim() &&
        Number.isFinite(Number(word.bbox.x)) &&
        Number.isFinite(Number(word.bbox.y)) &&
        Number.isFinite(Number(word.bbox.width)) &&
        Number.isFinite(Number(word.bbox.height))
      );
    });

    const visualLines = [];

    [...validWords]
      .sort((first, second) => {
        const firstCenterY =
          Number(first.bbox.y) +
          Number(first.bbox.height) / 2;

        const secondCenterY =
          Number(second.bbox.y) +
          Number(second.bbox.height) / 2;

        return firstCenterY - secondCenterY;
      })
      .forEach((word) => {
        const wordCenterY =
          Number(word.bbox.y) +
          Number(word.bbox.height) / 2;

        const matchingLine = visualLines.find((line) => {
          const tolerance = Math.max(
            5,
            Number(word.bbox.height) * 0.55,
            line.averageHeight * 0.55
          );

          return (
            Math.abs(line.centerY - wordCenterY) <=
            tolerance
          );
        });

        if (!matchingLine) {
          visualLines.push({
            centerY: wordCenterY,
            averageHeight: Number(word.bbox.height),
            words: [word],
          });

          return;
        }

        matchingLine.words.push(word);

        matchingLine.centerY =
          matchingLine.words.reduce((total, item) => {
            return (
              total +
              Number(item.bbox.y) +
              Number(item.bbox.height) / 2
            );
          }, 0) / matchingLine.words.length;

        matchingLine.averageHeight =
          matchingLine.words.reduce((total, item) => {
            return total + Number(item.bbox.height);
          }, 0) / matchingLine.words.length;
      });

    const detections = [];

    visualLines.forEach((line) => {
      const sortedWords = [...line.words].sort(
        (first, second) =>
          Number(first.bbox.x) -
          Number(second.bbox.x)
      );

      const sequences = createVisualLineSequences(
        sortedWords
      );

      sequences.forEach((sequence) => {
        const compactText = normalizeCredential(
          sequence.text
        );

        extractIpv4Candidates(sequence.text).forEach(
          (ipAddress) => {
            detections.push(
              createDetection(
                sequence,
                "ipv4",
                "Possible IP address",
                ipAddress
              )
            );
          }
        );

        extractIpv6Candidates(sequence.text).forEach(
          (ipAddress) => {
            detections.push(
              createDetection(
                sequence,
                "ipv6",
                "Possible IPv6 address",
                ipAddress
              )
            );
          }
        );

        const sessionMatches =
          compactText.match(
            /\b(?:sess|session)[_-][a-z0-9_-]{6,}\b/gi
          ) || [];

        sessionMatches.forEach((sessionId) => {
          detections.push(
            createDetection(
              sequence,
              "session_id",
              "Possible session ID",
              sessionId
            )
          );
        });

        const tokenPatterns = [
          /\bapi_(?:test|live)_[a-z0-9_-]{8,}\b/gi,
          /\b(?:sk|pk)_(?:test|live)_[a-z0-9_-]{8,}\b/gi,
          /\bghp_[a-z0-9]{20,}\b/gi,
          /\bgithub_pat_[a-z0-9_]{20,}\b/gi,
        ];

        tokenPatterns.forEach((pattern) => {
          const tokenMatches =
            compactText.match(pattern) || [];

          tokenMatches.forEach((token) => {
            detections.push(
              createDetection(
                sequence,
                "api_token",
                "Possible API token",
                token
              )
            );
          });
        });
      });
    });

    return detections.filter(Boolean);
  }

  function createVisualLineSequences(words) {
    if (!Array.isArray(words) || words.length === 0) {
      return [];
    }

    const sequences = [];

    for (
      let startIndex = 0;
      startIndex < words.length;
      startIndex += 1
    ) {
      const wordWindow = [];

      for (
        let currentIndex = startIndex;
        currentIndex < words.length;
        currentIndex += 1
      ) {
        const currentWord = words[currentIndex];

        if (wordWindow.length > 0) {
          const previousWord =
            wordWindow[wordWindow.length - 1];

          if (
            !areStructuredWordsAdjacent(
              previousWord,
              currentWord
            )
          ) {
            break;
          }
        }

        wordWindow.push(currentWord);

        if (wordWindow.length <= 12) {
          const combinedSequence =
            combineStructuredWords(wordWindow);

          if (combinedSequence) {
            sequences.push(combinedSequence);
          }
        }

        if (wordWindow.length === 12) {
          break;
        }
      }
    }

    return removeDuplicateCandidates(sequences);
  }

  function areStructuredWordsAdjacent(
    firstWord,
    secondWord
  ) {
    const firstHeight = Number(
      firstWord.bbox.height || 0
    );

    const secondHeight = Number(
      secondWord.bbox.height || 0
    );

    const maximumHeight = Math.max(
      firstHeight,
      secondHeight,
      1
    );

    const firstCenterY =
      Number(firstWord.bbox.y) +
      firstHeight / 2;

    const secondCenterY =
      Number(secondWord.bbox.y) +
      secondHeight / 2;

    if (
      Math.abs(firstCenterY - secondCenterY) >
      Math.max(5, maximumHeight * 0.6)
    ) {
      return false;
    }

    const firstRight =
      Number(firstWord.bbox.x) +
      Number(firstWord.bbox.width);

    const horizontalGap =
      Number(secondWord.bbox.x) -
      firstRight;

    return (
      horizontalGap >= -maximumHeight * 0.2 &&
      horizontalGap <=
      Math.max(24, maximumHeight * 2.5)
    );
  }

  function combineStructuredWords(words) {
    if (!Array.isArray(words) || words.length === 0) {
      return null;
    }

    const left = Math.min(
      ...words.map((word) =>
        Number(word.bbox.x)
      )
    );

    const top = Math.min(
      ...words.map((word) =>
        Number(word.bbox.y)
      )
    );

    const right = Math.max(
      ...words.map((word) => {
        return (
          Number(word.bbox.x) +
          Number(word.bbox.width)
        );
      })
    );

    const bottom = Math.max(
      ...words.map((word) => {
        return (
          Number(word.bbox.y) +
          Number(word.bbox.height)
        );
      })
    );

    const textParts = words.map((word) =>
      String(word.text || "").trim()
    );

    return {
      text: textParts.join(""),
      spacedText: textParts.join(" "),

      confidence: Math.min(
        ...words.map((word) =>
          Number(word.confidence || 0)
        )
      ),

      bbox: {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      },
      words: words.slice(),
      lineId: words.find((word) => word.lineId)?.lineId || null,
    };
  }

  function detectValuesBesideSensitiveLabels(words) {
    if (!Array.isArray(words)) {
      return [];
    }

    const validWords = words.filter((word) => {
      return (
        word?.bbox &&
        String(word.text || "").trim() &&
        Number.isFinite(Number(word.bbox.x)) &&
        Number.isFinite(Number(word.bbox.y)) &&
        Number.isFinite(Number(word.bbox.width)) &&
        Number.isFinite(Number(word.bbox.height))
      );
    });

    const visualLines = groupWordsByVisualLine(
      validWords
    );

    const detections = [];

    visualLines.forEach((lineWords) => {
      const sortedWords = [...lineWords].sort(
        (first, second) =>
          Number(first.bbox.x) -
          Number(second.bbox.x)
      );

      const completeLineText = sortedWords
        .map((word) =>
          String(word.text || "").trim()
        )
        .join(" ");

      const normalizedLineText =
        normalizeLabelText(completeLineText);

      if (
        normalizedLineText.includes("sessionid")
      ) {
        const detection =
          detectValueAfterLabel({
            words: sortedWords,
            labelPattern:
              /session\s*id\s*:?\s*/i,
            type: "session_id",
            label: "Possible session ID",
            valuePattern:
              /(?:sess|session)[_-]*[a-z0-9_-]{6,}/i,
          });

        if (detection) {
          detections.push(detection);
        }
      }

      if (
        normalizedLineText.includes("apitoken") ||
        normalizedLineText.includes("apikey")
      ) {
        const detection =
          detectValueAfterLabel({
            words: sortedWords,
            labelPattern:
              /api\s*(?:token|key)\s*:?\s*/i,
            type: "api_token",
            label: "Possible API token",
            valuePattern:
              /(?:api[_-]*(?:test|live)[_-]*[a-z0-9_-]{8,}|(?:sk|pk|rk)[_-]*(?:live|test)[_-]*[a-z0-9]{24,})/i,
          });

        if (detection) {
          detections.push(detection);
        }
      }
    });

    return detections;
  }

  function groupWordsByVisualLine(words) {
    const lines = [];

    [...words]
      .sort((first, second) => {
        const firstCenter =
          Number(first.bbox.y) +
          Number(first.bbox.height) / 2;

        const secondCenter =
          Number(second.bbox.y) +
          Number(second.bbox.height) / 2;

        return firstCenter - secondCenter;
      })
      .forEach((word) => {
        const wordCenter =
          Number(word.bbox.y) +
          Number(word.bbox.height) / 2;

        const matchingLine = lines.find(
          (line) => {
            const maximumHeight = Math.max(
              line.averageHeight,
              Number(word.bbox.height)
            );

            return (
              Math.abs(
                line.centerY - wordCenter
              ) <=
              Math.max(
                5,
                maximumHeight * 0.55
              )
            );
          }
        );

        if (!matchingLine) {
          lines.push({
            centerY: wordCenter,
            averageHeight:
              Number(word.bbox.height),
            words: [word],
          });

          return;
        }

        matchingLine.words.push(word);

        matchingLine.centerY =
          matchingLine.words.reduce(
            (total, item) =>
              total +
              Number(item.bbox.y) +
              Number(item.bbox.height) / 2,
            0
          ) / matchingLine.words.length;

        matchingLine.averageHeight =
          matchingLine.words.reduce(
            (total, item) =>
              total +
              Number(item.bbox.height),
            0
          ) / matchingLine.words.length;
      });

    return lines.map((line) => line.words);
  }

  function detectValueAfterLabel({
    words,
    labelPattern,
    type,
    label,
    valuePattern,
  }) {
    if (
      !Array.isArray(words) ||
      words.length === 0
    ) {
      return null;
    }

    const sortedWords = [...words].sort(
      (first, second) =>
        Number(first.bbox.x) -
        Number(second.bbox.x)
    );

    const lineText = sortedWords
      .map((word) =>
        String(word.text || "").trim()
      )
      .join(" ");

    const labelMatch =
      lineText.match(labelPattern);

    if (!labelMatch) {
      return null;
    }

    /*
      Etiketin bittiği OCR kelimesini bul.
      Örnek: "Session" + "ID:"
    */
    let accumulatedText = "";
    let valueStartIndex = -1;

    for (
      let index = 0;
      index < sortedWords.length;
      index += 1
    ) {
      accumulatedText +=
        `${String(
          sortedWords[index].text || ""
        ).trim()} `;

      labelPattern.lastIndex = 0;

      if (labelPattern.test(accumulatedText)) {
        valueStartIndex = index + 1;
        break;
      }
    }

    if (
      valueStartIndex < 0 ||
      valueStartIndex >= sortedWords.length
    ) {
      return null;
    }

    const valueWords = [];

    for (
      let index = valueStartIndex;
      index < sortedWords.length;
      index += 1
    ) {
      const currentWord = sortedWords[index];

      if (valueWords.length > 0) {
        const previousWord =
          valueWords[valueWords.length - 1];

        if (
          !areSensitiveValueWordsAdjacent(
            previousWord,
            currentWord
          )
        ) {
          break;
        }
      }

      valueWords.push(currentWord);

      /*
        Session ID ve API token için sekiz
        OCR parçası yeterlidir.
      */
      if (valueWords.length === 8) {
        break;
      }
    }

    if (valueWords.length === 0) {
      return null;
    }

    const combinedValue =
      combineWords(valueWords);

    if (!combinedValue) {
      return null;
    }

    const normalizedValue =
      normalizeCredential(
        combinedValue.text
      );

    const match =
      normalizedValue.match(valuePattern);

    if (!match) {
      return null;
    }

    return createDetection(
      combinedValue,
      type,
      label,
      formatDetectedCredential(
        match[0],
        type
      )
    );
  }

  function areSensitiveValueWordsAdjacent(
    firstWord,
    secondWord
  ) {
    if (
      !firstWord?.bbox ||
      !secondWord?.bbox
    ) {
      return false;
    }

    const firstHeight = Number(
      firstWord.bbox.height || 0
    );

    const secondHeight = Number(
      secondWord.bbox.height || 0
    );

    const maximumHeight = Math.max(
      firstHeight,
      secondHeight,
      1
    );

    const firstCenterY =
      Number(firstWord.bbox.y) +
      firstHeight / 2;

    const secondCenterY =
      Number(secondWord.bbox.y) +
      secondHeight / 2;

    const sameLine =
      Math.abs(
        firstCenterY - secondCenterY
      ) <= Math.max(
        5,
        maximumHeight * 0.55
      );

    if (!sameLine) {
      return false;
    }

    const firstRight =
      Number(firstWord.bbox.x) +
      Number(firstWord.bbox.width);

    const horizontalGap =
      Number(secondWord.bbox.x) -
      firstRight;

    return (
      horizontalGap >=
      -maximumHeight * 0.2 &&
      horizontalGap <=
      Math.max(
        16,
        maximumHeight * 1.5
      )
    );
  }

  function normalizeLabelText(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[İIı]/g, "i")
      .replace(/[^a-z0-9]/g, "");
  }

  function detectStructuredDataFromLines(lines) {
    return detectStructuredLines(lines, {
      profileId: editorState.detectionProfile,
      imageSize: sourceImagePixels(),
      linesById: ocrLinesById,
      extractEmailCandidates,
      extractIpv4Candidates,
      extractCreditCardCandidates,
      extractPhoneCandidates,
      loadCustomRules,
    });
  }

  function createDetection(source, type, label, text, options = {}) {
    return createStructuredDetection(source, type, label, text, options, {
      imageSize: sourceImagePixels(),
      linesById: ocrLinesById,
    });
  }

  function cleanOcrToken(value) {
    return String(value || "")
      .trim()
      .replace(/^[<([{\"'`]+/, "")
      .replace(/[>\])},;:\"'`]+$/, "")
      .replace(/[.,;:!?]+$/, "")
      .replace(/\s+/g, "");
  }

  function isEmail(value) {
    return extractEmailCandidates(value).some((email) => email.length === String(value || "").trim().length);
  }

  function extractEmailCandidates(value) {
    const matches = String(value || "").match(
      /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
    );
    if (!matches) {
      return [];
    }
    return [...new Set(matches.map(trimGluedEmailTld).filter(Boolean))];
  }

  function trimGluedEmailTld(email) {
    const parts = String(email || "").match(/^(.*\.)([a-z]{2,24})$/i);
    if (!parts) {
      return email;
    }
    const tld = parts[2].toLowerCase();
    const knownTlds = [
      "com", "net", "org", "edu", "gov", "io", "co", "tr", "uk", "de", "fr",
      "info", "biz", "app", "dev", "me", "us", "ca", "au", "nl", "se", "no",
      "fi", "ch", "at", "be", "it", "es", "pt", "pl", "ru", "jp", "kr", "cn",
      "in", "br", "xyz", "online", "site", "store", "tech", "email", "cloud",
      "company", "network", "systems", "digital", "group", "global",
    ];
    if (knownTlds.includes(tld)) {
      return `${parts[1]}${tld}`;
    }
    const knownPrefix = knownTlds
      .filter((item) => tld.startsWith(item) && tld.length > item.length)
      .sort((first, second) => second.length - first.length)[0];
    return knownPrefix ? `${parts[1]}${knownPrefix}` : email;
  }

  function extractIpv4Candidates(value) {
    const normalized = String(value || "")
      .trim()
      .replace(/[·•]/g, ".")
      .replace(/(\d)\s*\.\s*(\d)/g, "$1.$2");

    const matches = normalized.match(
      /(?<!\d)(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?::[0-9]{1,5})?(?!\d)/g
    );

    if (!matches) {
      return [];
    }

    return [...new Set(matches)].filter((match) => {
      const [ipAddress, port] = match.split(":");
      if (!isValidIpv4(ipAddress)) {
        return false;
      }
      if (port === undefined) {
        return true;
      }
      const portNumber = Number(port);
      return Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535;
    });
  }

  function isValidIpv4(value) {
    if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) return false;
    return value.split(".").map(Number).every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
  }

  function normalizeCredential(value) {
    return String(value || "")
      .trim()

      /* Farklı tire karakterleri */
      .replace(/[‐‑‒–—−]/g, "-")

      /* Farklı alt çizgi karakterleri */
      .replace(/[＿﹍﹎]/g, "_")

      /* Alt çizginin çevresindeki boşluklar */
      .replace(/\s*_\s*/g, "_")

      /* Tirenin çevresindeki boşluklar */
      .replace(/\s*-\s*/g, "-")

      /* Kalan boşluklar */
      .replace(/\s+/g, "")

      /* Sondaki noktalama */
      .replace(/[.,;:!?]+$/, "");
  }

  function formatDetectedCredential(
    value,
    type
  ) {
    const originalValue =
      String(value || "").trim();

    if (!originalValue) {
      return "";
    }

    if (type === "session_id") {
      const compactMatch =
        originalValue.match(
          /^(?:sess|session)(?:test|live)([a-z0-9_-]{6,})$/i
        );

      if (compactMatch) {
        const prefix = originalValue
          .toLowerCase()
          .startsWith("session")
          ? "session"
          : "sess";

        const environment =
          originalValue
            .slice(prefix.length)
            .toLowerCase()
            .startsWith("live")
            ? "live"
            : "test";

        const bodyStart =
          prefix.length +
          environment.length;

        const body =
          originalValue.slice(bodyStart);

        return (
          `${prefix}_` +
          `${environment}_` +
          body
        );
      }
    }

    if (type === "api_token") {
      const compactMatch =
        originalValue.match(
          /^api(test|live)([a-z0-9_-]{8,})$/i
        );

      if (compactMatch) {
        return (
          `api_${compactMatch[1].toLowerCase()}_` +
          compactMatch[2]
        );
      }
    }

    return originalValue;
  }

  function extractCreditCardCandidates(value) {
    return detectCreditCard(value).map((detection) => detection.text);
  }

  function extractPhoneCandidates(value) {
    const source = String(value || "")
      .replace(/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?::\d{1,5})?\b/g, " ")
      .replace(/(?<!\d)(?:\d[ \t-]?){12,18}\d(?!\d)/g, " ");
    return extractDetectedPhoneCandidates(source);
  }

  function isValidPhone(value) {
    const text = String(value || "").trim();
    const digits = text.replace(/\D/g, "");
    const hasClearFormat = text.startsWith("+") || text.startsWith("0") || text.startsWith("(");
    return hasClearFormat &&
      digits.length >= 10 &&
      digits.length <= 15 &&
      /^\+?\(?\d[\d\s().-]{8,22}\d$/.test(text);
  }

  function removeDuplicateDetections(detections) {
    const valid = detections.filter((item) =>
      item && [item.normX, item.normY, item.normWidth, item.normHeight].every(Number.isFinite)
    );
    valid.sort((a, b) => {
      const lengthDelta = normalizeDetectionText(b.text).length - normalizeDetectionText(a.text).length;
      if (lengthDelta !== 0) return lengthDelta;
      return b.normWidth * b.normHeight - a.normWidth * a.normHeight;
    });
    const unique = [];

    valid.forEach((candidate) => {
      const duplicate = unique.some((current) => {
        if (current.type !== candidate.type) return false;
        
        if (current.type === "tckn") {
          return sameTcknGlyph(detectionBoxPx(current), detectionBoxPx(candidate));
        }

        if (spatiallyDuplicate(detectionBoxPx(current), detectionBoxPx(candidate))) return true;

        const firstText = detectionComparisonKey(current);
        const secondText = detectionComparisonKey(candidate);
        const sameText = firstText === secondText && firstText.length > 0;
        return current.type === "person_name" &&
          sameText &&
          sameDetectionBand(current, candidate);
      });
      if (!duplicate) unique.push(candidate);
    });

    return unique;
  }

  function detectionBoxPx(detection) {
    const image = sourceImagePixels();
    const width = Number(image.width) || 0;
    const height = Number(image.height) || 0;
    if (!(width > 0) || !(height > 0)) return null;
    const x0 = detection.normX * width;
    const y0 = detection.normY * height;
    return {
      x0,
      y0,
      x1: x0 + detection.normWidth * width,
      y1: y0 + detection.normHeight * height,
    };
  }

  function detectionComparisonKey(detection) {
    if (detection?.type === "person_name") return canonicalPersonNameKey(detection.text);
    return normalizeDetectionText(detection?.text);
  }

  function sameDetectionBand(first, second) {
    const firstMid = first.normY + first.normHeight / 2;
    const secondMid = second.normY + second.normHeight / 2;
    const band = Math.max(first.normHeight, second.normHeight, 0.001);
    if (Math.abs(firstMid - secondMid) > band * 0.65) return false;
    const gap = Math.max(first.normX, second.normX) -
      Math.min(first.normX + first.normWidth, second.normX + second.normWidth);
    return gap <= band * 1.25;
  }

  function normalizeDetectionText(value) {
    return String(value || "").trim().replace(/\s+/g, "").toLowerCase();
  }

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

  function setLocalProcessingPopoverOpen(open) {
    const badge = document.getElementById("localProcessingBadge");
    const popover = document.getElementById("localProcessingPopover");
    if (!badge || !popover) return;
    popover.hidden = !open;
    badge.setAttribute("aria-expanded", String(open));
  }

  function cancelReviewHighlight() {
    editorState.reviewMotionId += 1;
    if (editorState.reviewMotionFrame) cancelAnimationFrame(editorState.reviewMotionFrame);
    if (editorState.reviewPulseFrame) cancelAnimationFrame(editorState.reviewPulseFrame);
    editorState.reviewMotionFrame = 0;
    editorState.reviewPulseFrame = 0;
    editorState.reviewPulse = 0;
    editorState.reviewFocusId = null;
    clearReviewCanvasOffset();
    renderCanvas();
  }

  function stopReviewSession() {
    editorState.reviewMotionId += 1;
    if (editorState.reviewMotionFrame) cancelAnimationFrame(editorState.reviewMotionFrame);
    if (editorState.reviewPulseFrame) cancelAnimationFrame(editorState.reviewPulseFrame);
    editorState.reviewMotionFrame = 0;
    editorState.reviewPulseFrame = 0;
    editorState.reviewActive = false;
    editorState.reviewIndex = -1;
    editorState.reviewFocusId = null;
    editorState.reviewPulse = 0;
    clearReviewCanvasOffset();
  }

  function focusReviewDetection(index) {
    const detections = editorState.detections;
    if (!detections.length || index < 0) {
      if (editorState.reviewActive) editorState.reviewFinished = true;
      stopReviewSession();
      renderSensitiveDataPanel();
      renderCanvas();
      return;
    }
    const nextIndex = ((index % detections.length) + detections.length) % detections.length;
    const detection = detections[nextIndex];
    editorState.reviewActive = true;
    editorState.reviewFinished = false;
    editorState.reviewIndex = nextIndex;
    editorState.reviewFocusId = detection.id;
    renderSensitiveDataPanel();
    animateReviewFocus(detection);
  }

  function animateReviewFocus(detection) {
    const viewport = document.querySelector(".editor-canvas-viewport");
    const rect = detectionRenderRect(detection);
    if (!viewport || !rect) return;
    const visible = reviewVisibleCanvasSize(viewport);
    const targetZoom = reviewZoomForBox(rect, {
      width: visible.visibleWidth,
      height: visible.visibleHeight,
    }, {
      min: editorState.minimumZoom,
      max: editorState.maximumZoom,
    });
    const startZoom = editorState.zoom;
    const motionId = editorState.reviewMotionId + 1;
    editorState.reviewMotionId = motionId;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    const duration = 320;

    const frame = (now) => {
      if (editorState.reviewMotionId !== motionId) return;
      const progress = reducedMotion ? 1 : easeOutCubic((now - start) / duration);
      setCanvasZoom(startZoom + (targetZoom - startZoom) * progress, { mode: "manual" });
      panDetectionToCenter(rect);
      if (progress < 1) {
        editorState.reviewMotionFrame = window.requestAnimationFrame(frame);
      }
    };

    if (editorState.reviewMotionFrame) cancelAnimationFrame(editorState.reviewMotionFrame);
    editorState.reviewMotionFrame = window.requestAnimationFrame(frame);
    if (!reducedMotion) pulseReviewFocus(detection.id);
  }

  function reviewCoveredPanelWidth(canvasContainer, sidePanel) {
    if (!canvasContainer || !sidePanel || sidePanel.hidden) return 0;
    const containerRect = canvasContainer.getBoundingClientRect();
    const panelRect = sidePanel.getBoundingClientRect();
    const overlap = Math.min(containerRect.right, panelRect.right) - Math.max(containerRect.left, panelRect.left);
    if (overlap <= 0) return 0;
    return Math.min(sidePanel.clientWidth, overlap);
  }

  function reviewVisibleCanvasSize(canvasContainer) {
    const sidePanel = document.getElementById("sensitiveDataPanel");
    const sidePanelWidth = reviewCoveredPanelWidth(canvasContainer, sidePanel);
    return {
      visibleWidth: Math.max(1, canvasContainer.clientWidth - sidePanelWidth),
      visibleHeight: Math.max(1, canvasContainer.clientHeight),
    };
  }

  function panDetectionToCenter(rect) {
    const canvasContainer = document.querySelector(".editor-canvas-viewport");
    const frame = document.querySelector(".editor-canvas-frame");
    const canvas = editorState.canvas;
    if (!canvasContainer || !frame || !canvas || !rect) return;

    const { visibleWidth, visibleHeight } = reviewVisibleCanvasSize(canvasContainer);
    frame.style.transform = "none";
    canvasContainer.scrollLeft = 0;
    canvasContainer.scrollTop = 0;
    const currentZoom = canvas.getBoundingClientRect().width / Math.max(canvas.width, 1);
    const targetOffsetX = (visibleWidth / 2) - ((rect.x + rect.width / 2) * currentZoom);
    const targetOffsetY = (visibleHeight / 2) - ((rect.y + rect.height / 2) * currentZoom);
    const frameRect = frame.getBoundingClientRect();
    const containerRect = canvasContainer.getBoundingClientRect();
    frame.style.transform = `translate(${targetOffsetX - (frameRect.left - containerRect.left)}px, ${targetOffsetY - (frameRect.top - containerRect.top)}px)`;
  }

  function clearReviewCanvasOffset() {
    const frame = document.querySelector(".editor-canvas-frame");
    if (frame) frame.style.transform = "";
  }

  function recenterActiveReviewDetection() {
    if (!editorState.reviewActive || !editorState.reviewFocusId) return;
    const detection = editorState.detections.find((item) => item.id === editorState.reviewFocusId);
    const rect = detection && detectionRenderRect(detection);
    if (rect) panDetectionToCenter(rect);
  }

  function ensureReviewViewportObserver() {
    if (editorState.reviewViewportObserver || typeof ResizeObserver === "undefined") return;
    const sidePanel = document.getElementById("sensitiveDataPanel");
    const workspace = document.getElementById("editorWorkspace");
    const observer = new ResizeObserver(() => {
      recenterActiveReviewDetection();
    });
    if (workspace) observer.observe(workspace);
    if (sidePanel) observer.observe(sidePanel);
    editorState.reviewViewportObserver = observer;
  }

  function pulseReviewFocus(id) {
    if (editorState.reviewPulseFrame) cancelAnimationFrame(editorState.reviewPulseFrame);
    const start = performance.now();
    const step = (now) => {
      if (editorState.reviewFocusId !== id) return;
      const progress = (now - start) / 700;
      editorState.reviewPulse = progress >= 1 ? 0 : Math.sin(progress * Math.PI * 2) * (1 - progress);
      paintOverlay(editorState.detections, editorState.isDrawing);
      if (progress < 1) {
        editorState.reviewPulseFrame = window.requestAnimationFrame(step);
      }
    };
    editorState.reviewPulseFrame = window.requestAnimationFrame(step);
  }

  function reviewEffectType() {
    if (["blackout", "blur", "pixelate"].includes(editorState.redactionStyle)) {
      return editorState.redactionStyle;
    }
    if (editorState.activeTool === "blur" || editorState.activeTool === "pixelate") {
      return editorState.activeTool;
    }
    return "blackout";
  }

  function syncRedactionStyleButtons() {
    document.querySelectorAll("[data-redaction-style]").forEach((button) => {
      const selected = button.dataset.redactionStyle === editorState.redactionStyle;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-checked", String(selected));
    });
  }

  function applyReviewEffect(redaction, type) {
    if (type === "blur") {
      redaction.type = "blur";
      redaction.blurRadius = editorState.blurRadius;
      delete redaction.color;
      delete redaction.pixelSize;
      return;
    }
    if (type === "pixelate") {
      redaction.type = "pixelate";
      redaction.pixelSize = editorState.pixelSize;
      delete redaction.color;
      delete redaction.blurRadius;
      return;
    }
    redaction.type = "blackout";
    redaction.color = "#000000";
    delete redaction.blurRadius;
    delete redaction.pixelSize;
  }

  function setRedactionStyle(style) {
    const next = ["blackout", "blur", "pixelate"].includes(style) ? style : "blackout";
    editorState.redactionStyle = next;
    syncRedactionStyleButtons();
    let restyled = false;
    editorState.redactions.forEach((redaction) => {
      if (redaction.source !== "automatic-detection" || redaction.type === next) return;
      applyReviewEffect(redaction, next);
      restyled = true;
    });
    if (restyled) saveHistory();
    if (editorState.activeTool !== next) {
      activateEditorTool(next);
      return;
    }
    renderCanvas();
  }

  function redactReviewedDetection(id) {
    const detection = editorState.detections.find((item) => item.id === id);
    const redaction = detection ? redactionFromDetection(detection) : null;
    if (!detection || !redaction) return;
    applyReviewEffect(redaction, reviewEffectType());
    const removedIndex = editorState.detections.findIndex((item) => item.id === id);
    const countBefore = editorState.detections.length;
    editorState.redactions.push(redaction);
    editorState.detections = editorState.detections.filter((item) => item.id !== id);
    saveHistory();
    renderCanvas();
    updateRegionStatus();
    showStatus("Area redacted.");
    focusReviewDetection(focusIndexAfterRemoval(removedIndex, countBefore));
  }

  function keepReviewedDetection(id) {
    const removedIndex = editorState.detections.findIndex((item) => item.id === id);
    if (removedIndex < 0) return;
    const countBefore = editorState.detections.length;
    editorState.detections = editorState.detections.filter((item) => item.id !== id);
    saveHistory();
    renderCanvas();
    showStatus("Left visible. The image was not changed.");
    focusReviewDetection(focusIndexAfterRemoval(removedIndex, countBefore));
  }

  function dismissReviewedDetection(id) {
    const removedIndex = editorState.detections.findIndex((item) => item.id === id);
    if (removedIndex < 0) return;
    const countBefore = editorState.detections.length;
    editorState.detections = editorState.detections.filter((item) => item.id !== id);
    saveHistory();
    renderCanvas();
    showStatus("Suggestion dismissed without changing the image.");
    focusReviewDetection(focusIndexAfterRemoval(removedIndex, countBefore));
  }

  let customRuleEditingId = "";

  function openCustomRulesDialog() {
    const dialog = ensureCustomRulesDialog();
    customRuleEditingId = "";
    renderCustomRulesEditor(true);
    dialog.hidden = false;
    dialog.querySelector("#customRuleName")?.focus();
  }

  function closeCustomRulesDialog() {
    const dialog = document.getElementById("customRulesDialog");
    if (dialog) dialog.hidden = true;
  }

  function ensureCustomRulesDialog() {
    let dialog = document.getElementById("customRulesDialog");
    if (dialog) return dialog;
    dialog = document.createElement("div");
    dialog.id = "customRulesDialog";
    dialog.className = "review-export-dialog custom-rules-dialog";
    dialog.hidden = true;
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "customRulesTitle");
    dialog.innerHTML = `
      <div class="custom-rules-card">
        <div class="custom-rules-header">
          <h2 id="customRulesTitle">Custom Rules</h2>
          <button id="closeCustomRulesButton" class="review-nav-button" type="button">Close</button>
        </div>
        <p class="custom-rules-note">Built-in checks such as IBAN stay active. Rules you add here are saved on this device.</p>
        <ul id="customRulesList" class="custom-rules-list"></ul>
        <form id="customRuleForm" class="custom-rule-form">
          <label>Name <input id="customRuleName" name="name" type="text" maxlength="80" required></label>
          <label>Type
            <select id="customRuleType" name="type">
              <option value="keyword">Keyword</option>
              <option value="regex">Regex</option>
            </select>
          </label>
          <label>Pattern <input id="customRulePattern" name="pattern" type="text" maxlength="180" required></label>
          <label>Sample text <textarea id="customRuleSample" rows="3"></textarea></label>
          <p id="customRuleTestResult" class="custom-rule-test-result" role="status"></p>
          <div class="custom-rule-form-actions">
            <button id="testCustomRuleButton" class="review-nav-button" type="button">Test pattern</button>
            <button id="cancelCustomRuleEditButton" class="review-nav-button" type="button" hidden>Cancel edit</button>
            <button id="saveCustomRuleButton" class="review-action review-action-redact" type="submit">Add rule</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeCustomRulesDialog();
    });
    dialog.querySelector("#closeCustomRulesButton")?.addEventListener("click", closeCustomRulesDialog);
    dialog.querySelector("#customRuleForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      submitCustomRuleForm();
    });
    dialog.querySelector("#testCustomRuleButton")?.addEventListener("click", showCustomRuleTest);
    dialog.querySelector("#cancelCustomRuleEditButton")?.addEventListener("click", () => {
      customRuleEditingId = "";
      renderCustomRulesEditor(true);
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeCustomRulesDialog();
      }
    });
    return dialog;
  }

  function renderCustomRulesEditor(resetForm) {
    const list = document.getElementById("customRulesList");
    const rules = readUserCustomRules(localStorage);
    if (list) {
      list.innerHTML = rules.length
        ? rules.map((rule) => `
          <li class="custom-rule-row">
            <div class="custom-rule-copy">
              <strong>${escapeHtml(rule.name)}</strong>
              <span>${rule.type === "keyword" ? "Keyword" : "Regex"}</span>
              <code>${escapeHtml(rule.pattern)}</code>
            </div>
            <label class="custom-rule-switch">
              <input data-rule-toggle="${escapeHtml(rule.id)}" type="checkbox" ${rule.enabled ? "checked" : ""}>
              <span>${rule.enabled ? "On" : "Off"}</span>
            </label>
            <button data-rule-edit="${escapeHtml(rule.id)}" class="review-nav-button" type="button">Edit</button>
            <button data-rule-delete="${escapeHtml(rule.id)}" class="review-nav-button" type="button">Delete</button>
          </li>
        `).join("")
        : `<li class="custom-rules-empty">No custom rules yet.</li>`;
      list.querySelectorAll("[data-rule-toggle]").forEach((input) => {
        input.addEventListener("change", () => {
          setUserCustomRuleEnabled(input.dataset.ruleToggle, input.checked, localStorage);
          renderCustomRulesEditor(false);
          showStatus("Custom rule updated. Click Scan sensitive data to apply it.");
        });
      });
      list.querySelectorAll("[data-rule-edit]").forEach((button) => {
        button.addEventListener("click", () => beginCustomRuleEdit(button.dataset.ruleEdit));
      });
      list.querySelectorAll("[data-rule-delete]").forEach((button) => {
        button.addEventListener("click", () => {
          deleteUserCustomRule(button.dataset.ruleDelete, localStorage);
          const clearedEditor = customRuleEditingId === button.dataset.ruleDelete;
          if (clearedEditor) customRuleEditingId = "";
          renderCustomRulesEditor(clearedEditor);
          showStatus("Custom rule deleted. Click Scan sensitive data to apply the change.");
        });
      });
    }
    const saveButton = document.getElementById("saveCustomRuleButton");
    const cancelButton = document.getElementById("cancelCustomRuleEditButton");
    if (saveButton) saveButton.textContent = customRuleEditingId ? "Save rule" : "Add rule";
    if (cancelButton) cancelButton.hidden = !customRuleEditingId;
    if (resetForm) {
      document.getElementById("customRuleForm")?.reset();
      const message = document.getElementById("customRuleTestResult");
      if (message) message.textContent = "";
    }
  }

  function beginCustomRuleEdit(id) {
    const rule = readUserCustomRules(localStorage).find((item) => item.id === id);
    if (!rule) return;
    customRuleEditingId = rule.id;
    const name = document.getElementById("customRuleName");
    const type = document.getElementById("customRuleType");
    const pattern = document.getElementById("customRulePattern");
    if (name) name.value = rule.name;
    if (type) type.value = rule.type;
    if (pattern) pattern.value = rule.pattern;
    renderCustomRulesEditor(false);
    name?.focus();
  }

  function customRuleFormValues() {
    return {
      id: customRuleEditingId || undefined,
      name: document.getElementById("customRuleName")?.value,
      type: document.getElementById("customRuleType")?.value,
      pattern: document.getElementById("customRulePattern")?.value,
    };
  }

  function showCustomRuleTest() {
    const values = customRuleFormValues();
    const sample = document.getElementById("customRuleSample")?.value || "";
    const result = testCustomPattern(values.pattern, sample, values.type);
    const message = document.getElementById("customRuleTestResult");
    if (!message) return;
    if (!result.ok) {
      message.textContent = result.error;
      return;
    }
    message.textContent = result.matches.length
      ? `Matches: ${result.matches.slice(0, 8).join(", ")}`
      : "No match in the sample text.";
  }

  function submitCustomRuleForm() {
    const values = customRuleFormValues();
    const existing = customRuleEditingId
      ? readUserCustomRules(localStorage).find((rule) => rule.id === customRuleEditingId)
      : null;
    const result = saveUserCustomRule({
      ...values,
      enabled: existing ? existing.enabled : true,
    }, localStorage);
    const message = document.getElementById("customRuleTestResult");
    if (!result.ok) {
      if (message) message.textContent = "Enter a name and a pattern that can be compiled.";
      return;
    }
    customRuleEditingId = "";
    renderCustomRulesEditor(true);
    showStatus("Custom rule saved. Click Scan sensitive data to apply it.");
  }

  function renderSensitiveDataPanel() {
    if (!sensitiveDataPanel) return;
    if (!editorState.image) {
      sensitiveDataPanel.innerHTML = `
        <div class="real-detection-panel-header">
          <h2 class="real-detection-panel-heading" data-i18n="editor.sensitive">Sensitive Data</h2>
          <button id="customRulesButton" class="custom-rules-button" type="button" data-i18n="editor.customRules">Custom Rules</button>
        </div>
        <div class="real-detection-awaiting">
          <span class="material-symbols-outlined" aria-hidden="true">photo_library</span>
          <p data-i18n="editor.loadShot">Load a screenshot. Analysis results will appear here.</p>
        </div>
      `;
      applyI18n(sensitiveDataPanel);
      document.getElementById("customRulesButton")?.addEventListener("click", openCustomRulesDialog);
      return;
    }
    const detections = editorState.detections;
    if (!detections.length && editorState.reviewFinished) {
      sensitiveDataPanel.innerHTML = `
        <div class="review-complete-card">
          <span class="material-symbols-outlined" aria-hidden="true">verified</span>
          <h2 data-i18n="editor.readyTitle">${escapeHtml(REVIEW_COMPLETE_TITLE)}</h2>
          <p data-i18n="editor.readyBody">Every pending suggestion has been resolved. The image is ready to export.</p>
          <button id="reviewExportButton" class="review-action review-action-redact" type="button" data-i18n="editor.download">Download</button>
          <button id="customRulesButton" class="custom-rules-button" type="button" data-i18n="editor.customRules">Custom Rules</button>
        </div>
      `;
      applyI18n(sensitiveDataPanel);
      document.getElementById("reviewExportButton")?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openExportFromReview(event.currentTarget);
      });
      document.getElementById("customRulesButton")?.addEventListener("click", openCustomRulesDialog);
      return;
    }
    const reviewIndex = detections.length
      ? Math.min(Math.max(editorState.reviewIndex, 0), detections.length - 1)
      : -1;
    const summaryText = detections.length
      ? t(detections.length === 1 ? "editor.reviewSummaryOne" : "editor.reviewSummary", { n: detections.length })
      : t("editor.suggest");
    const countText = detections.length
      ? t("editor.reviewPosition", { current: reviewIndex + 1, total: detections.length })
      : getDetectionSummary(0);
    sensitiveDataPanel.innerHTML = `
      <div class="real-detection-panel-header">
        <div class="real-detection-panel-title">
          <span class="material-symbols-outlined real-detection-shield" aria-hidden="true">security</span>
          <h2 class="real-detection-panel-heading" data-i18n="${detections.length ? "editor.privacyReview" : "editor.sensitive"}">${detections.length ? "Privacy Review" : "Sensitive Data"}</h2>
          <button id="reviewPanelCollapseButton" class="review-panel-collapse" type="button" aria-expanded="true" data-i18n-aria="editor.collapsePanel" data-i18n-title="editor.collapsePanel">
            <span class="material-symbols-outlined" aria-hidden="true">expand_more</span>
          </button>
        </div>
        <div class="real-detection-panel-meta">
          <span class="real-detection-count">${escapeHtml(countText)}</span>
          <button id="customRulesButton" class="custom-rules-button" type="button" data-i18n="editor.customRules">Custom Rules</button>
          <button id="hideAllDetectionsButton" class="real-hide-all-button" type="button" data-i18n="editor.hideAll" ${detections.length ? "" : "disabled"}>Hide all</button>
        </div>
      </div>
      <div class="real-detection-notice">
        <span class="material-symbols-outlined" aria-hidden="true">info</span>
        <p>${escapeHtml(summaryText)}</p>
      </div>
      <div class="real-detection-list">${detections.length ? createReviewStepMarkup(detections[reviewIndex], reviewIndex, detections.length) : createDetectionListMarkup(detections)}</div>
      <div class="real-detection-panel-footer">
        <span class="material-symbols-outlined" aria-hidden="true">lock</span>
        <span data-i18n="editor.localAnalysis">Analysis runs locally in this browser</span>
      </div>
    `;
    applyI18n(sensitiveDataPanel);

    document.getElementById("reviewPanelCollapseButton")?.addEventListener("click", () => {
      const collapsed = sensitiveDataPanel.classList.toggle("is-collapsed");
      const button = document.getElementById("reviewPanelCollapseButton");
      button?.setAttribute("aria-expanded", collapsed ? "false" : "true");
      const icon = button?.querySelector(".material-symbols-outlined");
      if (icon) icon.textContent = collapsed ? "expand_less" : "expand_more";
    });
    document.getElementById("reviewPreviousButton")?.addEventListener("click", () => {
      focusReviewDetection(stepReviewIndex(editorState.reviewIndex, editorState.detections.length, -1));
    });
    document.getElementById("reviewNextButton")?.addEventListener("click", () => {
      focusReviewDetection(stepReviewIndex(editorState.reviewIndex, editorState.detections.length, 1));
    });
    sensitiveDataPanel.querySelectorAll("[data-redaction-style]").forEach((button) => {
      button.addEventListener("click", () => setRedactionStyle(button.dataset.redactionStyle));
    });
    document.getElementById("reviewRedactButton")?.addEventListener("click", () => {
      redactReviewedDetection(editorState.reviewFocusId);
    });
    document.getElementById("reviewDismissButton")?.addEventListener("click", () => {
      dismissReviewedDetection(editorState.reviewFocusId);
    });
    document.getElementById("reviewKeepButton")?.addEventListener("click", () => {
      keepReviewedDetection(editorState.reviewFocusId);
    });
    document.getElementById("customRulesButton")?.addEventListener("click", openCustomRulesDialog);
    document.getElementById("hideAllDetectionsButton")?.addEventListener("click", applyAllDetectionsAsBlackout);
    const detectionList =
      sensitiveDataPanel.querySelector(
        ".real-detection-list"
      );

    if (detectionList) {
      window.requestAnimationFrame(() => {
        detectionList.scrollTop = 0;
      });
    }
  }

  function createReviewStepMarkup(detection, index, count) {
    if (!detection) return createDetectionListMarkup([]);
    const view = getDetectionPresentation(detection.type);
    const title = detection.type === "custom_rule" && detection.label ? detection.label : view.title;
    const confidence = Math.round(Number(detection.review?.ocrConfidence ?? detection.confidence ?? 0));
    const warnings = detectionWarnings(detection);
    const navigationDisabled = count < 2 ? "disabled" : "";
    return `
      <div class="review-step">
        <div class="review-nav">
          <button id="reviewPreviousButton" class="review-nav-button" type="button" ${navigationDisabled} data-i18n="editor.reviewPrevious">Previous</button>
          <span class="review-position">${escapeHtml(t("editor.reviewPosition", { current: index + 1, total: count }))}</span>
          <button id="reviewNextButton" class="review-nav-button" type="button" ${navigationDisabled} data-i18n="editor.reviewNext">Next</button>
        </div>
        <article class="real-detection-card review-active-card">
          <div class="real-detection-card-heading">
            <strong>${escapeHtml(title)}</strong>
            <span class="real-confidence-badge" data-i18n-title="editor.ocrConfidenceHint" title="${escapeHtml(t("editor.ocrConfidenceHint"))}">${confidence}%</span>
          </div>
          <code class="real-detection-text">${escapeHtml(detection.text)}</code>
          ${warnings.map((warning) => `<p class="real-detection-warning">${escapeHtml(localizeReviewWarning(warning))}</p>`).join("")}
          <div class="review-style" role="radiogroup" data-i18n-aria="editor.redactionStyle" aria-label="${escapeHtml(t("editor.redactionStyle"))}">
            ${["blackout", "blur", "pixelate"].map((style) => `
              <button type="button" class="review-style-option${editorState.redactionStyle === style ? " is-selected" : ""}" data-redaction-style="${style}" role="radio" aria-checked="${editorState.redactionStyle === style ? "true" : "false"}" data-i18n="${style === "blackout" ? "label.blackout" : style === "blur" ? "editor.blur" : "editor.pixelate"}">${style === "blackout" ? "Blackout" : style === "blur" ? "Blur" : "Pixelate"}</button>
            `).join("")}
          </div>
          <div class="review-actions">
            <button id="reviewRedactButton" class="review-action review-action-redact" type="button" data-i18n="editor.reviewRedact">Redact</button>
            <button id="reviewDismissButton" class="review-action" type="button" data-i18n="editor.reviewDismiss">Dismiss</button>
            <button id="reviewKeepButton" class="review-action" type="button" data-i18n="editor.reviewKeep">Keep Visible</button>
          </div>
        </article>
      </div>
    `;
  }

  function localizeReviewWarning(warning) {
    const text = String(warning || "");
    if (/OCR confidence is low/i.test(text)) return t("editor.ocrConfidenceLow");
    if (/OCR may have misread/i.test(text)) return t("editor.ocrMayMisread");
    return text;
  }

  function getDetectionSummary(count) {
    if (count === 0 && editorState.reviewFinished) return "Review complete";
    if (count === 0) return "No pending suggestions";
    if (count === 1) return "1 potential item found";
    return `${count} potential items found`;
  }

  function getDetectionPresentation(type) {
    return {
      person_name: { title: "Possible name", icon: "person" },
      email: { title: "Possible email", icon: "alternate_email" },
      phone: { title: "Possible phone number", icon: "call" },
      tckn: { title: "Turkish ID Number", icon: "badge" },
      vkn: { title: "Tax ID Number", icon: "badge" },
      location: { title: "Possible location", icon: "location_on" },
      api_token: { title: "Possible API token", icon: "key" },
      ipv4: { title: "Possible IP address", icon: "lan" },
      ipv6: { title: "Possible IPv6 address", icon: "lan" },
      credit_card: { title: "Possible card number", icon: "credit_card" },
      session_id: { title: "Possible session ID", icon: "badge" },
      custom_rule: { title: "Custom rule", icon: "tune" },
    }[type] || { title: "Possible sensitive data", icon: "warning" };
  }

  function createDetectionListMarkup(detections) {
    if (!detections.length) {
      if (editorState.reviewFinished) {
        return `
          <div class="real-detection-empty-state">
            <span class="material-symbols-outlined" aria-hidden="true">verified</span>
            <strong>Review complete</strong>
            <p>No suggestions are waiting. Manually inspect the image before sharing.</p>
          </div>
        `;
      }
      return `
        <div class="real-detection-empty-state">
          <span class="material-symbols-outlined" aria-hidden="true">document_scanner</span>
          <strong>No pending suggestions</strong>
          <p>No suggestions are waiting for review. Manually inspect the image before sharing.</p>
        </div>
      `;
    }

    const categoryOrder = [
      "person_name",
      "email",
      "phone",
      "tckn",
      "vkn",
      "location",
      "api_token",
      "ipv4",
      "ipv6",
      "credit_card",
      "session_id",
    ];
    const groups = new Map();
    detections.forEach((detection) => {
      const type = detection.type === "custom_rule"
        ? `custom_rule:${detection.label}`
        : (detection.type || "other");
      if (!groups.has(type)) groups.set(type, []);
      groups.get(type).push(detection);
    });
    const types = [...groups.keys()].sort((first, second) => {
      const firstIndex = categoryOrder.indexOf(first);
      const secondIndex = categoryOrder.indexOf(second);
      return (firstIndex < 0 ? 99 : firstIndex) - (secondIndex < 0 ? 99 : secondIndex);
    });

    return types.map((type) => {
      const items = groups.get(type);
      const presentationType = type.startsWith("custom_rule") ? "custom_rule" : type;
      const view = getDetectionPresentation(presentationType);
      const groupTitle = presentationType === "custom_rule" ? items[0].label : view.title;
      const cards = items.map((detection, index) => {
        const confidence = Math.round(Number(detection.review?.ocrConfidence ?? detection.confidence ?? 0));
        const warnings = detectionWarnings(detection);
        return `
        <article class="real-detection-card" data-detection-id="${escapeHtml(detection.id)}">
          <div class="real-detection-card-heading">
            <code class="real-detection-text">${escapeHtml(detection.text)}</code>
            <span
              class="real-confidence-badge"
              title="OCR confidence. This percentage does not prove the value is valid."
            >${confidence}%</span>
          </div>
          ${warnings.map((warning) => `<p class="real-detection-warning">${escapeHtml(warning)}</p>`).join("")}
          <div class="real-detection-card-footer">
            <div class="real-detection-actions">
              <button class="real-detection-action real-detection-locate" type="button" data-locate-detection="${escapeHtml(detection.id)}" title="Locate on image" aria-label="Locate ${escapeHtml(view.title)} ${index + 1} on image"><span class="material-symbols-outlined" aria-hidden="true">center_focus_strong</span></button>
              <button class="real-detection-action real-detection-hide" type="button" data-hide-detection="${escapeHtml(detection.id)}" title="Hide this area" aria-label="Hide ${escapeHtml(view.title)} ${index + 1}"><span class="material-symbols-outlined" aria-hidden="true">visibility_off</span></button>
              <button class="real-detection-action real-detection-dismiss" type="button" data-dismiss-detection="${escapeHtml(detection.id)}" title="Dismiss suggestion" aria-label="Dismiss ${escapeHtml(view.title)} ${index + 1}"><span class="material-symbols-outlined" aria-hidden="true">close</span></button>
            </div>
          </div>
        </article>
      `;
      }).join("");

      return `
        <section class="real-detection-group" data-detection-type="${escapeHtml(type)}">
          <header class="real-detection-group-header">
            <span class="real-status-dot" aria-hidden="true"></span>
            <strong>${escapeHtml(groupTitle)}</strong>
            <span class="real-detection-group-count">${items.length}</span>
          </header>
          <div class="real-detection-group-list">${cards}</div>
        </section>
      `;
    }).join("");
  }

  function detectionWarnings(detection) {
    if (Array.isArray(detection?.review?.warnings)) {
      return detection.review.warnings.filter((warning) => typeof warning === "string" && warning.trim());
    }
    const confidence = Math.round(Number(detection?.confidence || 0));
    if ((detection?.type === "ipv4" || detection?.type === "ipv6") && confidence < 70) {
      return ["OCR may have misread a digit. Verify the highlighted image area manually."];
    }
    return [];
  }

  function hideSingleDetection(id) {
    const detection = editorState.detections.find((item) => item.id === id);
    if (!detection) return;
    const redaction = redactionFromDetection(detection);
    if (!redaction) return;
    applyReviewEffect(redaction, reviewEffectType());
    editorState.redactions.push(redaction);
    editorState.detections = editorState.detections.filter((item) => item.id !== id);
    saveHistory();
    renderCanvas();
    renderSensitiveDataPanel();
    updateRegionStatus();
    showStatus("Selected area hidden.");
  }

  function dismissSingleDetection(id) {
    editorState.detections = editorState.detections.filter((item) => item.id !== id);
    renderCanvas();
    renderSensitiveDataPanel();
    saveHistory();
    showStatus("Suggestion dismissed without changing the image.");
  }

  function applyAllDetections(type = "blackout", options = {}) {
    const selected = detectionsForAutomaticRedaction(editorState.detections, Boolean(options.includeReview));
    if (!selected.length) return;
    const newRedactions = selected.map((detection) => {
      const redaction = redactionFromDetection(detection);
      if (!redaction) return null;
      if (type === "blur") {
        redaction.type = "blur";
        redaction.blurRadius = editorState.blurRadius;
        delete redaction.color;
      }
      if (type === "pixelate") {
        redaction.type = "pixelate";
        redaction.pixelSize = editorState.pixelSize;
        delete redaction.color;
      }
      return redaction;
    }).filter(Boolean);
    editorState.redactions.push(...newRedactions);
    const applied = new Set(selected);
    editorState.detections = editorState.detections.filter((detection) => !applied.has(detection));
    editorState.reviewFinished = editorState.detections.length === 0;
    if (editorState.reviewFinished) stopReviewSession();
    saveHistory();
    renderCanvas();
    renderSensitiveDataPanel();
    updateRegionStatus();
    showStatus(`${newRedactions.length} detected ${newRedactions.length === 1 ? "area" : "areas"} hidden.`);
  }

  function applyAllDetectionsAsBlackout() {
    const count = editorState.detections.length;
    if (!count) return;
    const uncertain = editorState.detections.filter((detection) => detectionWarnings(detection).length).length;
    const itemLabel = count === 1 ? "suggestion" : "suggestions";
    const uncertainLine = uncertain
      ? `\n\n${uncertain} ${uncertain === 1 ? "has a validation warning" : "have validation warnings"} and still need a manual check.`
      : "";
    const styleLabel = reviewEffectType() === "blur" ? "blur" : reviewEffectType() === "pixelate" ? "pixelate" : "blackout";
    const confirmed = window.confirm(
      `Hide all ${count} ${itemLabel} with ${styleLabel}?${uncertainLine}\n\nEvery highlighted area will be covered. You can undo this.`
    );
    if (!confirmed) return;
    applyAllDetections(reviewEffectType(), { includeReview: true });
  }

  function redactionFromDetection(detection) {
    const rect = detectionRenderRect(detection);
    if (!rect) return null;
    return {
      id: createId("redaction"),
      type: "blackout",
      source: "automatic-detection",
      detectionType: detection.type,
      originalText: detection.text,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      color: "#000000",
    };
  }

  function flashDetection(id) {
    const detection = editorState.detections.find((item) => item.id === id);
    if (!detection) return;
    detection.isFlashing = true;
    renderCanvas();
    window.setTimeout(() => {
      detection.isFlashing = false;
      renderCanvas();
    }, 900);
  }

  function initializeToolIntensityControls() {
    const slider = document.getElementById("toolIntensitySlider");
    if (!slider || slider.dataset.bound === "true") {
      syncToolIntensityBar();
      return;
    }
    slider.dataset.bound = "true";
    slider.addEventListener("input", () => {
      applyHeaderToolIntensity(slider.value, false);
    });
    slider.addEventListener("change", () => {
      applyHeaderToolIntensity(slider.value, true);
    });
    document.querySelectorAll("[data-tool]").forEach((button) => {
      button.addEventListener("click", () => {
        activateEditorTool(button.dataset.tool);
      });
    });
    syncToolIntensityBar();
  }

  function syncToolIntensityBar() {
    const bar = document.getElementById("toolIntensityBar");
    const slider = document.getElementById("toolIntensitySlider");
    const label = document.getElementById("toolIntensityLabel");
    const output = document.getElementById("toolIntensityValue");
    if (!bar || !slider || !label || !output) return;

    const tool = editorState.activeTool;
    const visible = tool === "blur" || tool === "pixelate";
    bar.hidden = !visible;
    if (!visible) return;

    const selected = getSelectedRedaction();
    const isBlur = tool === "blur";
    const minimum = isBlur ? 1 : 2;
    const maximum = isBlur ? 50 : 40;
    const stored = isBlur ? editorState.blurRadius : editorState.pixelSize;
    const selectedValue = selected && selected.type === tool
      ? Number(isBlur ? selected.blurRadius : selected.pixelSize)
      : stored;
    const value = clamp(selectedValue || stored, minimum, maximum);

    if (isBlur) editorState.blurRadius = value;
    else editorState.pixelSize = value;

    slider.min = String(minimum);
    slider.max = String(maximum);
    slider.step = "1";
    slider.value = String(value);
    slider.setAttribute("aria-label", t(isBlur ? "editor.blurRadius" : "editor.pixelSize"));
    label.setAttribute("data-i18n", isBlur ? "editor.blur" : "editor.pixel");
    label.textContent = t(isBlur ? "editor.blur" : "editor.pixel");
    output.textContent = `${Math.round(value)}px`;
  }

  function applyHeaderToolIntensity(rawValue, shouldCommit) {
    const tool = editorState.activeTool;
    if (tool !== "blur" && tool !== "pixelate") return;

    const isBlur = tool === "blur";
    const nextValue = clamp(Number(rawValue), isBlur ? 1 : 2, isBlur ? 50 : 40);
    if (isBlur) editorState.blurRadius = nextValue;
    else editorState.pixelSize = nextValue;

    const output = document.getElementById("toolIntensityValue");
    if (output) output.textContent = `${Math.round(nextValue)}px`;

    const selected = getSelectedRedaction();
    if (!selected || selected.type !== tool) return;

    if (!editorState.isAdjustingRegionStrength) {
      editorState.isAdjustingRegionStrength = true;
      editorState.regionStrengthOriginalValue = Number(
        isBlur ? selected.blurRadius : selected.pixelSize
      );
    }

    if (isBlur) selected.blurRadius = nextValue;
    else selected.pixelSize = nextValue;

    const inspectorSlider = document.getElementById("selectedRegionStrength");
    const inspectorOutput = document.getElementById("selectedRegionStrengthValue");
    if (inspectorSlider) inspectorSlider.value = String(nextValue);
    if (inspectorOutput) {
      inspectorOutput.textContent = isBlur
        ? `${Math.round(nextValue)}`
        : `${Math.round(nextValue)} px`;
    }

    renderCanvas();
    if (shouldCommit) commitSelectedRedactionStrength();
  }

  function initializeHeaderButtons() {
    const header = document.querySelector("body > header");
    if (!header) return;
    const buttons = Array.from(header.querySelectorAll("button"));
    const byTextOrIcon = (text, icon) => buttons.find((button) => {
      const buttonText = button.textContent.replace(/\s+/g, " ").trim().toLowerCase();
      const iconText = button.querySelector(".material-symbols-outlined")?.textContent.trim().toLowerCase();
      return buttonText === text || iconText === icon;
    });

    const copyButton = byTextOrIcon("copy image", "content_copy");
    const downloadButton = byTextOrIcon("download", "download");

    copyButton?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await copyCleanImageToClipboard(copyButton);
    });
    if (downloadButton) {
      downloadButton.id = "editorDownloadButton";
      downloadButton.setAttribute("aria-expanded", "false");
      downloadButton.setAttribute("aria-haspopup", "dialog");
      downloadButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleExportMenu(downloadButton);
      });
    }

    ensureExportMenu();
  }

  function ensureExportMenu() {
    if (document.getElementById("exportMenu")) return;
    const menu = document.createElement("div");
    menu.id = "exportMenu";
    menu.className = "export-menu";
    menu.hidden = true;
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", "Export image");
    menu.innerHTML = `
      <p class="export-menu-title" data-i18n="editor.export">Export</p>
      <div class="export-format-row" role="radiogroup" aria-label="Export format">
        <button type="button" class="export-format-option is-selected" data-export-format="png" role="radio" aria-checked="true">PNG</button>
        <button type="button" class="export-format-option" data-export-format="webp" role="radio" aria-checked="false">WebP</button>
        <button type="button" class="export-format-option" data-export-format="jpeg" role="radio" aria-checked="false">JPEG</button>
      </div>
      <label class="export-quality" id="exportQualityField" hidden>
        <span><span data-i18n="editor.quality">Quality</span> <output id="exportQualityValue">92%</output></span>
        <input id="exportQualitySlider" type="range" min="0.60" max="1" step="0.01" value="0.92" aria-label="Export quality">
      </label>
      <p class="export-lossless-note" id="exportLosslessNote" data-i18n="editor.lossless">Lossless PNG</p>
      <button id="exportConfirmButton" class="export-confirm" type="button" data-i18n="editor.exportImage">Export image</button>
    `;
    document.body.appendChild(menu);
    applyI18n(menu);

    menu.addEventListener("click", (event) => event.stopPropagation());
    menu.querySelectorAll("[data-export-format]").forEach((button) => {
      button.addEventListener("click", () => selectExportFormat(button.dataset.exportFormat));
    });
    menu.querySelector("#exportQualitySlider")?.addEventListener("input", (event) => {
      editorState.exportQuality = clamp(Number(event.target.value), 0.6, 1);
      const output = document.getElementById("exportQualityValue");
      if (output) output.textContent = `${Math.round(editorState.exportQuality * 100)}%`;
    });
    menu.querySelector("#exportConfirmButton")?.addEventListener("click", async () => {
      menu.hidden = true;
      delete menu.dataset.anchor;
      document.getElementById("editorDownloadButton")?.setAttribute("aria-expanded", "false");
      await downloadCleanImage();
    });
  }

  function toggleExportMenu(anchor) {
    const menu = document.getElementById("exportMenu");
    if (!menu || !anchor) return;
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    anchor.setAttribute("aria-expanded", String(willOpen));
    document.getElementById("editorDownloadButton")?.setAttribute("aria-expanded", String(willOpen));
    if (willOpen) positionAnchoredPanel(menu, anchor);
  }

  /** Review-complete "İndir" must not synthesize a header click (document click closes the menu). */
  function openExportFromReview(anchor) {
    ensureExportMenu();
    const menu = document.getElementById("exportMenu");
    const headerDownload = document.getElementById("editorDownloadButton");
    if (!menu) {
      downloadCleanImage();
      return;
    }
    menu.hidden = false;
    menu.dataset.anchor = "review";
    headerDownload?.setAttribute("aria-expanded", "true");
    positionAnchoredPanel(menu, anchor || headerDownload || document.body);
  }

  function selectExportFormat(format) {
    const nextFormat = ["png", "webp", "jpeg"].includes(format) ? format : "png";
    editorState.exportFormat = nextFormat;
    document.querySelectorAll("[data-export-format]").forEach((button) => {
      const selected = button.dataset.exportFormat === nextFormat;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-checked", String(selected));
    });
    const lossy = nextFormat !== "png";
    const qualityField = document.getElementById("exportQualityField");
    const losslessNote = document.getElementById("exportLosslessNote");
    if (qualityField) qualityField.hidden = !lossy;
    if (losslessNote) losslessNote.hidden = lossy;
  }

  function initializeZoomControls() {
    const header = document.querySelector(
      "body > header"
    );

    if (!header) {
      return;
    }

    const buttons = Array.from(
      header.querySelectorAll("button")
    );

    const zoomOutButton =
      findHeaderButtonByIcon(
        buttons,
        ["remove", "zoom_out"]
      );

    const zoomInButton =
      findHeaderButtonByIcon(
        buttons,
        ["add", "zoom_in"]
      );

    const fitButton =
      findHeaderButtonByIcon(
        buttons,
        [
          "fit_screen",
          "fullscreen",
          "center_focus_weak",
        ]
      );

    const resetButton =
      findHeaderButtonByIcon(
        buttons,
        [
          "restart_alt",
          "refresh",
          "sync",
        ]
      );

    if (zoomOutButton) {
      zoomOutButton.id =
        "editorZoomOutButton";

      zoomOutButton.setAttribute("data-i18n-title", "editor.zoomOut");
      zoomOutButton.setAttribute("data-i18n-aria", "editor.zoomOut");
      zoomOutButton.setAttribute("title", t("editor.zoomOut"));
      zoomOutButton.setAttribute("aria-label", t("editor.zoomOut"));

      zoomOutButton.addEventListener(
        "click",
        (event) => {
          event.preventDefault();

          changeCanvasZoom(-0.1);
        }
      );
    }

    if (zoomInButton) {
      zoomInButton.id =
        "editorZoomInButton";

      zoomInButton.setAttribute("data-i18n-title", "editor.zoomIn");
      zoomInButton.setAttribute("data-i18n-aria", "editor.zoomIn");
      zoomInButton.setAttribute("title", t("editor.zoomIn"));
      zoomInButton.setAttribute("aria-label", t("editor.zoomIn"));

      zoomInButton.addEventListener(
        "click",
        (event) => {
          event.preventDefault();

          changeCanvasZoom(0.1);
        }
      );
    }

    if (fitButton) {
      fitButton.id =
        "editorFitZoomButton";

      fitButton.setAttribute("data-i18n-title", "editor.fit");
      fitButton.setAttribute("data-i18n-aria", "editor.fit");
      fitButton.setAttribute("title", t("editor.fit"));
      fitButton.setAttribute("aria-label", t("editor.fit"));

      fitButton.addEventListener(
        "click",
        (event) => {
          event.preventDefault();

          fitCanvasToViewport();
        }
      );
    }

    if (resetButton) {
      resetButton.id =
        "editorResetZoomButton";

      resetButton.setAttribute("data-i18n-title", "editor.resetZoom");
      resetButton.setAttribute("data-i18n-aria", "editor.resetZoom");
      resetButton.setAttribute("title", t("editor.resetZoom"));
      resetButton.setAttribute("aria-label", t("editor.resetZoom"));

      resetButton.addEventListener(
        "click",
        (event) => {
          event.preventDefault();

          setCanvasZoom(1, {
            mode: "manual",
            centerViewport: true,
          });
        }
      );
    }

    document.addEventListener(
      "wheel",
      handleZoomWheel,
      {
        passive: false,
      }
    );

    window.addEventListener(
      "resize",
      handleZoomWindowResize
    );
  }

  function findHeaderButtonByIcon(
    buttons,
    iconNames
  ) {
    if (!Array.isArray(buttons)) {
      return null;
    }

    return (
      buttons.find((button) => {
        const iconText = button
          .querySelector(
            ".material-symbols-outlined"
          )
          ?.textContent
          .trim()
          .toLowerCase();

        return iconNames.includes(
          iconText
        );
      }) || null
    );
  }

  function setCanvasZoom(
    nextZoom,
    options = {}
  ) {
    const canvas = editorState.canvas;

    if (!canvas) {
      return;
    }

    const safeZoom = clamp(
      Number(nextZoom || 1),
      editorState.minimumZoom,
      editorState.maximumZoom
    );

    editorState.zoom = safeZoom;

    editorState.zoomMode =
      options.mode || "manual";

    if (options.mode !== "fit" && !editorState.reviewActive) {
      const frame = document.querySelector(".editor-canvas-frame");
      if (frame) frame.style.transform = "";
    }

    canvas.style.width =
      `${Math.round(
        canvas.width * safeZoom
      )}px`;

    canvas.style.height =
      `${Math.round(
        canvas.height * safeZoom
      )}px`;

    canvas.style.maxWidth = "none";
    canvas.style.maxHeight = "none";

    updateZoomDisplay();
    updateZoomButtonStates();

    if (options.centerViewport) {
      centerCanvasViewport();
    }
  }

  function changeCanvasZoom(delta) {
    const currentZoom = Number(
      editorState.zoom || 1
    );

    const nextZoom =
      Math.round(
        (currentZoom + delta) * 100
      ) / 100;

    setCanvasZoom(nextZoom, {
      mode: "manual",
      centerViewport: true,
    });
  }

  function fitCanvasToViewport() {
    const canvas = editorState.canvas;
    const canvasContainer = document.querySelector(".editor-canvas-viewport");
    const frame = document.querySelector(".editor-canvas-frame");
    const sidePanel = document.getElementById("sensitiveDataPanel");

    if (!canvas || !canvasContainer || !frame) {
      return;
    }

    const sidePanelWidth = reviewCoveredPanelWidth(canvasContainer, sidePanel);
    const visibleWidth = Math.max(1, canvasContainer.clientWidth - sidePanelWidth);
    const visibleHeight = Math.max(1, canvasContainer.clientHeight);
    const scaleX = visibleWidth / Math.max(canvas.width, 1);
    const scaleY = visibleHeight / Math.max(canvas.height, 1);
    const newZoom = Math.min(scaleX, scaleY) * 0.95;

    frame.style.transform = "none";
    canvasContainer.scrollLeft = 0;
    canvasContainer.scrollTop = 0;
    setCanvasZoom(newZoom, {
      mode: "fit",
      centerViewport: false,
    });
    canvasContainer.scrollLeft = 0;
    canvasContainer.scrollTop = 0;
    frame.style.transform = "none";

    const displayWidth = canvas.getBoundingClientRect().width;
    const displayHeight = canvas.getBoundingClientRect().height;
    const targetOffsetX = (visibleWidth - displayWidth) / 2;
    const targetOffsetY = (visibleHeight - displayHeight) / 2;
    const frameRect = frame.getBoundingClientRect();
    const containerRect = canvasContainer.getBoundingClientRect();
    editorState.panX = targetOffsetX;
    editorState.panY = targetOffsetY;
    frame.style.transform = `translate(${targetOffsetX - (frameRect.left - containerRect.left)}px, ${targetOffsetY - (frameRect.top - containerRect.top)}px)`;
  }
  function centerCanvasViewport() {
    const viewport = document.querySelector(
      ".editor-canvas-viewport"
    );

    const wrapper = document.querySelector(
      ".editor-canvas-wrapper"
    );

    if (!viewport || !wrapper) {
      return;
    }

    window.requestAnimationFrame(() => {
      const maximumScrollLeft =
        Math.max(
          0,
          wrapper.scrollWidth -
          viewport.clientWidth
        );

      const maximumScrollTop =
        Math.max(
          0,
          wrapper.scrollHeight -
          viewport.clientHeight
        );

      viewport.scrollLeft =
        maximumScrollLeft / 2;

      viewport.scrollTop =
        maximumScrollTop / 2;
    });
  }

  function updateZoomDisplay() {
    const percentage =
      Math.round(
        Number(editorState.zoom || 1) *
        100
      );

    const header = document.querySelector(
      "body > header"
    );

    if (!header) {
      return;
    }

    let zoomLabel =
      document.getElementById(
        "editorZoomPercentage"
      );

    if (!zoomLabel) {
      zoomLabel = Array.from(
        header.querySelectorAll(
          "span, button"
        )
      ).find((element) => {
        return /^\d+%$/.test(
          element.textContent.trim()
        );
      });

      if (zoomLabel) {
        zoomLabel.id =
          "editorZoomPercentage";
      }
    }

    if (zoomLabel) {
      zoomLabel.textContent =
        `${percentage}%`;

      zoomLabel.setAttribute(
        "title",
        editorState.zoomMode === "fit"
          ? "Image fitted to screen"
          : "Current zoom"
      );
    }
  }

  function updateZoomButtonStates() {
    const zoomOutButton =
      document.getElementById(
        "editorZoomOutButton"
      );

    const zoomInButton =
      document.getElementById(
        "editorZoomInButton"
      );

    const currentZoom = Number(
      editorState.zoom || 1
    );

    if (zoomOutButton) {
      zoomOutButton.disabled =
        currentZoom <=
        editorState.minimumZoom + 0.001;
    }

    if (zoomInButton) {
      zoomInButton.disabled =
        currentZoom >=
        editorState.maximumZoom - 0.001;
    }
  }

  function handleZoomWheel(event) {
    if (
      !event.ctrlKey &&
      !event.metaKey
    ) {
      return;
    }

    const viewport = event.target.closest?.(
      ".editor-canvas-viewport"
    );

    if (!viewport || !editorState.canvas) {
      return;
    }

    event.preventDefault();

    const zoomDirection =
      event.deltaY < 0
        ? 0.1
        : -0.1;

    zoomCanvasAroundPointer(
      zoomDirection,
      event,
      viewport
    );
  }

  function zoomCanvasAroundPointer(
    delta,
    event,
    viewport
  ) {
    const canvas = editorState.canvas;

    if (!canvas) {
      return;
    }

    const previousZoom = Number(
      editorState.zoom || 1
    );

    const nextZoom = clamp(
      Math.round(
        (previousZoom + delta) *
        100
      ) / 100,
      editorState.minimumZoom,
      editorState.maximumZoom
    );

    if (
      Math.abs(
        nextZoom - previousZoom
      ) < 0.001
    ) {
      return;
    }

    zoomAroundClientPoint(nextZoom, event.clientX, event.clientY);
  }

  function zoomAroundClientPoint(nextZoom, clientX, clientY) {
    const canvas = editorState.canvas;
    const viewport = document.querySelector(".editor-canvas-viewport");
    if (!canvas || !viewport) return;

    const safeZoom = clamp(
      Number(nextZoom || 1),
      editorState.minimumZoom,
      editorState.maximumZoom
    );
    if (Math.abs(safeZoom - Number(editorState.zoom || 1)) < 0.001) return;

    const viewportRect = viewport.getBoundingClientRect();
    const pointerX = clientX - viewportRect.left + viewport.scrollLeft;
    const pointerY = clientY - viewportRect.top + viewport.scrollTop;
    const relativeX = pointerX / Math.max(viewport.scrollWidth, 1);
    const relativeY = pointerY / Math.max(viewport.scrollHeight, 1);

    setCanvasZoom(safeZoom, {
      mode: "manual",
      centerViewport: false,
    });

    viewport.scrollLeft = relativeX * viewport.scrollWidth - (clientX - viewportRect.left);
    viewport.scrollTop = relativeY * viewport.scrollHeight - (clientY - viewportRect.top);
  }

  function handleZoomWindowResize() {
    if (
      editorState.zoomMode !== "fit" ||
      !editorState.canvas
    ) {
      return;
    }

    window.clearTimeout(
      handleZoomWindowResize.timeoutId
    );

    handleZoomWindowResize.timeoutId =
      window.setTimeout(() => {
        fitCanvasToViewport();
      }, 100);
  }

  function createCleanOutputCanvas() {
    if (!editorState.image || !editorState.canvas) return null;
    editorState.file = null;
    return buildCleanOutputCanvas(
      {
        image: editorState.image,
        width: editorState.canvas.width,
        height: editorState.canvas.height,
        redactions: editorState.redactions,
      },
      {
        drawBlur: drawBlurOnOutputCanvas,
        drawPixelate: drawPixelateOnOutputCanvas,
      }
    );
  }

  function drawBlurOnOutputCanvas(
    outputContext,
    outputCanvas,
    redaction
  ) {
    if (
      !outputContext ||
      !outputCanvas
    ) {
      return;
    }

    const rectangle =
      clampRectangleToBounds(
        redaction,
        outputCanvas.width,
        outputCanvas.height
      );

    if (
      rectangle.width < 2 ||
      rectangle.height < 2
    ) {
      return;
    }

    /*
      Katman sırasını korumak için kaynak olarak
      o ana kadar çizilmiş outputCanvas kullanılır.
    */
    const blurredRegion =
      createStableBlurRegion(
        outputCanvas,
        rectangle,
        redaction
      );

    if (!blurredRegion) {
      return;
    }

    outputContext.save();

    outputContext.beginPath();

    outputContext.rect(
      rectangle.x,
      rectangle.y,
      rectangle.width,
      rectangle.height
    );

    outputContext.clip();

    outputContext.imageSmoothingEnabled =
      true;

    outputContext.imageSmoothingQuality =
      "high";

    outputContext.drawImage(
      blurredRegion,
      0,
      0,
      blurredRegion.width,
      blurredRegion.height,
      rectangle.x,
      rectangle.y,
      rectangle.width,
      rectangle.height
    );

    outputContext.restore();
  }

  function drawPixelateOnOutputCanvas(
    outputContext,
    outputCanvas,
    redaction
  ) {
    const rawX = Number(
      redaction.x || 0
    );

    const rawY = Number(
      redaction.y || 0
    );

    const rawWidth = Number(
      redaction.width || 0
    );

    const rawHeight = Number(
      redaction.height || 0
    );

    const x = clamp(
      rawX,
      0,
      outputCanvas.width
    );

    const y = clamp(
      rawY,
      0,
      outputCanvas.height
    );

    const right = clamp(
      rawX + rawWidth,
      0,
      outputCanvas.width
    );

    const bottom = clamp(
      rawY + rawHeight,
      0,
      outputCanvas.height
    );

    const width = Math.max(
      0,
      right - x
    );

    const height = Math.max(
      0,
      bottom - y
    );

    if (
      width < 2 ||
      height < 2
    ) {
      return;
    }

    const pixelSize = Math.max(
      2,
      Number(redaction.pixelSize || 8)
    );

    const sampleWidth = Math.max(
      1,
      Math.ceil(width / pixelSize)
    );

    const sampleHeight = Math.max(
      1,
      Math.ceil(height / pixelSize)
    );

    const temporaryCanvas =
      document.createElement("canvas");

    temporaryCanvas.width = sampleWidth;
    temporaryCanvas.height = sampleHeight;

    const temporaryContext =
      temporaryCanvas.getContext("2d", {
        alpha: false,
      });

    if (!temporaryContext) {
      return;
    }

    temporaryContext.imageSmoothingEnabled =
      false;

    temporaryContext.drawImage(
      outputCanvas,

      x,
      y,
      width,
      height,

      0,
      0,
      sampleWidth,
      sampleHeight
    );

    outputContext.save();

    outputContext.beginPath();

    outputContext.rect(
      x,
      y,
      width,
      height
    );

    outputContext.clip();

    outputContext.imageSmoothingEnabled =
      false;

    outputContext.drawImage(
      temporaryCanvas,

      0,
      0,
      sampleWidth,
      sampleHeight,

      x,
      y,
      width,
      height
    );

    outputContext.restore();
  }

  function confirmExportWithUnresolvedSuggestions(count = editorState.detections.length, onReview) {
    const message = exportReviewPrompt(count);
    if (!message) return Promise.resolve(true);
    return new Promise((resolve) => {
      let dialog = document.getElementById("exportReviewDialog");
      if (!dialog) {
        dialog = document.createElement("div");
        dialog.id = "exportReviewDialog";
        dialog.className = "review-export-dialog";
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        dialog.setAttribute("aria-labelledby", "exportReviewMessage");
        dialog.innerHTML = `
          <div class="review-export-card">
            <p id="exportReviewMessage"></p>
            <div class="review-export-actions">
              <button id="reviewRemainingButton" class="review-action" type="button">Review Remaining</button>
              <button id="exportAnywayButton" class="review-action review-action-redact" type="button">Export Anyway</button>
            </div>
          </div>
        `;
        document.body.appendChild(dialog);
      }
      const messageNode = dialog.querySelector("#exportReviewMessage");
      const reviewButton = dialog.querySelector("#reviewRemainingButton");
      const exportButton = dialog.querySelector("#exportAnywayButton");
      if (messageNode) messageNode.textContent = message;
      dialog.hidden = false;

      const finish = (allowExport, openReview) => {
        dialog.hidden = true;
        reviewButton?.removeEventListener("click", review);
        exportButton?.removeEventListener("click", allow);
        dialog.removeEventListener("click", backdrop);
        document.removeEventListener("keydown", onKey);
        resolve(allowExport);
        if (openReview) {
          if (onReview) onReview();
          else focusReviewDetection(0);
        }
      };
      const review = () => finish(false, true);
      const allow = () => finish(true, false);
      const backdrop = (event) => {
        if (event.target === dialog) finish(false, false);
      };
      const onKey = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          finish(false, false);
        }
      };
      reviewButton?.addEventListener("click", review);
      exportButton?.addEventListener("click", allow);
      dialog.addEventListener("click", backdrop);
      document.addEventListener("keydown", onKey);
      reviewButton?.focus();
    });
  }

  async function copyCleanImageToClipboard(button) {
    if (!editorState.image || !editorState.canvas) {
      showStatus("Please open an image before copying.", true);
      return;
    }
    if (!window.isSecureContext || !navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      showStatus("Image copying is unavailable. Use localhost or HTTPS.", true);
      return;
    }
    if (!(await confirmExportWithUnresolvedSuggestions())) return;

    const canvas = createCleanOutputCanvas();
    if (!canvas) return;
    const original = button?.innerHTML || "";
    if (button) button.disabled = true;

    try {
      const promise = canvasToBlob(canvas);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": promise })]);
      showStatus("Image exported with EXIF metadata stripped");
    } catch (firstError) {
      try {
        const blob = await canvasToBlob(canvas);
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        showStatus("Image exported with EXIF metadata stripped");
      } catch (error) {
        console.error("Clipboard copy failed:", firstError, error);
        showStatus("Copy failed. Please use Download instead.", true);
      }
    } finally {
      if (button) {
        button.disabled = false;
        if (original) button.innerHTML = original;
      }
    }
  }

  async function openDeviceImagePicker() {
    if (!Capacitor.isNativePlatform()) {
      fileInput.value = "";
      fileInput.click();
      return;
    }

    try {
      const photo = await Camera.getPhoto({
        quality: 100,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Prompt,
        correctOrientation: true,
        promptLabelHeader: "Add a screenshot",
        promptLabelPhoto: "Gallery",
        promptLabelPicture: "Camera",
        promptLabelCancel: "Cancel",
      });
      const source = photo.webPath || photo.path;
      if (!source) {
        showStatus("The selected image could not be opened.", true);
        return;
      }

      const response = await fetch(source);
      const blob = await response.blob();
      const type = allowedTypes.includes(blob.type) ? blob.type : "image/jpeg";
      const extension = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
      const rawName = String(photo.path || "").split("/").pop() || `screenshot.${extension}`;
      const fileName = rawName.includes(".") ? rawName : `screenshot.${extension}`;
      loadImageFile(new File([blob], fileName, { type }));
    } catch (error) {
      const message = String(error?.message || error || "");
      if (/cancel/i.test(message)) return;
      console.error("Native image picker failed:", error);
      showStatus("The image could not be opened from the device.", true);
    }
  }

  async function downloadCleanImage() {
    const sourceName = editorState.sourceName || editorState.file?.name;
    if (!editorState.image || !sourceName) {
      showStatus("Please open an image before downloading.", true);
      return;
    }
    if (!(await confirmExportWithUnresolvedSuggestions())) return;

    try {
      const canvas = createCleanOutputCanvas();
      if (!canvas) {
        showStatus("The cleaned image could not be created.", true);
        return;
      }
      const exportFormat = editorState.exportFormat || "png";
      const mimeType = exportFormat === "jpeg"
        ? "image/jpeg"
        : exportFormat === "webp"
          ? "image/webp"
          : "image/png";
      const quality = exportFormat === "png" ? undefined : editorState.exportQuality;
      const blob = await canvasToBlob(canvas, mimeType, quality);
      canvas.width = 0;
      canvas.height = 0;
      const fileName = createCleanFileName(sourceName, exportFormat === "jpeg" ? "jpg" : exportFormat);
      if (Capacitor.isNativePlatform()) {
        await saveImageToDevice(blob, fileName);
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      showStatus("Image exported with EXIF metadata stripped");
    } catch (error) {
      console.error("Download failed:", error);
      showStatus("The cleaned image could not be created.", true);
    }
  }

  async function saveImageToDevice(blob, fileName) {
    const dataUrl = await blobToBase64(blob);
    const data = String(dataUrl).includes(",") ? String(dataUrl).split(",")[1] : String(dataUrl);
    if (!data) throw new Error("Image data is empty.");

    await Filesystem.requestPermissions();
    const written = await Filesystem.writeFile({
      path: `Pictures/${fileName}`,
      data,
      directory: Directory.Documents,
      recursive: true,
    });
    try {
      await Share.share({
        title: "Redacted Image",
        url: written.uri,
        dialogTitle: "Share Redacted Image",
      });
    } catch (error) {
      const message = String(error?.message || error || "");
      if (!/cancel/i.test(message)) throw error;
    }
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function createCleanFileName(name, extension = "png") {
    const safe = String(name || "screenshot")
      .replace(/\.[^/.]+$/, "")
      .replace(/[<>:\"/\\|?*\u0000-\u001F]/g, "-")
      .trim();
    const safeExtension = ["png", "webp", "jpg"].includes(extension) ? extension : "png";
    return `${safe || "screenshot"}_redacted.${safeExtension}`;
  }

  function activateEditorTool(
    toolName,
    options = {}
  ) {
    const supportedTools = [
      "select",
      "blackout",
      "blur",
      "pixelate",
    ];

    const normalizedToolName = String(
      toolName || ""
    )
      .trim()
      .toLowerCase();

    if (
      !supportedTools.includes(
        normalizedToolName
      )
    ) {
      return false;
    }

    const toolButton =
      document.querySelector(
        `[data-tool="${normalizedToolName}"]`
      );

    if (!toolButton) {
      showStatus(
        `${normalizedToolName} tool is unavailable.`,
        true
      );

      return false;
    }

    editorState.activeTool =
      normalizedToolName;

    if (["blackout", "blur", "pixelate"].includes(normalizedToolName)) {
      editorState.redactionStyle = normalizedToolName;
      syncRedactionStyleButtons();
    }

    if (
      normalizedToolName !== "select" &&
      normalizedToolName !== "blur" &&
      normalizedToolName !== "pixelate"
    ) {
      editorState.selectedRedactionId = null;
      editorState.selectionInteraction = null;
      editorState.selectionResizeHandle = null;
      editorState.selectionHasMoved = false;

      editorState.isAdjustingRegionStrength =
        false;

      editorState.regionStrengthOriginalValue =
        null;
    }

    const toolButtons =
      document.querySelectorAll(
        "[data-tool]"
      );

    updateActiveToolButton(
      toolButtons,
      toolButton
    );

    const statusMessages = {
      select: t("editor.statusSelect"),
      blackout: t("editor.statusBlackout"),
      blur: t("editor.statusBlur"),
      pixelate: t("editor.statusPixelate"),
    };

    updateActiveToolStatus(
      statusMessages[normalizedToolName]
    );

    renderCanvas();
    renderSelectedRegionInspector();
    updateCanvasCursor();
    syncToolIntensityBar();

    if (options.showNotification) {
      const labels = {
        select: "Select",
        blackout: "Blackout",
        blur: "Blur",
        pixelate: "Pixelate",
      };

      showStatus(
        `${labels[normalizedToolName]} tool selected.`
      );
    }

    return true;
  }

  function initializeToolButtons() {
    const toolButtons =
      document.querySelectorAll(
        "[data-tool]"
      );

    toolButtons.forEach((button) => {
      if (
        button.dataset.editorBound ===
        "true"
      ) {
        return;
      }

      button.dataset.editorBound = "true";

      button.addEventListener(
        "click",
        () => {
          const toolName = String(
            button.dataset.tool || ""
          )
            .trim()
            .toLowerCase();

          activateEditorTool(toolName);
        }
      );
    });

    activateEditorTool(
      editorState.activeTool
    );
  }


  function updateActiveToolButton(
    toolButtons,
    activeButton
  ) {
    toolButtons.forEach((button) => {
      button.classList.remove(
        "bg-primary-container",
        "text-on-primary-container",
        "shadow-sm",
        "is-tool-active"
      );

      button.classList.add(
        "text-on-surface-variant"
      );

      button.setAttribute(
        "aria-pressed",
        "false"
      );
    });

    activeButton.classList.remove(
      "text-on-surface-variant"
    );

    activeButton.classList.add(
      "is-tool-active"
    );

    activeButton.setAttribute(
      "aria-pressed",
      "true"
    );
  }

  function updateActiveToolStatus(message) {
    const element = document.getElementById("activeToolStatus");
    if (element) element.textContent = message;
  }

  function updateRegionStatus() {
    if (
      editorState.activeTool === "select"
    ) {
      updateSelectionStatus();
      return;
    }

    const count =
      editorState.redactions.length;

    const regionText =
      `${count} ${count === 1
        ? "region"
        : "regions"
      }`;

    const toolNames = {
      blackout: "Blackout",
      blur: "Blur",
      pixelate: "Pixelate",
    };

    const activeToolName =
      toolNames[editorState.activeTool] ||
      "Blackout";

    updateActiveToolStatus(
      `${activeToolName} tool active · ${regionText}`
    );
  }

  function updateOcrProgress(progressMessage, buttonLabel) {
    if (!progressMessage) return;
    const status = String(progressMessage.status || "Processing image")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
    const progress = Number(progressMessage.progress || 0);
    const percentage = Math.round(progress * 100);
    updateActiveToolStatus(progress > 0 ? `${status} · ${percentage}%` : status);
    if (buttonLabel) buttonLabel.textContent = progress > 0 ? `Scanning ${percentage}%` : status;
  }

  function updateHeaderFileName(fileName) {
    const label = Array.from(document.querySelectorAll("header span")).find((element) => {
      const text = element.textContent.trim().toLowerCase();
      return [".png", ".jpg", ".jpeg", ".webp"].some((extension) => text.endsWith(extension));
    });
    if (label) label.textContent = fileName;
  }

  function showStatus(message, isError = false) {
    let notification = document.getElementById("clipboardNotification");
    if (!notification) {
      notification = document.createElement("div");
      notification.id = "clipboardNotification";
      notification.className = "editor-clipboard-notification";
      notification.setAttribute("role", "status");
      notification.setAttribute("aria-live", "polite");
      document.body.appendChild(notification);
    }
    notification.textContent = message;
    notification.classList.toggle("is-error", isError);
    notification.classList.add("is-visible");
    window.clearTimeout(showStatus.timeoutId);
    showStatus.timeoutId = window.setTimeout(() => notification.classList.remove("is-visible"), 2600);
  }

  function showFileError(message) {
    emptyState.hidden = false;
    selectedFileMessage.hidden = false;
    selectedFileMessage.classList.add("is-error");
    selectedFileMessage.textContent = message;
    fileInput.value = "";
  }

  function hasDraggedFiles(event) {
    return Array.from(event.dataTransfer?.types || []).includes("Files");
  }

  function showDropOverlay() {
    let overlay = document.getElementById("editorDropOverlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "editorDropOverlay";
      overlay.className = "editor-drop-overlay";
      overlay.innerHTML = `
        <div class="editor-drop-card">
          <span class="material-symbols-outlined" aria-hidden="true">add_photo_alternate</span>
          <strong>Drop your screenshot here</strong>
          <span>PNG, JPG or WebP</span>
        </div>
      `;
      document.body.appendChild(overlay);
    }
    overlay.classList.add("is-visible");
  }

  function hideDropOverlay() {
    document.getElementById("editorDropOverlay")?.classList.remove("is-visible");
  }

  function clearPreviousObjectUrl() {
    if (!editorState.objectUrl) return;
    URL.revokeObjectURL(editorState.objectUrl);
    editorState.objectUrl = null;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function createId(prefix) {
    return typeof crypto.randomUUID === "function"
      ? `${prefix}-${crypto.randomUUID()}`
      : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  document.addEventListener("click", (event) => {
    const historyDrawer = document.getElementById("historyDrawer");
    const historyButton = document.getElementById("historyDrawerButton");
    if (
      historyDrawer &&
      !historyDrawer.hidden &&
      !historyDrawer.contains(event.target) &&
      !historyButton?.contains(event.target)
    ) {
      historyDrawer.hidden = true;
      historyButton?.setAttribute("aria-expanded", "false");
    }

    const exportMenu = document.getElementById("exportMenu");
    const downloadButton = document.getElementById("editorDownloadButton");
    const reviewExportButton = document.getElementById("reviewExportButton");
    if (
      exportMenu &&
      !exportMenu.hidden &&
      !exportMenu.contains(event.target) &&
      !downloadButton?.contains(event.target) &&
      !reviewExportButton?.contains(event.target)
    ) {
      exportMenu.hidden = true;
      delete exportMenu.dataset.anchor;
      downloadButton?.setAttribute("aria-expanded", "false");
    }
  });

  window.addEventListener("beforeunload", () => {
    clearPreviousObjectUrl();
    if (ocrModuleRequested()) {
      loadOcrModule().then((ocrModule) => ocrModule.terminateOcrWorker()).catch(() => {});
    }
  });
  activeRedaktixEditor = {
    applyAllDetections,
    hideSingleDetection,
    destroy() {
      clearPreviousObjectUrl();
      if (!ocrModuleRequested()) return Promise.resolve();
      return loadOcrModule().then((ocrModule) => ocrModule.terminateOcrWorker());
    },
  };
  console.log("Redaktix editor initialized successfully.");
});

function removeDuplicateBrandText() {
  const header = document.querySelector("body > header");
  if (!header) return;
  const matches = Array.from(header.querySelectorAll("span, strong, a")).filter((element) =>
    element.children.length === 0 && element.textContent.trim() === "Redaktix"
  );
  matches.slice(1).forEach((element) => {
    element.hidden = true;
    element.setAttribute("aria-hidden", "true");
  });
}
