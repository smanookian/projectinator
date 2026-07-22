// The OpenRouter model catalog — so users can pick ANY OpenRouter model by name
// (Kimi, DeepSeek, Qwen, …) instead of typing slugs.
//
//  - refreshOpenRouterModels(): live-fetch openrouter.ai/api/v1/models (freshest
//    names + pricing), cache to disk. Falls back to Pi's built-in OR catalog.
//  - openRouterModels() / findOpenRouterModel(): SYNC reads (disk cache, else Pi's
//    built-in list) so cost estimation (getModel) can price any picked model.

import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Model, ModelCost } from "./types.js";

/** A pickable OpenRouter model: our Model shape minus the provider (always "openrouter"). */
export type ORModel = Omit<Model, "provider">;

const CACHE = join(homedir(), ".projectinator", "openrouter-models.json");

let builtinMemo: ORModel[] | null = null;
let diskMemo: ORModel[] | null | undefined; // undefined = not read yet, null = no cache

/** Pi's built-in OpenRouter catalog — offline, always available, names + pricing. */
export function builtinOpenRouterModels(): ORModel[] {
  if (builtinMemo) return builtinMemo;
  try {
    const reg = ModelRegistry.create(AuthStorage.create());
    const all = (reg.getAll() as unknown as Array<{ id: string; provider: string; name?: string; contextWindow?: number; cost?: ModelCost }>);
    builtinMemo = all
      .filter((m) => m.provider === "openrouter" && m.cost)
      .map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        contextWindow: m.contextWindow ?? 200_000,
        cost: m.cost as ModelCost,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    builtinMemo = [];
  }
  return builtinMemo;
}

function readDiskCache(): ORModel[] | null {
  if (diskMemo !== undefined) return diskMemo;
  try {
    if (existsSync(CACHE)) {
      const parsed = JSON.parse(readFileSync(CACHE, "utf8")) as { models?: ORModel[] };
      diskMemo = Array.isArray(parsed.models) && parsed.models.length ? parsed.models : null;
    } else diskMemo = null;
  } catch {
    diskMemo = null;
  }
  return diskMemo;
}

/** The list to show / price against: live-fetched disk cache if present, else Pi's built-in. */
export function openRouterModels(): ORModel[] {
  const cached = readDiskCache();
  return cached && cached.length ? cached : builtinOpenRouterModels();
}

/** Look up one model's pricing/name by slug (cache first, then built-in). Sync. */
export function findOpenRouterModel(id: string): ORModel | undefined {
  return openRouterModels().find((m) => m.id === id) ?? builtinOpenRouterModels().find((m) => m.id === id);
}

/** Map OpenRouter's API pricing (USD per token, strings) to our per-1M-token cost. */
function mapApiModel(m: {
  id: string;
  name?: string;
  context_length?: number;
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
        mkdirSync(join(homedir(), ".projectinator"), { recursive: true });
        writeFileSync(CACHE, JSON.stringify({ fetchedAt: Date.now(), models: list }));
        diskMemo = list;
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
