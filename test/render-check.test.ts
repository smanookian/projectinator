// renderCheck viewport screenshots + horizontal-overflow signal, against real headless
// Chromium. Skips when Chromium isn't installed (the tester degrades to PASS* then).

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderCheck, chromiumAvailable, VIEWPORTS } from "../src/preview.js";

const hasChromium = await chromiumAvailable();

describe.skipIf(!hasChromium)("renderCheck viewports", () => {
  it("screenshots every width and flags overflow only where the layout breaks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-render-"));
    // A 700px fixed-width block: overflows a 390px phone, fits tablet and desktop.
    writeFileSync(join(dir, "index.html"), `<!doctype html><html lang="en"><head><title>Fixture</title></head>
      <body><div style="width:700px;background:#eee">Hello from a fixed-width block</div></body></html>`);
    try {
      const r = await renderCheck(dir, "index.html", { checksDir: join(dir, ".checks"), checksPrefix: "T-1-r0" });
      expect(r.ok).toBe(true);
      expect(r.viewports.map((v) => v.width)).toEqual([...VIEWPORTS]);
      for (const v of r.viewports) {
        expect(existsSync(v.screenshotPath)).toBe(true);
        expect(statSync(v.screenshotPath).size).toBeGreaterThan(500);
        expect(v.textLength).toBeGreaterThan(0);
      }
      expect(r.viewports.map((v) => v.overflowsHorizontally)).toEqual([true, false, false]);
      expect(r.viewports[0]!.screenshotPath.endsWith("T-1-r0-390.png")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("a blank page reports textLength 0 at every width; no checksDir → no viewports", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-render-"));
    writeFileSync(join(dir, "index.html"), `<!doctype html><html><body></body></html>`);
    try {
      const r = await renderCheck(dir, "index.html", { checksDir: join(dir, ".checks") });
      expect(r.viewports.every((v) => v.textLength === 0 && !v.overflowsHorizontally)).toBe(true);
      const plain = await renderCheck(dir, "index.html");
      expect(plain.viewports).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
