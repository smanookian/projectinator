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
if (args.includes("--help") || args.includes("-h") || args[0] === "help") {
  console.log(`projectinator ${version} — your AI build team in the terminal

Usage
  projectinator                        open the cockpit (TUI)
  projectinator doctor                 check Node, API keys, Chromium, Pi catalog, git
  projectinator build "<idea>" [...]   plan + build headless (--dry-run, --yes, --json,
                                       --budget, --provider, --concurrency, --task-cap, --task-timeout)
  projectinator projects               list past builds with status and cost
  projectinator models                 the roster as it will run, with prices
  projectinator --version | --help

Setup
  Inside the app: Settings → API keys (Anthropic, OpenAI, Gemini, OpenRouter).
  Keys live in ~/.projectinator/config.json (chmod 0600).
  Optional: npx playwright install chromium  → lets the tester run the app headless.

Exit codes: 0 ok · 1 environment problem · 2 bad usage · 3 build halted
Docs: https://github.com/smanookian/projectinator#readme`);
  process.exit(0);
}

const COMMANDS = new Set(["doctor", "build", "projects", "models"]);
if (args.length && !COMMANDS.has(args[0])) {
  console.error(`projectinator: unknown ${args[0].startsWith("-") ? "option" : "command"} "${args[0]}". Try --help.`);
  process.exit(2);
}

// `node --import tsx <entry>` registers tsx's loader, then runs the TS entry.
// No command → the TUI; a command → the headless CLI with the remaining args.
const target = args.length ? join(root, "src", "cli.ts") : entry;
const res = spawnSync(process.execPath, ["--import", "tsx", target, ...args], {
  stdio: "inherit",
  cwd: root,
});

if (res.error) {
  console.error("Failed to launch Projectinator:", res.error.message);
  process.exit(1);
}
process.exit(res.status ?? 0);
