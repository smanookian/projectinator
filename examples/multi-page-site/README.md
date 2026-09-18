# Multi-page site — example build (parallel worktrees)

Built end to end by Projectinator from one sentence, unedited:

> A static site with three independent pages: about.html with a bio, contact.html with a form,
> and pricing.html with a table. Plus index.html linking to all three. Each page has its own
> separate CSS file.

**10 tasks · $1.77 · complete.** Tester verdict `{"passed":true,"bugs":[],"runtimeChecked":true}`
— the app was really executed in headless Chromium, not just read.

## Why this one exists

It was built with **parallel code tasks** on (`Settings → Build defaults`, or `--parallel-code`).
Independent code tasks run at the same time, each in its own git worktree, merged back per task.
This run is the artifact for what happens when that goes wrong: three merges conflicted and every
one recovered.

```
merge_conflict T-03 css/index.css    → rebuilt serially → ✓ $0.08
merge_conflict T-06 css/contact.css  → rebuilt serially → ✓ $0.12
merge_conflict T-09 css/pricing.css  → rebuilt serially → ✓ $0.12
done: halted false · $1.77 · 10 files
```

Afterwards the workspace was clean: `.worktrees/` empty, `git worktree list` showing only `main`,
no leftover branches.

## Verified by hand afterwards

Every page opened in a real browser from `file://`:

| page | title | check |
|---|---|---|
| `index.html` | Home | links to all three pages |
| `about.html` | About | bio content, own stylesheet |
| `contact.html` | Contact | a real `<form>`, `mailto:` link |
| `pricing.html` | Pricing | a 9-row `<table>` |

Each page loads its own CSS file, as asked. No console errors.
