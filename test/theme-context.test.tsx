// Theme context wiring: ThemedApp primes the live palette from persisted config, preview
// paints without persisting, and set() flips the palette + persists. HOME is redirected before
// the imports because theme-context reads config at module load.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "pi-theme-"));
process.env.HOME = home;

import React, { useEffect } from "react";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { describe, it, expect, afterAll } from "vitest";
import { ThemedApp, useThemeCtx, type ThemeApi } from "../src/tui/theme-context.js";
import { activeTheme, C, resolveTheme } from "../src/tui/theme.js";
import { getTheme, setTheme } from "../src/tui/config.js";

afterAll(() => {
  delete process.env.HOME;
  rmSync(home, { recursive: true, force: true });
});

const g = globalThis as { __ctx?: ThemeApi };

function Probe(): React.ReactElement {
  const ctx = useThemeCtx();
  useEffect(() => {
    g.__ctx = ctx;
  });
  return <Text>{ctx.id}</Text>;
}

const tick = () => new Promise((r) => setTimeout(r, 30));

describe("theme context", () => {
  it("primes from persisted config; preview paints without saving; set() flips and persists", async () => {
    setTheme("nord");
    const { lastFrame, unmount } = render(<ThemedApp><Probe /></ThemedApp>);
    await tick();
    expect(lastFrame()).toContain("nord");
    expect(activeTheme().id).toBe("nord");

    g.__ctx!.previewTheme("dracula");
    await tick();
    expect(C.accent).toBe(resolveTheme("dracula").accent);
    expect(getTheme()).toBe("nord");
    g.__ctx!.previewTheme(null);
    await tick();
    expect(activeTheme().id).toBe("nord");

    g.__ctx!.setTheme("gruvbox-dark");
    await tick();
    expect(activeTheme().id).toBe("gruvbox-dark");
    expect(C.accent).toBe(resolveTheme("gruvbox-dark").accent);
    expect(getTheme()).toBe("gruvbox-dark");
    unmount();
  }, 15_000);
});
