// importProject: an existing folder becomes a project — files copied (junk dirs skipped),
// empty backlog with status "complete", git-initialised — and the PM sees the real files.

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importProject, buildProjectContext, listProjects } from "../src/tui/engine.js";
import { loadState } from "../src/build-state.js";

const made: string[] = [];
afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });

function sourceFolder(): string {
  const src = mkdtempSync(join(tmpdir(), "pi-import src-")); // space in the path on purpose
  made.push(src);
  writeFileSync(join(src, "index.html"), "<h1>IMPORTED-MARKER</h1>");
  mkdirSync(join(src, "css"));
  writeFileSync(join(src, "css", "site.css"), "body{}");
  mkdirSync(join(src, "node_modules", "junk"), { recursive: true });
  writeFileSync(join(src, "node_modules", "junk", "x.js"), "");
  mkdirSync(join(src, ".git"));
  writeFileSync(join(src, ".git", "HEAD"), "ref: refs/heads/main");
  return src;
}

describe("importProject", () => {
  it("copies the files, skips node_modules, keeps .git, writes an empty complete backlog, and is planable", () => {
    const src = sourceFolder();
    const r = importProject(`"${src}"`, "my old site"); // quoted, like a dragged path
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    made.push(r.dir);
    expect(r.files).toBe(2);
    expect(readFileSync(join(r.dir, "index.html"), "utf8")).toContain("IMPORTED-MARKER");
    expect(existsSync(join(r.dir, "css", "site.css"))).toBe(true);
    expect(existsSync(join(r.dir, "node_modules"))).toBe(false);
    // an existing .git is preserved verbatim (history + remote survive the import)
    expect(readFileSync(join(r.dir, ".git", "HEAD"), "utf8")).toBe("ref: refs/heads/main");
    const s = loadState(join(r.dir, "build-state.json"))!;
    expect(s.idea).toBe("my old site");
    expect(s.tasks).toEqual([]);
    expect(s.status).toBe("complete");
    expect(listProjects().some((p) => p.dir === r.dir)).toBe(true);
    expect(buildProjectContext(r.dir)).toContain("IMPORTED-MARKER"); // what the PM will see
  });

  it("defaults the label to the folder name", () => {
    const src = sourceFolder();
    const r = importProject(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    made.push(r.dir);
    expect(loadState(join(r.dir, "build-state.json"))!.idea).toMatch(/^Imported: pi-import src-/);
  });

  it("rejects a missing path, a file, and a folder that is already a project", () => {
    expect(importProject("/nope/never").ok).toBe(false);
    const src = sourceFolder();
    expect(importProject(join(src, "index.html")).ok).toBe(false);
    writeFileSync(join(src, "build-state.json"), "{}");
    const r = importProject(src);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/already a Projectinator project/);
  });
});
