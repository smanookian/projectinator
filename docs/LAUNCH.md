# Launch copy

Everything here is checkable. Costs and task counts come from the builds committed in
[`examples/`](../examples/); the tester verdicts are from those runs' `build-state.json`.
If a number changes, change it here too — the credibility of the post is the numbers.

---

## Show HN

**Title** (80 char limit — this is 79):

```
Show HN: Projectinator – a terminal cockpit where AI models plan and build apps
```

**Body:**

```
Projectinator is a TUI where you act as the PM and a roster of AI models does the work. You
type an idea; a PM model breaks it into a Scrum backlog; each task is routed to the model
that's best and cheapest for that job — planning, design, code, review, test — and you watch
it on a live board with a running cost.

The part I care about: the Tester actually runs the app. It starts a server when the stack
needs one, opens the build in headless Chromium, and fails the task on real runtime errors.
A verdict means the app was executed, not that the code looked fine.

Two builds, unedited, committed in the repo:

- A markdown scratchpad: 11 tasks, $2.46. Live preview, localStorage persistence, a toolbar
  that wraps the selected text, word/char count, copy button.
- A 4-page static site: 10 tasks, $1.77, built with independent code tasks running in
  parallel git worktrees. Three merges conflicted; each recovered with a serial rebuild.

Things I got wrong and fixed, in case they're useful to anyone building the same kind of tool:

- Estimates ran ~2x low because the cost model assumed input served from cache bills at the
  cache-read rate. Measured bills behave as if there's no discount. It now calibrates on
  measured dollars per (capability, difficulty, model).
- A build could report "Complete" when the Tester returned no verdict at all — the feedback
  loop only reacted to a verdict that *failed*. A judge that judges nothing is now a failure.
- Storing projects inside the installed package meant `npm i -g pkg@latest` deleted your work
  on every upgrade, not just on uninstall.

Builds run real shell commands on your machine, so Safe mode is the default: it refuses
deleting outside the project folder, reading ~/.ssh or your API keys, sudo, curl|sh, and
git push. It's a guard, not a sandbox, and the README says so.

Bring your own API key (Anthropic / OpenAI / Gemini / OpenRouter), or point it at Ollama or
LM Studio for free local runs. Node >= 22.19, MIT.

npm i -g projectinator
https://github.com/smanookian/projectinator
```

**Answers to comments you will get** (have these ready; don't pre-empt them in the post):

- *"Isn't this just Claude Code / Aider with extra steps?"* — Those are one agent in your repo.
  This is a backlog of tasks routed to *different* models by role and difficulty, with a
  per-task cost ceiling and a tester that executes the result. The bake-off exists because
  "which model is best for this role" should be measured, not assumed.
- *"Why would I pay for six model calls?"* — Because a $0.02 test task catches what a $0.50
  code task got wrong. The review policy defaults to hard tasks only for exactly this reason:
  reviews were 22% of spend and caught nothing across the runs I measured.
- *"How is the cost estimate not nonsense?"* — It was nonsense: ~2x low. It now uses measured
  dollars once a bucket has two runs, and prices conservatively before that. Predicted vs
  actual is in the Retro screen.
- *"Sandbox?"* — No. Safe mode blocks the realistic accident; a container is the real answer
  and isn't built yet. Don't point it at a repo you care about without a backup.

---

## Reddit (r/LocalLLaMA angle — lead with local models)

**Title:** `Terminal app that plans and builds a project with a team of models — works fully local with Ollama/LM Studio`

```
I built a TUI where an AI "team" builds an app: a PM model writes the backlog, then each task
goes to the model that fits it — design, code, review, test. Cost per task is tracked live and
capped.

It runs entirely against a local server if you want: point Settings → Local models at Ollama or
LM Studio and it routes everything there at $0. It writes one entry into Pi's models.json for
provider `local`; local is never a silent fallback for a cloud task, so a local run stays local.

The tester is the part worth stealing: it prepares the stack (npm install / venv), starts a
server on a free port when the stack needs one, opens the app in headless Chromium, and fails
the task on real console errors. Verdicts carry a runtimeChecked flag so you can tell an
executed pass from a read-the-code pass.

Two example builds with real costs are committed in the repo (an $2.46 markdown editor and a
$1.77 four-page site built in parallel git worktrees).

MIT, Node >=22.19: npm i -g projectinator
https://github.com/smanookian/projectinator
```

---

## X / Mastodon thread

```
1/ Projectinator: you're the PM, the dev team is a roster of AI models.

Type an idea → a PM model writes the backlog → each task goes to the best (and cheapest) model
for that job → you watch it build on a live board with a running cost.

npm i -g projectinator
```

```
2/ The tester actually runs the app.

Not "reads the diff and says LGTM" — it installs deps, starts a server when the stack needs
one, opens the build in headless Chromium, and fails the task on real runtime errors.
```

```
3/ Real output, committed unedited:

• markdown scratchpad — 11 tasks, $2.46 (live preview, localStorage, toolbar, counts)
• 4-page site — 10 tasks, $1.77, built in parallel git worktrees; 3 merge conflicts, all
  auto-recovered
```

```
4/ Cost is the honest part.

Estimates were ~2x low because the pricing assumed a cache discount the bill never gave. It
now calibrates on measured dollars per role/difficulty/model, and the Retro screen shows
predicted vs actual.
```

```
5/ It writes files and runs shell commands on your machine, so Safe mode is the default:
no deleting outside the project folder, no reading ~/.ssh or your API keys, no sudo,
no curl|sh, no git push.

A guard, not a sandbox. The README says so.
```

```
6/ Bring your own key (Anthropic / OpenAI / Gemini / OpenRouter) — or run it free and private
against Ollama / LM Studio.

MIT. https://github.com/smanookian/projectinator
```

---

## Rules for posting

- **Don't claim it replaces a developer.** It builds small apps well and says what each one
  cost. That is the claim, and it survives scrutiny.
- **Lead with a number, not an adjective.** "11 tasks, $2.46, here is the code" beats
  "powerful multi-agent orchestration".
- **Name the limits before someone else does**: no sandbox, small apps, mobile/desktop stacks
  fall back to a web build, web-login for paid subscriptions is parked.
- **Post when you can sit with it for a few hours.** The first hour of comments is where the
  real bug reports arrive.
