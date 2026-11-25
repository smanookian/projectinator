// Theme system: the family palettes (shared with Musinator / Todonator / Calinator), the
// contrast guarantee, match-omarchy parsing, and the live `C` proxy.
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { BUILTIN, DEFAULT_ID, OMARCHY_ID, resolveTheme, setActiveTheme, activeTheme, C, contrastReport, loadOmarchyTheme } from "../src/tui/theme.js";

describe("theme", () => {
  it("defaults to catppuccin-mocha like the other apps; unknown ids fall back to it", () => {
    expect(DEFAULT_ID).toBe("catppuccin-mocha");
    expect(resolveTheme(undefined).id).toBe(DEFAULT_ID);
    expect(resolveTheme("dark").id).toBe(DEFAULT_ID);
    expect(resolveTheme("nord").id).toBe("nord");
  });

  it("every built-in theme passes every contrast pair it draws", () => {
    const failures = BUILTIN.flatMap((t) =>
      contrastReport(t).filter(([, got, min]) => got < min).map(([pair, got, min]) => `${t.id} ${pair}: ${got.toFixed(2)} < ${min}`),
    );
    expect(failures).toEqual([]);
  });

  it("match-omarchy reads colors.toml, and falls back to alacritty.toml", () => {
    const dir = mkdtempSync(join(tmpdir(), "omarchy-theme-"));
    try {
      writeFileSync(join(dir, "alacritty.toml"), `[colors.primary]\nbackground = "#101010"\nforeground = "#e0e0e0"\n[colors.normal]\nblue = "#7799ff"\nred = "#ff5555"\n`);
      const fromAlacritty = loadOmarchyTheme(dir)!;
      expect(fromAlacritty.id).toBe(OMARCHY_ID);
      expect(fromAlacritty.bg).toBe("#101010");
      expect(fromAlacritty.accent).toBe("#7799ff");

      writeFileSync(join(dir, "colors.toml"), `mode = "dark"\naccent = "#FF8866" # orange\nbackground = "#111110"\nforeground = "#e8dec6"\nselection = "#3a2a1c"\n`);
      const fromColors = loadOmarchyTheme(dir)!;
      expect(fromColors.bg).toBe("#111110");
      expect(fromColors.accent).toBe("#ff8866");
      expect(contrastReport(fromColors).filter(([, got, min]) => got < min)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("C follows setActiveTheme live (the proxy reads the current palette)", () => {
    const before = activeTheme();
    setActiveTheme(resolveTheme("gruvbox-dark"));
    expect(C.accent).toBe(resolveTheme("gruvbox-dark").accent);
    setActiveTheme(resolveTheme("nord"));
    expect(C.accent).toBe(resolveTheme("nord").accent);
    setActiveTheme(before); // restore shared module state for other tests
  });
});
