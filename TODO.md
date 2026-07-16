# Projectinator — Roadmap / TODO

PM cockpit for running an AI dev team. Pipeline: idea → backlog → design → code → test, best model per role, cost tracking.

## Done
- [x] Multi-LLM pipeline (idea → backlog → design → code → test), per-role routing, cost tracking
- [x] TUI cockpit: board editor, Kanban, project board, team, standup, settings, exit stats
- [x] Save / resume builds, parallel execution, mid-build gate, self-calibration
- [x] Multi-file apps (dev inspects + builds on existing tree; design defines file structure)
- [x] Export → Markdown, CSV, Jira CSV, Trello CSV
- [x] Deploy → Cloudflare Pages / Vercel / Netlify (user picks target)

## In progress (top 3)
- [ ] **Real test execution** — tester RUNS the app headless (Playwright), clicks through, catches runtime bugs (not just reads code)
- [ ] **Live preview** — local server serves the build + auto-reloads as tasks finish
- [ ] **Model bake-off / case study** — run one task across Opus/GPT/Gemini, compare cost + quality, feed the routing registry (the original founding goal)

## Backlog (brainstorm 2026-07-16)

### Build quality
- [ ] Git per build — init repo in workspace, commit per task → history, diffs, undo-a-task
- [ ] Framework choice — React/Vite, Next scaffolds (beyond vanilla HTML/JS)

### PM cockpit depth
- [ ] Retro — after a build, auto-summary: what passed, tester flags, cost per epic
- [ ] Burndown / velocity — ASCII charts: progress + spend over time
- [ ] Estimates vs actuals — surface calibration (est vs real cost/tokens per role)
- [ ] Portfolio dashboard — all projects, total spend, statuses at a glance
- [ ] Task comments / notes

### Robustness
- [ ] Provider fallback — 0-token/error → auto-retry on another provider
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
