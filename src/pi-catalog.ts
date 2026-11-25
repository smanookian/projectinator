// Pi's bundled model catalog (names, prices, context) as a sync lookup. Pi's runtime is async,
// so `warmPiCatalog()` fills a memo once at startup; after that, pricing (`getModel`), labels and
// the newer-model check read it synchronously. Pi is the same source that reports the ACTUAL
// cost of every run, so a model priced from here keeps estimate and bill in step.

import { piRuntime } from "./executor.js";
import type { Model, Provider } from "./types.js";

type CloudProvider = Exclude<Provider, "local">;
const PROVIDERS: CloudProvider[] = ["anthropic", "openai", "google", "openrouter"];

let memo: Model[] | null = null;

/** Load every cloud provider's models into the memo. Safe to call repeatedly. */
export async function warmPiCatalog(): Promise<Model[]> {
  if (memo) return memo;
  try {
    const runtime = await piRuntime();
    memo = PROVIDERS.flatMap((provider) =>
      runtime
        .getModels(provider)
        .filter((m) => !!m.cost)
        .map((m) => ({ id: m.id, provider, name: m.name ?? m.id, contextWindow: m.contextWindow ?? 200_000, cost: m.cost })),
    );
  } catch {
    memo = [];
  }
  return memo;
}

/** The catalog for one provider (empty until warmed). */
export function piCatalog(provider: CloudProvider): Model[] {
  return (memo ?? []).filter((m) => m.provider === provider);
}

/** One model by id, if Pi knows it (and the catalog is warm). Ids don't collide across
 *  providers: OpenRouter's are `vendor/model`, native ones have no slash. */
export function findPiModel(id: string): Model | undefined {
  return (memo ?? []).find((m) => m.id === id);
}
