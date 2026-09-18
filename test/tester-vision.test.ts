// The Tester renders the app at three viewports but only ever read text about it, so a verdict
// could not account for anything you can only SEE. Screenshots now go to the model as images.
// This covers the loader: the token budget, the viewport cap, and that a missing file can never
// fail a test task.

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadScreenshots } from "../src/roles.js";

/** A real 2x2 PNG — resizeImage decodes it, so a fake byte string wouldn't exercise the path. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYkBBv4zAAAmCwIBaN9CmgAAAABJRU5ErkJggg==",
  "base64",
);

function shots(n: number): { dir: string; paths: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "shots-"));
  const paths = Array.from({ length: n }, (_, i) => {
    const p = join(dir, `shot-${i}.png`);
    writeFileSync(p, PNG);
    return p;
  });
  return { dir, paths };
}

describe("screenshots as model input", () => {
  it("returns base64 image content the model can read", async () => {
    const { dir, paths } = shots(1);
    try {
      const images = await loadScreenshots(paths);
      expect(images).toHaveLength(1);
      expect(images[0]!.type).toBe("image");
      expect(images[0]!.mimeType).toMatch(/^image\//);
      expect(images[0]!.data.length).toBeGreaterThan(0);
      expect(() => Buffer.from(images[0]!.data, "base64")).not.toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("sends at most one image per viewport — more is cost without signal", async () => {
    const { dir, paths } = shots(7);
    try {
      expect(await loadScreenshots(paths)).toHaveLength(3);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("a missing screenshot is skipped, never thrown", async () => {
    const { dir, paths } = shots(1);
    try {
      const images = await loadScreenshots([join(dir, "gone.png"), ...paths]);
      expect(images).toHaveLength(1); // the real one still arrives
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("no screenshots means no images, so the visual pass is skipped", async () => {
    expect(await loadScreenshots([])).toEqual([]);
  });
});
