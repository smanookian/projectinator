// Model bake-off CLI — run one task across models, compare cost/latency/quality.
//
//   npm run bakeoff -- --capability design "Design a pricing page with 3 tiers"
//   npm run bakeoff -- --capability plan "Plan an MVP task list for a URL shortener"
//   npm run bakeoff -- --capability code "Build a tip calculator (index.html, style.css, script.js)"
//   npm run bakeoff -- --models anthropic:claude-opus-5,openrouter:google/gemini-3.8-flash,local:qwen3 "..."
//
// Defaults to the connected roster for that capability (every provider with a key, plus
// local models). --models takes provider:model entries (bare ids → --provider, slugs with
// "/" → openrouter). Code bake-offs build in scratch folders and are scored by the Tester.

import type { Capability, Difficulty, Provider } from "./types.js";
import { runBakeoff, bakeoffTask, parseCandidates, type Candidate } from "./bakeoff.js";
import { bakeoffCandidates, rosterTester } from "./tui/engine.js";
import { applyKeysToEnv } from "./tui/config.js";

applyKeysToEnv();

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
const candidates: Candidate[] = modelsArg ? parseCandidates(modelsArg, provider) : bakeoffCandidates(capability);
if (candidates.length < 2) {
  console.log("\n  A bake-off needs at least two models: connect another provider or pass --models a:b,c:d.\n");
  process.exit(1);
}

console.log(`\n  Bake-off — ${capability}/${difficulty}   ${candidates.length} models\n  Task: ${prompt}\n`);

const result = await runBakeoff(bakeoffTask(prompt, capability, difficulty), candidates, {
  tester: rosterTester(),
  onProgress: (m) => console.log("  " + m),
});

// ---- report ----
const scoreOf = new Map(result.scores.map((s) => [s.model, s]));
const money = (n: number) => `$${n.toFixed(4)}`;
console.log("\n  --- RESULTS ---");
console.log("  model".padEnd(30) + "score".padEnd(8) + "cost".padEnd(12) + "time".padEnd(8) + (capability === "code" ? "files" : "tokens"));
for (const e of result.entries) {
  const key = `${e.provider}/${e.model}`;
  const sc = scoreOf.get(key);
  const scoreStr = e.error ? "ERR" : sc ? `${sc.score}/10` : "—";
  const line =
    ((result.pareto.includes(key) ? "★ " : "  ") + e.model).padEnd(30) +
    scoreStr.padEnd(8) +
    (e.error ? "—" : money(e.cost)).padEnd(12) +
    (e.error ? "—" : `${(e.ms / 1000).toFixed(1)}s`).padEnd(8) +
    (e.error ? "" : String(capability === "code" ? e.files?.length ?? 0 : e.outputTokens));
  console.log(line);
  if (e.error) console.log(`      ↳ ${e.error}`);
  if (e.dir) console.log(`      ↳ built in ${e.dir}`);
}

if (result.winner) {
  const w = result.entries.find((e) => `${e.provider}/${e.model}` === result.winner);
  const wc = w?.cost ?? 0;
  const cheapest = result.entries.filter((e) => !e.error).sort((a, b) => a.cost - b.cost)[0];
  console.log(`\n  🏆 Best quality: ${result.winner}  (${capability === "code" ? "tester" : "judge"}: ${result.judge})`);
  if (result.bestValue) console.log(`  ⚖ Best value (score per $): ${result.bestValue}   ★ = quality/$ frontier`);
  if (cheapest && `${cheapest.provider}/${cheapest.model}` !== result.winner) {
    console.log(`  💸 Cheapest: ${cheapest.provider}/${cheapest.model} at ${money(cheapest.cost)} (winner cost ${money(wc)})`);
  }
  for (const s of result.scores.sort((a, b) => b.score - a.score)) {
    console.log(`      ${s.score}/10  ${s.model} — ${s.reason}`);
  }
}
console.log("");
process.exit(0);
