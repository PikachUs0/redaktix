let ocrModulePromise = null;

export function ocrModuleRequested() {
  return ocrModulePromise !== null;
}

export function loadOcrModule() {
  if (!ocrModulePromise) {
    ocrModulePromise = import("./ocr.js");
  }
  return ocrModulePromise;
}
