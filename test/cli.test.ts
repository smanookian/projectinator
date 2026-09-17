// The headless CLI: argv parsing, the Node floor check, and the launcher's
// dispatch (exit codes are part of the contract — scripts branch on them).

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { installKind, parseArgv, semverGte } from "../src/cli.js";
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
