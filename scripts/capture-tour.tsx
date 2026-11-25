// Regenerate the README pictures from the running app: docs/cockpit.svg (the board with a card's
// details) and docs/tour.svg (home, the board, Settings floating over it, the key list).
//
// Why not a terminal recording: the TUI intermittently fails to emit its first frame under a
// pseudo-terminal (fine in a real one), so a PTY-driven capture is not reproducible.
// ink-testing-library renders the same components deterministically, which is what the test
// suite relies on — so these are real frames, with the app's real theme colours (catppuccin-mocha,
// the default), turned into SVG cell by cell.
//
//   npx tsx scripts/capture-tour.tsx
//
// It reads a COPY of your projects (~/.projectinator/projects) in a throwaway data dir, with no
// API key — nothing it does touches your real data or spends anything.
import React from "react";
import type { render as Render } from "ink-testing-library";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// The data dir, key and colour level must be set before the app's modules load (config is read
// at import time), so the app is imported dynamically below.
const home = mkdtempSync(join(tmpdir(), "projectinator-tour-"));
cpSync(join(homedir(), ".projectinator", "projects"), join(home, "projects"), { recursive: true });
let modelUpgrades: Record<string, string> | undefined;
try { modelUpgrades = JSON.parse(readFileSync(join(homedir(), ".projectinator", "config.json"), "utf8")).modelUpgrades; } catch { /* none */ }
// ASCII role icons: a README viewer has no Nerd Font, so its glyphs would render as boxes.
writeFileSync(join(home, "config.json"), JSON.stringify({ keys: {}, icons: "ascii", modelUpgrades }));
process.env.PROJECTINATOR_HOME = home;
process.env.OPENROUTER_API_KEY = "sk-tour";
process.env.FORCE_COLOR = "3";

// Ink's colour support (chalk) is decided when it loads, so it too comes after FORCE_COLOR.
const { render }: { render: typeof Render } = await import("ink-testing-library");
const { default: App } = await import("../src/tui/App.js");
const { ThemedApp } = await import("../src/tui/theme-context.js");
const { C } = await import("../src/tui/theme.js");
const { warmPiCatalog } = await import("../src/pi-catalog.js");
await warmPiCatalog();

const COLS = 140, ROWS = 40;
const DOWN = "\u001b[B", ENTER = "\r", ESC = "\u001b";
const tick = (ms = 120) => new Promise((r) => setTimeout(r, ms));

const r = render(<ThemedApp><App /></ThemedApp>);
const out = r.stdout as unknown as { emit: (e: string) => void };
Object.defineProperty(out, "columns", { value: COLS, configurable: true });
Object.defineProperty(out, "rows", { value: ROWS, configurable: true });
out.emit("resize");
await tick(500);
const key = async (s: string, wait = 150) => { r.stdin.write(s); await tick(wait); };
const frame = () => r.lastFrame() ?? "";
const frames: { caption: string; text: string }[] = [];
const grab = (caption: string) => frames.push({ caption, text: frame() });

await key(ENTER, 300); // "Start a build" → Home
grab("Home — the sidebar holds your projects and your team");
await key("/"); // find the biggest project and open it
await key("markdown");
await key(ENTER, 400);
await key(DOWN); // Board
await key(ENTER, 400);
await key("l"); // into Done, then a few cards down
await key("j"); await key("j");
const board = frame();
grab("A project's board — pick a card, its details show below; e edits, a adds, d deletes");
await key("S", 300);
grab("Settings float over the page, like Musinator's dialogs");
await key(ESC); await key(ESC);
await key("?", 300);
grab("? — every key, in one place");
r.unmount();
rmSync(home, { recursive: true, force: true });

// ---- ANSI frame → SVG, one monospace cell per character ----

const CW = 7.8, LH = 16, FS = 13, PAD = 16;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface Span { col: number; text: string; fg?: string; bg?: string; bold: boolean }

function parse(line: string): Span[] {
  const spans: Span[] = [];
  let fg: string | undefined, bg: string | undefined, bold = false, col = 0;
  for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
    const m = /^\x1b\[([0-9;]*)m$/.exec(part);
    if (!m) {
      if (part) { spans.push({ col, text: part, fg, bg, bold }); col += [...part].length; }
      continue;
    }
    const c = (m[1] || "0").split(";").map(Number);
    for (let i = 0; i < c.length; i++) {
      const n = c[i]!;
      if (n === 0) { fg = bg = undefined; bold = false; }
      else if (n === 1) bold = true;
      else if (n === 22) bold = false;
      else if (n === 39) fg = undefined;
      else if (n === 49) bg = undefined;
      else if ((n === 38 || n === 48) && c[i + 1] === 2) {
        const rgb = `rgb(${c[i + 2]},${c[i + 3]},${c[i + 4]})`;
        if (n === 38) fg = rgb; else bg = rgb;
        i += 4;
      }
    }
  }
  return spans;
}

/** One terminal frame as SVG elements, its top-left at (x, y). */
function screen(text: string, x: number, y: number): string[] {
  const lines = text.split("\n");
  const els = [`<rect x="${x}" y="${y}" width="${(COLS * CW).toFixed(1)}" height="${lines.length * LH}" rx="6" fill="${C.bg}"/>`];
  lines.forEach((line, row) => {
    const top = y + row * LH;
    for (const s of parse(line)) {
      const n = [...s.text].length;
      const left = x + s.col * CW;
      if (s.bg) els.push(`<rect x="${left.toFixed(1)}" y="${top}" width="${(n * CW).toFixed(1)}" height="${LH}" fill="${s.bg}"/>`);
      if (!s.text.trim()) continue;
      // textLength pins every glyph to the cell grid, so borders line up in any viewer's font.
      els.push(`<text xml:space="preserve" x="${left.toFixed(1)}" y="${top + LH - 4}" fill="${s.fg ?? C.text}"${s.bold ? ' font-weight="700"' : ""} textLength="${(n * CW).toFixed(1)}" lengthAdjust="spacingAndGlyphs">${esc(s.text)}</text>`);
    }
  });
  return els;
}

const svg = (w: number, h: number, body: string[]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="ui-monospace,'JetBrains Mono','DejaVu Sans Mono',Menlo,Consolas,monospace" font-size="${FS}">\n${body.join("\n")}\n</svg>\n`;

const W = Math.ceil(COLS * CW + 2 * PAD);
const screenH = ROWS * LH;

writeFileSync("docs/cockpit.svg", svg(W, screenH + 2 * PAD, screen(board, PAD, PAD)));

const tour: string[] = [];
let y = 0;
for (const f of frames) {
  y += 30;
  tour.push(`<text x="${PAD}" y="${y}" fill="${C.accent}" font-size="${FS + 2}" font-weight="700">${esc(f.caption)}</text>`);
  y += 12;
  tour.push(...screen(f.text, PAD, y));
  y += screenH + 8;
}
writeFileSync("docs/tour.svg", svg(W, y + PAD, tour));
console.log(`docs/cockpit.svg and docs/tour.svg — ${frames.length} screens, ${W}px wide`);
process.exit(0);
