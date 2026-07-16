# Projectinator — Roadmap / TODO

PM cockpit for running an AI dev team. Pipeline: idea → backlog → design → code → test, best model per role, cost tracking.

## Done
- [x] Multi-LLM pipeline (idea → backlog → design → code → test), per-role routing, cost tracking
- [x] TUI cockpit: board editor, Kanban, project board, team, standup, settings, exit stats
- [x] Save / resume builds, parallel execution, mid-build gate, self-calibration
- [x] Multi-file apps (dev inspects + builds on existing tree; design defines file structure)
- [x] Export → Markdown, CSV, Jira CSV, Trello CSV
- [x] Deploy → Cloudflare Pages / Vercel / Netlify (user picks target)

## Top 3 (done)
- [x] **Real test execution** — tester RUNS the app headless (Playwright check_app), catches runtime JS errors, not just reads code
- [x] **Live preview** — local server serves the build + auto-reloads on change (👁 Live preview)
- [x] **Model bake-off / case study** — `npm run bakeoff` + TUI (Home → 🆚 Compare models): runs one task across models, judges quality, compares cost/latency, saves winner to the registry (the founding goal). Next: cross-provider once keys work, code bake-off with test scoring

## Backlog (brainstorm 2026-07-16)

### Build quality
- [x] Git per build — init repo in workspace, commit per task → history + diffs (History view). Undo-a-task: reverts files (git reset) + rolls back build-state so Resume rebuilds it
- [ ] Framework choice — React/Vite, Next scaffolds (beyond vanilla HTML/JS)

### PM cockpit depth
- [x] Retro — 📊 Retro (project screen): status/cost/tests, cost-by-epic bars, cost-by-model, priciest tasks, rebuilds, tester flags. Free (from build-state). Next: optional AI narrative (what went well / to improve)
- [ ] Burndown / velocity — ASCII charts: progress + spend over time
- [x] Estimates vs actuals — Retro shows predicted-vs-actual build cost (Δ%); Settings → 📈 Estimate accuracy shows baseline-vs-measured output tokens per bucket + sample count + whether calibration is live
- [ ] Portfolio dashboard — all projects, total spend, statuses at a glance
- [ ] Task comments / notes

### Robustness
- [x] Provider fallback — routed provider errors / returns 0 tokens → auto-retry the same-strength model on another key-holding provider (executor-level, both build paths). CLI prints the fallback
- [ ] Per-project budget cap + alerts

### Sharing
- [ ] Zip / share a build
- [ ] Template save + share (templates.ts exists)

### Packaging (deferred)
- [ ] Bundle to install/run/share without `npm run` (npm binary or installer)

### Parked
- [ ] Web-login (paid subs in-app) — OAuth spoof closed by vendors 2026; browser automation half-works Claude; behind PROJECTINATOR_WEB=1

### Deferred / low-value
- [ ] Git-worktree isolation per task
