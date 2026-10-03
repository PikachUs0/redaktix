# OCR language data

`src/js/ocr.js` loads Tesseract locally. `langPath` is `/assets/ocr/lang`.

`createWorker(["eng", "tur"], 1)` uses LSTM-only mode and does not set `gzip: false`, so the worker requests:

- `eng.traineddata.gz`
- `tur.traineddata.gz`

These files are the Tesseract.js `4.0.0_best_int` packs (the same data the library fetches for OEM 1):

- https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz
- https://cdn.jsdelivr.net/npm/@tesseract.js-data/tur/4.0.0_best_int/tur.traineddata.gz

Vite copies this folder to `dist/assets/ocr/lang/` on build.
