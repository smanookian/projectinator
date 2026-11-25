// "A newer model is out" — for each model your team runs, look in the catalog for a newer
// version of the same model family from the same provider: claude-opus-5 → claude-opus-5-5,
// gpt-5.6-sol → gpt-6.2-sol, anthropic/claude-sonnet-5 → anthropic/claude-sonnet-5.5.
// Pure: give it the team and a catalog. The app shows the result; you decide (switch / skip).

import type { Model, Provider } from "./types.js";

/** Same model, different packaging — never offered as an upgrade. */
const VARIANTS = new Set(["fast", "batch", "thinking", "customtools", "latest"]);

/** A model id as family + numeric version, or undefined for ids we can't read that way
 *  (dated snapshots, variants, `~aliases`, `:batch` slugs). Anthropic writes 5.5 as `5-5`. */
export function familyOf(id: string): { family: string; version: number[] } | undefined {
  const m = /^((?:[a-z0-9]+\/)?[a-z]+(?:-[a-z]+)*)-(\d+(?:[.-]\d+)?)(?:-([a-z]+(?:-[a-z]+)*))?$/.exec(id);
  if (!m) return undefined;
  const words = (m[3] ?? "").split("-").filter((w) => w && w !== "preview");
  if (words.some((w) => VARIANTS.has(w))) return undefined;
  return { family: `${m[1]}|${words.join("-")}`, version: m[2]!.split(/[.-]/).map(Number) };
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** The newest priced model in `catalog` from the same provider and family as `id`, if it is
 *  newer than `id`. */
export function newerThan(id: string, provider: Provider, catalog: Model[]): Model | undefined {
  const me = familyOf(id);
  if (!me) return undefined;
  let best: { model: Model; version: number[] } | undefined;
  for (const m of catalog) {
    if (m.provider !== provider || !(m.cost.input > 0)) continue;
    const f = familyOf(m.id);
    if (!f || f.family !== me.family || compare(f.version, me.version) <= 0) continue;
    if (!best || compare(f.version, best.version) > 0) best = { model: m, version: f.version };
  }
  return best?.model;
}

export interface ModelUpgrade {
  /** The model the team runs now. */
  from: string;
  to: Model;
  /** Roles on `from`, e.g. ["Developer", "Designer"]. */
  roles: string[];
}

/** One upgrade per model the team uses that has a newer, not-skipped version. */
export function findUpgrades(
  team: { label: string; provider?: Provider; model?: string }[],
  catalog: Model[],
  skipped: string[],
): ModelUpgrade[] {
  const out: ModelUpgrade[] = [];
  for (const r of team) {
    if (!r.model || !r.provider || r.provider === "local") continue;
    const seen = out.find((u) => u.from === r.model);
    if (seen) { seen.roles.push(r.label); continue; }
    const to = newerThan(r.model, r.provider, catalog);
    if (to && !skipped.includes(to.id)) out.push({ from: r.model, to, roles: [r.label] });
  }
  return out;
}

/** Follow the switches you made (old → new, possibly chained) to the model to run. */
export function upgraded(id: string, upgrades: Record<string, string>): string {
  const seen = new Set<string>();
  let cur = id;
  while (upgrades[cur] && !seen.has(cur)) { seen.add(cur); cur = upgrades[cur]!; }
  return cur;
}
