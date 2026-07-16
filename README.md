# Projectinator

Multi-LLM app-building pipeline. You hand it an idea; a project-manager model breaks it
into a Scrum backlog (epic → story → task) and dispatches each task to the model that's
provably best — and cheapest — for that exact job. Built to ride the [Pi](https://pi.dev)
harness (Node/TS).

**Core principle:** roles bind to `capability + tier`, never to a model name. A swappable
registry maps capabilities to models. New frontier model next month → edit one config file
→ every route updates. Adaptable by construction.

## Quick start

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # or OPENAI_API_KEY / GEMINI_API_KEY
npm start
```

`npm start` launches the TUI: type what you want to build, confirm the estimated cost,
and watch the team build it live (tasks, spinners, budget bar). That's the whole product.
The `npm run …` commands below are the same engine exposed for scripting/CI.

## Status — full pipeline + TUI, live end-to-end

Phase 1 = the brain. Phase 2 = one Developer agent. Phase 3 = idea → backlog. Phase 4 = run the whole backlog: PM → Designer → Developer → Tester with handoffs + a Tester→Dev feedback loop. Plus a polished Ink TUI front end.

| Module | Job |
|---|---|
| `src/types.ts` | The three schemas: Task, RegistryEntry, RoutingPolicy (+ Model pricing) |
| `src/models.ts` | Model pricing table — ids kept identical to Pi's built-in registry |
| `src/registry.ts` | The swappable brain: capability + tier → model, per backend, with tier fallback |
| `src/cost.ts` | Token estimate × price → USD (handles cache rates + volume tiers) |
| `src/estimate.ts` | **Token buckets by capability×difficulty — estimation in code, not the model** |
| `src/router.ts` | Deterministic dispatch: task → backend → model → cost → budget check |
| `src/executor.ts` | Runs a task on a real Pi session; reads back Pi's own token+cost stats |
| `src/pm.ts` | PM decomposer: idea → epic/story/task via a forced typebox tool call |
| `src/orchestrator.ts` | **Toposort + run backlog + Tester→Dev feedback loop + budget halt (executor injected)** |
| `src/roles.ts` | **Per-role prompts, Tester verdict tool, provider-lock, the real Pi executor** |
| `src/demo.ts` | Feeds a fake landing-page backlog through the router, prints the plan |
| `src/run-dev.ts` | Runs one dev task; dry by default, `--live` to actually build |
| `src/run-pm.ts` | Decomposes an idea into a routed backlog; `--live`, `--pm <provider/id>` |
| `src/run-build.ts` | Full end-to-end build; `--mini`, `--live`, `--lock <provider>` |
| `src/scout.ts` | **Findings → proposed registry diff (semi-auto adaptability)** |
| `src/registry-store.ts` | **Load/merge/save `registry.overrides.json` — the registry is now data-driven** |
| `src/run-scout.ts` | Propose (and `--apply`) registry updates from findings |
| `src/research.ts` | **Extract structured findings from a research report via a model** |
| `src/run-research.ts` | `report.txt` → validated `findings.json` for the Scout |
| `src/build-state.ts` | **Checkpoint/restore a build (save & resume, no re-paying)** |

```bash
npm start                # the TUI — the simple way to use it
npm run demo             # routing plan (seed + any scout overrides)
npm run dev:task -- --live                       # Phase 2 LIVE: one dev agent
npm run pm -- --live "your idea"                  # Phase 3 LIVE: decompose + route
npm run build -- --mini                           # Phase 4 DRY: tiny 3-task plan
npm run build -- --live --mini                    # Phase 4 LIVE: mini end-to-end (~$0.10)
npm run build -- --live --lock anthropic "idea"   # Phase 4 LIVE: full pipeline, one provider
npm run build -- --live --mini --resume           # resume a halted/finished build (skips done tasks)
npm run build -- --fan --concurrency 2            # DRY: fan-out backlog, 2 tasks at once
npm run build -- --live --fan --concurrency 2     # LIVE: independent branches run in parallel
npm run research -- report.txt --live            # extract findings.json from a report
npm run scout -- --from findings.json            # propose registry changes from findings
npm run scout -- --from findings.json --apply    # apply -> writes registry.overrides.json
npm test                 # 84 tests
npm run typecheck
```

### Parallel execution
`--concurrency N` runs independent tasks (all dependencies satisfied) at once, up to N.
A ready-set scheduler launches whatever is unblocked; dependents wait; a budget reservation
on in-flight estimates prevents launches that could cross the cap. `concurrency=1` (default)
is the unchanged sequential path. JS is single-threaded, so state mutations between awaits are
atomic — no locks. Caveat: tasks share one workspace, so parallel tasks writing the *same file*
could race (independent tasks touch different files by design). Live-proven: a fan-out backlog
built two design specs, then two pages, two-at-a-time, then joined for the test — est $0.41 vs
actual $0.40.

### Save & resume
Every build checkpoints its backlog + finished task outcomes to `build-state.json` in the
workspace after **each task**. If a run halts (budget cap), crashes, or you cancel it, re-run
with `--resume`: finished tasks are skipped (their output still feeds dependents), the running
cost is restored, and only the remainder executes. Live-proven: a completed mini build re-run
with `--resume` skipped all 3 tasks and spent **$0**.

### The full adaptability loop (Phase 5)
```
research report (text)  ->  npm run research --live  ->  findings.json
                        ->  npm run scout --from      ->  registry diff  ->  --apply
```
A model reads the report and extracts validated `Finding[]` (a forced tool + a check that
every model exists in `models.ts` with a matching provider). The Scout diffs those against
the live registry and, on `--apply`, writes `registry.overrides.json`. Live-proven: a prose
benchmark summary became 5 findings and a `code/mid: sonnet → opus` proposal, no code edits.

### Scout — staying current (Phase 5)
The registry is the swappable brain; the Scout keeps it current without code edits.
Feed it **findings** (best model per capability+tier — the deep-research harness emits
exactly this), and it computes a diff against the live registry: updates, additions,
no-ops, and an **unknown-model guard** (refuses to apply a model not in `models.ts`).
Semi-auto: you see the diff, then `--apply` writes `registry.overrides.json`, which
`loadRegistry()` merges over the seed. New frontier model next month → one JSON write →
every route follows. Proven end-to-end: a finding flipped `code/high` from Opus 4.8 to
Fable 5 with no code change.

### Orchestration (Phase 4)
- **Toposort** on `dependsOn` → tasks run after their dependencies.
- **Handoff**: each task sees its dependencies' final output as context (design spec → developer).
- **Feedback loop**: a failing Tester verdict re-runs the code dependency with a bug report, then re-tests, bounded by `maxFeedbackRounds`.
- **Budget halt**: stops before a task whose estimate would cross `budgetCapUSD`.
- The executor is **injected**, so the whole control flow is unit-tested offline with a fake — no spend.
- **`--lock <provider>`** routes every role to one provider (use the one you hold a key for).

Live-validated: the `--mini` design→code→test pipeline built a real `index.html` from a design spec, Tester passed it, total **$0.09**.

### Structured output (how the PM guarantees a valid backlog)
Pi has no native structured output. The PM model is given exactly ONE tool —
`submit_backlog`, whose typebox schema **is** the backlog shape — and must call it.
No JSON-from-prose parsing; the schema validates at the tool boundary. (`typebox@1.1.38`,
pinned to Pi's bundled version so `TSchema` types are identical.)

### Live run (spends money)

`--live` is opt-in and key-gated. Set the provider's key first, e.g.:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm run dev:task -- --live
```

The agent builds into `.workspace/<task-id>/`, then prints estimated vs Pi's actual cost.

### Verified about Pi (v0.80.7)
- Every roster model resolves in Pi's built-in registry **offline** (no key needed to resolve).
- Pi's prices match our table exactly; our model ids are kept identical to Pi's on purpose (no alias layer).
- Pi computes its own token usage + dollar cost per session (`getSessionStats()`), so "actual" cost is authoritative.

### Backend-conditional routing (the key mechanic)

Same capability resolves to different models depending on how you connect:

- **web** = your existing web subscription, ~free → registry picks the strongest model (e.g. code → Fable 5, 95% SWE-bench)
- **api** = metered → registry picks the cost-appropriate model (e.g. code → Opus 4.8, 88.6%), and may prompt you per role

`backendMode` policy: `"ask"` (prompt per run) · `"cost-first"` (default → web) · `"api"` · `"web"`.

## Known gaps / TODO
- **Web cost is notional.** The estimator prices every backend by tokens; real web-login cost ≈ flat subscription. Add a "sub vs metered" cost mode so cost-first comparisons are honest.
- Token estimates in tasks are hand-supplied; a real estimator (heuristic or a cheap model) comes with the PM decomposer.
- Roster/prices are a July-2026 snapshot — the registry is meant to move (see the Scout, Phase 5).

## Remaining
- **Scout** ✅. **Auto-findings** ✅. **Calibration** ✅. **Save & resume** ✅. **Parallel** ✅. **TUI** ✅.
- **Packaging for distribution**: `npm link` / `bin` entry + `npx projectinator`; bundle so buyers run one command.
- **Web-login backend**: the ~free path — a custom Pi provider behind the same interface (brittle; ToS caveats).
- **Per-task workspace isolation**: let parallel code tasks that touch the same file run safely (git worktrees).
- **Self-calibration**: feed measured `getSessionStats` back into `estimate.ts` buckets automatically.
- **In-TUI settings**: edit budget cap / concurrency / provider from the UI; resume picker.

Design doc: https://claude.ai/code/artifact/88a1e6ce-e4df-41c0-b703-e30ac85599b0
