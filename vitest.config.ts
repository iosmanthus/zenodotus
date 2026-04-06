import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "extension"),
    },
  },
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/.direnv/**"],
    setupFiles: ["./extension/test-setup.ts"],
  },
});
