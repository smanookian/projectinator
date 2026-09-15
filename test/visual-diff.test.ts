// Visual delta: our zero-dependency PNG decoder reads what Chromium writes; identical
// shots are 0%, a changed region is > 0 and < 100, and the whole thing works end to end
// through renderCheck screenshots of two page versions.

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodePng, pixelDelta, visualDeltaPct } from "../src/visual-diff.js";
import { renderCheck, chromiumAvailable } from "../src/preview.js";

const hasChromium = await chromiumAvailable();

describe("pixelDelta", () => {
  const img = (w: number, h: number, fill: number) => ({ width: w, height: h, data: new Uint8Array(w * h * 4).fill(fill) });
  it("identical → 0, fully different → 1, size mismatch counts the extra area", () => {
    expect(pixelDelta(img(4, 4, 0), img(4, 4, 0))).toBe(0);
    expect(pixelDelta(img(4, 4, 0), img(4, 4, 255))).toBe(1);
    expect(pixelDelta(img(4, 4, 0), img(4, 8, 0))).toBe(0.5); // same top half, extra bottom half
  });
  it("tolerance ignores tiny anti-aliasing differences", () => {
    expect(pixelDelta(img(2, 2, 100), img(2, 2, 110))).toBe(0);
    expect(pixelDelta(img(2, 2, 100), img(2, 2, 130))).toBe(1);
  });
});

describe.skipIf(!hasChromium)("visual delta on real screenshots", () => {
  it("decodes Chromium PNGs; identical pages 0%, a changed block > 0%", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-vdiff-"));
    const page = (color: string) => `<!doctype html><html lang="en"><head><title>x</title></head><body style="margin:0"><div style="width:400px;height:300px;background:${color}"></div><p>text</p></body></html>`;
    try {
      writeFileSync(join(dir, "index.html"), page("#fff"));
      await renderCheck(dir, "index.html", { checksDir: join(dir, ".checks"), checksPrefix: "T-r0" });
      await renderCheck(dir, "index.html", { checksDir: join(dir, ".checks"), checksPrefix: "T-r1" });
      writeFileSync(join(dir, "index.html"), page("#000"));
      await renderCheck(dir, "index.html", { checksDir: join(dir, ".checks"), checksPrefix: "T-r2" });
      const r0 = readFileSync(join(dir, ".checks", "T-r0-1280.png"));
      const r1 = readFileSync(join(dir, ".checks", "T-r1-1280.png"));
      const r2 = readFileSync(join(dir, ".checks", "T-r2-1280.png"));
      const d = decodePng(r0);
      expect(d.width).toBe(1280);
      expect(visualDeltaPct(r0, r1)).toBe(0);
      const changed = visualDeltaPct(r0, r2)!;
      expect(changed).toBeGreaterThan(5);
      expect(changed).toBeLessThan(50); // a 400x300 block on a 1280x900 page ≈ 10%
      expect(visualDeltaPct(undefined, r2)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
