// Model bake-off CLI — run one task across models, compare cost/latency/quality.
//
//   npm run bakeoff -- --capability design "Design a pricing page with 3 tiers"
//   npm run bakeoff -- --capability plan "Plan an MVP task list for a URL shortener"
//   npm run bakeoff -- --models claude-opus-4-8,claude-sonnet-4-6,claude-haiku-4-5 "..."
//
// Defaults to the three Anthropic tiers (what most people hold a key for). Add
// --models to compare any model ids; --provider to set their provider.

import type { Capability, Difficulty, Provider } from "./types.js";
import { runBakeoff, bakeoffTask, type Candidate } from "./bakeoff.js";

const args = process.argv.slice(2);
function opt(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const capability = (opt("--capability") ?? "design") as Capability;
const difficulty = (opt("--difficulty") ?? "medium") as Difficulty;
const provider = (opt("--provider") ?? "anthropic") as Provider;
const modelsArg = opt("--models");
const consumed = new Set(["--capability", capability, "--difficulty", difficulty, "--provider", provider, "--models", modelsArg ?? ""].filter(Boolean));
const prompt = args.filter((a) => !consumed.has(a)).join(" ").trim();

if (!prompt) {
  console.log('\n  Usage: npm run bakeoff -- --capability design "your task"\n');
  process.exit(1);
}
if (capability === "code") {
  console.log("\n  Code bake-off isn't supported yet (needs a sandbox + real test scoring per model).");
  console.log("  Try --capability design or plan for now.\n");
  process.exit(1);
}

const models = (modelsArg ?? "claude-opus-4-8,claude-sonnet-4-6,claude-haiku-4-5").split(",").map((s) => s.trim()).filter(Boolean);
const candidates: Candidate[] = models.map((model) => ({ provider, model }));

console.log(`\n  Bake-off — ${capability}/${difficulty}   ${candidates.length} models\n  Task: ${prompt}\n`);

const result = await runBakeoff(bakeoffTask(prompt, capability, difficulty), candidates, {
  onProgress: (m) => console.log("  " + m),
});

// ---- report ----
const scoreOf = new Map(result.scores.map((s) => [s.model, s]));
const money = (n: number) => `$${n.toFixed(4)}`;
console.log("\n  --- RESULTS ---");
console.log("  model".padEnd(30) + "score".padEnd(8) + "cost".padEnd(12) + "time".padEnd(8) + "tokens");
for (const e of result.entries) {
  const key = `${e.provider}/${e.model}`;
  const sc = scoreOf.get(key);
  const scoreStr = e.error ? "ERR" : sc ? `${sc.score}/10` : "—";
  const line =
    ("  " + e.model).padEnd(30) +
    scoreStr.padEnd(8) +
    (e.error ? "—" : money(e.cost)).padEnd(12) +
    (e.error ? "—" : `${(e.ms / 1000).toFixed(1)}s`).padEnd(8) +
    (e.error ? "" : String(e.outputTokens));
  console.log(line);
  if (e.error) console.log(`      ↳ ${e.error}`);
}

if (result.winner) {
  const w = result.entries.find((e) => `${e.provider}/${e.model}` === result.winner);
  const wc = w?.cost ?? 0;
  const cheapest = result.entries.filter((e) => !e.error).sort((a, b) => a.cost - b.cost)[0];
  console.log(`\n  🏆 Best quality: ${result.winner}  (judge: ${result.judge})`);
  if (cheapest && `${cheapest.provider}/${cheapest.model}` !== result.winner) {
    console.log(`  💸 Cheapest: ${cheapest.provider}/${cheapest.model} at ${money(cheapest.cost)} (winner cost ${money(wc)})`);
  }
  for (const s of result.scores.sort((a, b) => b.score - a.score)) {
    console.log(`      ${s.score}/10  ${s.model} — ${s.reason}`);
  }
}
console.log("");
process.exit(0);
