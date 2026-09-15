# Richer tester — design (no code yet)

Today `check_app` (`roles.ts` → `preview.ts renderCheck`) loads the app once over http and
once over `file://`, collects console/page errors + failed requests, grabs body text, and
tells the Tester model. That catches "blank page" and "JS threw". It does not catch: layouts
that break at phone width, unreadable contrast, missing alt text, a button that does nothing
when clicked, or a rebuild that quietly changed how the page looks.

## Goal

Give the Tester *evidence* it can't get by reading code, cheaply, and keep every artifact so
a human can see what the tester saw. Four pieces, shippable independently, in this order.

## 1. Viewport screenshots (smallest, biggest visible win)

`renderCheck` already accepts `screenshotPath`. Extend to three widths — 390 (phone), 820
(tablet), 1280 (desktop) — written to `<project>/.checks/<taskId>-r<round>-<width>.png`.
`check_app`'s reply lists the paths and, per viewport, whether any element overflows the
viewport horizontally (`document.documentElement.scrollWidth > innerWidth` — the classic
"phone layout is broken" signal) and the rendered text length (0 = blank at that width).

- `.checks/` is gitignored in the workspace (`git.ts initRepo` writes the ignore).
- Transcripts screen: an outcome with screenshots lists them; Enter on one opens it with
  `openInBrowser`. No image rendering in the terminal.
- Cost: three page loads instead of one — ~1 s. No model tokens.

## 2. Accessibility + basic quality checks (no model needed)

Run in the same headless page, report as structured facts in the `check_app` reply so the
Tester can cite them in `bugs`:

| Check | How | Severity hint |
|---|---|---|
| images without `alt` | DOM query | medium |
| form controls without a label | `input/select/textarea` lacking `<label for>`, `aria-label`, or `aria-labelledby` | medium |
| document has no `<title>` / no `<h1>` | DOM | low |
| contrast of body text vs background < 4.5:1 | computed styles on `body` + the largest text block; WCAG formula, pure fn | medium |
| `lang` missing on `<html>` | DOM | low |
| horizontal overflow at 390px | from piece 1 | high |

Not Lighthouse: it needs its own Chrome flags, ~10 s per run, and its scores are noisy for
a static page. The six checks above are ~40 lines of `page.evaluate` and deterministic.
Lighthouse can be a later opt-in behind a pref.

## 3. Interaction probe

Static apps still have behaviour: a button that should update a total, a form that should
validate. The Tester model can already run `bash`, but not drive the page. Add a second
tool, `interact_app`, with a tiny declarative script the model writes:

```json
{ "file": "index.html", "steps": [
  { "fill": "#bill", "value": "100" },
  { "fill": "#tip", "value": "15" },
  { "click": "#calc" },
  { "expectText": "#total", "contains": "115" }
]}
```

Executed in one Playwright page; reply = pass/fail per step, console errors during the run,
and a screenshot after the last step. Steps: `click`, `fill`, `select`, `press`, `expectText`,
`expectVisible`, `expectUrl`. Bounded: max 20 steps, 10 s total. The Tester prompt gains one
line: *"for interactive apps, write an interact_app script that exercises the main flow
before judging."* This is where most real "the app doesn't work" bugs live.

## 4. Visual diff on rebuild

When a task re-runs (feedback round ≥ 1, or a change build), compare the new 1280px
screenshot to the previous one for the same task: pixel diff via Playwright's built-in
`toHaveScreenshot` machinery is test-runner-bound; use `pixelmatch`-style comparison on the
raw PNG buffers (Playwright ships `pngjs`; ~30 lines, no new dependency). Store the diff
percentage on the outcome (`RoleResult.visualDelta?: number`) and show it in History next to
the commit (`▲ 12% visual change`). Purely informational; the Tester's verdict still rules.

## Contract changes

| Piece | Change |
|---|---|
| `preview.ts` | `renderCheck` → per-viewport results + a11y facts; new `interactCheck(dir, file, steps)` |
| `roles.ts` | `check_app` reply gains viewport + a11y sections; new `interact_app` tool (test role only); Tester prompt updated |
| `types.ts` | `RoleResult.screenshots?: string[]`, `RoleResult.visualDelta?: number` |
| `git.ts` | workspace `.gitignore` adds `.checks/` |
| `tui/App.tsx` | Transcripts: list screenshots, open on Enter; History: visual delta badge |
| `orchestrator.ts` | none |

## What it costs

Piece 1–2: zero model tokens, ~1–2 s per test task. Piece 3: the model writes one small
JSON script (~200 output tokens) and reads a short result. Piece 4: CPU only.

## Tests to write

- `renderCheck` on a fixture page with a deliberately overflowing element at 390px → flagged
  only at 390. A fixture with a missing `alt` and an unlabeled input → both facts present.
- `interactCheck` on a fixture calculator → passes; with a wrong expected total → the failing
  step is named.
- Visual diff: identical PNGs → 0; a fixture with one changed region → > 0 and < 100.
- Tester tool tests (`tester-tools.test.ts`) extended for the new reply sections.

## Open questions

1. Screenshots per task accumulate (3 per test run × rounds). Keep the last N rounds per task,
   or all? Recommendation: keep all, they're small (~50 KB) and `.checks/` is not shipped.
2. Should `interact_app` be available to the **Reviewer** too? Recommendation: no — the
   Reviewer is the cheap static pass; running the app is the Tester's job.
3. Contrast check: body text only (cheap, robust) or every text node (thorough, noisy)?
   Recommendation: body + headings.

## Decisions (2026-09-15)

1. Keep every screenshot; `.checks/` is small and never shipped.
2. `interact_app` is Tester-only. The Reviewer stays a static code pass; sub-pages are
   exercised by the Tester clicking through them.
3. Contrast check covers body text and headings.
