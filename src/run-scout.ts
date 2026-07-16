// Scout entry — propose (and optionally apply) registry updates from findings.
//
//   npm run scout                    show proposed changes from the sample findings
//   npm run scout -- --from f.json    use findings from a file (e.g. research output)
//   npm run scout -- --apply          write registry.overrides.json (routing updates)
//
// Findings normally come from a research/benchmark pass (the deep-research harness
// emits exactly this kind of verified model->role data). Semi-auto: you see the diff
// before anything changes.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadRegistry, saveOverrides, OVERRIDES_FILENAME } from "./registry-store.js";
import { proposeUpdate, formatProposal, meaningfulChanges, type Finding } from "./scout.js";
import { validateFindings } from "./research.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const fromIdx = args.indexOf("--from");
const fromFile = fromIdx >= 0 ? args[fromIdx + 1] : undefined;

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const overridesPath = join(projectRoot, OVERRIDES_FILENAME);

// A stand-in for research output. Shows an update, a no-op, an add, and the
// unknown-model guard. Replace via --from with real verified findings.
const SAMPLE_FINDINGS: Finding[] = [
  { capability: "code", tier: "high", backend: "api", provider: "anthropic", model: "claude-fable-5", evidence: "SWE-bench Verified: Fable 5 95% now the API pick over Opus 4.8 88.6%", date: "2026-07-15" },
  { capability: "test", tier: "fast", backend: "api", provider: "google", model: "gemini-3-flash-preview", evidence: "Still cheapest high-volume reviewer" },
  { capability: "plan", tier: "high", backend: "api", provider: "openai", model: "gpt-5.6-sol", evidence: "New plan/high tier for hard planning tasks" },
];

const findings: Finding[] = fromFile
  ? (JSON.parse(readFileSync(fromFile, "utf-8")) as { findings: Finding[] }).findings
  : SAMPLE_FINDINGS;

// Guard against findings that reference models we don't know about.
const validation = validateFindings(findings);
if (!validation.ok) {
  console.log("\n  Findings reference unknown/mismatched models:");
  for (const i of validation.issues) console.log(`    ! finding ${i.index} (${i.model}): ${i.problem}`);
  console.log("  (These will surface as 'unknown-model' below and block --apply.)");
}

const current = loadRegistry(overridesPath);
const proposal = proposeUpdate(current, findings);

console.log(`\n  Projectinator — Scout   [${apply ? "APPLY" : "DRY"}]`);
console.log(`  Findings: ${findings.length}${fromFile ? ` (from ${fromFile})` : " (sample)"}\n`);
console.log("  Proposed registry changes:");
console.log(formatProposal(proposal.changes));

const real = meaningfulChanges(proposal.changes);
const unknown = real.filter((c) => c.kind === "unknown-model");

if (!apply) {
  console.log(`\n  ${real.length} change(s). Re-run with --apply to write ${OVERRIDES_FILENAME}.\n`);
  process.exit(0);
}

if (unknown.length) {
  console.error(`\n  Refusing to apply: ${unknown.length} finding(s) reference a model not in models.ts. Add it first.\n`);
  process.exit(1);
}

saveOverrides(proposal.updated, overridesPath);
console.log(`\n  Applied. Wrote ${OVERRIDES_FILENAME}. Routing now uses the updated registry.\n`);
