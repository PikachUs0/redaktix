import { TOOLS, getToolBySlug, resolveSiteOrigin, sitemapPaths, toolPublicPath } from "./registry.js";

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function jsonLd(data) {
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}

function pageShell({ lang, title, description, canonicalPath, jsonLdBlocks, body, scriptSrc, styleHref }) {
  const blocks = jsonLdBlocks.map((block) => `<script type="application/ld+json">${jsonLd(block)}</script>`).join("");
  const script = scriptSrc ? `<script type="module" src="${escapeHtml(scriptSrc)}"></script>` : "";
  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonicalPath)}">
<link rel="stylesheet" href="${escapeHtml(styleHref)}">
${blocks}
</head>
<body>
${body}
${script}
</body>
</html>
`;
}

function originFor(env) {
  return resolveSiteOrigin(env);
}

export function renderToolPage(entry, options = {}) {
  const styleHref = options.styleHref || "/src/css/tool-page.css";
  const scriptSrc = options.scriptSrc || "/src/js/tool-page.js";
  const origin = originFor(options.env);
  const path = toolPublicPath(entry);
  const related = entry.relatedSlugs
    .map((slug) => getToolBySlug(slug))
    .filter(Boolean)
    .map((item) => `<li><a href="${escapeHtml(toolPublicPath(item))}">${escapeHtml(item.h1)}</a></li>`)
    .join("");
  const faqHtml = entry.faqList.map((item) => `<details class="tool-faq"><summary>${escapeHtml(item.question)}</summary><p>${escapeHtml(item.answer)}</p></details>`).join("");
  const webApp = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: entry.title,
    applicationCategory: "SecurityApplication",
    operatingSystem: "Web",
    url: `${origin}${path}`,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    browserRequirements: "Requires a browser with WebAssembly",
    description: entry.introText,
  };
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Redaktix", item: `${origin}/` },
      { "@type": "ListItem", position: 2, name: entry.lang === "tr" ? "Araçlar" : "Tools", item: `${origin}${entry.lang === "tr" ? "/tr/" : "/tools/"}` },
      { "@type": "ListItem", position: 3, name: entry.h1, item: `${origin}${path}` },
    ],
  };
  const body = `<header class="tool-header"><a class="tool-brand" href="/">Redaktix</a><a class="tool-trust" href="/security/">🟢 100% Local Processing (Zero Data Upload)</a></header>
<main class="tool-main" data-tool-slug="${escapeHtml(entry.slug)}">
<h1>${escapeHtml(entry.h1)}</h1>
<p class="tool-intro">${escapeHtml(entry.introText)}</p>
<div class="tool-dropzone" data-tool-dropzone>
<p>Drop screenshot here, press Ctrl+V to paste, or browse files</p>
<label class="tool-file-label">Browse files<input id="toolFileInput" type="file" accept="image/png,image/jpeg,image/webp"></label>
<p class="tool-drop-status" data-tool-status role="status"></p>
</div>
<pre class="tool-example">${escapeHtml(entry.exampleCodeOrImage)}</pre>
<section>
<h2>${entry.lang === "tr" ? "Sorular" : "Questions"}</h2>
${faqHtml}
</section>
<nav aria-label="Related tools"><ul>${related}</ul></nav>
</main>`;
  return pageShell({
    lang: entry.lang,
    title: `${entry.title} — Redaktix`,
    description: entry.introText,
    canonicalPath: path,
    jsonLdBlocks: [webApp, crumbs],
    body,
    scriptSrc,
    styleHref,
  });
}

export function renderToolsIndex(options = {}) {
  const styleHref = options.styleHref || "/src/css/tool-page.css";
  const links = TOOLS.map((entry) => `<li><a href="${escapeHtml(toolPublicPath(entry))}">${escapeHtml(entry.h1)}</a><p>${escapeHtml(entry.introText)}</p></li>`).join("");
  const body = `<header class="tool-header"><a class="tool-brand" href="/">Redaktix</a><a class="tool-trust" href="/security/">🟢 100% Local Processing (Zero Data Upload)</a></header>
<main class="tool-main">
<h1>Screenshot redaction tools</h1>
<p class="tool-intro">Each tool opens Redaktix with one detector preset. OCR stays in the browser and starts only after you drop, paste, or select a screenshot.</p>
<ul class="tool-index">${links}</ul>
</main>`;
  return pageShell({
    lang: "en",
    title: "Screenshot redaction tools — Redaktix",
    description: "Local screenshot tools for API keys, email, phone numbers, IP addresses, cards, JWTs, and Turkish ID numbers.",
    canonicalPath: "/tools/",
    jsonLdBlocks: [],
    body,
    scriptSrc: "",
    styleHref,
  });
}

export function renderSecurityPage(options = {}) {
  const styleHref = options.styleHref || "/src/css/tool-page.css";
  const body = `<header class="tool-header"><a class="tool-brand" href="/">Redaktix</a><a class="tool-trust" href="/security/">🟢 100% Local Processing (Zero Data Upload)</a></header>
<main class="tool-main">
<h1>Local-first processing</h1>
<p class="tool-intro">Redaktix reads a screenshot with Tesseract.js compiled to WebAssembly in this browser. The image pixels and the recognized text stay in tab memory. They are not copied into a request body and they do not leave the browser.</p>
<section class="security-diagram" aria-label="Processing path">
<div class="security-node">Screenshot pixels<br>in tab memory</div>
<div class="security-arrow" aria-hidden="true">→</div>
<div class="security-node">WASM OCR<br>/assets/ocr on this origin</div>
<div class="security-arrow" aria-hidden="true">→</div>
<div class="security-node">Redacted PNG<br>downloaded locally</div>
</section>
<p class="security-note">There is no arrow from the screenshot to a Redaktix server. The OCR worker, core, and eng/tur traineddata are static files under /assets/ocr.</p>
<h2>Verify in Chrome DevTools</h2>
<ol class="security-steps">
<li>Open Redaktix and press F12. Select the Network panel. Enable Preserve log.</li>
<li>Drop, paste, or select a screenshot, then click Scan sensitive data.</li>
<li>Inspect the request names. Image bytes do not appear as an outbound payload.</li>
<li>Same-origin files under /assets/ocr are the OCR engine and language data, not your screenshot.</li>
<li>The screenshot file name is not a request URL. Closing the tab drops the decoded image.</li>
</ol>
<p><a href="/tools/">Browse the single-purpose tools</a></p>
</main>`;
  return pageShell({
    lang: "en",
    title: "Local processing proof — Redaktix",
    description: "How to confirm Redaktix keeps screenshot pixels in the browser and does not upload the image.",
    canonicalPath: "/security/",
    jsonLdBlocks: [{
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "Redaktix",
      applicationCategory: "SecurityApplication",
      operatingSystem: "Web",
      url: `${originFor(options.env)}/security/`,
    }],
    body,
    scriptSrc: "",
    styleHref,
  });
}

export function renderSitemap(env) {
  const origin = originFor(env);
  const urls = sitemapPaths().map((path) => `  <url><loc>${escapeHtml(`${origin}${path}`)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

export function renderedPages(options = {}) {
  const pages = [
    { path: "/tools/", file: "tools/index.html", html: renderToolsIndex(options) },
    { path: "/security/", file: "security/index.html", html: renderSecurityPage(options) },
  ];
  for (const entry of TOOLS) {
    const path = toolPublicPath(entry);
    pages.push({
      path,
      file: `${path.replace(/^\//, "")}index.html`,
      html: renderToolPage(entry, options),
    });
  }
  return pages;
}
