// Phase 3 entry — decompose an idea into a routed backlog.
//
//   npm run pm -- "your idea here"            dry: show PM model + prompt, NO spend
//   npm run pm -- --live "your idea here"     live: decompose + route the backlog
//
// Live decomposition needs an API key (PM routes to an OpenAI model by default).

import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { DEFAULT_POLICY, routeBacklog } from "./router.js";
import { findEntry } from "./registry.js";
import { resolvePiModel } from "./executor.js";
import { decomposeIdea, pmSystemPrompt } from "./pm.js";

const args = process.argv.slice(2);
const live = args.includes("--live");

// Optional PM model override: --pm <provider/id> (e.g. anthropic/claude-sonnet-4-6).
// Lets you decompose with whichever provider you hold a key for.
const pmIdx = args.indexOf("--pm");
const pmOverride = pmIdx >= 0 ? args[pmIdx + 1] : undefined;
const consumed = new Set<string>(["--live", "--pm", pmOverride].filter(Boolean) as string[]);
const idea = args.filter((a) => !consumed.has(a)).join(" ").trim() ||
  "A simple personal task tracker web app: add tasks, mark them done, filter by status.";

const backend = "api" as const; // web-login backend not built yet
const money = (n: number) => `$${n.toFixed(2)}`;

const auth = AuthStorage.create();
const registry = ModelRegistry.create(auth);
const { entry } = findEntry("plan", "mid");
const pick = pmOverride
  ? { provider: pmOverride.split("/")[0] as typeof entry.byBackend[typeof backend]["provider"], model: pmOverride.split("/").slice(1).join("/") }
  : entry.byBackend[backend];
const pm = resolvePiModel(registry, pick.provider, pick.model); // offline

console.log(`\n  Projectinator — Phase 3 PM decomposer   [${live ? "LIVE" : "DRY"}]\n`);
console.log(`  Idea:    ${idea}`);
console.log(`  PM model: ${pick.provider}/${pm.id}  (tier=${entry.tier}, backend=${backend})\n`);

if (!live) {
  console.log("  --- PM system prompt (not sent) ---");
  console.log(pmSystemPrompt().split("\n").map((l) => "  | " + l).join("\n"));
  console.log("\n  Dry run. Re-run with --live (and an API key) to actually decompose.\n");
  process.exit(0);
}

const envKey: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
};
if (!(envKey[pick.provider] ?? []).some((k) => process.env[k])) {
  console.error(`  No API key for ${pick.provider}. Set: ${(envKey[pick.provider] ?? []).join(", ")}\n`);
  process.exit(1);
}

console.log("  Decomposing...\n");
const onEvent = (e: AgentSessionEvent) => {
  if (e.type === "tool_execution_end" || e.type === "agent_end") process.stdout.write(`  · ${e.type}\n`);
};

const result = await decomposeIdea(idea, {
  backend,
  onEvent,
  modelOverride: pmOverride ? { provider: pick.provider, model: pick.model } : undefined,
});

console.log(`\n  --- BACKLOG (${result.provider}/${result.modelId}) ---`);
for (const t of result.backlog.tasks) {
  const dep = (t.dependsOn ?? []).length ? `  <- ${(t.dependsOn ?? []).join(",")}` : "";
  const grp = t.epic ? `${t.epic}${t.story ? "/" + t.story : ""}  ` : "";
  console.log(`  ${t.id.padEnd(6)} [${t.capability}/${t.difficulty}] ${grp}${t.title}${dep}`);
}
if (result.diagnostics.length) {
  console.log(`\n  Normalizer notes:`);
  for (const d of result.diagnostics) console.log(`    ! ${d}`);
}

// Route the whole backlog and total the cost.
const decisions = routeBacklog(result.tasks, { policy: { ...DEFAULT_POLICY, backendMode: backend } });
console.log(`\n  --- ROUTING PLAN ---`);
console.log("  " + "TASK".padEnd(7) + "CAP/DIFF".padEnd(16) + "MODEL".padEnd(22) + "COST");
for (const d of decisions) {
  const t = result.tasks.find((x) => x.id === d.taskId)!;
  console.log(
    "  " + d.taskId.padEnd(7) +
      `${t.capability}/${t.difficulty}`.padEnd(16) +
      d.model.name.padEnd(22) + money(d.cost),
  );
}
console.log(`\n  Tasks: ${result.tasks.length}   Estimated total: ${money(decisions.at(-1)?.runningTotal ?? 0)}\n`);
