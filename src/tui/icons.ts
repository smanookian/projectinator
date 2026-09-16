// Role icons — Nerd Font glyphs with a monospace-safe ASCII fallback. A terminal can't
// report whether a Nerd Font is installed, so the mode is a user choice (Settings →
// Appearance): "nerd" uses real glyphs, "ascii" uses portable single-width marks.
// Codepoints are pinned from the Nerd Fonts v3 cheat sheet (webfont.css).

import type { Capability } from "../types.js";

export type IconMode = "nerd" | "ascii";

export const ROLE_ICON: Record<Capability, { nerd: string; ascii: string }> = {
  plan:   { nerd: "\u{F018B}", ascii: "◆" }, // nf-md-compass
  design: { nerd: "\u{F03D8}", ascii: "✱" }, // nf-md-palette
  code:   { nerd: "\u{F121}",  ascii: "◇" }, // nf-fa-code
  review: { nerd: "\u{F0349}", ascii: "◉" }, // nf-md-magnify
  test:   { nerd: "\u{F0093}", ascii: "✚" }, // nf-md-flask
  ops:    { nerd: "\u{F0427}", ascii: "▲" }, // nf-oct-rocket
};

// Live store (like the theme's C proxy): roleGlyph reads the current mode, and ThemedApp
// syncs it so a Settings change re-renders every screen.
let mode: IconMode = "nerd";

export function setIconMode(m: IconMode): void {
  mode = m;
}
export function iconMode(): IconMode {
  return mode;
}
export function roleGlyph(capability: Capability): string {
  return ROLE_ICON[capability][mode];
}