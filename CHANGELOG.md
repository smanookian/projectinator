# Changelog

## 0.28.0 — 2026-09-19

### Added
- **Build modes — `Safe` (new default) and `Auto`.** The roles write files and run shell
  commands on your machine with your permissions, and Pi ships no sandbox by design. Safe mode
  refuses, before execution, the things a build has no business doing:
  - deleting or overwriting anything **outside the project folder** (including `rm -rf /`)
  - **reading your credentials** — `~/.ssh`, `~/.aws`, `~/.npmrc`, `~/.pi/agent/auth.json`,
    and Projectinator's own `config.json` where your API key lives
  - `sudo`, machine-level commands (`shutdown`, `mkfs`, `systemctl`, fork bombs)
  - piping a download straight into a shell (`curl … | sh`)
  - `git push` — publishing stays a decision you make in Ship

  A refusal is explained to the model so it finds another way; it does not kill the task.
  Everything a build genuinely needs — `npm install`, `npm run build`, `rm -rf node_modules`,
  writing files in its own folder — is untouched, verified by a live build that finished clean.

  Settings → Build defaults → **Build mode** switches to `Auto`, which restores the old
  behaviour (no guard).

  Implemented on Pi's `tool_call` extension hook, the only point where a command can be refused.
  Sessions also now load with `noExtensions`, so Pi never executes an extension written into the
  workspace by a model.

### Known limits
- **This is a guard, not a sandbox.** It stops the realistic accident — a destructive command
  aimed outside the project, or a role reading your keys. It cannot stop a determined exploit:
  a build may legitimately write a script inside its own folder and run it. Containerised
  execution remains the strong fix.
- There is no `Ask` mode yet. Builds run up to three tasks at once and headless/MCP runs have
  nobody to ask, so a prompt-per-command needs a question queue and per-run-mode behaviour.
  Safe mode needs none of that and works identically everywhere.

## 0.27.0 — 2026-09-18

### Added
- **The Tester now sees its own screenshots.** It has always rendered the app at three viewports
  — and then judged it from text. The screenshots were captioned "saved for the human reviewer";
  the model never received them. They are now passed as images (Pi's `PromptOptions.images`),
  resized through Pi's `resizeImage` to keep them inside a sane token budget, capped at one per
  viewport, and only for models whose `input` includes `"image"`. The model is asked to judge
  what only pixels show — overlap, clipping, unreadable contrast, a collapsed layout — and then
  submit or revise its verdict.

  **Honest result: I could not demonstrate this catching anything the text-only Tester missed.**
  Three paired live runs (a white-on-white + overlapping-sections page, a list clipped by
  `overflow: hidden`, and a minified Vite-style bundle) were all caught by *both* variants,
  because the Tester can read the stylesheet. Measured cost was the same either way ($0.05 per
  test task with and without). It is kept because it closes a real hole rather than a
  demonstrated one: a stylesheet the workspace doesn't contain, canvas or image output, and
  runtime-computed styles are invisible to source reading. Notably the text-only control claimed
  "visual inspection of rendered screenshots" it had never been given — now that claim is true.

## 0.26.3 — 2026-09-18

### Docs
- **A visual tour in the README** ([`docs/tour.svg`](docs/tour.svg)): four real screens — home,
  projects with what each build cost, a finished project, and the split-pane transcript viewer.
  Regenerate with `npx tsx scripts/capture-tour.tsx`.

### Internal
- `scripts/capture-tour.tsx` captures those frames through `ink-testing-library` rather than a
  terminal recording. A PTY-driven asciinema capture is **not** reproducible here: the TUI
  intermittently fails to emit its first frame under a pseudo-terminal (14 bytes, then nothing —
  identical inputs gave 14 / 181 / 3104 bytes across runs). It renders normally in a real
  terminal, and the same components render deterministically under the test renderer.

## 0.26.2 — 2026-09-18

### Docs
- **Two more example builds, committed unedited**: a
  [markdown scratchpad](examples/markdown-scratchpad/) (11 tasks, $2.46 — live preview,
  `localStorage` persistence, selection-wrapping toolbar, word/char count, copy button) and a
  [multi-page site](examples/multi-page-site/) (10 tasks, $1.77, built with parallel code tasks
  in git worktrees, three merge conflicts all auto-recovered). Both finished with the Tester's
  `runtimeChecked: true`, and both were then driven by hand in a browser — every feature the
  idea asked for is listed with what it actually did. The README now leads with that evidence
  instead of only describing the pipeline.

## 0.26.1 — 2026-09-18

### Fixed
- **The council's epic-approval screen could hide its own choices.** It rendered every proposed
  epic with a wrapping rationale, and the approve/skip menu sits *below* that list — so with ten
  epics on a 24-row terminal "Skip epics — quick plan instead" was pushed off the screen
  entirely. This was the last screen never audited for the overflow class that hit five others.
  The list is now budgeted against `termRows` (two rows per epic, rationale truncated rather
  than wrapped, `… N more epics` when trimmed), so the menu always survives.

## 0.26.0 — 2026-09-18

### Added
- **The transcript viewer is a split pane.** On a terminal at least 100 columns wide the run list
  stays beside the text, marking which run is open, and **←/→ move between runs** without going
  back to the picker — reading three transcripts was three round-trips. Narrower terminals keep
  the text full-width rather than squeezing both. The status bar carries the new keys.

## 0.25.1 — 2026-09-18

### Fixed
- **A sub-minute task timeout aborted with "ran longer than 0 min".** The limit was rounded to
  whole minutes, and `0` means *unlimited* in the preferences — so the message contradicted the
  setting that caused the abort. It now reads `ran longer than 3s`, and keeps a fraction
  (`1.5 min`) above a minute.

### Verified
- Exercised the four features that could not persist before 0.24.1, against real builds:
  **per-task cost cap** (`T-01 aborted: spent $0.03 > per-task cap $0.02`), **per-task timeout**,
  **webhook** (a real receiver got `build.finished` for both a halted and a completed build), and
  **parallel code tasks** — a 10-task site built across git worktrees, hit three merge conflicts
  (`css/index.css`, `css/contact.css`, `css/pricing.css`), recovered each with a serial rebuild,
  finished complete at $1.77, and left no stale worktrees or branches. That build also produced
  the first Tester verdict with `runtimeChecked: true` — the app was really executed.

## 0.25.0 — 2026-09-18

### Fixed
- **Plan estimates ran ~2x low, so caps halted builds against their own plan.** Measured on three
  real builds: est $0.62 → actual $1.00, est $1.35 → actual $2.46, est $0.82 → $1.00 at 6/10
  tasks. The token counts were right (calibration measures them); the *pricing* was wrong. Cost
  was derived assuming input served from cache bills at the cheap `cacheRead` rate, but real
  bills behave as if there is no cache discount at all — a task estimated at $0.15 with 95% cache
  assumed, and $0.54 with none, actually cost $0.50.

  Two changes:
  - Every real run now records its **measured USD**, and the router prices a task from that once
    the bucket has two runs on that model (`calibratedCostUSD`). This is self-correcting and
    needs no assumption about how a provider bills caching.
  - Until a bucket has measured runs, tokens are priced **without** a cache discount. On the
    completed scratchpad build this turns est $1.35 (actual $2.46) into est $3.63 — deliberately
    conservative, because being told $3.63 and spending $2.46 beats being told $1.35 and halting
    at $1.
- **A server's startup line could be corrupted, and a crash message lost.** `serve.ts` split each
  stdout *chunk* into lines on its own, so a chunk boundary falling mid-line inserted a newline:
  `listening on 41765` arrived as `listening on` + ` 41765`. That failed the Python stack's
  readiness check about 1 run in 6 (the intermittent test failure noted in 0.23.3 — it was never
  a port race), and would equally mangle a stack trace the Tester reads out of the log. Partial
  lines are now buffered across chunks, and an unterminated final line is flushed instead of
  dropped, so `FATAL: …` with no trailing newline still reaches the error message.

## 0.24.3 — 2026-09-18

### Fixed
- **A build could report "Complete" without being tested.** The feedback loop only reacted to a
  verdict that *failed*, so a judge that returned no verdict at all counted as success. A real
  build finished `halted: false` off a Tester that produced empty text and no verdict for $0.01
  — nothing was ever executed, and the summary claimed otherwise. A `test` or `review` task that
  produces no verdict is now a failed outcome: the build halts naming the task, and because
  failed outcomes never count as done, resuming re-runs it.

## 0.24.2 — 2026-09-18

### Fixed
- **Building the same idea twice destroyed the first build's record.** A new build derived its
  folder from the idea's slug and reused it if it already existed, so the second run overwrote
  `build-state.json` — task list, costs, outcomes, retro — and wrote its code on top of the first
  build's files. (Found by building the same scratchpad idea twice: the 18-task/$1.20 record was
  gone, the two builds' commits interleaved in one git history.) A fresh build now takes the next
  free folder (`slug-2`, `slug-3`, …), the same helper duplicate/import already used; resume and
  change-builds still address the project they were given. The build id matches its folder again.

## 0.24.1 — 2026-09-18

### Fixed
- **Five settings never persisted.** `loadConfig()` projected an explicit list of fields, so
  anything missing from that list was written to `config.json` and then silently dropped when
  read back. `taskTimeoutMin`, `taskCostCapUSD`, `parallelCode`, `reviewPolicy` and `webhookUrl`
  all reverted to their defaults, which means the **webhook, both per-task limits and the
  parallel-code toggle have never worked across a restart** — you could set them, they looked
  saved, and nothing used them. The config is no longer filtered on read, and a test now asserts
  every pref round-trips.

  Found immediately after adding the review-policy setting: the new toggle wrote `all` to disk
  and read back `high`.

## 0.24.0 — 2026-09-18

### Changed
- **Reviews now default to hard code tasks only.** Measured across every build to date, the
  Reviewer was **22% of all spend and found zero bugs** — one review cost $0.21, more than the
  $0.17 code task it was reviewing, because reviews read the code and so get more expensive as
  the project grows. Meanwhile the Tester, which actually *runs* the app in Chromium, averaged
  $0.02. On the same scratchpad idea this takes the plan from **18 tasks / $1.42** to
  **7 tasks / $0.47**, and it now fits under a $1 cap instead of being doomed from the start.

  Settings → Build defaults → **Code reviews** cycles `Hard tasks only` → `Every code task` →
  `Off`. The sample is small (4 reviews), so the capability is kept, not deleted — it is now
  spent where a bug is most likely.

  The policy is *enforced* in `normalizeBacklog()`, not just requested in the PM prompt: a model
  that adds reviews anyway would otherwise quietly spend the money. Dropping a review rewires
  whatever depended on it onto the code it was reviewing, so the test still waits for that code.
  It keys on the difficulty of the **reviewed code**, not the review task's own — reviews are
  cheap/low by construction, so reading their own field would have dropped every one.

## 0.23.3 — 2026-09-18

Found by running a real $1.20 build end to end instead of auditing code.

### Fixed
- **`budget_halt` overstated the bill.** It reported `running + the estimate of the task it
  refused to launch`, so a build that had spent $1.20 announced $1.25. It now reports what was
  actually spent, which is also what `done.totalCost` says — the two used to disagree.
- **`--json` hid the "estimate exceeds the cap" warning.** It was printed with `say()`, which
  `--json` suppresses, so a machine consumer got no signal until `budget_halt` arrived after the
  money was gone. A `budget_warning` event (`estCost`, `cap`) is now emitted before the build
  starts, and the human-readable warning names both numbers.
- **An overspend is now explained.** The cap clears each task against its *estimate*, so a run
  whose tasks cost more than estimated can finish above the cap (a $1 cap billed $1.20). The
  summary says so rather than leaving you to notice, and a budget halt points at the cockpit to
  resume the remaining tasks.

## 0.23.2 — 2026-09-16

### Fixed
- **`doctor` cried wolf.** A working install reported `Ready · 4 warnings`, all of them things
  you may deliberately not want: the three provider keys you don't need (one key runs the whole
  roster) and local models. They now render as `·` and read
  `Ready · 4 optional extras not set up`; a missing *everything* is still a blocking `✗`. A
  warning count that flags a healthy setup trains you to ignore it.
- **An exported-but-empty `*_API_KEY` counted as a key**, so `export OPENROUTER_API_KEY=` (or a
  cleared var in a CI job) turned a clear "no keys — nothing can run" into an auth failure
  partway through a build. Empty and whitespace-only values are now treated as unset.
- Tests no longer inherit the developer's real config: `test/setup.ts` pre-seeds an empty
  `config.json` in its temp data dir, since `configPath()`'s legacy migration would otherwise
  copy the real one (API key included) into any fresh `PROJECTINATOR_HOME`.

## 0.23.1 — 2026-09-16

### Fixed
- **`PROJECTINATOR_HOME` only moved half your data.** It relocated projects, but calibration
  samples, the OpenRouter price cache, saved templates and the web-login browser profiles all
  stayed pinned to `$HOME/.projectinator` — so a Docker volume or a relocated home silently
  split the data directory in two and lost whichever half wasn't mounted. Every one of those
  now resolves through `dataHome()`, which is the only place `~/.projectinator` is constructed.

### Internal
- Each test file now gets its own `PROJECTINATOR_HOME` (`test/setup.ts`). Several tests were
  reading the developer's real `calibration.json`, and once everything shared one test home,
  calibration written by one file moved the token estimates another file asserted on. Two runs
  back to back now give the same 309.

## 0.23.0 — 2026-09-16

### Added
- **`projectinator update`** — upgrade in place, instead of remembering the npm incantation:
  ```
  projectinator update            # check, then install the latest
  projectinator update --check    # just report; change nothing
  ```
  It compares your version against the registry and only self-installs when it *is* the global
  npm install. A git clone is told to `git pull`, a project dependency is told to update itself,
  and inside Docker it says to rebuild the image — so it can never npm-clobber a checkout you're
  working in. Projects and keys in `~/.projectinator` are untouched by an upgrade (since 0.22.0).

### Fixed
- `doctor` printed a hardcoded `~/.projectinator/config.json` as the source of a saved key; it now
  prints the real `configPath()`, which differs when `PROJECTINATOR_HOME` is set.

## 0.22.1 — 2026-09-16

### Removed
- **Homebrew support, because it never actually worked.** `brew install projectinator` fails in
  Homebrew's post-install relocation pass:
  ```
  Error: failed changing dylib ID of .../clipboard.darwin-arm64.node
  Error: failed to fix install linkage
  ```
  Homebrew rewrites the dylib ID of every Mach-O file in a keg, which invalidates its code
  signature on Apple Silicon. Projectinator's tree vendors prebuilt signed binaries
  (`@earendil-works/pi-coding-agent` → `@mariozechner/clipboard`, plus Playwright), and Homebrew
  offers no way to exempt them. The formula, `scripts/brew-formula.sh` and the tap are gone
  rather than left advertising an install that errors out. **`npm install -g projectinator` is
  the install path**, with Docker for an isolated one.

### Fixed
- **`PROJECTINATOR_HOME` didn't move your config.** It relocated projects but `config.json` stayed
  pinned to `$HOME`, so the data directory was split in two — and the test suite read and wrote
  the developer's real config, including the stored API key (one test persisted a theme into it,
  which raced other tests). Config now lives in `dataHome()` like everything else; the default
  path is unchanged, and a `$HOME`-pinned config is copied across (mode `600`) if you have
  `PROJECTINATOR_HOME` set, so no keys are orphaned.

## 0.22.0 — 2026-09-16

### Fixed
- **Upgrading wiped your projects.** Builds and the Scout's routing overrides were stored inside
  the installed package (`<package>/.workspace/tui`), and `npm i -g projectinator@latest` replaces
  that directory — so every upgrade silently destroyed all saved work, not just uninstalling did.
  User data now lives in `~/.projectinator/` (`projects/`, `registry.overrides.json`), outside
  anything a package manager touches. `PROJECTINATOR_HOME` still overrides it; Docker still uses
  `/data`. Projects found in the old location are **copied** (never moved, so a failure can't cost
  you anything) on first run, and never copied again over later edits.
- API keys and prefs were always in `~/.projectinator/config.json` and are unaffected.

### Internal
- `test/setup.ts` pins `PROJECTINATOR_HOME` inside the repo for every test, so a fixture can never
  be written among real projects.

## 0.21.2 — 2026-09-16

### Fixed
- **Homebrew install instructions were incomplete**, so they ended in
  `Error: Refusing to load formula from untrusted tap`. Since Homebrew 6.0.0 a non-official tap
  must be trusted explicitly (loading a tap runs Ruby code from it), so the documented flow now
  includes it:
  ```sh
  brew tap smanookian/projectinator
  brew trust smanookian/projectinator
  brew install projectinator
  ```
  The tap README explains why, offers the narrower `brew trust --formula …`, and points at
  `npm install -g projectinator` for anyone who would rather not opt in. Note
  `HOMEBREW_NO_REQUIRE_TAP_TRUST=1` is deprecated and shouldn't be used.

## 0.21.1 — 2026-09-16

### Added
- **Homebrew install actually works.** The tap is live at
  [smanookian/homebrew-projectinator](https://github.com/smanookian/homebrew-projectinator) —
  the formula shipped in 0.16.0 but the tap repo it needed never existed, so
  `brew install projectinator` couldn't resolve:
  ```sh
  brew tap smanookian/projectinator
  brew install projectinator
  ```
  `scripts/brew-formula.sh --push` now regenerates the formula from the published tarball and
  publishes it to the tap in one step (idempotent; refuses if the version isn't on npm yet).

### Fixed
- The formula depended on keg-only `node@22`, which isn't on `PATH` — the launcher's
  `#!/usr/bin/env node` shebang could have picked a different runtime. It now depends on
  unversioned `node` (24.x satisfies the `>=22.19` engines field).

## 0.21.0 — 2026-09-16

### Changed
- **Overflowing a screen can no longer corrupt it.** Five screens have been fixed for the same
  root cause: content stacked past the terminal height, Yoga shrank the children to fit the
  fixed-height frame, and rows merged into garbage ("Designermanager", "Test the pagerm"). The
  frame now wraps screen content in a non-shrinking box, so content that doesn't fit is
  *clipped* instead of squeezed. Verified: the build board's old (too small) row budget stops
  corrupting once content can't shrink.
  This is defence in depth, not a replacement for the per-screen budgets — clipping still hides
  the bottom of a screen, so each screen keeps yielding its optional panels so the actionable
  part survives. It protects screens nobody has audited yet.

### Added
- Intake screen test: a clarifying question and all its options render intact.

## 0.20.4 — 2026-09-16

### Fixed
- **The live build board squeezed cards together.** Its card budget reserved 13 rows for
  everything around the board while the screen actually spends ~22, so it asked for more cards
  than fit; the clipped frame then squeezed two cards onto one line and only a tail survived
  ("Test the page" + a "…form" card came out as "Test the pagerm"). The reserve now counts the
  rows the screen really uses, including the standup chips and any open steering prompt, and
  the chips yield on a short terminal. This is the screen you watch for the whole build.
- Removed the build screen's inline steering hint — the status bar has shown the same keys
  since 0.20.0, so it was duplicated (and cost a row the board needed).

### Added
- Building-screen test: a realistic mid-build state (8 tasks, some done, some running) asserts
  no card id or title is run into by neighbouring text, and that the add-a-task prompt renders
  whole alongside the board.

## 0.20.3 — 2026-09-16

### Fixed
- **The plan board overflowed a short terminal.** Each card was ~3 rows (id line, title line,
  margin) and the 17-key legend rendered as bordered keycaps costing 3 rows per wrapped line —
  together they blew past the viewport and the clipped frame merged rows ("Contact form" came
  out as "Contact formw"). On a short terminal cards now render one line each and the legend
  renders as a compact wrapped line (~2 rows instead of 9). Both board editors benefit.
- `KeyHint` gained a compact form; it wraps rather than truncating, so no key is hidden.

### Added
- Board-editor rendering test with a realistic 8-task/3-epic backlog, asserting every card
  title arrives intact (a plain substring check passes on "Contact formw", so it checks the
  title is not run into by other text).

## 0.20.2 — 2026-09-16

### Fixed
- **The plan and done screens overflowed a short terminal**, and the clipped frame made Yoga
  render rows on top of each other — on the plan screen the roster came out as
  "Designermanager" and the decision menu as "Budget cap: $25g now ($0.42)(2 in backlog)";
  on the done screen "New build" and "Add a file / image" merged into "New builde / image".
  Both now drop their optional panels (roster / alternate-roster costs / standup chips) when
  there isn't room, so the actionable menu always renders whole. Same class as the project
  screen fixed in 0.20.1 — the plan screen is on the path of every single build.

### Added
- **Build-flow tests.** plan → building → done had no App-level coverage at all, because
  reaching it for real costs money. The three spending calls (`assessBuild`, `planBuild`,
  `startBuild`) are now mockable, so the tests walk the real App to the plan screen, start a
  build, drive orchestrator events, and exercise the **mid-build steering keys** (`p` pause /
  resume, `x` stop) against a real `BuildControl` — which shipped in 0.10.0 with orchestrator
  tests but nothing covering the cockpit that drives them.

## 0.20.1 — 2026-09-16

### Fixed
- **Project screen overflowed a short terminal.** Its chrome (title, chips, roster panel)
  reserved ~21 rows and then still asked for 6 more for the menu, so on a 24-row terminal the
  clipped frame made Yoga overlap rows (the roster rendered as "Designermanager") and the menu
  collapsed to a single usable item. The roster panel now renders only when there is room for
  it, and the menu's row budget is computed from what is actually left.
- `GroupedMenu` spent its row budget on section headers and gaps, so a tight budget left almost
  no selectable items. When space is scarce it now drops the decoration and spends every row on
  items.

### Added
- **Navigation audit tests.** Every Settings sub-screen (10) and every read-only project
  sub-screen (12) is opened, asserted to render, and Esc-ed back — the bug class that manual
  clicking kept finding (crash on render, dead Esc, dead end) and that per-screen tests missed.

## 0.20.0 — 2026-09-16

### Changed
- **Keyboard hints are consistent everywhere.** They used to be per-screen, so some screens
  carried a heavy in-panel keycap legend (Local models) and others showed nothing at all
  (Preferred provider). The standard keys now live in the **status bar**, driven by one
  `PHASE_HINTS` table next to the existing phase labels — so every screen shows its keys, in
  the same place, in the same wording: `↑↓ pick · Enter confirm · Esc back · q quit`.
  Context-aware per screen: text fields show `Enter confirm · Esc back`, the transcript/diff
  pagers show scroll keys, the build screen shows `p pause · a add a task · r remove · x stop`,
  the sprint view shows `←/→ sprint`.
- Removed the 15 now-duplicated in-panel keycap rows. An in-panel legend is kept only where
  the footer can't express the key set: the two board editors' full legends, a MultiSelect's
  `Space`, and the prefs form's field-by-field `Enter`.

## 0.19.2 — 2026-09-16

### Fixed
- **Settings could trap you.** `Esc` did nothing on every Settings sub-screen (App.tsx skips the
  settings phase in its own back handler, and Settings never implemented one) even though the
  hints advertised "Esc back". Esc now backs out one level — sub-screen → menu → out of
  Settings — with a proper parent for nested screens (key entry → API keys, model pick →
  assignments, local pick → local models).
- **Local models had two live inputs.** The URL field and the menu were both mounted, so Enter
  fired *both*: choosing **Back** also submitted the URL and probed the server instead of going
  back. The URL is now display-only until you pick "Change the URL", so exactly one input owns
  the keyboard; the menu gained an explicit "Connect to <url>" action.

## 0.19.1 — 2026-09-16

### Fixed
- **Crash: `<Box> can't be nested inside <Text>`.** Two @inkjs/ui components that render a
  `<Box>` were placed inside a `<Text>`, which ink rejects outright:
  - Settings → Local models, while probing a server (`Spinner` inside the "Server URL" line) —
    this is the one that killed the app on `npm start` → Settings → Local models → Enter.
  - The board card's verdict `Badge` (any card with PASS/PASS*/FAIL).
  The spinner now sits beside the text in a `Box`, and the verdict renders as colored text like
  the list view already did. Regression test covers a board card with a verdict.

## 0.19.0 — 2026-09-16

### Added
- **Collapsible epics** on both board editors (Plan board + Edit board). Each epic lane
  shows a `▾ n` / `▸ n` marker and a collapse count; press its number (1-9) to hide or
  reveal its tasks. Collapsed epics are excluded from the cursor, so up/down never land on a
  hidden task. Helps large boards stay scannable.

## 0.18.0 — 2026-09-16

### Added
- **Themes & a restyle across the whole TUI** (Settings → Appearance):
  - **Dark / light themes** — the palette is a `Theme` (dark amber cockpit, light) resolved
    through a live `C` proxy, so every token follows the active theme and light mode paints a
    real light background with white cards. `PROJECTINATOR_HOME`-style live switching.
  - **Clearer hierarchy** — panels are full-width with a surface background and **bold** (not
    amber) titles; keycaps are muted; **amber now means interactive/in-focus only** (brand,
    active menu, spinners, input carets). Status colors (pass/warn/fail/running) actually work
    and resolve correctly per theme.
  - **Nerd Font role icons** with a monospace-safe ASCII fallback (`Appearance → Icons`),
    codepoints pinned from the Nerd Fonts v3 cheat sheet. Role emoji (double-width, blurry) gone.
- **Consistent casing** in Settings values (`Webhook: Off`, `Default stack: Ask/…`).

### Fixed
- Light theme originally painted a light card on the transparent (dark) terminal frame, and bare
  text used the terminal's default white foreground — title/board/role text vanished. The app now
  paints an opaque light background and every text carries an explicit theme color.

## 0.17.0 — 2026-09-16

### Added
- **Python stack** (`--stack python`, Stack picker → Backend (Python — FastAPI / Flask),
  MCP `stack: "python"`). The PM briefs a `requirements.txt` + `main.py` server that reads
  `PORT`; prepare creates a private `.venv` and pip-installs (cached by requirements hash);
  the Tester starts `.venv/bin/python main.py` on a free port and drives it like the Node
  stack. `.venv/`, `__pycache__/` excluded from git/share/file lists. `doctor` checks
  `python3`. Verified with a real venv + server + headless render.

## 0.16.0 — 2026-09-16

### Added
- **Docker.** `Dockerfile` on the official Playwright image (Node + headless Chromium + git);
  `docker build -t projectinator .` then `docker run -it -e OPENROUTER_API_KEY -v projectinator-home:/data projectinator`.
  Keys, prefs and every build live on the `/data` volume. Verified: `doctor` inside the
  container reports Chromium, npm, git and the data dir on the volume.
- **Homebrew.** `homebrew/projectinator.rb` formula (node@22 + git, npm tarball) for the tap
  `smanookian/homebrew-projectinator`; `scripts/brew-formula.sh` refreshes url/sha per release.
- **`PROJECTINATOR_HOME`** — where projects are stored (`$PROJECTINATOR_HOME/projects`).
  Default is still inside the package folder; set it for global installs/containers so
  builds survive upgrades. `projectinator projects` prints the folder.

## 0.15.0 — 2026-09-16

### Added
- **MCP server.** `projectinator mcp` serves Projectinator over stdio to any MCP client
  (Claude Desktop, Cursor, Pi, …). Tools: `plan` (idea → backlog + estimate, one PM call),
  `build` (starts a real build, returns the workspace at once), `build_status` (per-task
  status, spend, halt reason — any project folder), `build_control` (pause / resume / stop /
  add work, for builds started by that server), `projects`, `models`. Descriptions say what
  spends money. `src/mcp.ts`; dependency `@modelcontextprotocol/sdk` + `zod`.

### Fixed
- The published `projectinator` launcher rejected `scout` (added in 0.13.0) as an unknown
  command; the allow-list now includes `scout` and `mcp`.

## 0.14.0 — 2026-09-16

### Added
- **Bake-off upgrades.** Candidates now come from your connected roster — every provider
  you hold a key for (fast/mid/high picks, deduped) plus local models — instead of three
  hard-coded Claude tiers; `npm run bakeoff -- --models provider:model,…` mixes providers.
  **Code bake-off**: each model builds the task in its own scratch folder with the real
  developer tooling (no provider fallback), then the roster's Tester runs every build
  (headless browser, interaction); the verdict is the score (PASS 10 / PASS* 9, bugs cost by
  severity, FAIL ≤ 5) — no judge model. **Quality/$ Pareto**: ★ marks models no other beats
  on both score and cost; "best value" = score per dollar among passing results.
  Verified live: Sonnet 5 PASS 10/10 $0.02 vs Gemini 3.8 Flash FAIL (wrote no files).

## 0.13.1 — 2026-09-16

### Fixed
- npmjs.com showed "This package does not have a README": the README contained a literal `<script src>` (npm's sanitizer rejects it even inside code) and relative image paths. Text reworded; images now absolute.

## 0.13.0 — 2026-09-16

### Added
- **Auto-scout.** `projectinator scout` reads the live OpenRouter catalog (the same feed
  used for pricing) and reports: price drift over 10% for every model we price (native ids
  are mapped to their `vendor/slug`), new models from the vendors we route that are newer
  than our roster (`:batch`/`:free`/dated-preview variants skipped), and a proposed registry
  diff — one candidate per slot, priced like the current pick, always flagged
  `unknown-model` until someone adds it to `models.ts`. `--findings <file>` writes the
  findings for the existing `npm run scout -- --from <file> --apply` flow. Nothing is applied
  automatically. `src/scout-feed.ts` (pure); catalog entries now carry `created`.

## 0.12.0 — 2026-09-16

### Added
- **Sprints.** Every build run (first build, resume, change, board-planned sprint) is recorded
  as a sprint in `build-state.json` (`sprints[]`: start/end, planned task ids, outcome slice).
  Project → *Sprints & burndown* shows one row per sprint — planned, done, retries, cost, time —
  plus velocity (tasks per ended sprint) and cost per finished task; ←/→ picks the sprint whose
  burndown is drawn. Older projects count as one sprint. `src/sprints.ts`.

### Fixed
- Burndown screen could lose rows on short terminals (the frame clips at the terminal height
  and Yoga shrank the panel). The table never shrinks; the charts show the latest steps that fit.

## 0.11.0 — 2026-09-16

### Added
- **Escalation ladder.** When a review/test still fails after the developer fix rounds
  (tier-bumped), the build no longer just gives up: rung 3 — the Designer upstream of the
  failing code rewrites the spec around the surviving bugs, and the developer fixes once more
  against the new spec; rung 4 — the PM splits the stubborn code task into 2–4 smaller code
  tasks, which join the backlog with a fresh review/test. Each rung runs at most once per
  failing review/test; per-task and budget caps still apply. Event `escalate` (rung
  `respec`/`replan`), printed by the CLI and `--json`. Orchestrator option `replan`.

## 0.10.0 — 2026-09-16

### Added
- **Mid-build steering.** While a build runs: `p` pauses (running tasks finish, nothing new
  starts) / resumes; `a` adds work — one line, the PM turns it into tasks that join the backlog
  (deps on existing tasks allowed, review after each new code task); `r` removes a task that
  has not started (its dependents no longer wait for it); `x` stops after the running tasks
  (resumable like any halt). Injected tasks are persisted into the project's backlog.
  Orchestrator: `createBuildControl()` + `control` option, events `paused`/`resumed`/
  `task_added`/`task_removed`, `RunResult.tasks`. `--json` streams the same events.
  Verified live: paused build finished its task and started nothing new; added tasks joined the
  backlog while paused; a removed task never ran; stop halted resumably ($0.09).

### Changed
- One ready-set scheduler for both sequential and parallel builds (concurrency 1 launches one
  task per pass in toposorted order — same order as before).

## 0.9.0 — 2026-09-16

### Added
- **Parallel code tasks** (Settings → Build defaults → *Parallel code tasks*; CLI
  `--parallel-code`). Off by default. When on, independent code tasks no longer wait for each
  other: each extra one builds in its own git worktree (`.worktrees/<task>`), is committed there,
  and merged into the project when it finishes. A merge conflict discards that attempt and
  reruns the task once, serially, on the merged files — the developer is told which files a
  parallel task changed. Leftover worktrees from a crash are pruned at the next build.
  Reviewer/Tester still run after their code task, so the feedback loop is unchanged.

## 0.8.0 — 2026-09-16

### Added
- **Node server stack is now tested for real** (picker → *Backend*; `--stack node`). The Tester
  runs `npm ci --ignore-scripts`, starts `npm start` on a free `PORT`, waits up to 20 s for it to
  answer, renders `GET /` (viewports + a11y facts as for static apps), lets `interact_app`
  drive it, and kills the process tree afterwards. A server that crashes on start or never
  listens on `process.env.PORT` is reported with its output as a high-severity finding.

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
