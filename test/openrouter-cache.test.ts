// A live OpenRouter list fetched before a model came out must not hide it: the picker and the
// newer-model check see the cache plus whatever Pi's built-in list has that the cache lacks.
// Regression: a September cache hid anthropic/claude-opus-5.5, so no "newer model" notice.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import { warmPiCatalog } from "../src/pi-catalog.js";
import { openRouterModels, findOpenRouterModel, openRouterCacheAge } from "../src/openrouter.js";

const fetchedAt = Date.now() - 30 * 24 * 60 * 60 * 1000;

beforeAll(async () => {
  writeFileSync(join(process.env.PROJECTINATOR_HOME!, "openrouter-models.json"), JSON.stringify({
    fetchedAt,
    models: [{ id: "anthropic/claude-opus-5", name: "Anthropic: Claude Opus 5", contextWindow: 1_000_000, cost: { input: 9, output: 99, cacheRead: 0, cacheWrite: 0 } }],
  }));
  await warmPiCatalog();
});

describe("OpenRouter model list", () => {
  it("adds models from Pi's list that an old cache doesn't have", () => {
    const ids = openRouterModels().map((m) => m.id);
    expect(ids).toContain("anthropic/claude-opus-5");
    expect(ids).toContain("anthropic/claude-opus-5.5");
  });
  it("keeps the cache's own entry (its live price) for models it has", () => {
    expect(findOpenRouterModel("anthropic/claude-opus-5")?.cost.input).toBe(9);
  });
  it("reports how old the cache is, so a stale one gets fetched again", () => {
    expect(openRouterCacheAge(fetchedAt + 1000)).toBe(1000);
  });
});
