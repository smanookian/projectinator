// The STACKS.md milestone: a real Vite project goes through prepareForTest (npm ci
// --ignore-scripts, vite build) and the tester renders dist/ in Chromium. Also: a broken
// build is reported with its output, and a second prepare is a cache hit. Needs the npm
// registry once; skipped offline or without Chromium (the static path is tested elsewhere).

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareForTest } from "../src/prepare.js";
import { PROFILES } from "../src/stack.js";
import { renderCheck, chromiumAvailable } from "../src/preview.js";
import { buildCheckTool } from "../src/roles.js";

const hasChromium = await chromiumAvailable();
const online = spawnSync("npm", ["view", "vite", "version", "--fetch-timeout=8000"], { encoding: "utf8" }).status === 0;
const none = undefined as never;

function viteProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-vite-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    name: "smoke", private: true, type: "module",
    scripts: { dev: "vite", build: "vite build", preview: "vite preview" },
    devDependencies: { vite: "^6" },
  }, null, 2));
  writeFileSync(join(dir, "index.html"), `<!doctype html><html lang="en"><head><title>Vite smoke</title></head><body><h1 id="h">…</h1><script type="module" src="/src/main.ts"></script></body></html>`);
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "main.ts"), `const h = document.getElementById("h") as HTMLElement; h.textContent = "VITE-BUILT-MARKER " + (1 + 1);`);
  // A lockfile is required for npm ci; generate it once (network).
  const lock = spawnSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: dir, encoding: "utf8", timeout: 120_000 });
  if (lock.status !== 0) throw new Error(`lockfile: ${lock.stderr}`);
  return dir;
}

describe.skipIf(!online || !hasChromium)("vite stack through the tester", () => {
  it("installs, builds, serves dist/, renders in Chromium; the second prepare is cached; a broken build is reported", async () => {
    const dir = viteProject();
    try {
      const p1 = prepareForTest(dir, PROFILES.vite);
      expect(p1.ok).toBe(true);
      expect(p1.serveDir).toBe(join(dir, "dist"));
      expect(p1.log).toEqual(["npm ci --ignore-scripts --no-audit --no-fund → ok", "npm run build → ok"]);
      expect(existsSync(join(dir, "dist", "index.html"))).toBe(true);

      // The tester renders the BUILT app (module script compiled), no double-click check.
      const r = await renderCheck(dir, "index.html", { serveDir: p1.serveDir, doubleClick: false });
      expect(r.ok).toBe(true);
      expect(r.text).toContain("VITE-BUILT-MARKER 2");
      expect(r.doubleClickBroken).toBe(false);

      // Cache: nothing changed → nothing runs.
      expect(prepareForTest(dir, PROFILES.vite).log).toEqual(["install: up to date (cached)", "build: up to date (cached)"]);

      // Break the source → build fails with the compiler's output, install still cached.
      writeFileSync(join(dir, "src", "main.ts"), `import { nope } from "./missing";\nnope();`);
      const p3 = prepareForTest(dir, PROFILES.vite);
      expect(p3.ok).toBe(false);
      expect(p3.failedStep).toBe("build");
      expect(p3.log[0]).toBe("install: up to date (cached)");
      expect(p3.output).toMatch(/missing/);

      // The check_app tool surfaces that as a high-severity finding and still counts as "ran".
      const tool = buildCheckTool(dir, true, "T-1-r0", PROFILES.vite);
      const reply = await tool.tool.execute("c", {}, none, none, none);
      const text = String((reply.content[0] as { text?: unknown }).text);
      expect(text).toMatch(/failed to build — this is a HIGH-severity bug/);
      expect(text).toMatch(/missing/);
      expect(tool.rendered()).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 240_000);
});

describe("prepareForTest without a build stack", () => {
  it("static is a no-op; a build stack without package.json fails clearly", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-static-"));
    try {
      expect(prepareForTest(dir, PROFILES.static)).toEqual({ ok: true, serveDir: dir, log: [] });
      const r = prepareForTest(dir, PROFILES.vite);
      expect(r.ok).toBe(false);
      expect(r.output).toMatch(/package\.json is missing/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
