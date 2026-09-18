// Building the same idea twice must not land on the first build's folder: the second run used to
// overwrite build-state.json (task list, costs, outcomes) and write its code over the first's
// files. An empty backlog keeps this free — the orchestrator has nothing to execute.

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { startBuild, tuiRoot, slugify, listProjects } from "../src/tui/engine.js";
import { lockRegistryToProvider } from "../src/roles.js";

const IDEA = "a collision probe app";
const opts = {
  concurrency: 1,
  budgetCapUSD: 1,
  taskLimits: { timeoutMs: 0, costCapUSD: 0 },
  onEvent: () => {},
  mode: "auto" as const,
};
const plan = { tasks: [], provider: "openrouter" as const, modelId: "m", estCost: 0, registry: lockRegistryToProvider("openrouter") };

afterEach(() => {
  for (const p of listProjects()) if (p.idea === IDEA || p.slug.startsWith(slugify(IDEA))) rmSync(p.dir, { recursive: true, force: true });
});

describe("a new build never reuses an existing project folder", () => {
  it("the second build of the same idea gets its own directory", async () => {
    const first = startBuild(IDEA, plan, opts);
    await first.promise;
    const second = startBuild(IDEA, plan, opts);
    await second.promise;

    expect(second.workspace).not.toBe(first.workspace);
    expect(existsSync(join(first.workspace, "build-state.json")), "the first build's state was destroyed").toBe(true);
    expect(basename(second.workspace)).toBe(`${slugify(IDEA)}-2`);
  });

  it("an unrelated folder already occupying the slug is left alone", async () => {
    const squatter = join(tuiRoot(), slugify(IDEA));
    mkdirSync(squatter, { recursive: true });
    const h = startBuild(IDEA, plan, opts);
    await h.promise;
    expect(h.workspace).not.toBe(squatter);
    expect(existsSync(join(squatter, "build-state.json"))).toBe(false);
  });
});
