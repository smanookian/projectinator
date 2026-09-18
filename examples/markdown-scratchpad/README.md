# Markdown scratchpad — example build

Built end to end by Projectinator from one sentence, unedited:

> A markdown scratchpad: type notes in a textarea on the left, see rendered HTML live on the
> right. Notes persist in localStorage so they survive a reload. A toolbar with bold, italic,
> heading and list buttons that wrap the selected text. Live word and character count. A
> copy-as-markdown button.

**11 tasks · $2.46 · complete** (PM → design → 8× code → 1 review → test). The Reviewer ran
once, on the only task the PM rated `high` difficulty — the default review policy.

The Tester executed the app in headless Chromium and returned
`{"passed":true,"bugs":[],"runtimeChecked":true}`.

## Verified by hand afterwards

Driven in a real browser, every feature the idea asked for:

| feature | result |
|---|---|
| live preview | `# Title` + `**bold**` → `<h1>Title</h1> <p><strong>bold</strong></p>` |
| word / char / line count | `6 words`, `39 chars`, `6 lines` |
| persistence | text survived a genuine page reload (`localStorage['scratchpad.doc']`) |
| toolbar | selecting `plain` and pressing **B** produced `**plain**` |
| copy as markdown | button calls `navigator.clipboard.writeText` |

No console errors. Open `index.html` by double-clicking it — no server, no build step.

## What it shows

The markdown parser in `app.js` is hand-written (no dependency), because the stack profile is
`static`: everything has to run from `file://`. That constraint is in the brief the roles see,
not something patched afterwards.
