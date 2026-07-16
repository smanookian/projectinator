// Registry persistence — makes the "swappable brain" actually swappable at runtime.
// The in-code REGISTRY is the seed. An optional registry.overrides.json (written by
// the Scout) merges on top by (capability, tier) key. New frontier model next month
// => Scout edits the JSON => every route updates. No code change.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { RegistryEntry } from "./types.js";
import { REGISTRY } from "./registry.js";

export const OVERRIDES_FILENAME = "registry.overrides.json";

const key = (e: Pick<RegistryEntry, "capability" | "tier">) => `${e.capability}/${e.tier}`;

/** Merge overrides onto the seed registry, replacing entries by (capability, tier). */
export function mergeRegistry(seed: RegistryEntry[], overrides: RegistryEntry[]): RegistryEntry[] {
  const map = new Map(seed.map((e) => [key(e), e]));
  for (const o of overrides) map.set(key(o), o);
  return [...map.values()];
}

/** Load the effective registry: seed + overrides file if present. */
export function loadRegistry(overridesPath: string, seed: RegistryEntry[] = REGISTRY): RegistryEntry[] {
  if (!existsSync(overridesPath)) return seed;
  try {
    const parsed = JSON.parse(readFileSync(overridesPath, "utf-8")) as { entries?: RegistryEntry[] };
    if (!parsed.entries?.length) return seed;
    return mergeRegistry(seed, parsed.entries);
  } catch (e) {
    throw new Error(`Bad ${OVERRIDES_FILENAME}: ${e instanceof Error ? e.message : e}`);
  }
}

/** Persist override entries (the full set the Scout wants applied). */
export function saveOverrides(entries: RegistryEntry[], overridesPath: string): void {
  writeFileSync(overridesPath, JSON.stringify({ updated: nowStamp(), entries }, null, 2) + "\n");
}

// Deterministic-ish stamp without Date.now (kept simple; callers may override).
function nowStamp(): string {
  return "scout";
}
