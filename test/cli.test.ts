// The headless CLI: argv parsing, the Node floor check, and the launcher's
// dispatch (exit codes are part of the contract — scripts branch on them).

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseArgv } from "../src/cli.js";
import { installKind, isNewer, notesFor, semverGte } from "../src/update.js";
import { sep } from "node:path";

describe("parseArgv", () => {
  it("separates positionals from --flag value, --flag=value and bare --flag", () => {
    const a = parseArgv(["build", "a", "tip", "calculator", "--budget", "5", "--provider=openai", "--yes", "--json"]);
    expect(a.positional).toEqual(["build", "a", "tip", "calculator"]);
    expect(a.flags).toEqual({ budget: "5", provider: "openai", yes: true, json: true });
  });
  it("a bare flag followed by another flag stays boolean", () => {
    expect(parseArgv(["--dry-run", "--budget", "2"]).flags).toEqual({ "dry-run": true, budget: "2" });
  });
});

describe("semverGte", () => {
  it("compares numerically, not lexically", () => {
    expect(semverGte("22.19.0", "22.19.0")).toBe(true);
    expect(semverGte("22.9.0", "22.19.0")).toBe(false);
    expect(semverGte("24.0.0", "22.19.0")).toBe(true);
    expect(semverGte("21.99.99", "22.19.0")).toBe(false);
  });
});

describe("installKind", () => {
  // `update` may only npm-install over itself when it IS the global install. Getting this wrong
  // means clobbering someone's clone or a project dependency with a global package.
  const g = ["", "usr", "lib", "node_modules"].join(sep);
  it("recognises the global install it may replace", () => {
    expect(installKind([g, "projectinator", "dist", "cli.js"].join(sep), { globalRoot: g })).toBe("npm-global");
  });
  it("treats a project dependency as local, not global", () => {
    const local = ["", "home", "me", "app", "node_modules", "projectinator", "dist", "cli.js"].join(sep);
    expect(installKind(local, { globalRoot: g })).toBe("npm-local");
  });
  it("a checkout outside node_modules is a clone", () => {
    expect(installKind(["", "home", "me", "projectinator", "src", "cli.ts"].join(sep), { globalRoot: g })).toBe("clone");
  });
  it("Docker wins over any path shape", () => {
    expect(installKind([g, "projectinator", "dist", "cli.js"].join(sep), { docker: true, globalRoot: g })).toBe("docker");
  });
  it("npx and mise installs are told their own command, not npm-local's", () => {
    expect(installKind(["", "home", "me", ".npm", "_npx", "ab12", "node_modules", "projectinator", "dist", "cli.js"].join(sep), { globalRoot: g })).toBe("npx");
    expect(installKind(["", "home", "me", ".local", "share", "mise", "installs", "npm-projectinator", "0.28.0", "lib", "node_modules", "projectinator", "dist", "cli.js"].join(sep), { globalRoot: g })).toBe("mise");
  });
});

describe("update offers", () => {
  it("only a newer stable version", () => {
    expect(isNewer("0.29.0", "0.28.0")).toBe(true);
    expect(isNewer("0.28.10", "0.28.9")).toBe(true);
    expect(isNewer("0.28.0", "0.28.0")).toBe(false);
    expect(isNewer("0.27.5", "0.28.0")).toBe(false);
    expect(isNewer("0.29.0-beta.1", "0.28.0")).toBe(false);
    expect(isNewer("garbage", "0.28.0")).toBe(false);
  });
  it("reads one version's notes from the CHANGELOG as plain lines", () => {
    const log = "# Changelog\n\n## 0.29.0 — 2026-12-01\n\n### Added\n- **Board** edits in `place`.\n\n\n- Second.\n\n## 0.28.0\n- old\n";
    expect(notesFor(log, "0.29.0")).toEqual(["Added", "• Board edits in place.", "", "• Second."]);
    expect(notesFor(log, "0.30.0")).toEqual([]);
  });
});

describe("launcher (bin/projectinator.mjs)", () => {
  const run = (...args: string[]) => spawnSync(process.execPath, ["bin/projectinator.mjs", ...args], { encoding: "utf8" });
  it("--version prints package.json's version and exits 0", () => {
    const { version } = JSON.parse(readFileSync("package.json", "utf8"));
    const r = run("--version");
    expect(r.stdout.trim()).toBe(version);
    expect(r.status).toBe(0);
  });
  it("--help lists every command", () => {
    const r = run("--help");
    for (const c of ["doctor", "build", "projects", "models", "update"]) expect(r.stdout).toContain(`projectinator ${c}`);
    expect(r.status).toBe(0);
  });
  it("unknown commands and options exit 2 without booting the app", () => {
    expect(run("bogus").status).toBe(2);
    expect(run("--bogus").status).toBe(2);
    expect(run("bogus").stderr).toMatch(/unknown command/);
    expect(run("--bogus").stderr).toMatch(/unknown option/);
  });
});

describe.skipIf(!existsSync("dist/cli.js"))("compiled dist (run `npm run compile` first)", () => {
  it("the launcher runs dist in-process: no tsx on the command line, and the package ships no src", () => {
    const r = spawnSync(process.execPath, ["bin/projectinator.mjs", "models"], { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Roster as it will run now");
    const files = JSON.parse(readFileSync("package.json", "utf8")).files as string[];
    expect(files).toContain("dist");
    expect(files).not.toContain("src");
  });
  it("the compiled tree resolves every registry pick (import graph is intact)", async () => {
    const r = spawnSync(process.execPath, ["-e", `
      const { REGISTRY } = await import("./dist/registry.js");
      const { piRuntime, resolvePiModel } = await import("./dist/executor.js");
      const rt = await piRuntime();
      for (const e of REGISTRY) resolvePiModel(rt, e.byBackend.api.provider, e.byBackend.api.model);
      console.log("ok", REGISTRY.length);
    `, "--input-type=module"], { encoding: "utf8" });
    expect(r.stdout.trim()).toMatch(/^ok \d+$/);
  });
});

describe("doctor severity", () => {
  // A healthy install must report zero warnings. One provider key is enough to run everything,
  // so the other providers and local models are alternatives, not gaps — counting them as
  // warnings trains you to ignore the count.
  const run = (env: Record<string, string>) =>
    spawnSync(process.execPath, ["bin/projectinator.mjs", "doctor"], {
      encoding: "utf8",
      env: { ...process.env, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "", ...env },
    });

  it("one key is enough: no key or provider warnings, exit 0", () => {
    const r = run({ OPENROUTER_API_KEY: "sk-test-doctor" });
    // Headless Chromium is a property of the machine running the tests, not of the key setup:
    // it warns on a host without `npx playwright install chromium`, so it's left out here.
    const warnings = r.stdout.split("\n").filter((l) => /^\s*!/.test(l) && !l.includes("Headless Chromium"));
    expect(warnings).toEqual([]);
    expect(r.stdout).toMatch(/Ready/);
    expect(r.status).toBe(0);
  });

  it("no provider at all is a blocking problem, not an optional extra", () => {
    const r = run({});
    expect(r.stdout).toMatch(/blocking problem/);
    expect(r.stdout).toMatch(/warning/);
    expect(r.status).toBe(1);
  });
});
