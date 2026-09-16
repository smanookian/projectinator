// Auto-scout source — turns the OpenRouter catalog (the one feed we already fetch for
// pricing) into things a human should look at:
//   1. price drift: models we price whose live input/output rate moved by more than 10%
//   2. new models from the vendors we route (anthropic / openai / google) that our roster
//      does not know, newest first
// and into Findings for the existing Scout (`proposeUpdate`): each new model becomes an
// "unknown-model" finding for the slot it most plausibly fits — never applied silently.
// Pure: feed it a catalog; no network here.

import type { Finding } from "./scout.js";
import type { ORModel } from "./openrouter.js";
import type { Model, RegistryEntry } from "./types.js";
import { MODELS } from "./models.js";

export interface PriceDrift {
  id: string; // our model id
  slug: string; // OpenRouter slug it was matched to
  ours: { input: number; output: number };
  live: { input: number; output: number };
  /** Largest relative change, signed (+ = more expensive). */
  change: number;
}

export interface NewModel {
  slug: string;
  name: string;
  vendor: string;
  created?: number; // epoch seconds
  cost: { input: number; output: number };
  contextWindow: number;
}

export interface ScoutReport {
  drift: PriceDrift[];
  newModels: NewModel[];
  /** Findings for `proposeUpdate` (all "unknown-model" until someone adds them to models.ts). */
  findings: Finding[];
}

const ROUTED_VENDORS = ["anthropic", "openai", "google"];
const DRIFT_THRESHOLD = 0.1;

/** Our id ↔ OpenRouter slug. Native ids differ only in the vendor prefix and dots. */
export function slugFor(m: Model): string | undefined {
  if (m.provider === "openrouter") return m.id;
  if (m.provider === "local") return undefined;
  // claude-opus-4-8 → anthropic/claude-opus-4.8 ; gemini-3-flash-preview stays as is
  const norm = m.id.replace(/-(\d)-(\d)\b/g, "-$1.$2");
  return `${m.provider}/${norm}`;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function scoutFromCatalog(catalog: ORModel[], models: Record<string, Model> = MODELS, registry: RegistryEntry[] = []): ScoutReport {
  const bySlug = new Map(catalog.map((m) => [m.id, m]));

  // 1. price drift
  const drift: PriceDrift[] = [];
  const knownSlugs = new Set<string>();
  for (const m of Object.values(models)) {
    const slug = slugFor(m);
    if (!slug) continue;
    knownSlugs.add(slug);
    const live = bySlug.get(slug);
    if (!live) continue;
    const rel = (a: number, b: number) => (a === 0 ? (b === 0 ? 0 : 1) : (b - a) / a);
    const dIn = rel(m.cost.input, live.cost.input), dOut = rel(m.cost.output, live.cost.output);
    const change = Math.abs(dIn) >= Math.abs(dOut) ? dIn : dOut;
    if (Math.abs(change) > DRIFT_THRESHOLD) {
      drift.push({ id: m.id, slug, ours: { input: m.cost.input, output: m.cost.output }, live: { input: round3(live.cost.input), output: round3(live.cost.output) }, change: round3(change) });
    }
  }
  drift.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

  // 2. new models from routed vendors, newest first. "New" = listed after the newest
  // model we already know from that vendor; variants (:batch, :free, dated previews) skipped.
  const newestKnown = new Map<string, number>();
  for (const slug of knownSlugs) {
    const c = bySlug.get(slug)?.created;
    if (c) newestKnown.set(slug.split("/")[0]!, Math.max(newestKnown.get(slug.split("/")[0]!) ?? 0, c));
  }
  const newModels: NewModel[] = catalog
    .filter((m) => {
      const vendor = m.id.split("/")[0]!;
      return ROUTED_VENDORS.includes(vendor) && !knownSlugs.has(m.id) && !/:[a-z]+$|preview-\d{2}-\d{2}/.test(m.id)
        && (m.created ?? 0) > (newestKnown.get(vendor) ?? 0);
    })
    .map((m) => ({ slug: m.id, name: m.name, vendor: m.id.split("/")[0]!, created: m.created, cost: { input: round3(m.cost.input), output: round3(m.cost.output) }, contextWindow: m.contextWindow }))
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0));

  // 3. findings: a new model is proposed for the slot whose current pick it is priced like
  // (same vendor, closest output price) — a starting point for the human, not a verdict.
  // One finding per slot (the newest model wins) so the diff never chains.
  const findings: Finding[] = [];
  const taken = new Set<string>();
  for (const nm of newModels) {
    let best: { entry: RegistryEntry; gap: number } | undefined;
    for (const e of registry) {
      const cur = e.byBackend.api;
      const curModel = models[cur.model];
      if (!curModel || (curModel.provider !== nm.vendor && !cur.model.startsWith(`${nm.vendor}/`))) continue;
      const gap = Math.abs(Math.log((curModel.cost.output || 0.01) / (nm.cost.output || 0.01)));
      if (!best || gap < best.gap) best = { entry: e, gap };
    }
    if (!best || taken.has(`${best.entry.capability}/${best.entry.tier}`)) continue;
    taken.add(`${best.entry.capability}/${best.entry.tier}`);
    findings.push({
      capability: best.entry.capability,
      tier: best.entry.tier,
      backend: "api",
      provider: "openrouter",
      model: nm.slug,
      evidence: `New on OpenRouter${nm.created ? ` (${new Date(nm.created * 1000).toISOString().slice(0, 10)})` : ""}: $${nm.cost.input}/$${nm.cost.output} per 1M vs ${best.entry.byBackend.api.model} — verify quality before applying`,
    });
  }

  return { drift, newModels, findings };
}

export function formatScoutReport(r: ScoutReport): string {
  const lines: string[] = [];
  lines.push(r.drift.length ? "  Price drift (ours → live, per 1M tokens):" : "  Price drift: none over 10%.");
  for (const d of r.drift) {
    const pct = `${d.change > 0 ? "+" : ""}${Math.round(d.change * 100)}%`;
    lines.push(`    ${d.change > 0 ? "▲" : "▼"} ${d.id.padEnd(30)} in $${d.ours.input} → $${d.live.input}   out $${d.ours.output} → $${d.live.output}   (${pct})`);
  }
  lines.push("");
  lines.push(r.newModels.length ? "  New models from routed vendors (not in models.ts):" : "  New models from routed vendors: none.");
  for (const m of r.newModels.slice(0, 15)) {
    const when = m.created ? new Date(m.created * 1000).toISOString().slice(0, 10) : "     ?    ";
    lines.push(`    + ${when}  ${m.slug.padEnd(38)} $${m.cost.input}/$${m.cost.output}  ${Math.round(m.contextWindow / 1000)}k ctx`);
  }
  if (r.newModels.length > 15) lines.push(`    … ${r.newModels.length - 15} more`);
  return lines.join("\n");
}
