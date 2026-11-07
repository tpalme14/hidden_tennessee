import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Scoped explicitly to this workspace's own src/ directory so this never
// discovers backend or e2e files.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "dist/**"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
