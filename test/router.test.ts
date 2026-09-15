import { describe, it, expect } from "vitest";
import { route, routeBacklog, resolveBackend, DEFAULT_POLICY } from "../src/router.js";
import { findEntry } from "../src/registry.js";
import type { RoutingPolicy, Task } from "../src/types.js";

const designTask: Task = {
  id: "D-1", title: "design", capability: "design", difficulty: "high",
  estTokens: { input: 20_000, output: 15_000 },
};

const policy = (over: Partial<RoutingPolicy> = {}): RoutingPolicy => ({ ...DEFAULT_POLICY, ...over });

describe("difficulty -> tier", () => {
  it("maps via policy", () => {
    const p = DEFAULT_POLICY.difficultyToTier;
    expect(p.trivial).toBe("fast");
    expect(p.high).toBe("high");
  });
});

describe("backend resolution", () => {
  it("cost-first picks web (free subscription)", () => {
    expect(resolveBackend(policy({ backendMode: "cost-first" }), designTask)).toBe("web");
  });
  it("explicit api/web honored", () => {
    expect(resolveBackend(policy({ backendMode: "api" }), designTask)).toBe("api");
    expect(resolveBackend(policy({ backendMode: "web" }), designTask)).toBe("web");
  });
  it('"ask" requires a chooser and uses its answer', () => {
    expect(() => resolveBackend(policy({ backendMode: "ask" }), designTask)).toThrow();
    const b = resolveBackend(policy({ backendMode: "ask" }), designTask, { chooseBackend: () => "api" });
    expect(b).toBe("api");
  });
});

// The registry is data that changes every roster refresh; assert the ROUTING
// behaviour (backend picks its own column, tier resolves) against what it says now.
const pick = (cap: Task["capability"], tier: "fast" | "mid" | "high", backend: "web" | "api") =>
  findEntry(cap, tier).entry.byBackend[backend].model;

describe("backend-conditional model selection", () => {
  it("web and api backends route design to their own registry columns", () => {
    const web = route(designTask, { policy: policy({ backendMode: "web" }) });
    const api = route(designTask, { policy: policy({ backendMode: "api" }) });
    expect(web.backend).toBe("web");
    expect(web.model.id).toBe(pick("design", "high", "web"));
    expect(api.model.id).toBe(pick("design", "high", "api"));
    expect(web.model.id).not.toBe(api.model.id); // the whole point of two columns
  });
  it("code/high follows the registry on both backends", () => {
    const codeTask: Task = { ...designTask, id: "C-1", capability: "code" };
    expect(route(codeTask, { policy: policy({ backendMode: "web" }) }).model.id).toBe(pick("code", "high", "web"));
    expect(route(codeTask, { policy: policy({ backendMode: "api" }) }).model.id).toBe(pick("code", "high", "api"));
  });
});

describe("per-role model override on API", () => {
  it("uses chooseModel when entry.ask and backend is api", () => {
    const d = route(designTask, {
      policy: policy({ backendMode: "api" }),
      prompts: { chooseModel: () => "gpt-5.6-terra" },
    });
    expect(d.model.id).toBe("gpt-5.6-terra");
    expect(d.reasons.some((r) => r.includes("overrode"))).toBe(true);
  });
  it("ignores chooseModel on web backend (ask is API-only)", () => {
    const d = route(designTask, {
      policy: policy({ backendMode: "web" }),
      prompts: { chooseModel: () => "gpt-5.6-terra" },
    });
    expect(d.model.id).toBe(pick("design", "high", "web"));
  });
});

describe("tier fallback", () => {
  it("test capability only defined at fast tier — high difficulty still resolves", () => {
    const testTask: Task = { ...designTask, id: "Q-1", capability: "test", difficulty: "high" };
    const d = route(testTask, { policy: policy({ backendMode: "api" }) });
    expect(d.tier).toBe("fast");
    expect(d.model.id).toBe(pick("test", "fast", "api"));
    expect(d.reasons.some((r) => r.includes("fell back"))).toBe(true);
  });
  it("findEntry marks exact vs fallback", () => {
    expect(findEntry("code", "high").exactTier).toBe(true);
    expect(findEntry("test", "high").exactTier).toBe(false);
  });
});

describe("budget cap", () => {
  it("flags overCap once running total crosses the cap", () => {
    const pricey: Task = {
      id: "X-1", title: "big", capability: "code", difficulty: "high",
      estTokens: { input: 1_000_000, output: 200_000 }, // Fable 5 web: $10 + $10 = $20
    };
    const d = route(pricey, { policy: policy({ backendMode: "web", budgetCapUSD: 15 }) });
    expect(d.cost).toBeGreaterThan(15);
    expect(d.overCap).toBe(true);
  });
});

describe("routeBacklog threads the running total", () => {
  it("running total is monotonic and equals the last decision's total", () => {
    const tasks: Task[] = [
      { id: "A", title: "a", capability: "plan", difficulty: "medium", estTokens: { input: 10_000, output: 5_000 } },
      { id: "B", title: "b", capability: "test", difficulty: "trivial", estTokens: { input: 80_000, output: 15_000 } },
    ];
    const ds = routeBacklog(tasks, { policy: policy({ backendMode: "api" }) });
    expect(ds[1]!.runningTotal).toBeGreaterThan(ds[0]!.runningTotal);
    expect(ds[1]!.runningTotal).toBeCloseTo(ds[0]!.cost + ds[1]!.cost, 2);
  });
});
