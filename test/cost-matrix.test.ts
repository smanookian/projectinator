// costMatrix: the same backlog priced per roster option, cheapest first, with the
// option the build will use flagged. Pure — no keys, no network.

import { describe, it, expect } from "vitest";
import { costMatrix, estimateTasks } from "../src/tui/engine.js";
import { REGISTRY } from "../src/registry.js";
import { lockRegistryToProvider } from "../src/roles.js";
import type { Task } from "../src/types.js";

const tasks: Task[] = [
  { id: "D", title: "d", capability: "design", difficulty: "high", dependsOn: [], estTokens: { input: 20_000, output: 8_000 } },
  { id: "C", title: "c", capability: "code", difficulty: "high", dependsOn: ["D"], estTokens: { input: 60_000, output: 14_000 } },
  { id: "T", title: "t", capability: "test", difficulty: "low", dependsOn: ["C"], estTokens: { input: 25_000, output: 2_500 } },
];

describe("costMatrix", () => {
  it("prices every option, sorts cheapest first, and flags the current roster", () => {
    const rows = costMatrix(tasks, REGISTRY, ["anthropic", "openai", "google"]);
    expect(rows.map((r) => r.label).sort()).toEqual(["Anthropic (Claude)", "Best model per role", "Google (Gemini)", "OpenAI (GPT)"].sort());
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.total).toBeGreaterThanOrEqual(rows[i - 1]!.total);
    expect(rows.filter((r) => r.current).map((r) => r.label)).toEqual(["Best model per role"]);
    expect(rows.find((r) => r.current)!.total).toBe(estimateTasks(tasks, REGISTRY).total);
  });

  it("a locked provider is the current row and is not listed twice", () => {
    const rows = costMatrix(tasks, lockRegistryToProvider("anthropic"), ["anthropic", "google"], "anthropic");
    expect(rows.map((r) => r.label).sort()).toEqual(["Anthropic (Claude) (locked)", "Google (Gemini)"]);
    expect(rows.find((r) => r.current)!.label).toBe("Anthropic (Claude) (locked)");
  });

  it("with a single key there is nothing to compare", () => {
    expect(costMatrix(tasks, lockRegistryToProvider("google"), ["google"], "google")).toHaveLength(1);
  });
});
