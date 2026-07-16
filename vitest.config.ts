import { defineConfig } from "vitest/config";

// Enable the automatic JSX runtime so .tsx TUI tests transform correctly.
export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
});
