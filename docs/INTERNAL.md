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
  → building    runBacklog(): toposort → design→code→test, Tester→Dev feedback, budget halt
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
| `roles.ts` | per-role prompts, Tester verdict + `check_app` tools, provider-lock, **the real Pi executor + provider-fallback chain** |
| `pm.ts` | `decomposeIdea` — forced-tool backlog; accepts approved `epics` |
| `intake.ts` | `assessIntake` (clarifying questions) + `enrichBrief` |
| `council.ts` | `councilEpics` — 3 lenses ∥ → synthesize epics |
| `orchestrator.ts` | toposort + run backlog + Tester→Dev loop + parallel scheduler + budget halt |
| `build-state.ts` | checkpoint/restore (save & resume) |
| `preview.ts` | static server (+live-reload) and `renderCheck` (headless test-execution) |
| `bakeoff.ts` | run one task across models + LLM judge |
| `narrate.ts` | AI retro narrative |
| `retro.ts` / `burndown.ts` | pure analytics from build-state |
| `stack.ts` | platform/framework → brief instruction |
| `session-cost.ts` | per-session $ accumulator |
| `run-*.ts` | CLI entries (build, pm, dev, scout, research, bakeoff, web) |

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
| `Kanban/BoardEditor/EditableBoard/panels/theme/notify/validate` | board, editing, standup, amber theme, notifications |

## Running & developing

```bash
npm start                 # the cockpit
npm run build -- --live --mini            # cheap headless end-to-end (~$0.10)
npm run bakeoff -- --capability design "…" # model comparison
npm test                  # vitest (134)
npm run typecheck         # tsc --noEmit — run this after every change
```

- **Node 22+** (dev on 24). TypeScript via `tsx` (no build step for the app itself).
- **`npx playwright install chromium`** is required for `renderCheck` (the tester) + web-login.
- The executor is **injected** into the orchestrator, so all control-flow logic is unit-tested
  offline with a fake — no spend. Live runs are behind `--live` and key-gated.
- Keys resolve **offline** in Pi's registry; you only need a key to actually call a model.

### Gotchas (hard-won)

- **typebox pinned to `1.1.38`** (Pi's bundled version) or `TSchema` types diverge.
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
- **Add a role/capability** → `Capability` in `types.ts`, prompt in `roles.ts`, registry rows.
- **Add a TUI screen** → new `phase`, a render branch, a `goBack` case, and (if it has an input)
  add it to the `typing` guard.
- **Tune estimates** → buckets in `estimate.ts`; they self-calibrate, view accuracy in Settings.

## Known limitations

- **Web-login (paid subs)** is parked behind `PROJECTINATOR_WEB=1`. OAuth-spoof is blocked by
  vendors (2026); browser automation half-works for Claude but is brittle + ToS-violating. See
  the memory note. Do not promote it.
- **React = CDN/no-build.** Vite-with-build needs reliable `npm install` in the task sandbox.
- **Parallel tasks share one workspace** — independent tasks touch different files by design;
  git-worktree isolation is deferred.
- **Mobile/Desktop** stacks currently fall back to a web build.
