// The Scout — keeps the registry current.
//
// Input: findings (best model per capability+tier, from a research/benchmark pass —
//   the same kind of verified output the deep-research harness produces).
// Output: a proposed registry + a human-readable diff. SEMI-AUTO by design: the Scout
//   proposes, you approve, then apply. Nothing changes routing without a look.
//
// Pure + testable: no network. Feed it findings; it computes the delta.

import type { Backend, Capability, Provider, RegistryEntry, Tier } from "./types.js";
import { MODELS } from "./models.js";

export interface Finding {
  capability: Capability;
  tier: Tier;
  /** Which backend slot this evidence informs. Benchmarks mostly inform "api". */
  backend: Backend;
  provider: Provider;
  model: string;
  evidence: string;
  date?: string;
}

export type ChangeKind = "add" | "update" | "noop" | "unknown-model";

export interface RegistryChange {
  kind: ChangeKind;
  capability: Capability;
  tier: Tier;
  backend: Backend;
  from?: string;
  to: string;
  evidence: string;
}

export interface Proposal {
  updated: RegistryEntry[];
  changes: RegistryChange[];
}

const keyOf = (c: Capability, t: Tier) => `${c}/${t}`;

/** Compute a proposed registry from the current one + findings. Pure. */
export function proposeUpdate(current: RegistryEntry[], findings: Finding[]): Proposal {
  // Clone entries so we don't mutate the input.
  const map = new Map<string, RegistryEntry>(
    current.map((e) => [keyOf(e.capability, e.tier), cloneEntry(e)]),
  );
  const changes: RegistryChange[] = [];

  for (const f of findings) {
    const k = keyOf(f.capability, f.tier);
    const known = !!MODELS[f.model];
    const existing = map.get(k);

    if (!existing) {
      // New capability/tier slot — seed both backends with the finding, mark others later.
      map.set(k, {
        capability: f.capability,
        tier: f.tier,
        byBackend: {
          web: { provider: f.provider, model: f.model },
          api: { provider: f.provider, model: f.model },
        },
        evidence: f.evidence,
        updated: f.date ?? "scout",
      });
      changes.push({
        kind: known ? "add" : "unknown-model",
        capability: f.capability, tier: f.tier, backend: f.backend,
        to: f.model, evidence: f.evidence,
      });
      continue;
    }

    const cur = existing.byBackend[f.backend];
    if (cur.model === f.model && cur.provider === f.provider) {
      changes.push({
        kind: "noop", capability: f.capability, tier: f.tier, backend: f.backend,
        from: cur.model, to: f.model, evidence: f.evidence,
      });
      continue;
    }

    existing.byBackend[f.backend] = { provider: f.provider, model: f.model };
    existing.evidence = f.evidence;
    existing.updated = f.date ?? "scout";
    changes.push({
      kind: known ? "update" : "unknown-model",
      capability: f.capability, tier: f.tier, backend: f.backend,
      from: cur.model, to: f.model, evidence: f.evidence,
    });
  }

  return { updated: [...map.values()], changes };
}

/** Only the changes that actually alter routing (drops noops). */
export function meaningfulChanges(changes: RegistryChange[]): RegistryChange[] {
  return changes.filter((c) => c.kind !== "noop");
}

export function formatProposal(changes: RegistryChange[]): string {
  const real = meaningfulChanges(changes);
  if (!real.length) return "  No changes — registry already matches the findings.";
  const icon: Record<ChangeKind, string> = { add: "+", update: "~", noop: " ", "unknown-model": "!" };
  return real
    .map((c) => {
      const arrow = c.from ? `${c.from} -> ${c.to}` : c.to;
      const warn = c.kind === "unknown-model" ? "  [!] model not in models.ts — add it before applying" : "";
      return `  ${icon[c.kind]} ${c.capability}/${c.tier} [${c.backend}]  ${arrow}\n      ${c.evidence}${warn}`;
    })
    .join("\n");
}

function cloneEntry(e: RegistryEntry): RegistryEntry {
  return {
    ...e,
    byBackend: { web: { ...e.byBackend.web }, api: { ...e.byBackend.api } },
  };
}
