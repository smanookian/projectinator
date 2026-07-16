// Model pricing table. Rates USD per 1,000,000 tokens (verified July 2026).
// Shape mirrors Pi's models.json `cost` block so this ports to Pi later.
// cacheRead ~= 0.1x input, cacheWrite ~= 1.25x input (Anthropic-style; approximations
// for models whose exact cache rates we haven't pinned — refine against provider docs).

import type { Model } from "./types.js";

export const MODELS: Record<string, Model> = {
  // ---- OpenAI: GPT-5.6 family ----
  "gpt-5.6-sol": {
    id: "gpt-5.6-sol",
    provider: "openai",
    name: "GPT-5.6 Sol",
    contextWindow: 272_000,
    cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 },
  },
  "gpt-5.6-terra": {
    id: "gpt-5.6-terra",
    provider: "openai",
    name: "GPT-5.6 Terra",
    contextWindow: 272_000,
    cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 3.125 },
  },
  "gpt-5.6-luna": {
    id: "gpt-5.6-luna",
    provider: "openai",
    name: "GPT-5.6 Luna",
    contextWindow: 272_000,
    cost: { input: 1, output: 6, cacheRead: 0.1, cacheWrite: 1.25 },
  },

  // ---- Anthropic: Claude ----
  "claude-fable-5": {
    id: "claude-fable-5",
    provider: "anthropic",
    name: "Claude Fable 5",
    contextWindow: 1_000_000,
    cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  },
  "claude-opus-4-8": {
    id: "claude-opus-4-8",
    provider: "anthropic",
    name: "Claude Opus 4.8",
    contextWindow: 1_000_000,
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
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
  "gemini-3-flash-preview": {
    id: "gemini-3-flash-preview",
    provider: "google",
    name: "Gemini 3 Flash",
    contextWindow: 1_000_000,
    cost: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0.625 },
  },
};

export function getModel(id: string): Model {
  const m = MODELS[id];
  if (!m) throw new Error(`Unknown model id: "${id}". Add it to src/models.ts.`);
  return m;
}
