# Changelog

## 0.2.0 — 2026-09-15

### Added
- **Reviewer role** — a sixth capability, `review`. The PM plans one after every code task; the
  test task depends on it. Runs on a cheap read-only session (no shell, no browser) and ends in a
  structured verdict. A failed review re-runs the developer with the bug report through the
  existing feedback loop. Settings → Models gains a Reviewer slot. Design: `docs/REVIEWER.md`.
- **Per-task timeout + cost ceiling** — Settings → Preferences: *Task timeout (min)* and *Task cost
  cap (USD)*; defaults 10 min / $3, `0` = unlimited. On breach the Pi session is aborted, the
  attempt is billed, the task is recorded as failed, and the build halts (resumable — the failed
  task is rebuilt, its sunk cost kept). A breach never falls back to another provider.
  CLI: `--task-cap USD`, `--task-timeout MIN`.
- **Playwright-missing warning** — when headless Chromium isn't installed the tester says so
  instead of failing opaquely. Verdicts carry `runtimeChecked`; passes that never ran the app show
  as **PASS\*** (amber) on the board with an install hint on the build and done screens.
- **Task notes** — `n` on the plan board or project board editor. Human-only annotation shown on
  cards; never sent to a model; included in Markdown/CSV exports. Allowed on built tasks.
- `CHANGELOG.md` (this file).

### Fixed
- Parallel builds could crash the process: a task error escaped through `Promise.race`, orphaning
  sibling promises whose later rejections were unhandled. Failures are now contained, in-flight
  work drains, state is checkpointed, then the error is rethrown once.
- The Tester's fix loop only looked at *direct* code dependencies; with review tasks between
  code and test it would have found nothing to fix. It now resolves code through reviews.
- Cost estimates rounded every task to cents, so sub-cent tasks estimated as $0.00 and the
  parallel scheduler under-reserved budget. Estimates now keep 4 decimals; display is unchanged.
- The done screen hard-coded "halted (budget cap)"; it now shows the real halt reason.
- The "done" set used for Resume, Kanban, exports and retro was computed inline in seven places;
  all now use `completedIds()`, which excludes failed attempts.

### Changed
- `Verdict` gains a required `runtimeChecked`; `RoleExecutor` receives `limits`;
  `RoutingPolicy` gains `taskLimits`. Older `build-state.json` files still load — historic
  verdicts without the field display as PASS\*.
- The `--mini` and `--fan` CLI backlogs include a review step (mini: +$0.01).
- Test count 140 → 157. Docs: `INTERNAL.md` corrected (Node ≥ 20, test count, module map).

## 0.1.5 — 2026-07-22
- README fixes (test count, OpenRouter in the key-setup line).

## 0.1.4 — 2026-07-22
- Fix crash on the build screen: use `ink-spinner` (Text) not `@inkjs/ui` Spinner (Box) inside `<Text>`.

## 0.1.3 — 2026-07-22
- OpenRouter as a provider + model browser; cockpit screenshot; better 0-token error copy.

## 0.1.2
- README: clarify it's a CLI (`npm i` without `-g` gives no command).
