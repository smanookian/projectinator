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
- [ ] Task comments / notes

### Robustness
- [x] Provider fallback — routed provider errors / returns 0 tokens → auto-retry the same-strength model on another key-holding provider (executor-level, both build paths). CLI prints the fallback
- [x] Per-project budget cap — 💰 Budget cap on the plan screen (new build) and project screen (existing) overrides the global default; persisted in build-state, carried into resume/change; the orchestrator halts at the effective cap
- [x] Budget alert — soft warning during the build once spend crosses a configurable % of the effective cap (Settings → Preferences → "Alert at % of cap", default 80), before the hard halt

### Sharing
- [ ] Zip / share a build
- [x] Template save + share — 💾 Save as template (from a project); picker shows built-in + user templates (★); 📥 Import a shared .pitemplate.json; 🗂 Manage → export (share) / delete. Persisted in ~/.projectinator/templates.json

### Packaging (deferred)
- [ ] Bundle to install/run/share without `npm run` (npm binary or installer)

### Parked
- [ ] Web-login (paid subs in-app) — OAuth spoof closed by vendors 2026; browser automation half-works Claude; behind PROJECTINATOR_WEB=1

### Deferred / low-value
- [ ] Git-worktree isolation per task
