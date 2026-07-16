// Phase 2 entry — route ONE developer task and (optionally) run it on a real Pi agent.
//
//   npm run dev:task            dry run: resolve model + print plan/prompt, NO api call, NO spend
//   npm run dev:task -- --live  actually run the agent (spends money, needs an API key)
//
// Dry mode proves the whole wiring offline. Live mode is opt-in and key-gated.

import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { Task } from "./types.js";
import { DEFAULT_POLICY, route } from "./router.js";
import { buildDeveloperPrompt, executeTask, resolvePiModel } from "./executor.js";

const TASK: Task = {
  id: "T-DEV1",
  story: "S-1",
  title: "Create a single-file landing page (index.html) for 'Projectinator' with a hero headline, one-line pitch, and a contact form (name, email, message) styled with embedded CSS. No external assets.",
  capability: "code",
  difficulty: "high",
  estTokens: { input: 40_000, output: 12_000, cachedInputFraction: 0.3 },
};

const live = process.argv.includes("--live");

// Route it. Web-login backend isn't built yet -> use API.
const policy = { ...DEFAULT_POLICY, backendMode: "api" as const };
const decision = route(TASK, { policy });

const auth = AuthStorage.create();
const registry = ModelRegistry.create(auth);
const piModel = resolvePiModel(registry, decision.provider, decision.model.id); // offline, free

const money = (n: number) => `$${n.toFixed(2)}`;

console.log(`\n  Projectinator — Phase 2 developer run   [${live ? "LIVE" : "DRY"}]\n`);
console.log(`  Task     ${TASK.id}: ${TASK.title.slice(0, 64)}...`);
console.log(`  Routed   ${decision.provider}/${decision.model.id}  (tier=${decision.tier}, backend=${decision.backend})`);
console.log(`  Pi model resolved: ${piModel.id}  ctx=${piModel.contextWindow}  in/out=${piModel.cost?.input}/${piModel.cost?.output}`);
console.log(`  Est cost ${money(decision.cost)}\n`);

if (!live) {
  console.log("  --- developer prompt (not sent) ---");
  console.log(buildDeveloperPrompt(TASK).split("\n").map((l) => "  | " + l).join("\n"));
  console.log("\n  Dry run only. Wiring verified: task routed, Pi model resolved, prompt built.");
  console.log("  Re-run with --live (and an API key) to actually build.\n");
  process.exit(0);
}

// --- LIVE PATH: spends money ---
const envKey: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
};
const keyPresent = (envKey[decision.provider] ?? []).some((k) => !!process.env[k]);
if (!keyPresent) {
  console.error(
    `  No API key for ${decision.provider}. Set one of: ${(envKey[decision.provider] ?? []).join(", ")}\n`,
  );
  process.exit(1);
}

// fileURLToPath decodes %20/%7E etc. — URL.pathname would leave them encoded and
// create a literally-named "Mobile%20Documents" directory.
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workspace = join(projectRoot, ".workspace", TASK.id);
mkdirSync(workspace, { recursive: true });
console.log(`  Workspace: ${workspace}\n  Running agent...\n`);

const onEvent = (e: AgentSessionEvent) => {
  process.stdout.write(`  · ${e.type}\n`);
};

const result = await executeTask(TASK, decision, { workspace, onEvent });

console.log(`\n  --- done ---`);
console.log(`  Files:   ${result.files.join(", ") || "(none)"}`);
console.log(`  Tokens:  in=${result.actual.input} out=${result.actual.output} cacheRead=${result.actual.cacheRead} total=${result.actual.total}`);
console.log(`  Est:     ${money(result.estCost)}`);
console.log(`  Actual:  ${money(result.actualCost)}   (delta ${money(result.costDelta)})\n`);
