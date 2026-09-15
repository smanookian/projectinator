# Changelog

## 0.7.0 — 2026-09-16

### Added
- **Vite stack** (stack picker → *Vite + React + TypeScript* / *Vite + vanilla TypeScript*;
  CLI `--stack vite`). The Developer scaffolds a real npm project; the Tester runs
  `npm ci --ignore-scripts` + `npm run build` (cached by lockfile/source hash) and tests the
  built `dist/` in Chromium; an install/build failure is reported verbatim as a high-severity
  finding. Deploy stages `dist/`; Share excludes `node_modules`/`dist`; the README gets the
  real run commands. Verified live: the model produced a Vite+React+TS tip calculator that
  built cleanly and passed the interaction probe ($100 + 15 % → $115.00).
- **Node server stack** (picker → *Backend*; `--stack node`): planned and coded with the
  right instructions; the Tester's spawn-and-probe for servers lands in a later release.
- Per-project **"allow install scripts"** switch (project → Manage) — `npm ci` blocks package
  scripts by default; the Tester's reply says so when that's the likely cause of a failure.
- `doctor` reports npm; `--help` documents `--stack`.
- Dev clones: the launcher runs the TypeScript sources when they are newer than `dist/`, so a
  stale compile can't silently run old code.

### Design
- Every pipeline stage now reads a **stack profile** (`docs/STACKS.md`) instead of assuming
  a static folder; the static profile is a no-op, so existing builds are unchanged.

## 0.6.0 — 2026-09-16

### Added
- **GitHub** (needs GitHub CLI, `gh auth login`; no tokens stored):
  - **Publish** (project → Ship): create a private or public repo from a build and push it —
    one commit per task, nothing else. Later builds push to `main`.
  - **Pull requests**: a change to a project that has a GitHub remote runs on its own
    `projectinator/<change>-<stamp>` branch; the done screen (and Ship) opens a PR with a
    summary table of tasks, results and cost.
  - **Issues** (project → Export): one issue per task, epic as a label; re-running adds only
    new tasks.
  - Safety rules: a repo Projectinator created is pushed to on `main`; a repo that already had
    a remote (an imported clone) is **never** pushed to on its base branch — branch + PR only.
    `build-state.json`, `.checks/`, `.deploy/` and exports are kept out of every repo via
    `.git/info/exclude`, so an imported project's own `.gitignore` is untouched.
- **Import keeps git history**: importing a folder that is a git repo now preserves `.git`
  (history and remote) instead of starting fresh.

### Changed
- New project repos are created on `main` regardless of the machine's `init.defaultBranch`.

## 0.5.1 — 2026-09-15

### Added (tester)
- **Responsive check**: the Tester now screenshots the app at phone (390), tablet (820) and
  desktop (1280) widths, and is told when the page overflows a viewport or renders blank at
  that width — the classic broken-phone-layout bug. Screenshots are kept in the project's
  `.checks/` folder (never shipped/deployed) and listed in Transcripts; press 1–3 to open one.
- **Accessibility & basics check**: in the same render, the Tester is told about missing
  `<title>`/`lang`/`<h1>`, images without alt text, unlabeled form controls, and text that fails
  WCAG AA contrast (body + headings). Deterministic, no model tokens, no Lighthouse.
- **The Tester uses the app**: a new `interact_app` tool lets it write a short step script
  (fill inputs, click, expect text/visibility/URL) and run it in the browser. A failing step
  is reported with what was actually shown, and is a high-severity bug in the verdict. This is
  where "the button doesn't do anything" gets caught. Tester-only; the Reviewer stays static.
- **Visual change on rebuild**: each test run's desktop screenshot is compared with the previous
  one for that task (feedback round or earlier build); the % of changed pixels shows in
  Transcripts and next to the commit in History. No dependency — a small PNG decoder on zlib.

## 0.5.0 — 2026-09-15

### Added
- **Local models** (Settings → Local models): point Projectinator at an Ollama / LM Studio /
  vLLM server, pick the models to allow, and they show up under Model assignments as
  provider "local" — $0, no key. Registered through Pi's own `~/.pi/agent/models.json` (only
  our `local` entry is touched). `--provider local` works in the CLI; `doctor` reports it.
  Local servers are never used as a *fallback* for a cloud task.
- **Share a build** (project → Ship): `<slug>.zip` next to the project (`tar.gz` if the
  system has no `zip`), built files only.

## 0.4.0 — 2026-09-15

### Added
- **Transcripts** (project → Reports): browse every run of a build — role, model, cost,
  verdict, retries — and read what each role actually said, with its bugs and files. Scrolls
  with ↑↓ / PgUp / PgDn.
- **Diffs** (project → Reports → History): pick any task commit to see its `--stat` and
  colored patch, paged like Transcripts.
- **Per-model calibration** — measured token usage is now also tracked per model. Once a
  model has ≥2 runs of a role/difficulty, cost estimates for that model use its own average
  (Settings → Estimate accuracy shows the per-model rows). Other models keep the generic
  estimate, so a Haiku history no longer skews an Opus estimate.
- **Webhook** (Settings → Build defaults): POST a JSON summary to any URL when a build
  finishes or halts — Slack/Discord incoming webhooks, n8n, your own endpoint. Fired by the
  cockpit and by `projectinator build`.
- **Cost matrix** on the plan screen: the same backlog priced under every provider you hold a
  key for, cheapest first, so you can see what a provider lock would save before building.
- **Escalation on failure**: when a review or test fails, the developer retries **one model
  tier up** (e.g. Sonnet → Opus) instead of repeating on the same model. The reviewer/tester
  keeps its own model. Shown in the routing reasons as "escalated from …".
- **Slow-task indicator**: running cards on the live board show an elapsed clock and turn
  amber with `slow` once a task runs past twice its usual time (learned from your builds)
  or half its timeout. Purely informational — the per-task timeout still enforces.
- **Import an existing folder** (Home menu): bring any folder in as a project — files copied
  (junk dirs skipped), versioned, and ready for "Add to backlog" so the PM plans changes
  against what's actually there.

### Changed
- **Compiled package**: `npm install -g projectinator` now gets prebuilt JavaScript — no `tsx`
  at runtime, faster start, `tsx` moved to devDependencies. Dev clones still run from source.

### Fixed
- `projectinator … | head` no longer dies with EPIPE.
- Two README feature bullets that had been mangled.

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
