# Projectinator — internal docs

For us. How it's built, how to run/develop it, how to extend it, and what to watch out for.

## The one-sentence architecture

A **capability→model registry** + a **deterministic router** feed a **backlog orchestrator**
that runs each task on an injected **Pi executor**, all driven from an **Ink TUI** state machine.
Roles bind to `capability + tier`, never to a model name — so the roster is swappable data.

## The build pipeline (end to end)

```
idea (raw string, kept raw)
  → stack       StackPick → StackChoice           (or Settings default)
  → assessing   assessIntake() → questions?        (skip if specific / scope=change)
  → intake      Intake wizard → answers
  → planMode    Quick | Deep
        Deep:   councilEpics() [architect|product|risk ∥] → synth → approve
  → planning    decomposeIdea(brief, {epics?}) → routed Task[] + estimate
  → plan        approve / board / build
  → building    runBacklog(): toposort → design→code→review→test, Reviewer/Tester→Dev feedback, budget halt
  → done        files + retro + deploy/export/preview
```

The brief the planner sees is composed **purely** from state:
`composeBrief() = idea + stackInstruction(stackChoice) + enrichBrief(intakeAnswers)`.
`idea` is never mutated — this is why navigating back through stack/intake can't double-append.

## Module map

**Core engine (`src/`)**

| File | Job |
|---|---|
| `types.ts` | Task, RegistryEntry, RoutingPolicy, Model, Verdict, TaskOutcome |
| `models.ts` | Model pricing table (ids identical to Pi's registry — no alias layer) |
| `registry.ts` / `registry-store.ts` | capability+tier→model, per backend; merge `registry.overrides.json` |
| `cost.ts` / `estimate.ts` / `calibration.ts` | token estimate × price → USD; buckets self-calibrate from real runs |
| `router.ts` | task → backend → model → cost → budget check |
| `executor.ts` | resolve a Pi model; run a session |
| `roles.ts` | per-role prompts, Tester verdict + `check_app`/`interact_app` tools, provider-lock, **the real Pi executor + provider-fallback chain**, per-task timeout/cost abort (`TaskLimitError`) |
| `pm.ts` | `decomposeIdea` — forced-tool backlog; accepts approved `epics` |
| `intake.ts` | `assessIntake` (clarifying questions) + `enrichBrief` |
| `council.ts` | `councilEpics` — 3 lenses ∥ → synthesize epics |
| `orchestrator.ts` | toposort + run backlog + Tester→Dev loop + ready-set scheduler (`isolate` for worktree-parallel code, `control` for pause/inject/remove/stop, `replan` for the escalation ladder's PM split) + budget halt + limit-breach → failed outcome & halt |
| `build-state.ts` | checkpoint/restore (save & resume) |
| `preview.ts` | static server (+live-reload) and `renderCheck` (headless render + viewports + a11y facts) and `interactCheck` (step script) |
| `bakeoff.ts` | one task across the roster: LLM judge (text) or scratch-dir build + real Tester verdict (code); Pareto frontier |
| `narrate.ts` | AI retro narrative |
| `retro.ts` / `burndown.ts` / `sprints.ts` | pure analytics from build-state (sprints: per-run outcome slice → done/retries/cost/velocity) |
| `mcp.ts` | MCP server (stdio): plan/build/build_status/build_control/projects/models over engine.ts |
| `scout-feed.ts` | pure: OpenRouter catalog → price drift, new models, findings for `scout.ts` |
| `stack.ts` | platform/framework → brief instruction; **stack profiles** (install/build/serve/outDir/deployable/doubleClick) every stage reads |
| `local-models.ts` | owns the `local` provider entry in Pi's `~/.pi/agent/models.json` (Ollama/LM Studio/vLLM): probe, read, write |
| `stuck.ts` | pure "slow task" rule (2× typical, ½ timeout, 60 s floor) |
| `visual-diff.ts` | zero-dependency PNG decode + pixel delta between two screenshots |
| `prepare.ts` | install/build for build-stack projects (npm ci --ignore-scripts, vite build), cached by lockfile+source hash; failures returned as text for the Tester |
| `serve.ts` | spawn a server stack on a free PORT, wait for HTTP, kill the process tree (backend tester path) |
| `github.ts` | Publish / PR / Issues via `gh` (injectable runner); ownership rule; `prBody` |
| `a11y.ts` | WCAG contrast math + the in-page quality sweep (`PAGE_FACTS_SCRIPT`) the Tester reads |
| `session-cost.ts` | per-session $ accumulator |
| `run-*.ts` | dev CLI entries (build with fixed mini/fan backlogs, pm, dev, scout, research, bakeoff, web) |
| `cli.ts` | user-facing headless CLI (`doctor`/`build`/`projects`/`models`); `bin/projectinator.mjs` dispatches here for any command, else to the TUI |

**TUI (`src/tui/`)**

| File | Job |
|---|---|
| `App.tsx` | the state machine — one `phase` string, ~40 phases, effects for assessing/council/planning/building |
| `engine.ts` | TUI↔core glue: `planBuild`, `assessBuild`, `councilBuild`, `startBuild`, projects, exporters, deploy/preview/retro/budget wrappers |
| `components.tsx` | `C` color tokens, Header, Panel, Menu/TextField/Password adapters, BudgetBar, Kanban bits |
| `Settings.tsx` | keys, provider, workflow, stack, models, prefs (budget/concurrency/alert%), estimate accuracy |
| `Intake.tsx` / `StackPick.tsx` / `BakeOff.tsx` / `WebAccounts.tsx` | wizards |
| `deploy.ts` | Cloudflare/Vercel/Netlify via their CLI; staging dir |
| `templates.ts` | built-in + user templates; save/export/import |
| `config.ts` | `~/.projectinator/config.json` (0600), prefs getters/setters |
| `Kanban/BoardEditor/EditableBoard/panels/theme/theme-context/icons/notify/validate` | board, editing, standup, dark/light themes + live `C` proxy, role icons, notifications |

## Running & developing

```bash
npm start                 # the cockpit
npm run build -- --live --mini            # cheap headless end-to-end (~$0.10)
npm run bakeoff -- --capability design "…" # model comparison
npm test                  # vitest (283)
npm run typecheck         # tsc --noEmit — run this after every change
```

- **Node ≥ 22.19** (Pi's floor; dev on 24). Dev scripts run TypeScript via `tsx`; the **published
  package ships compiled JS** (`npm run compile` → `dist/`, mirrors `src/`; `bin` prefers `dist/`
  and falls back to tsx on a clone). `tsx` is a devDependency. `prepublishOnly` compiles first
  so the dist tests exercise the fresh build.
- **`npx playwright install chromium`** is required for `renderCheck` (the tester) + web-login.
- The executor is **injected** into the orchestrator, so all control-flow logic is unit-tested
  offline with a fake — no spend. Live runs are behind `--live` and key-gated.
- Keys resolve **offline** in Pi's registry; you only need a key to actually call a model.

### Gotchas (hard-won)

- **typebox pinned to Pi's bundled version** (`1.3.7` for pi-coding-agent 0.85.1) or `TSchema` types diverge.
- **Model ids + prices must match Pi's catalog exactly** — `test/executor.test.ts` resolves every
  `models.ts` entry through `ModelRuntime` and pins input/output rates. Upgrading Pi = rerun it,
  then copy any repriced rows. Pi's catalog lives at
  `node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/models.generated.js`.
- Sessions are created with `modelRuntime: await piRuntime()` (`executor.ts`); Pi ≥ 0.85 removed
  `AuthStorage`/`ModelRegistry` from the SDK. The runtime is built per call so a key saved in
  Settings applies to the next session.
- Forced-tool schemas must be **permissive** (`additionalProperties: true`, loose enums coerced
  in code) or the tool call fails *invisibly* (Pi rejects it, your capture never fires). See
  `pm.ts` / `intake.ts` / `council.ts`.
- Icons must be **Emoji_Presentation=Yes** codepoints — VS16 emoji (⚙️) render 1-wide and break
  TUI alignment. Use 🔧🟢📊🆚 etc.
- Any TUI phase with a text input **must** be in the `typing` guard in `App.tsx`, or a "q"
  keystroke quits the app (both `useInput` handlers see every key).
- `Date.now()`/`Math.random()` are fine in the app/CLI but **not** inside Workflow scripts.

## How to extend

- **Add/retune a model** → `models.ts` + `registry.ts` (or run a bake-off and save the winner).
- **Add a template** → `TEMPLATES` in `tui/templates.ts` (or save one in-app).
- **Add a deploy target** → `DEPLOY_META` + `buildArgs()` in `tui/deploy.ts`.
- **Add a role/capability** → `Capability` in `types.ts`, then let `tsc` list every `Record<Capability, …>` table (`estimate.ts`, `roles.ts` ×2, `components.tsx` ×2); plus the string lists it can't see: `pm.ts` `CAPS`, `roles.ts` `lockRegistryToProvider`, both board editors' `CAPS`, `engine.ts` `ROLE_TIERS`, and a registry row. The Reviewer (2026-09) is the worked example.
- **Add a TUI screen** → new `phase`, a render branch, a `goBack` case, and (if it has an input)
  add it to the `typing` guard.
- **Tune estimates** → buckets in `estimate.ts`; they self-calibrate, view accuracy in Settings.

## Known limitations

- **Web-login (paid subs)** is parked behind `PROJECTINATOR_WEB=1`. OAuth-spoof is blocked by
  vendors (2026); browser automation half-works for Claude but is brittle + ToS-violating. See
  the memory note. Do not promote it.
- **React = CDN/no-build.** Vite-with-build needs reliable `npm install` in the task sandbox.
- **Projects dir**: `tuiRoot()` = `$PROJECTINATOR_HOME/projects` or `<root>/.workspace/tui`. Docker sets it to `/data`.
- **Parallel code tasks are opt-in** (worktrees, merged per task). Off = the old one-code-task-at-a-time rule.
- **Mobile/Desktop** stacks currently fall back to a web build.
