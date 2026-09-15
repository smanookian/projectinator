# Build-step stacks (Vite, then Node/Python backends) — design (no code yet)

Today every build is **static, no build step**: vanilla HTML/CSS/JS or React-from-CDN. That is
what makes the current pipeline simple — the tester serves the folder, "double-click
index.html" is a hard guarantee, deploy copies files, share zips them. It is also the
product's biggest limit: no Vite, no Tailwind, no TypeScript, no backend.

Decision already made (Sept 2026): builds run **directly on the host** — no Docker. So the
question is only how to make the pipeline stack-aware without breaking the static path.

## One concept: the stack profile

Every project gets a `stack` record in `build-state.json` (missing = static, today's
behaviour). Each stack profile answers the same six questions, and every stage of the
pipeline asks the profile instead of assuming:

| Question | static (today) | `vite` | `node` (Express/Hono) | `python` (Flask/FastAPI) |
|---|---|---|---|---|
| Install | — | `npm ci` | `npm ci` | `python -m venv .venv && .venv/bin/pip install -r requirements.txt` |
| Build | — | `npm run build` → `dist/` | — | — |
| Serve for testing | static server on the folder | static server on `dist/` (**after** build) | `npm start` on a free `PORT`, wait for it to listen | `.venv/bin/python app.py` on `PORT`, wait |
| Entry URL | `/index.html` | `/` | `/` | `/` |
| Deploy artefact | folder | `dist/` | ✗ (needs a server host — out of scope) | ✗ |
| "Runs on double-click"? | **required** | no — README with `npm run dev` required instead | no — README required | no — README required |

The profile is chosen once, at the stack picker, and it is what the PM, Developer,
Reviewer, Tester, deploy and share all read. Nothing else in the pipeline learns about
Vite specifically.

## What changes, by stage

### Stack picker / brief (`stack.ts`, `StackPick.tsx`)
New framework entries: *Vite + React*, *Vite + vanilla TS*, and a *Backend* platform with
Node and Python. Each maps to a profile id and a brief instruction that names the exact
scaffold (Vite's `npm create vite@latest`-shaped tree; package.json scripts `dev`/`build`/
`start`; port from `process.env.PORT`; a README with run commands). The static-only
instructions ("no ES modules, no fetch of local files") are dropped for build stacks —
they were only ever about `file://`.

### Developer (`roles.ts`)
Prompt gains: "the project uses <profile>. Install with `<install>` before you need
packages; make `<build>` pass before you finish; never commit `node_modules` or `dist`."
The dev already has `bash`; nothing new is required. `node_modules`/`dist`/`.venv` go into
`.git/info/exclude` alongside our bookkeeping.

### Reviewer (`roles.ts`)
Unchanged, plus one check in the prompt for build stacks: `package.json` scripts exist and
`import`s resolve to installed deps (read `package.json`, don't run anything).

### Tester (`preview.ts`, `roles.ts`)
`check_app` today = `renderCheck(dir, file)`. It becomes `check_app` → `serveForTest(profile)`
→ same render/viewport/a11y/interact machinery against the returned URL:
- static: as now.
- vite: run install+build (once per test task, cached by a hash of `package.json` +
  lockfile) then static-serve `dist/`. **Build failure = the check_app reply**, verbatim
  stderr tail — that is the most common real bug and the Tester must see it.
- node/python: install, spawn the server with a free `PORT`, poll the URL until 200 (≤ 20 s),
  run the checks, kill the process tree. A server that never listens = the reply.
The `file://` render and "double-click" verdict rule apply only to the static profile.
Install/build time is *not* billed as model time; the per-task timeout still covers it.

### Deploy (`deploy.ts`) / Share / Preview
Stage `dist/` for vite (after a build); static unchanged; backends: the menu item is
disabled with "needs a server host (Railway/Fly/Render) — not wired yet". Share zips the
source tree (never `node_modules`/`dist`). Live preview for vite runs `npm run dev` and opens
its URL instead of our static server.

### CLI
`build --stack vite|node|python` (default static). `doctor` gains rows: `node`/`npm` version,
`python3`, and warns when a build stack is the default but the tool is missing.

## Contract

| Piece | Change |
|---|---|
| `stack.ts` | `StackProfile` type + `PROFILES` table (install/build/serve/entry/deployDir/doubleClick); `stackInstruction` reads the profile |
| `build-state.ts` | `stack?: StackProfileId` |
| `preview.ts` | `serveForTest(dir, profile)` → `{ url, close() }`; `renderCheck`/`interactCheck` take a URL provider instead of assuming the static server |
| `roles.ts` | prompts read the profile; `check_app` reports install/build/serve failures as text |
| `tui/deploy.ts` | `stageForDeploy` uses `profile.deployDir`; backend targets disabled |
| `git.ts` | exclude `node_modules/ dist/ .venv/` |
| `cli.ts` | `--stack`; doctor rows |
| `engine.ts` | profile threaded through `planBuild`/`startBuild`; `ensureRunInstructions` writes the profile's run commands |

## Order of work (each shippable alone)

1. **Profiles + picker + prompts + git excludes** (static profile = no-op). Nothing runs yet,
   but a Vite project gets planned and coded correctly.
2. **Tester: install + build + serve `dist/`** for vite. This is the real milestone — a Vite
   app that the Tester actually builds and runs.
3. **Deploy/share/preview** for vite.
4. **Node backend** (spawn + port + readiness). Python follows the same shape.

## Cost & risk

- Install runs on your machine with network access, as the user. Same trust model as
  `npm install` in any project you clone — but the code was written by a model. Mitigation:
  the Reviewer runs first and reads `package.json`; `npm ci` (lockfile only) rather than
  `npm install`; no `postinstall` scripts (`--ignore-scripts`) by default, with a per-project
  override.
- Time: a cold Vite install is 20–60 s; cached by lockfile hash so retries and the Tester's
  repeated `check_app` calls don't pay it again.
- Tokens: the dev prompt grows by ~60 tokens. Build-failure stderr in the Tester reply is
  capped to the last 40 lines.

## Open questions

1. `npm ci --ignore-scripts` by default (safer, breaks the rare package that needs a
   postinstall) — or plain `npm install`? Recommendation: `--ignore-scripts`, with a
   project-level toggle shown when a build fails for that reason.
2. Should the **static** path stay the default for "Let the AI decide"? Recommendation: yes
   — cheapest, most robust, and every existing guarantee holds; the PM only picks Vite when
   the request needs it (TypeScript, Tailwind, routing, state library).
3. Backend targets: are Node and Python both wanted, or Node only first? Recommendation:
   Node only in the first pass; Python is the same shape and can follow once Node is solid.

## Decisions (2026-09-16)

1. `npm ci --ignore-scripts` by default; a per-project "allow install scripts" switch appears
   when a build fails for that reason.
2. "Let the AI decide" keeps **static** as the default; the PM picks Vite only when the
   request needs it.
3. Backends: **Node first**; Python follows once Node is solid.
