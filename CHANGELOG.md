# Changelog

## 0.3.1 — 2026-09-15

### Added
- **Headless CLI** — `projectinator doctor | build | projects | models`, routed by the launcher
  (`src/cli.ts`, same engine and workspace as the cockpit).
  - `doctor`: Node ≥ 22.19, per-provider keys (env or app config), Pi catalog resolves every
    registry pick, headless Chromium, git, data dir, prefs. Exit 1 on a blocking problem.
  - `build "<idea>"`: `--dry-run`, `--yes`/`-y`, `--json` (NDJSON events; implies `--yes`),
    `--budget`, `--provider`, `--concurrency`, `--task-cap`, `--task-timeout`. Defaults come from
    your app prefs. Exit 3 when the build halts.
  - `projects`: past builds with status/cost/progress. `models`: effective roster with prices.
- `projectinator --version` / `-v` and `--help` / `-h`. Unknown commands/options exit 2.

### Fixed
- `tsconfig` uses `lib: ES2024` with `target: ES2022`, so vitest's esbuild no longer prints an
  "Unrecognized target environment" warning per file.

## 0.3.0 — 2026-09-15

### Changed
- **Model roster refreshed (Sept 2026).** API picks: Developer high → **Claude Opus 5**
  (96% SWE-bench Verified, same $5/$25 as Opus 4.8); Developer mid → **Claude Sonnet 5**
  ($2/$10 in Pi's table); Developer fast, Reviewer and Tester → **Gemini 3.8 Flash**
  ($0.75/$3.75, 90.8% Terminal-Bench 2.1); web picks move from Fable 5 to **Fable 5.1**. PM,
  Designer and Ops stay on GPT-5.6 Terra/Sol, which OpenAI repriced to $2/$12 and $4/$20.
  Every `evidence` field cites the benchmark. Provider-lock and OpenRouter tables follow.
- **Pi harness `0.80.7 → 0.85.1`** (required for the new catalog). Sessions now use Pi's
  `ModelRuntime` (`AuthStorage`/`ModelRegistry` were removed from the SDK). `typebox` repinned
  to `1.3.7` to match Pi.
- **Node ≥ 22.19** is now required (Pi's floor). Was ≥ 20.
- `models.ts` prices are copied verbatim from Pi's catalog and the test suite pins **every**
  entry's input/output rate against it (was four hand-picked ids).
- Router/scout tests assert routing behaviour against the live registry instead of literal
  model ids, so future roster refreshes don't re-pin them.

### Fixed
- GPT-5.6 Sol/Terra/Luna were over-estimated since OpenAI's price cut; estimates now match.
  The demo backlog estimate drops $7.53 → $7.03.

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
