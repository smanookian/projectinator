#!/usr/bin/env node
// Launcher for `projectinator` / `npx github:smanookian/projectinator`.
// Runs the Ink TUI (TypeScript) through tsx — no build step, no compiled dist.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(root, "src", "tui.tsx");

const args = process.argv.slice(2);
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

if (args.includes("--version") || args.includes("-v")) {
  console.log(version);
  process.exit(0);
}
if (args.includes("--help") || args.includes("-h")) {
  console.log(`projectinator ${version} — your AI build team in the terminal

Usage
  projectinator              open the cockpit (TUI)
  projectinator --version    print the version
  projectinator --help       this text

Setup
  Inside the app: Settings → API keys (Anthropic, OpenAI, Gemini, OpenRouter).
  Keys live in ~/.projectinator/config.json (chmod 0600).
  Optional: npx playwright install chromium  → lets the tester run the app headless.

Scripting (from a clone of the repo)
  npm run build -- --live --mini            cheap end-to-end build (~$0.10)
  npm run build -- --live "idea"            full pipeline
  npm run bakeoff -- --capability code "…"  compare models on one task

Docs: https://github.com/smanookian/projectinator#readme`);
  process.exit(0);
}
if (args.length) {
  console.error(`projectinator: unknown option "${args[0]}". Try --help.`);
  process.exit(2);
}

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
