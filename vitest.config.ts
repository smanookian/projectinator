import { defineConfig } from "vitest/config";

// Enable the automatic JSX runtime so .tsx TUI tests transform correctly.
export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  // Redirect user data (projects, routing overrides) into the repo for every test file.
  test: { setupFiles: ["./test/setup.ts"] },
});
