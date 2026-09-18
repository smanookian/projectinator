# Markdown Scratchpad — Design Spec

## T-01: File Structure

Plain static site. No build step, no bundler, no ES modules. Opens by double-clicking `index.html` (works on `file://`).

```
/
├── index.html      Single page shell: markup for toolbar, editor pane, preview pane, status bar
├── styles.css      All styling: layout, theme tokens (light/dark), component states, print styles
└── app.js          All behaviour, one classic script, IIFE-wrapped, no imports/exports
```

### index.html
- `<!doctype html>`, `lang="en"`, `<meta charset="utf-8">`, `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- `<title>Scratchpad</title>`
- `<link rel="stylesheet" href="styles.css">` in `<head>`.
- `<script src="app.js" defer></script>` — **one classic script tag**, no `type="module"`. Loaded at end of `<head>` with `defer` (or last thing before `</body>`); either way it runs on double-click from disk.
- Body structure (ids are the contract `app.js` relies on):
  - `<header class="toolbar" id="toolbar">` — app title, view-mode buttons (`#btn-edit`, `#btn-split`, `#btn-preview`), `#btn-theme`, `#btn-copy`, `#btn-download`, `#btn-clear`.
  - `<main class="panes" id="panes">`
    - `<section class="pane pane--editor"><textarea id="editor" spellcheck="false"></textarea></section>`
    - `<section class="pane pane--preview"><article id="preview" class="markdown"></article></section>`
  - `<footer class="statusbar" id="statusbar">` — `#stat-words`, `#stat-chars`, `#stat-lines`, `#stat-saved`.
- No inline styles, no inline event handlers (except none at all — listeners attached in `app.js`).
- Markdown rendering is done by hand-rolled code in `app.js`; **no CDN dependencies** (must work offline/file://).

### styles.css
Sections, in order:
1. `:root` design tokens — colours, spacing scale, radii, font stacks, transition durations.
2. `[data-theme="dark"]` token overrides on `<html>`.
3. Reset/base — `box-sizing`, margins, `html,body{height:100%}`, body grid (`toolbar / panes / statusbar` rows).
4. Layout — `.panes` as CSS grid; modifier classes `.panes--edit`, `.panes--split`, `.panes--preview` toggled by `app.js`.
5. Components — `.toolbar`, `.btn` (+ `:hover`, `:focus-visible`, `:active`, `.is-active`, `:disabled`), `#editor`, `.statusbar`, `.toast`.
6. `.markdown` typography — headings, `p`, `ul/ol`, `blockquote`, `code`, `pre`, `table`, `hr`, `a`, `img`.
7. Responsive — under 720px `.panes--split` collapses to stacked rows.
8. `@media print` — hide toolbar/statusbar/editor, print preview only.
9. `@media (prefers-reduced-motion: reduce)` — disable transitions.

### app.js
Single IIFE: `(function () { 'use strict'; ... })();`. No module syntax. Internal sections:
1. `DOM` — cached `getElementById` references.
2. `STORAGE_KEY = 'scratchpad.doc'`, `THEME_KEY = 'scratchpad.theme'`, `VIEW_KEY = 'scratchpad.view'`.
3. `renderMarkdown(text)` — string → HTML, with escaping of `&<>` before inline rules.
4. `updatePreview()`, `updateStats()` — debounced (150ms) on `input`.
5. `save()` — debounced (400ms) `localStorage.setItem`, wrapped in try/catch (file:// quota/privacy failures degrade silently, status shows "not saved").
6. `load()` — restore doc, theme, view mode on `DOMContentLoaded`; seed welcome doc if empty.
7. View-mode, theme-toggle, copy, download (Blob + `URL.createObjectURL`), clear (with confirm) handlers.
8. Keyboard shortcuts: `Ctrl/Cmd+S` save+toast, `Ctrl/Cmd+E` cycle view, `Tab` inserts two spaces, `Ctrl/Cmd+B` / `+I` wrap selection.
9. `toast(msg)` helper.

Load-order rule if the script is ever split: `styles.css` first in `<head>`; scripts as plain `<script src>` tags in dependency order (e.g. `markdown.js` then `app.js`) — never `type="module"`.
