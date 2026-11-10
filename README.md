# Redaktix

Privacy-first redaction for PDFs and screenshots. Files are opened, analysed, and
redacted inside your browser. They are never uploaded.

- [Verify it yourself](/verify/): an airplane-mode test, a DevTools network check,
  and the Content Security Policy that the host sends for every tool page.
- [Security proof](/security/): how detection and OCR stay on your device.
- [Tools](/tools/): single-purpose redaction pages.

## Verify the privacy claim

`/verify/` walks through three checks you can run yourself, including the exact
policy header each route returns in production. Ads never load on `/verify/`,
`/privacy`, or any `/tools/*` page; `?privacy_mode=true` disables them everywhere.

## Develop

```powershell
npm install
npm run dev
```

## Test

```powershell
node --test
```

## Build

```powershell
npm run build
```

The build writes `dist/`, stamps the service worker with a content-hashed
`BUILD_HASH`, and emits `/verify/` from `src/verify/index.html`.
