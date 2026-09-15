// Model pricing table. Rates USD per 1,000,000 tokens — copied verbatim from Pi's
// bundled catalog (pi-coding-agent 0.85.1, Sept 2026); test/executor.test.ts pins every
// entry against it. Shape mirrors Pi's models.json `cost` block.

import type { Model } from "./types.js";
import { findOpenRouterModel } from "./openrouter.js";
import { getLocalModels } from "./local-models.js";

export const MODELS: Record<string, Model> = {
  // ---- OpenAI: GPT-5.6 family (prices cut Sept 2026; past 272k input costs 2x) ----
  "gpt-5.6-sol": {
    id: "gpt-5.6-sol",
    provider: "openai",
    name: "GPT-5.6 Sol",
    contextWindow: 272_000,
    cost: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5, tiers: [{ inputTokensAbove: 272_000, input: 8, output: 30, cacheRead: 0.8, cacheWrite: 10 }] },
  },
  "gpt-5.6-terra": {
    id: "gpt-5.6-terra",
    provider: "openai",
    name: "GPT-5.6 Terra",
    contextWindow: 272_000,
    cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5, tiers: [{ inputTokensAbove: 272_000, input: 4, output: 18, cacheRead: 0.4, cacheWrite: 5 }] },
  },
  "gpt-5.6-luna": {
    id: "gpt-5.6-luna",
    provider: "openai",
    name: "GPT-5.6 Luna",
    contextWindow: 272_000,
    cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25, tiers: [{ inputTokensAbove: 272_000, input: 0.4, output: 1.8, cacheRead: 0.04, cacheWrite: 0.5 }] },
  },

  // ---- Anthropic: Claude ----
  "claude-fable-5-1": {
    id: "claude-fable-5-1",
    provider: "anthropic",
    name: "Claude Fable 5.1",
    contextWindow: 1_000_000,
    cost: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  },
  "claude-fable-5": {
    id: "claude-fable-5",
    provider: "anthropic",
    name: "Claude Fable 5",
    contextWindow: 1_000_000,
    cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  },
  "claude-opus-5": {
    id: "claude-opus-5",
    provider: "anthropic",
    name: "Claude Opus 5",
    contextWindow: 1_000_000,
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  },
  "claude-opus-4-8": {
    id: "claude-opus-4-8",
    provider: "anthropic",
    name: "Claude Opus 4.8",
    contextWindow: 1_000_000,
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  },
  "claude-sonnet-5": {
    id: "claude-sonnet-5",
    provider: "anthropic",
    name: "Claude Sonnet 5",
    contextWindow: 1_000_000,
    cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  },
  "claude-sonnet-4-6": {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    name: "Claude Sonnet 4.6",
    contextWindow: 1_000_000,
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  },
  "claude-haiku-4-5": {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    name: "Claude Haiku 4.5",
    contextWindow: 200_000,
    cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  },

  // ---- Google: Gemini ----
  // NOTE: ids match Pi's built-in registry exactly (provider "google"), so they
  // resolve directly via ModelRegistry.find() with no alias layer.
  "gemini-3.1-pro-preview": {
    id: "gemini-3.1-pro-preview",
    provider: "google",
    name: "Gemini 3.1 Pro",
    contextWindow: 1_000_000,
    cost: {
      input: 2,
      output: 12,
      cacheRead: 0.2,
      cacheWrite: 2.5,
      // Google charges more past 200k input tokens.
      tiers: [{ inputTokensAbove: 200_000, input: 4, output: 18, cacheRead: 0.4, cacheWrite: 5 }],
    },
  },
  "gemini-3.8-flash": {
    id: "gemini-3.8-flash",
    provider: "google",
    name: "Gemini 3.8 Flash",
    contextWindow: 1_000_000,
    cost: { input: 0.75, output: 3.75, cacheRead: 0.075 },
  },
  "gemini-3-flash-preview": {
    id: "gemini-3-flash-preview",
    provider: "google",
    name: "Gemini 3 Flash",
    contextWindow: 1_000_000,
    cost: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0.625 },
  },

  // ---- OpenRouter (one key → frontier models). ids are Pi's OpenRouter-catalog
  // slugs (vendor/model). Pricing mirrors the underlying model (OpenRouter passes
  // it through, ~small margin); ACTUAL cost still comes from Pi per run.
  "anthropic/claude-opus-5": {
    id: "anthropic/claude-opus-5",
    provider: "openrouter",
    name: "Claude Opus 5 (OpenRouter)",
    contextWindow: 1_000_000,
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  },
  "anthropic/claude-opus-4.8": {
    id: "anthropic/claude-opus-4.8",
    provider: "openrouter",
    name: "Claude Opus 4.8 (OpenRouter)",
    contextWindow: 1_000_000,
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  },
  "anthropic/claude-sonnet-5": {
    id: "anthropic/claude-sonnet-5",
    provider: "openrouter",
    name: "Claude Sonnet 5 (OpenRouter)",
    contextWindow: 1_000_000,
    cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  },
  "anthropic/claude-sonnet-4.6": {
    id: "anthropic/claude-sonnet-4.6",
    provider: "openrouter",
    name: "Claude Sonnet 4.6 (OpenRouter)",
    contextWindow: 1_000_000,
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  },
  "google/gemini-3.8-flash": {
    id: "google/gemini-3.8-flash",
    provider: "openrouter",
    name: "Gemini 3.8 Flash (OpenRouter)",
    contextWindow: 1_000_000,
    cost: { input: 0.75, output: 3.75, cacheRead: 0.075 },
  },
  "openai/gpt-5.6-luna": {
    id: "openai/gpt-5.6-luna",
    provider: "openrouter",
    name: "GPT-5.6 Luna (OpenRouter)",
    contextWindow: 1_050_000,
    cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
  },
};

/** A configured local model: $0, provider "local". Checked before the OpenRouter guess so a
 *  local id that happens to contain "/" isn't mispriced. */
function localModel(id: string): Model | undefined {
  if (!getLocalModels()?.models.includes(id)) return undefined;
  return { id, provider: "local", name: `${id} (local)`, contextWindow: 32_000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
}

export function getModel(id: string): Model {
  const m = MODELS[id] ?? localModel(id);
  if (m) return m;
  // OpenRouter slugs (vendor/model) aren't in the static table — price them from
  // the OpenRouter catalog (live cache or Pi's built-in list). Fall back to a
  // rough estimate so a build never crashes on an unpriced model (actual cost
  // still comes from Pi per run).
  if (id.includes("/")) {
    const or = findOpenRouterModel(id);
    if (or) return { ...or, provider: "openrouter" };
    return { id, provider: "openrouter", name: id, contextWindow: 200_000, cost: { input: 1, output: 3, cacheRead: 0.1, cacheWrite: 1.25 } };
  }
  throw new Error(`Unknown model id: "${id}". Add it to src/models.ts, or configure it under Settings → Local models.`);
}
