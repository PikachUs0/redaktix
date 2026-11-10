# Redaction guarantees

Redaktix is a local-only redaction tool. This document states exactly what the
export pipeline guarantees, how each guarantee is enforced in code, and how it
is tested. Anything not listed here is **not** guaranteed.

The tests that enforce these guarantees live in
[`tests/redaction-guarantees.test.js`](../tests/redaction-guarantees.test.js),
[`tests/pdf-export.test.js`](../tests/pdf-export.test.js) and
[`tests/export-cleanliness.test.js`](../tests/export-cleanliness.test.js).

---

## (a) Redaction boxes are burned into pixels before encoding

**Guarantee.** A redaction is only ever applied by drawing solid pixels over the
rendered page. The encoded image — not the original document — is what leaves
the app.

**How.**

1. `src/lib/pdfEngine.js` `renderPdfPage()` rasterizes the page (default scale 2)
   into a canvas.
2. `src/js/export-clean.js` `createCleanOutputCanvas()` draws the rendered page
   onto a fresh canvas and then calls `fillRect()` for every `blackout`
   redaction. `blur`/`pixelate` are hardened to solid black covers during PDF
   export when no style painter is supplied
   (`src/lib/pdfExport.js` `hardenRedactionsForRaster()`), so a failed blur can
   never leave readable content.
3. The resulting canvas is PNG-encoded and embedded into the output.

**Test.** Exports a synthetic PDF, captures the canvas that is about to be
encoded, and asserts the redacted region is opaque black `(0,0,0)` while an
unredacted region keeps its original pixels. A second case asserts blur is
exported as solid black.

---

## (b) The exported PDF is built fresh — no source structures survive

**Guarantee.** The output PDF is a brand-new document containing one embedded
PNG per page. It has no text layer, no annotations, no form fields, no
JavaScript, no embedded files, and no XMP or Info metadata copied from the
source.

**How.** `src/lib/pdfExport.js` `exportRedactedPdf()` has exactly **one** path:

- `PDFDocument.create()` — an empty document, never the source document.
- For each page: render → burn redactions → `embedPng()` → `addPage()` →
  `drawImage()`.
- `outDoc.save()` — serializes the new document only.

There is no "vector" export mode. The source `PDFDocument` is loaded solely to
read page sizes and page count; it is never re-saved.

The output does contain pdf-lib's own generic `Producer`/`Creator` strings
(`pdf-lib`) and a fresh creation date. That is library metadata about the
exporter, not information about the user's document.

**Test.** Asserts the exported bytes contain `/Subtype /Image` but not
`/Type /Font`, `/Annots`, `/AcroForm`, `/JavaScript`, `/EmbeddedFile` or
`adobe.com/xap`; that the source Title/Author/Subject strings are absent; and
that a hostile text extraction (`verifyRedactionIntegrity()`) recovers none of
the secret terms — even when zero redaction boxes are supplied, because the
text layer is gone entirely.

---

## (c) Exported images are re-encoded through a canvas

**Guarantee.** Raster image exports never copy the original file bytes. They are
redrawn onto a fresh canvas and re-encoded, so EXIF, GPS, XMP, camera
Make/Model and DateTime tags are dropped.

**How.** `src/js/export-clean.js`:

- `createCleanOutputCanvas()` redraws the source into a new canvas.
- `canvasToBlob()` redraws that canvas once more into a second new canvas and
  encodes from there, then zeroes the intermediate canvas dimensions.
- `findMetadataMarkers()` scans encoded bytes for `Exif`, XMP (`http://ns.adobe.com/xap`),
  GPS, Make/Model and DateTime markers.

**Test.** Re-encodes `tests/fixtures/exif-sample.jpg` (which carries Exif, XMP
and GPS) and asserts the output bytes differ from the source and contain zero
metadata markers, for PNG, JPEG and WebP.

---

## (d) Output filenames are generic

**Guarantee.** Downloads are named `redacted-YYYYMMDD-HHMMSS.<ext>` using the
UTC wall clock. The original file name is never reused, so the exported file
cannot hint at what it contains.

**How.** `src/js/export-clean.js` `createRedactedFileName(extension, date)`
whitelists `pdf`, `png`, `jpg`, `jpeg`, `webp`; unknown extensions fall back to
`png` instead of echoing arbitrary input. `src/lib/pdfExport.js`
`createRedactedPdfFileName()` wraps it for PDFs.

**Test.** Fixed-date assertions on the exact output name plus a pattern check
for the live clock, including a hostile-extension case.

---

## (e) Session teardown: object URLs revoked, buffers released

**Guarantee.** Nothing redacted is retained after the user is done. A
**Clear session** action runs the full teardown, and every download object URL
is revoked.

**How.** `src/js/editor.js`:

- `triggerBlobDownload()` creates the object URL for the synthetic blob,
  clicks a detached `<a download>`, and always calls
  `URL.revokeObjectURL()` afterwards. It is the only download path.
- Source image object URLs are revoked immediately after the image is decoded
  into a canvas (`loadImageFile()`), so the file handle is not kept alive.
  `clearPreviousObjectUrl()` is the session-level safety net.
- `releaseEditorImage()` zeroes the source canvas width/height before dropping it.
- `releasePdfCanvasBitmap()` / `destroyPdfSession()` zero cached page canvases
  and destroy the pdf.js document and any in-flight scan.
- `clearSession()` calls all of the above and resets detections, redactions and
  history. Both the **Redact another** and **Clear session** buttons in the
  export-complete panel call it.
- `beforeunload` also revokes the source object URL.

**Test.** Static assertions that every `URL.createObjectURL` in the editor has a
matching revoke, that the image/PDF buffers are zeroed, that the Clear session
control exists, and that it runs `destroyPdfSession` → `clearPreviousObjectUrl`
→ `releaseEditorImage`.

---

## Not guaranteed

Be explicit with users about these limits:

- **Rasterization is lossy.** Exported PDFs are images: text is no longer
  selectable/searchable, crisp at high zoom, or accessible to screen readers.
  This is the cost of guarantee (b).
- **Memory is not zeroed cryptographically.** Buffers are dropped and canvases
  zeroed, but JavaScript cannot guarantee that the browser or OS has not paged
  out a copy. Closing the tab is the strongest disposal step.
- **Downloaded files are outside our control.** Once a file is saved or shared,
  Redaktix cannot revoke it.
- **Detection recall is not perfect.** Redaction is only as complete as the
  detections the user accepts; always review the overlay before exporting.
- **Screenshots and screen recordings** of the canvas are outside the threat
  model.

## Verification checklist (manual)

1. Open the editor, load `tests/fixtures/exif-sample.jpg`, add a redaction,
   download PNG/JPEG/WebP and confirm the name is `redacted-*.ext`.
2. Run `exiftool` (or `findstr /i "Exif GPS XMP"`) on each download — no hits.
3. Load a PDF, export it, then run `pdftotext` on the result — output must be
   empty.
4. Confirm the export-complete panel shows Download / Redact another /
   Clear session first, and that any advertisement sits far below them.
5. Click **Clear session**; the canvas disappears and DevTools →
   Application → no object URLs remain for `blob:` sources.
