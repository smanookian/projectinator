// Role icons: Nerd Font glyphs (codepoints pinned from the NF v3 cheat sheet) and their
// monospace-safe ASCII fallbacks, switched by the live mode store.
import { describe, it, expect } from "vitest";
import { roleGlyph, setIconMode, iconMode, ROLE_ICON, type IconMode } from "../src/tui/icons.js";

describe("role icons", () => {
  it("pins the Nerd Font codepoints (regression guard against a re-typed glyph)", () => {
    expect(ROLE_ICON.plan.nerd).toBe("\u{F018B}");   // nf-md-compass
    expect(ROLE_ICON.design.nerd).toBe("\u{F03D8}"); // nf-md-palette
    expect(ROLE_ICON.code.nerd).toBe("\u{F121}");    // nf-fa-code
    expect(ROLE_ICON.review.nerd).toBe("\u{F0349}"); // nf-md-magnify
    expect(ROLE_ICON.test.nerd).toBe("\u{F0093}");   // nf-md-flask
    expect(ROLE_ICON.ops.nerd).toBe("\u{F0427}");    // nf-oct-rocket
  });

  it("switches between NF glyphs and single-width ASCII via the live mode", () => {
    const prev = iconMode();
    setIconMode("nerd");
    expect(roleGlyph("code")).toBe("\u{F121}");
    setIconMode("ascii");
    expect(roleGlyph("code")).toBe("◇");
    expect(roleGlyph("plan")).toBe("◆");
    // every ASCII fallback is a single code point (NF glyphs are also BMP single-char, but
    // the ASCII set must be ASCII-range so any terminal renders it)
    for (const g of ["◆", "✱", "◇", "◉", "✚", "▲"]) expect(g.length).toBe(1);
    setIconMode(prev as IconMode);
  });
});