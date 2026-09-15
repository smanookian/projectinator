// The headless CLI: argv parsing, the Node floor check, and the launcher's
// dispatch (exit codes are part of the contract — scripts branch on them).

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgv, semverGte } from "../src/cli.js";

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
    for (const c of ["doctor", "build", "projects", "models"]) expect(r.stdout).toContain(`projectinator ${c}`);
    expect(r.status).toBe(0);
  });
  it("unknown commands and options exit 2 without booting the app", () => {
    expect(run("bogus").status).toBe(2);
    expect(run("--bogus").status).toBe(2);
    expect(run("bogus").stderr).toMatch(/unknown command/);
    expect(run("--bogus").stderr).toMatch(/unknown option/);
  });
});
