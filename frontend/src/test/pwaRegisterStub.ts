// Stand-in for vite-plugin-pwa's `virtual:pwa-register` in unit tests
// (M06-T02 Increment 2). The virtual module exists only in the Vite build with
// the PWA plugin, which vitest.config.ts deliberately does not load. Unit tests
// inject their own fake register function into createServiceWorkerController;
// reaching this stub means a test forgot to, so it fails loudly. Real
// registration is verified in the browser (e2e/sw).
import type { RegisterSWOptions } from "vite-plugin-pwa/types";

export type { RegisterSWOptions };

export function registerSW(_options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void> {
  throw new Error("virtual:pwa-register is not available in unit tests; inject a fake register.");
}
