// The OpenRouter model catalog — so users can pick ANY OpenRouter model by name
// (Kimi, DeepSeek, Qwen, …) instead of typing slugs.
//
//  - refreshOpenRouterModels(): live-fetch openrouter.ai/api/v1/models (freshest
//    names + pricing), cache to disk. Falls back to Pi's built-in OR catalog.
//  - openRouterModels() / findOpenRouterModel(): SYNC reads (disk cache, else Pi's
//    built-in list) so cost estimation (getModel) can price any picked model.

import { piCatalog } from "./pi-catalog.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataHome } from "./tui/config.js";
import type { Model, ModelCost } from "./types.js";

/** A pickable OpenRouter model: our Model shape minus the provider (always "openrouter"). */
export type ORModel = Omit<Model, "provider"> & {
  /** Listing date (epoch seconds) from the live catalog; absent on Pi's built-in list. */
  created?: number;
};

const cachePath = () => join(dataHome(), "openrouter-models.json");

let diskMemo: ORModel[] | null | undefined; // undefined = not read yet, null = no cache
let diskFetchedAt = 0; // when the disk cache was fetched (epoch ms); 0 = no cache

/** Pi's built-in OpenRouter catalog — offline, names + pricing, sorted by name. Empty until
 *  warmPiCatalog() (pi-catalog.ts) has run once at startup. */
export function builtinOpenRouterModels(): ORModel[] {
  return piCatalog("openrouter")
    .map(({ provider: _p, ...m }) => m)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function readDiskCache(): ORModel[] | null {
  if (diskMemo !== undefined) return diskMemo;
  try {
    if (existsSync(cachePath())) {
      const parsed = JSON.parse(readFileSync(cachePath(), "utf8")) as { fetchedAt?: number; models?: ORModel[] };
      diskMemo = Array.isArray(parsed.models) && parsed.models.length ? parsed.models : null;
      diskFetchedAt = diskMemo && typeof parsed.fetchedAt === "number" ? parsed.fetchedAt : 0;
    } else diskMemo = null;
  } catch {
    diskMemo = null;
  }
  return diskMemo;
}

/** How old the live-fetched catalog on disk is (ms); Infinity when there is none. */
export function openRouterCacheAge(now = Date.now()): number {
  return readDiskCache() && diskFetchedAt ? now - diskFetchedAt : Infinity;
}

/** The list to show / price against: the live-fetched disk cache, plus any model in Pi's
 *  built-in list the cache doesn't have. A cache fetched before a model came out (Opus 5.5 vs a
 *  September fetch) would otherwise hide it from the picker and the newer-model check. */
export function openRouterModels(): ORModel[] {
  const cached = readDiskCache();
  if (!cached?.length) return builtinOpenRouterModels();
  const have = new Set(cached.map((m) => m.id));
  const missing = builtinOpenRouterModels().filter((m) => !have.has(m.id));
  return missing.length ? [...cached, ...missing].sort((a, b) => a.name.localeCompare(b.name)) : cached;
}

/** Look up one model's pricing/name by slug (live cache first, then Pi's built-in). Sync. */
export function findOpenRouterModel(id: string): ORModel | undefined {
  return openRouterModels().find((m) => m.id === id);
}

/** Map OpenRouter's API pricing (USD per token, strings) to our per-1M-token cost. */
function mapApiModel(m: {
  id: string;
  name?: string;
  context_length?: number;
  created?: number;
  pricing?: { prompt?: string; completion?: string; input_cache_read?: string; input_cache_write?: string };
}): ORModel | null {
  const p = m.pricing ?? {};
  const input = Number(p.prompt) * 1e6;
  const output = Number(p.completion) * 1e6;
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  const cacheRead = p.input_cache_read != null ? Number(p.input_cache_read) * 1e6 : input * 0.1;
  const cacheWrite = p.input_cache_write != null ? Number(p.input_cache_write) * 1e6 : input * 1.25;
  return {
    id: m.id,
    name: m.name ?? m.id,
    contextWindow: m.context_length ?? 200_000,
    cost: { input, output, cacheRead, cacheWrite },
    ...(m.created ? { created: m.created } : {}),
  };
}

/** Live-fetch the catalog and cache it. Falls back to the current list on any failure. */
export async function refreshOpenRouterModels(timeoutMs = 8000): Promise<ORModel[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", { signal: ctrl.signal });
    if (!res.ok) return openRouterModels();
    const json = (await res.json()) as { data?: Array<Parameters<typeof mapApiModel>[0]> };
    const list = (json.data ?? []).map(mapApiModel).filter((m): m is ORModel => m !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (list.length) {
      try {
        mkdirSync(dataHome(), { recursive: true });
        writeFileSync(cachePath(), JSON.stringify({ fetchedAt: Date.now(), models: list }));
        diskMemo = list;
        diskFetchedAt = Date.now();
      } catch { /* cache write is best-effort */ }
      return list;
    }
    return openRouterModels();
  } catch {
    return openRouterModels();
  } finally {
    clearTimeout(timer);
  }
}
