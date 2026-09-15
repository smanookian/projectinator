// Page-quality facts: WCAG contrast math against reference values (no browser), and the
// in-page sweep against real Chromium — a fixture with every defect vs a clean page.

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contrastRatio, parseRgb, describeFacts, WCAG_AA } from "../src/a11y.js";
import { renderCheck, chromiumAvailable } from "../src/preview.js";

describe("contrast math (WCAG 2.x)", () => {
  it("matches the reference ratios", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 1);
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 1); // symmetric
    expect(contrastRatio([119, 119, 119], [255, 255, 255])).toBeCloseTo(4.48, 2); // #777 on white: just under AA
    expect(contrastRatio([118, 118, 118], [255, 255, 255])).toBeGreaterThan(WCAG_AA); // #767676: the classic AA-passing grey
  });
  it("parses rgb/rgba and treats fully transparent as absent", () => {
    expect(parseRgb("rgb(1, 2, 3)")).toEqual([1, 2, 3]);
    expect(parseRgb("rgba(1, 2, 3, 0.5)")).toEqual([1, 2, 3]);
    expect(parseRgb("rgba(0, 0, 0, 0)")).toBeUndefined();
    expect(parseRgb("transparent")).toBeUndefined();
  });
  it("describeFacts is silent for a clean page and names each defect otherwise", () => {
    expect(describeFacts({ lang: true, title: true, h1: true, imagesWithoutAlt: 0, unlabeledControls: 0, minContrast: 7, lowContrastSamples: [] })).toEqual([]);
    const lines = describeFacts({ lang: false, title: false, h1: false, imagesWithoutAlt: 2, unlabeledControls: 1, minContrast: 2.1, lowContrastSamples: ["p (2.1:1) \"hi\""] });
    expect(lines).toHaveLength(6);
    expect(lines.join("\n")).toMatch(/2 images without alt/);
    expect(lines.join("\n")).toMatch(/worst 2\.1:1/);
  });
});

const hasChromium = await chromiumAvailable();

describe.skipIf(!hasChromium)("page facts in a real browser", () => {
  const fixture = (html: string) => {
    const dir = mkdtempSync(join(tmpdir(), "pi-a11y-"));
    writeFileSync(join(dir, "index.html"), html);
    return dir;
  };

  it("finds every defect in a bad page", async () => {
    const dir = fixture(`<!doctype html><html><head></head><body style="background:#fff">
      <p style="color:#999">Light grey text that fails AA</p>
      <img src="x.png"><img src="y.png" alt="">
      <input type="text"><select><option>a</option></select>
      </body></html>`);
    try {
      const f = (await renderCheck(dir)).facts!;
      expect(f.lang).toBe(false);
      expect(f.title).toBe(false);
      expect(f.h1).toBe(false);
      expect(f.imagesWithoutAlt).toBe(1); // alt="" is a deliberate decorative marker
      expect(f.unlabeledControls).toBe(2);
      expect(f.minContrast).toBeLessThan(WCAG_AA);
      expect(f.lowContrastSamples[0]).toMatch(/^p \(/);
      expect(describeFacts(f)).toHaveLength(6);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("is clean for a well-formed page", async () => {
    const dir = fixture(`<!doctype html><html lang="en"><head><title>Good</title></head><body style="background:#fff;color:#222">
      <h1>Heading</h1><p>Readable body text.</p>
      <img src="x.png" alt="A thing"><label for="n">Name</label><input id="n"><input aria-label="Email">
      </body></html>`);
    try {
      const f = (await renderCheck(dir)).facts!;
      expect(describeFacts(f)).toEqual([]);
      expect(f.minContrast).toBeGreaterThan(WCAG_AA);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
