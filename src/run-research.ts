// Research entry — extract findings from a report, ready for the Scout.
//
//   npm run research -- report.txt                    dry: show the extraction plan
//   npm run research -- report.txt --live             extract via a model, write findings.json
//   npm run research -- report.txt --live --out f.json --model anthropic/claude-sonnet-4-6
//
// Then:  npm run scout -- --from findings.json
//
// The report is any benchmark write-up — e.g. save the deep-research harness output to a
// text file and point this at it.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Provider } from "./types.js";
import { extractFindings, validateFindings, extractionPrompt } from "./research.js";

const args = process.argv.slice(2);
const live = args.includes("--live");
const outIdx = args.indexOf("--out");
const modelIdx = args.indexOf("--model");
const modelArg = (modelIdx >= 0 ? args[modelIdx + 1] : undefined) ?? "anthropic/claude-sonnet-4-6";
const outArg = outIdx >= 0 ? args[outIdx + 1] : undefined;

const consumed = new Set(["--live", "--out", outArg, "--model", modelArg].filter(Boolean) as string[]);
const reportPath = args.filter((a) => !consumed.has(a))[0];

if (!reportPath) {
  console.error("\n  Usage: npm run research -- <report.txt> [--live] [--out findings.json] [--model provider/id]\n");
  process.exit(1);
}

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outPath = outArg ?? join(projectRoot, "findings.json");
const [provider, ...rest] = modelArg.split("/");
const modelSpec = { provider: provider as Provider, model: rest.join("/") };

const report = readFileSync(reportPath, "utf-8");

console.log(`\n  Projectinator — Research extractor   [${live ? "LIVE" : "DRY"}]`);
console.log(`  Report:  ${reportPath} (${report.length} chars)`);
console.log(`  Model:   ${modelSpec.provider}/${modelSpec.model}`);
console.log(`  Output:  ${outPath}\n`);

if (!live) {
  console.log("  --- extraction prompt (not sent, report truncated) ---");
  console.log(extractionPrompt(report.slice(0, 400) + "\n...[truncated]").split("\n").map((l) => "  | " + l).join("\n"));
  console.log("\n  Dry run. Add --live (and an API key) to extract.\n");
  process.exit(0);
}

const envKey: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"], openai: ["OPENAI_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
};
if (!(envKey[modelSpec.provider] ?? []).some((k) => process.env[k])) {
  console.error(`  No API key for ${modelSpec.provider}. Set: ${(envKey[modelSpec.provider] ?? []).join(", ")}\n`);
  process.exit(1);
}

console.log("  Extracting...\n");
const findings = await extractFindings(report, { model: modelSpec });
const { ok, issues } = validateFindings(findings);

console.log(`  Extracted ${findings.length} findings:`);
for (const f of findings) console.log(`    ${f.capability}/${f.tier} [${f.backend}] -> ${f.provider}/${f.model}`);

if (!ok) {
  console.log(`\n  Validation issues (fix models.ts or the report before applying):`);
  for (const i of issues) console.log(`    ! finding ${i.index} (${i.model}): ${i.problem}`);
}

writeFileSync(outPath, JSON.stringify({ findings }, null, 2) + "\n");
console.log(`\n  Wrote ${outPath}. Next: npm run scout -- --from ${outPath}\n`);
