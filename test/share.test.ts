// shareBuild: archives the built files only (no build-state, no .git), zip when the
// system has it, tar.gz otherwise. Verified by listing the archive with the same tool.

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { shareBuild } from "../src/tui/engine.js";

describe("shareBuild", () => {
  it("archives built files and excludes project bookkeeping", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-share-"));
    const dir = join(root, "my-site");
    mkdirSync(join(dir, "css"), { recursive: true });
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, "index.html"), "<h1>hi</h1>");
    writeFileSync(join(dir, "css", "site.css"), "body{}");
    writeFileSync(join(dir, "build-state.json"), "{}");
    writeFileSync(join(dir, ".git", "HEAD"), "x");
    try {
      const r = shareBuild(dir);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(existsSync(r.path)).toBe(true);
      expect(basename(r.path)).toBe(r.format === "zip" ? "my-site.zip" : "my-site.tar.gz");
      const list = r.format === "zip"
        ? spawnSync("unzip", ["-Z1", r.path], { encoding: "utf8" }).stdout
        : spawnSync("tar", ["-tzf", r.path], { encoding: "utf8" }).stdout;
      expect(list).toMatch(/index\.html/);
      expect(list).toMatch(/css\/site\.css/);
      expect(list).not.toMatch(/build-state\.json/);
      expect(list).not.toMatch(/\.git\//);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
