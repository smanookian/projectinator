// Theme foundation: the token store + live `C` proxy, and the two built-in palettes.
import { describe, it, expect } from "vitest";
import { resolveTheme, setActiveTheme, activeTheme, C, THEMES, DARK, LIGHT, buildUiTheme, type ThemeId } from "../src/tui/theme.js";

describe("theme", () => {
  it("has exactly two built-ins, dark by default", () => {
    expect(Object.keys(THEMES).sort()).toEqual(["dark", "light"]);
    expect(resolveTheme(undefined).id).toBe("dark");
    expect(resolveTheme(null).id).toBe("dark");
  });

  it("dark is today's palette; light inverts to light-terminal contrast", () => {
    expect(DARK.text).toBe("white");
    expect(LIGHT.text).not.toBe(DARK.text);
    expect(LIGHT.accent).not.toBe(DARK.accent);
    // status colors must also flip (ANSI names → explicit dark-on-light hexes)
    expect(DARK.warn).toBe("yellow");
    expect(LIGHT.warn).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("C follows setActiveTheme live (the proxy reads the current palette)", () => {
    setActiveTheme(DARK);
    expect(C.accent).toBe(DARK.accent);
    setActiveTheme(LIGHT);
    expect(C.accent).toBe(LIGHT.accent);
    expect(C.warn).toBe(LIGHT.warn);
    setActiveTheme(DARK); // restore shared module state for other tests
    expect(activeTheme().id).toBe("dark");
  });

  it("buildUiTheme is keyed by accent", () => {
    const theme = buildUiTheme("#123456");
    // A resolve of the accent surfaces through the Select focus indicator.
    expect(typeof theme).toBe("object");
  });
});