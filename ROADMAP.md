# Roadmap

Projectinator is usable today — this page is what comes next, and where help is welcome.

If something here interests you, **open an issue saying so before you start** (or comment on the
linked issue). I'll tell you what I know about the area and where the traps are, so you don't
lose an evening to something I already learned the hard way.

## What already works

- **Six roles** — PM, Designer, Developer, Reviewer, Tester, Ops — each routed to the model
  that's best and cheapest for that capability and difficulty. The roster is a registry you can
  edit; a built-in bake-off picks winners empirically.
- **The Tester runs the app.** Installs deps, starts a server when the stack needs one, opens
  the build in headless Chromium, and fails the task on real runtime errors. Verdicts record
  whether the app was actually executed.
- **Stacks**: static HTML/CSS/JS, React via CDN, Vite + React + TypeScript, Node servers,
  Python servers — each with its own install / build / serve profile.
- **Cost control**: live spend, per-project budget cap, per-task timeout and cost ceiling, and
  estimates that calibrate against measured dollars.
- **A cockpit**: editable board, Kanban, standup, sprints, burndown, retro, per-task
  transcripts, per-commit diffs, mid-build steering.
- **Beyond the TUI**: a headless CLI (`doctor`, `build`, `projects`, `models`, `scout`,
  `update`), an MCP server so other agents can drive it, GitHub publish/PR/issues via `gh`,
  Docker, and local models through Ollama / LM Studio.
- **Safe by default**: builds run real shell commands, so the roles are blocked from deleting
  outside the project folder, reading your credentials, `sudo`, `curl | sh`, and `git push`.

Version history is in [`CHANGELOG.md`](./CHANGELOG.md). Architecture and the traps I've already
hit are in [`docs/INTERNAL.md`](./docs/INTERNAL.md) — read that before a first PR.

## Next up

### Cheaper retries — reuse the session on a fix round
**Medium.** When the Tester fails a task, the Developer's fix round starts a brand-new session
and re-sends the whole context (~90k input tokens on a typical code task). Pi's `fork()` reuses
an existing session instead. This is the single largest remaining cost saving in a build.
Touches `src/roles.ts` and the feedback loop in `src/orchestrator.ts`. Needs a before/after
measurement on a real build to prove the saving.

### Mid-task steering
**Medium.** `BuildControl` (pause / inject / remove / stop) is consulted *between* task
launches, so a task heading the wrong way runs to completion and you pay for it. Pi exposes
`session.steer()`, which delivers a correction after the current tool batch. Wiring that up
turns steering from "queue a change for later" into "change course now".

### Contained execution
**Large.** Safe mode (`src/guard.ts`) blocks the realistic accident, but it is a guard, not a
sandbox: a build can still write a script inside its own workspace and run it. The real fix is
running builds in a container. The hard part isn't the container — it's keeping the stack
profiles working, since Vite/Node/Python builds spawn servers and the Tester must still reach
them over HTTP.

### Project skills
**Small.** Pi discovers skills from `.pi/skills/` and `.agents/skills/` in the working
directory, and our sessions already run with the project as cwd — so dropping a skill into a
project may already teach every role your conventions. Nobody has verified it. If it works:
document it and add an example skill. If it doesn't: wire it through the resource loader.

### Ask mode
**Medium, and deliberately not started yet.** A per-command approval prompt sounds obvious, but
builds run up to three tasks at once, and headless/MCP runs have nobody to ask. It needs a
question queue, a timeout policy, remembered answers, and different behaviour per run mode.
Worth building once Safe mode has blocked something it shouldn't have — real examples beat
guesses about which commands deserve a prompt.

### Mobile and desktop targets
**Large.** Both currently fall back to a web build. A real target means a stack profile that can
install a toolchain, build, and — the part that matters — let the Tester actually run the result
and see it.

## Parked

- **Web login for paid subscriptions** (use a Claude/ChatGPT plan instead of API keys). Vendors
  closed third-party subscription auth in 2026; browser automation half-works for one provider
  and breaks on any login-page change. Behind `PROJECTINATOR_WEB=1`. Not worth maintaining
  unless the situation changes.

## Good first contributions

You don't need to take on a roadmap item to be useful:

- **Run a build and file what went wrong.** Real builds are how nearly every bug in this
  project has been found. Paste the plan, the cost, and what the app did.
- **A new stack profile** (`src/stack.ts`) — Go, Rust, Deno, Svelte. The profile interface is
  install / build / serve / entry, and there are four working examples to copy.
- **Tests for a screen you use.** `test/` has harnesses for both the mocked build flow and the
  real app; they run without spending anything.

One rule for PRs: a test must fail before your fix and pass after it. If a change can't be
tested cheaply, say so in the PR and explain how you verified it by hand.
