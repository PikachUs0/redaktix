import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderedPages, renderSitemap } from "./src/tools/render-pages.js";
import { writeServiceWorker } from "./scripts/write-sw.js";

function toolPagesDevPlugin() {
  return {
    name: "privacylab-tool-pages",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = String(request.url || "").split("?")[0];
        if (url === "/sitemap.xml") {
          response.setHeader("Content-Type", "application/xml; charset=utf-8");
          response.end(renderSitemap());
          return;
        }
        // /verify/ is a Vite MPA input. In dev the file lives under src/,
        // so serve the source HTML at the public URL; its asset links are
        // root-absolute (/src/...), which Vite serves directly.
        if (url === "/verify" || url === "/verify/") {
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.end(readFileSync(resolve(import.meta.dirname, "src/verify/index.html"), "utf8"));
          return;
        }
        const normalized = url.endsWith("/") ? url : `${url}/`;
        const page = renderedPages().find((item) => item.path === url || item.path === normalized);
        if (!page) {
          next();
          return;
        }
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(page.html);
      });
    },
  };
}

function serviceWorkerPrecachePlugin() {
  return {
    name: "privacylab-sw-precache",
    apply: "build",
    closeBundle() {
      writeServiceWorker(resolve(import.meta.dirname, "dist"));
    },
  };
}

export default defineConfig({
  // App is served from the project root in both dev and production.
  // Do not set `base` to a subpath (e.g. /privacylab/) — that causes 404 at localhost:5173/.
  base: "/",
  plugins: [toolPagesDevPlugin(), serviceWorkerPrecachePlugin()],
  server: {
    port: 5173,
    strictPort: false,
    open: "/",
  },
  preview: {
    port: 4173,
    strictPort: false,
  },
  build: {
    manifest: true,
    rollupOptions: {
      input: {
        landing: resolve(
          import.meta.dirname,
          "index.html"
        ),

        editor: resolve(
          import.meta.dirname,
          "editor.html"
        ),

        verify: resolve(
          import.meta.dirname,
          "src/verify/index.html"
        ),

        toolPage: resolve(
          import.meta.dirname,
          "src/js/tool-page.js"
        ),
      },
    },
  },
});