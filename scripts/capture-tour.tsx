// Regenerate docs/tour.svg — four real screens captured from the running app.
//
// Why not a terminal recording: the TUI intermittently fails to emit its first frame under a
// pseudo-terminal (fine in a real one), so a PTY-driven asciinema capture is not reproducible.
// ink-testing-library renders the same components deterministically, which is what the test
// suite relies on, so the frames here are real output — just captured reliably.
//
//   npx tsx scripts/capture-tour.tsx
import React from "react";
import { render } from "ink-testing-library";
import { writeFileSync } from "node:fs";
import App from "../src/tui/App.js";

const DOWN = "\u001b[B", ENTER = "\r", RIGHT = "\u001b[C";
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));
process.env.OPENROUTER_API_KEY ||= "test";

const r = render(<App />);
const frame = () => r.lastFrame() ?? "";
const cursor = () => frame().split("\n").find((l) => l.includes("❯")) ?? "";
const frames: { caption: string; text: string }[] = [];
const grab = (caption: string) => frames.push({ caption, text: frame() });

async function pick(label: string) {
  for (let i = 0; i < 30 && !cursor().includes(label); i++) { r.stdin.write(DOWN); await tick(45); }
  const before = frame();
  for (let i = 0; i < 8 && frame() === before; i++) { r.stdin.write(ENTER); await tick(60); }
}

await tick(300);
await pick("Start a build");
await tick(200);
grab("Home — your projects, spend, and what to do next");
await pick("Projects (");
await tick(250);
grab("Projects — every build with status and cost");
await pick("A static site");
await tick(300);
grab("A finished project — tasks, epics, and what it cost");
await pick("Transcripts (what each role said)");
await tick(250);
r.stdin.write(ENTER); await tick(400);
r.stdin.write(RIGHT); await tick(400);
grab("Transcripts — the run list beside what the role actually said");

const CW = 7.55, LH = 15.5, FS = 12.5, PAD = 14, COLS = 100;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Colours mirror the app's own dark theme (theme.ts DARK).
const BG = "#12100d", TEXT = "#d8d2c6", MUTED = "#8a8375", AMBER = "#e0a72d", GOOD = "#7bab5a";
const colour = (line: string) =>
  line.includes("PROJECTINATOR") || line.trimStart().startsWith("❯") ? AMBER
  : /^[\s│]*[─╭╰│╮╯]/.test(line) || /^─+$/.test(line.trim()) ? MUTED
  : /✓/.test(line) ? GOOD : TEXT;

let y = 0;
const out: string[] = [];
for (const f of frames) {
  const lines = f.text.split("\n").filter((l, i, a) => i < a.length - 1 || l.trim());
  y += 26;
  out.push(`<text x="${PAD}" y="${y}" fill="${AMBER}" font-size="${FS + 1.5}" font-weight="600">${esc(f.caption)}</text>`);
  y += 12;
  out.push(`<rect x="${PAD - 6}" y="${y}" width="${COLS * CW + 14}" height="${lines.length * LH + 16}" rx="7" fill="${BG}" stroke="#2a251d"/>`);
  y += 18;
  for (const line of lines) {
    if (line.trim()) {
      // Force exact monospace metrics: without textLength the viewer's own font advance is
      // used and the box-drawing borders stop lining up with the content.
      const n = [...line].length;
      out.push(`<text xml:space="preserve" x="${PAD}" y="${y}" fill="${colour(line)}" textLength="${(n * CW).toFixed(1)}" lengthAdjust="spacingAndGlyphs">${esc(line)}</text>`);
    }
    y += LH;
  }
  y += 10;
}
const W = COLS * CW + 2 * PAD + 8, H = y + 14;
writeFileSync("docs/tour.svg", `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,'DejaVu Sans Mono',monospace" font-size="${FS}">
<rect width="${W}" height="${H}" fill="#0b0a08"/>
${out.join("\n")}
</svg>
`);
console.log(`docs/tour.svg — ${frames.length} screens, ${W}x${Math.round(H)}`);
r.unmount();
