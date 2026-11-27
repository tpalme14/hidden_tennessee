import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Scoped explicitly to this workspace's own src/ directory so this never
// discovers backend or e2e files.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // vite-plugin-pwa's virtual module exists only in the real build (M06-T02
      // Increment 2); unit tests resolve it to a stub and inject fakes.
      "virtual:pwa-register": fileURLToPath(
        new URL("./src/test/pwaRegisterStub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "dist/**"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
