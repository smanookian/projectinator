// The Model Registry — the swappable brain.
// Maps capability + tier -> model, per backend. Change an entry, re-route everything.
// Seeded from the July-2026 verified roster. This is the ONE file the scout edits.

import type { Capability, RegistryEntry, Tier } from "./types.js";

const TIER_ORDER: Tier[] = ["fast", "mid", "high"];

// Backend intent:
//   web  = user's free web subscription -> use the strongest brand model.
//   api  = metered -> use the cost-appropriate model; ask the user when it matters.
export const REGISTRY: RegistryEntry[] = [
  // --- PLAN (PM / decomposition, long-horizon planning) ---
  {
    capability: "plan",
    tier: "mid",
    byBackend: {
      web: { provider: "openai", model: "gpt-5.6-sol" },
      api: { provider: "openai", model: "gpt-5.6-terra" },
    },
    evidence: "OpenAI leads DeepPlanning long-horizon planning",
    updated: "2026-07-15",
  },

  // --- DESIGN (UI/UX) ---
  {
    capability: "design",
    tier: "high",
    byBackend: {
      web: { provider: "anthropic", model: "claude-fable-5" },
      api: { provider: "openai", model: "gpt-5.6-sol" },
    },
    ask: true,
    evidence: "Design Arena Elo — Fable 5 #2, GPT-5.6 Sol #3",
    updated: "2026-07-15",
  },

  // --- CODE (development) ---
  {
    capability: "code",
    tier: "high",
    byBackend: {
      web: { provider: "anthropic", model: "claude-fable-5" }, // free -> 95% SWE-bench ceiling
      api: { provider: "anthropic", model: "claude-opus-4-8" }, // paid -> 88.6% value pick
    },
    ask: true,
    evidence: "SWE-bench Verified — Fable 5 95%, Opus 4.8 88.6%",
    updated: "2026-07-15",
  },
  {
    capability: "code",
    tier: "mid",
    byBackend: {
      web: { provider: "anthropic", model: "claude-opus-4-8" },
      api: { provider: "anthropic", model: "claude-sonnet-4-6" },
    },
    updated: "2026-07-15",
  },
  {
    capability: "code",
    tier: "fast",
    byBackend: {
      web: { provider: "anthropic", model: "claude-sonnet-4-6" },
      api: { provider: "anthropic", model: "claude-haiku-4-5" },
    },
    updated: "2026-07-15",
  },

  // --- TEST (QA / review, high volume -> cheap) ---
  {
    capability: "test",
    tier: "fast",
    byBackend: {
      web: { provider: "google", model: "gemini-3.1-pro-preview" },
      api: { provider: "google", model: "gemini-3-flash-preview" },
    },
    evidence: "Fast tier ~5x cheaper for high-volume review",
    updated: "2026-07-15",
  },

  // --- OPS (Runner: terminal / CI / file-driving autonomy) ---
  {
    capability: "ops",
    tier: "high",
    byBackend: {
      web: { provider: "openai", model: "gpt-5.6-sol" },
      api: { provider: "openai", model: "gpt-5.6-sol" },
    },
    evidence: "GPT-5.6 Sol leads Terminal-Bench 2.1",
    updated: "2026-07-15",
  },
];

/** Find the best registry entry for a capability at (or near) a tier.
 *  Exact tier wins; otherwise fall back to the nearest available tier. */
export function findEntry(
  capability: Capability,
  tier: Tier,
  registry: RegistryEntry[] = REGISTRY,
): { entry: RegistryEntry; exactTier: boolean } {
  const forCap = registry.filter((e) => e.capability === capability);
  if (forCap.length === 0) {
    throw new Error(`No registry entry for capability "${capability}".`);
  }

  const exact = forCap.find((e) => e.tier === tier);
  if (exact) return { entry: exact, exactTier: true };

  // Nearest tier by distance in TIER_ORDER.
  const want = TIER_ORDER.indexOf(tier);
  const nearest = forCap
    .slice()
    .sort(
      (a, b) =>
        Math.abs(TIER_ORDER.indexOf(a.tier) - want) - Math.abs(TIER_ORDER.indexOf(b.tier) - want),
    )[0]!;
  return { entry: nearest, exactTier: false };
}
