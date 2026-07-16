// Phase 1 demo — proves the brain before wiring any agents.
// Feeds a fake "landing page + contact form" backlog through the router and prints
// backend, model, and estimated cost per task, plus the total.
//
// Run: npm run demo            (cost-first / web backend)
//      npm run demo -- api      (force API backend)
//      npm run demo -- ask      (interactive-style; here stubbed to demonstrate)

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { RoutingPolicy, Task } from "./types.js";
import { DEFAULT_POLICY, routeBacklog } from "./router.js";
import { loadRegistry, OVERRIDES_FILENAME } from "./registry-store.js";

const BACKLOG: Task[] = [
  {
    id: "T-01", epic: "E-1", story: "S-1", title: "Break brief into backlog",
    capability: "plan", difficulty: "medium",
    estTokens: { input: 10_000, output: 5_000 },
  },
  {
    id: "T-02", epic: "E-1", story: "S-2", title: "Design hero + layout system",
    capability: "design", difficulty: "high",
    estTokens: { input: 20_000, output: 15_000 },
  },
  {
    id: "T-03", epic: "E-2", story: "S-3", title: "Build page + contact form",
    capability: "code", difficulty: "high", dependsOn: ["T-02"],
    estTokens: { input: 400_000, output: 60_000, cachedInputFraction: 0.6 },
  },
  {
    id: "T-04", epic: "E-2", story: "S-4", title: "Wire form handler",
    capability: "code", difficulty: "low", dependsOn: ["T-03"],
    estTokens: { input: 30_000, output: 8_000, cachedInputFraction: 0.5 },
  },
  {
    id: "T-05", epic: "E-3", story: "S-5", title: "Review + test the build",
    capability: "test", difficulty: "trivial", dependsOn: ["T-03", "T-04"],
    estTokens: { input: 80_000, output: 15_000 },
  },
  {
    id: "T-06", epic: "E-3", story: "S-6", title: "Run it, drive the CI/preview",
    capability: "ops", difficulty: "high", dependsOn: ["T-04"],
    estTokens: { input: 100_000, output: 20_000, cachedInputFraction: 0.4 },
  },
];

const arg = process.argv[2];
const policy: RoutingPolicy = { ...DEFAULT_POLICY };
if (arg === "api") policy.backendMode = "api";
if (arg === "web") policy.backendMode = "web";

// For "ask" mode we'd wire real prompts; here we stub a chooser so the demo runs headless.
const prompts =
  arg === "ask"
    ? {
        chooseBackend: () => "api" as const,
        chooseModel: (_t: Task, _e: unknown, _b: unknown) => undefined, // accept defaults
      }
    : undefined;
if (arg === "ask") policy.backendMode = "ask";

// Load the effective registry (seed + any Scout overrides), so applied Scout
// changes are reflected here.
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const registry = loadRegistry(join(projectRoot, OVERRIDES_FILENAME));

const decisions = routeBacklog(BACKLOG, { policy, registry, prompts });

const pad = (s: string, n: number) => s.padEnd(n);
const money = (n: number) => `$${n.toFixed(2)}`;

console.log(`\n  Projectinator — routing plan   [backendMode=${policy.backendMode}, cap=${money(policy.budgetCapUSD)}]\n`);
console.log(
  "  " +
    pad("TASK", 7) + pad("CAPABILITY", 11) + pad("DIFF", 9) +
    pad("BACKEND", 9) + pad("MODEL", 20) + pad("TIER", 6) + pad("COST", 9) + "RUNNING",
);
console.log("  " + "-".repeat(78));

for (const d of decisions) {
  const task = BACKLOG.find((t) => t.id === d.taskId)!;
  const flag = d.overCap ? "  ⚠ OVER CAP" : "";
  console.log(
    "  " +
      pad(d.taskId, 7) +
      pad(task.capability, 11) +
      pad(task.difficulty, 9) +
      pad(d.backend, 9) +
      pad(d.model.name, 20) +
      pad(d.tier, 6) +
      pad(money(d.cost), 9) +
      money(d.runningTotal) +
      flag,
  );
}

const total = decisions.at(-1)?.runningTotal ?? 0;
console.log("  " + "-".repeat(78));
console.log(`  TOTAL ESTIMATED: ${money(total)}\n`);

console.log("  Decision trail for T-03 (the developer task):");
for (const r of decisions.find((d) => d.taskId === "T-03")!.reasons) {
  console.log("    · " + r);
}
console.log("");
