# Reviewer role — design (no code yet)

Decision (2026-09-15): the Reviewer is a **real team member** — a sixth capability the PM
can plan, you can see and edit on the board, and Settings can assign a model to. Not an
invisible orchestrator step. Resolved: a review follows **every** code task; the registry
holds only a `fast` row, so every difficulty routes to the cheap tier, and Settings → Models
can reassign the Reviewer like any other role.

## What it does

A cheap model reads the files a code task just produced and answers one question: *is
this wired correctly enough to be worth paying the Tester for?* It catches the boring
class of failure — missing `<script src>`, a function called but never defined, a file
the design named but nobody wrote, `import` in a no-build site — before the Tester
spends a Chromium run and a feedback round on it.

It never edits files. It never runs the app. Output is structured, like the Tester.

## Pipeline position

```
design ──▶ code ──▶ review ──▶ test
                      │  fail
                      └──▶ code (fix, round 1) ──▶ review … (bounded)
```

The PM emits `review` tasks with `dependsOn: [<code task>]`, and the test task depends
on the review. The PM prompt gets one new rule: *for every code task, add a review task
that depends on it; the test task depends on the review.* Users can delete review tasks
on the plan board if they don't want them.

## Feedback loop

Reuses the existing Tester→Developer loop in `orchestrator.ts` (`runTaskUnit`). Today it
triggers on `task.capability === "test"`; it becomes `"test" || "review"`. Both produce a
`Verdict`, both re-run the code deps with a bug report. `maxFeedbackRounds` is shared —
a task that fails review twice and test once has used three rounds. Per-task limits and
the halt-on-breach path apply unchanged.

Open point: should review and test have **separate** round budgets? Recommendation: no —
one knob, and review failures are cheap rounds.

## Contract

| Piece | Change |
|---|---|
| `types.ts` | `Capability` gains `"review"`. `Verdict` reused as-is (`runtimeChecked` is always `false` for a review — it never runs anything; the UI must not show `PASS*` for reviews, so the label mapper checks capability). |
| `registry.ts` | One row: `review / fast` → same cheap picks as `test` (Gemini Flash on API). Tier fallback already handles `mid`/`high` requests. |
| `roles.ts` | `ROLE_INTRO.review` prompt; `CAP_STRENGTH.review = "cheap"`; `lockRegistryToProvider` caps list gains `review`; tools = read-only set + `submit_verdict` (**no** `check_app`, no `bash`). |
| `estimate.ts` | `BUCKETS.review` — start as a copy of `test` buckets; calibration will correct it. |
| `pm.ts` | `CAPS` set + prompt rule above. `coerceCap` default stays `"code"`. |
| `orchestrator.ts` | feedback-loop trigger widened to `review`. Nothing else. |
| `tui/components.tsx` | `CAP_LABEL.review`, `ROLE_META.review = { emoji: "🔍", label: "Reviewer" }` (Emoji_Presentation=Yes — see INTERNAL gotchas). |
| `tui/engine.ts` | `ROLE_TIERS` gains a Reviewer slot so Settings → Models can assign it. |
| `tui/App.tsx` | `verdictLabel` takes capability; review verdicts are `PASS`/`FAIL`, never `PASS*`. |
| Boards/editors | `CAPS` arrays gain `review` so `c` cycles through it. |
| `retro.ts` | Tests counter already filters `capability === "test"`, so reviews don't inflate it; review bugs still land in the `bugs` list. No new counter. |
| `bakeoff.ts` | `--capability review` works for free once the registry row exists. |

Everything keyed by `Record<Capability, …>` fails typecheck until every table has the
row — that is the checklist.

## Reviewer prompt (as shipped in `roles.ts`)

> You are the REVIEWER. Do NOT edit files and do NOT run the app. Read the task, the
> design context, and the files in the working directory. Check: every file the design
> named exists; every `<script src>` / `<link href>` / import resolves; no function or
> element is referenced but never defined; a plain static site uses no ES modules or
> `fetch()` of local files (they break on double-click); the task's stated deliverable is
> actually present. Report only real defects a developer must fix — not style. Then call
> `submit_verdict` exactly once.

## Cost

Review = one cheap read-only turn per code task. On the `--mini` build (design → code →
test, ~$0.10) it adds roughly one Flash call (~$0.01). The saving is avoided Tester rounds:
each avoided round is a code re-run (~$0.03–0.05 on Sonnet) plus a Tester run.

## Not in scope

- Diff-scoped review (only files changed by the task). Would need the git commit-per-task
  hash on the outcome; worth doing later, not needed for v1.
- Review of design/plan tasks.
- A Reviewer that proposes fixes (that's the Developer's job in the feedback round).

## Tests to write

- `pm.test.ts`: `coerceCap("review")` keeps it.
- `orchestrator.test.ts`: review FAIL → code re-run with bug report → review re-run; PASS
  continues to test; shares `maxFeedbackRounds`.
- `executor.test.ts` model-resolution loop covers the new registry row automatically.
- TUI: `verdictLabel` never yields `PASS*` for a review.

## Open questions for you

1. Should the PM add a review after **every** code task, or only when the backlog has ≥ 2
   code tasks (single-file builds gain little)?
2. Default model tier for review: `fast` (recommended) or let difficulty drive it like
   other roles?
