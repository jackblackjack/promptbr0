import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The React plugin gives test files the automatic JSX runtime (no `import
// React` needed). Environments are chosen per file: node by default (main /
// lib logic tests), `// @vitest-environment jsdom` for component tests.
export default defineConfig({
  plugins: [react()],
  test: {
    setupFiles: ["src/renderer/src/test/setup.ts"],
    // The jsdom component tests share one machine with their setup work; on a
    // many-core dev host Vitest otherwise spawns enough workers to push
    // ordinary UI interactions past their 5s timeouts. Four matches the CI
    // runner and keeps local runs deterministic.
    maxWorkers: 4,
  },
});
