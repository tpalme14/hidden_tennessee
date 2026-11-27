import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    // M06-T02 — PWA build (Specification 6 v1.1 §12.10, ADR-007 amended,
    // ADR-008). Generates the web app manifest and a shell-only service worker.
    // The plugin's automatic registration injection stays disabled
    // (`injectRegister: false`); the application registers the worker itself
    // through src/pwa/serviceWorker.ts (Increment 2).
    VitePWA({
      strategies: "generateSW",
      registerType: "prompt",
      injectRegister: false,
      devOptions: { enabled: false },
      // The icons are already precached by the bounded `globPatterns` below;
      // the plugin's default would list them a second time.
      includeManifestIcons: false,
      manifest: {
        name: "Tennessee Natural Landmarks Explorer",
        short_name: "TN Landmarks",
        description: "Discover lesser-known natural landmarks in Tennessee.",
        id: "/",
        start_url: "/",
        scope: "/",
        display: "standalone",
        lang: "en",
        theme_color: "#ffffff",
        background_color: "#ffffff",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Bounded application-shell precache only: no runtime caching of any
        // request (API, authentication, shared trips, map tiles, or external
        // resources), no background sync, and no source maps.
        // `assets/*.js` also covers the hashed workbox-window chunk that the
        // registration helper loads.
        globPatterns: ["index.html", "assets/*.{js,css}", "icons/*.{png,svg}"],
        globIgnores: ["**/*.map"],
        // Any single file over 2 MiB is left out of the precache (with a build
        // warning); the browser suite fails if a required shell file is missing.
        maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
        // Cache name: "hidden-tennessee-precache-v2-<scope>"; entries are
        // versioned by Workbox revisions and obsolete caches are removed.
        cacheId: "hidden-tennessee",
        // Offline navigation: application routes fall back to the precached
        // shell. Workbox tests each pattern against pathname + search
        // (workbox-routing 7.4.1 NavigationRoute), so excluded navigations
        // always go to the network:
        navigateFallback: "index.html",
        navigateFallbackDenylist: [
          /^\/api(?:[/?]|$)/i, // the API (ADR-008)
          /^\/health(?:[/?]|$)/i, // readiness endpoint
          /^\/shared(?:[/?]|$)/i, // shared-trip pages keep the server's no-store / noindex headers
          /^[^?]*%/, // percent-encoded paths (encoded query values are still allowed)
          /^[^?]*\/[^/?]*\.[^/?]*(?:\?|$)/, // file-like last path segment (sw.js, assets, …)
        ],
        cleanupOutdatedCaches: true,
        skipWaiting: false,
        clientsClaim: false,
        sourcemap: false,
      },
    }),
  ],
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/health": "http://localhost:3000",
    },
  },
});
