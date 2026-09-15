# Projectinator — Roadmap / TODO

PM cockpit for running an AI dev team. Pipeline: idea → backlog → design → code → test, best model per role, cost tracking.

## Done
- [x] Multi-LLM pipeline (idea → backlog → design → code → test), per-role routing, cost tracking
- [x] TUI cockpit: board editor, Kanban, project board, team, standup, settings, exit stats
- [x] Save / resume builds, parallel execution, mid-build gate, self-calibration
- [x] Multi-file apps (dev inspects + builds on existing tree; design defines file structure)
- [x] Export → Markdown, CSV, Jira CSV, Trello CSV
- [x] Deploy → Cloudflare Pages / Vercel / Netlify (user picks target)
- [x] PM intake — a vague request (bare template, one-liner) triggers 2-4 AI-generated clarifying questions with pickable options (+ Other/Skip) before planning; specific requests skip straight through
- [x] Deep plan / council — opt-in per build (Quick vs Deep). Deep runs a council: architect + product + risk leads propose epics in parallel, a synthesizer merges them, you approve the epics, then they expand into the task backlog. Quick = today's single-PM decompose

## Top 3 (done)
- [x] **Real test execution** — tester RUNS the app headless (Playwright check_app), catches runtime JS errors, not just reads code
- [x] **Live preview** — local server serves the build + auto-reloads on change (👁 Live preview)
- [x] **Model bake-off / case study** — `npm run bakeoff` + TUI (Home → 🆚 Compare models): runs one task across models, judges quality, compares cost/latency, saves winner to the registry (the founding goal). Next: cross-provider once keys work, code bake-off with test scoring

## Backlog (brainstorm 2026-07-16)

### Build quality
- [x] Git per build — init repo in workspace, commit per task → history + diffs (History view). Undo-a-task: reverts files (git reset) + rolls back build-state so Resume rebuilds it
- [x] Framework choice — stack picker (platform → web framework: vanilla / React-CDN / let-AI-decide / custom) before planning; Settings default to skip; choice threads into the brief. React is CDN/no-build so it runs in the existing static test/preview/deploy. Verified a React counter builds + passes the tester. Next: Vite-with-build (needs npm in the sandbox), mobile/desktop toolchains

### PM cockpit depth
- [x] Retro — 📊 Retro (project screen): status/cost/tests, cost-by-epic bars, cost-by-model, priciest tasks, rebuilds, tester flags. Free (from build-state)
- [x] AI-narrative retro — on-demand "what went well / what to improve / next time" written by a model over the retro facts; cached on build-state (🧠 Generate/Regenerate in the Retro screen)
- [x] Burndown — 📉 Burndown (project screen): ASCII bars of tasks-remaining + cumulative spend across completion order; retries flagged
- [x] Estimates vs actuals — Retro shows predicted-vs-actual build cost (Δ%); Settings → 📈 Estimate accuracy shows baseline-vs-measured output tokens per bucket + sample count + whether calibration is live
- [x] Portfolio dashboard — Home → 📊 Portfolio: project count, total spend, status breakdown, and a per-project spend bar + done/total progress
- [x] Task comments / notes — shipped as **Task notes** (see 2026-09-14 backlog)

### Robustness
- [x] Provider fallback — routed provider errors / returns 0 tokens → auto-retry the same-strength model on another key-holding provider (executor-level, both build paths). CLI prints the fallback
- [x] Per-project budget cap — 💰 Budget cap on the plan screen (new build) and project screen (existing) overrides the global default; persisted in build-state, carried into resume/change; the orchestrator halts at the effective cap
- [x] Budget alert — soft warning during the build once spend crosses a configurable % of the effective cap (Settings → Preferences → "Alert at % of cap", default 80), before the hard halt

### Sharing
- [x] Zip / share a build — project → Ship → **Share**: `zip` when present, else `tar.gz`; excludes build-state/.git/.deploy/node_modules
- [x] Template save + share — 💾 Save as template (from a project); picker shows built-in + user templates (★); 📥 Import a shared .pitemplate.json; 🗂 Manage → export (share) / delete. Persisted in ~/.projectinator/templates.json

### Packaging (deferred)
- [x] Bundle to install/run/share without `npm run` — `npm i -g projectinator` ships compiled `dist/`; `projectinator` / `projectinator <command>` work with no tsx

### Parked
- [ ] Web-login (paid subs in-app) — OAuth spoof closed by vendors 2026; browser automation half-works Claude; behind PROJECTINATOR_WEB=1

### Deferred / low-value
- [ ] Git-worktree isolation per task — same as "Worktree-parallel code tasks" below

## Backlog (brainstorm 2026-09-14)

Direction: all audiences (solo builders, devs with real repos, model evaluators, teams). Non-static stacks run directly on the host (no Docker). Ship many small robustness/polish items first; one medium feature designed at a time.

### Next batch (decided)
- [x] **Per-task timeout + cost ceiling** — Settings → Preferences: "Task timeout (min)" + "Task cost cap (USD)" (defaults 10 / $3, 0 = unlimited). The Pi executor aborts the session on breach and throws `TaskLimitError`; the orchestrator bills the attempt, records a failed outcome (`error`), emits `task_failed`, and halts with the reason. Failed outcomes never count as done — `completedIds` excludes them so Resume rebuilds the task. A breach never falls back to another provider.
- [x] **Playwright-missing warning** — `chromiumAvailable()` probe (`preview.ts`); `check_app` refuses with the install hint instead of failing opaquely; `Verdict.runtimeChecked` is true only after a real render. Board/Kanban/Standup show **PASS\*** (amber) for un-executed passes; build + done screens carry a banner; CLI prints `PASS* (app not executed — no Chromium)`. Read-only testing still runs.
- [x] **Task notes** — `Task.notes`; `n` in the plan board and the project board editor (allowed on built tasks too — it changes nothing that ran). Shown as `✎ …` on both editors and the Kanban; included in the Markdown/CSV export. Never sent to a model (`buildRolePrompt` only reads id/title; test pins it).

### Small (independently shippable; reuse existing seams)
- [x] Per-task transcript view — project → Reports → **Transcripts**: every outcome (retries included) with role/model/cost/verdict; pick one to read the role's final text, verdict bugs, and files. ↑↓/PgUp/PgDn scroll. Page size is `termRows − 18` (measured frame chrome + 1 slack; less and Yoga squeezes a row).
- [x] Per-commit diff viewer — History rows are now selectable; pick a commit → `--stat` + full patch, colored (+ green / − red / @@ amber), same pager as Transcripts. `git.ts` `commitDiff()`.
- [x] Per-model calibration — `recordActual` folds every run into `cap/diff` **and** `cap/diff/model`; `route()` prices with the model row once it has ≥2 samples (reason line: "tokens from measured runs on …"), otherwise leaves the task's estimate untouched. Settings → Estimate accuracy shows model rows indented under each bucket.
- [x] Webhook notify on done/halt — Settings → Build defaults → **Webhook**; POSTs `{event:"build.finished", status, haltReason?, idea, totalCost, files, workspace, at}` from both the cockpit and `projectinator build` (which also emits a `webhook` NDJSON event with `ok`). 5 s timeout, never throws.
- [x] Headless JSON CLI mode — shipped as `projectinator build --json` (NDJSON: plan, every orchestrator event, done, webhook).
- [x] Model-choice cost matrix on the plan screen — `costMatrix()` prices the backlog under the current roster and each key-holding provider locked, cheapest first, current row marked ▶. Shown only when there's more than one option.
- [x] Tier-bump escalation — `route()` takes `tierBump`; the feedback loop re-runs the developer with `tierBump: 1` (fast→mid→high, capped; registry nearest-tier fallback covers single-row capabilities). The judge (review/test) keeps its routed model. Decision trail says "escalated from <tier>".
- [x] "Stuck task" indicator — every run's wall time is recorded into calibration (`ms`, per bucket and per model). The live board shows `m:ss` on running cards and an amber `slow` badge once elapsed > max(60 s, 2× typical, ½ task timeout); header counts slow tasks. Rule is pure in `stuck.ts`.
- [x] Compiled `dist` — `tsconfig.build.json` emits `dist/` (src layout, sourcemaps); `bin` imports `dist/cli.js` / `dist/tui.js` in-process and falls back to tsx for a dev clone. `files: [bin, dist]`, `tsx` → devDependency. Tarball 192 kB. Tests verify the launcher runs dist without tsx and that the compiled import graph resolves every registry pick.
- [x] Import an existing folder as a project — Home → **Import an existing folder**: copies the folder (skipping `node_modules`/`.git`/`dist`/…) into a fresh workspace, writes an empty "complete" backlog, `git init`s, and lands on the project screen so "Add to backlog" plans the first change against the real files (`buildProjectContext`). `engine.ts` `importProject()`.

### Medium (design doc before code)
- [x] **Reviewer role** — sixth capability `review`: PM plans one after every code task (test depends on the review); cheap read-only session (no `bash`, no `check_app`) ending in `submit_verdict`; a FAIL re-runs the code via the same Tester→Dev loop; the Tester's fix round resolves code deps *through* review tasks. Settings → Models has a Reviewer slot; registry holds one `fast` row so every difficulty routes cheap. Design: [`docs/REVIEWER.md`](docs/REVIEWER.md).
- [x] Richer tester — all four pieces shipped: 3-viewport screenshots + overflow signal; a11y/basics facts (`a11y.ts`); `interact_app` step script (Tester-only); visual delta vs the previous run (`visual-diff.ts`, zero-dep PNG decode) shown in Transcripts and History. Design: [`docs/TESTER.md`](docs/TESTER.md).
- [ ] Vite/npm stack on host, then Node/Express and Python backend targets — **Vite shipped** (steps 1–3 of the design; live-verified). Node: planned/coded, tester spawn-and-probe pending (step 4). Python after Node. Design in [`docs/STACKS.md`](docs/STACKS.md): one *stack profile* (install/build/serve/entry/deployDir/doubleClick) read by every stage; 4 shippable steps; 3 open questions.
- [ ] Worktree-parallel code tasks (today code tasks serialize even in parallel mode)
- [ ] Mid-build steering — pause, inject/edit a task, resume without losing in-flight work
- [ ] Escalation ladder beyond tier-bump — Designer re-spec, then bounded PM re-plan
- [ ] Sprints — group tasks, velocity, burndown per sprint
- [ ] Auto-scout from an OpenRouter rankings/pricing feed → proposed registry diff (scout is already pure; it lacks a source)
- [ ] Bake-off upgrades — cross-provider, code bake-off scored by the real tester, quality/$ Pareto
- [x] GitHub push + PR per build; export backlog to GitHub Issues — `github.ts` over `gh`: Publish (create+push), change builds on published/imported projects run on a `projectinator/…` branch → Open PR (body = task table + cost), Issues export (epic = label, idempotent). Owned repos push `main`; pre-existing remotes are branch+PR only. Bookkeeping excluded via `.git/info/exclude`. Verified live on a throwaway repo (PR #1, issue, clean tree).
- [ ] MCP server exposing Projectinator
- [x] Local models (Ollama/LM Studio/vLLM) — verified: Pi loads `~/.pi/agent/models.json`; we own one entry, provider id `local` (`local-models.ts`). Settings screen probes `GET /models`, user picks ids; `Provider` gains `"local"`; `$0`; available without a key; never a cloud fallback; `lockRegistryToProvider("local")` picks the biggest-looking id for strong slots.
- [ ] Homebrew / Docker packaging
