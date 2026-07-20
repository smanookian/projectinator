#!/usr/bin/env node
// Launcher for `projectinator` / `npx github:smanookian/projectinator`.
// Runs the Ink TUI (TypeScript) through tsx — no build step, no compiled dist.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(root, "src", "tui.tsx");

// `node --import tsx <entry>` registers tsx's loader, then runs the TS entry.
const res = spawnSync(process.execPath, ["--import", "tsx", entry], {
  stdio: "inherit",
  cwd: root,
});

if (res.error) {
  console.error("Failed to launch Projectinator:", res.error.message);
  process.exit(1);
}
process.exit(res.status ?? 0);
