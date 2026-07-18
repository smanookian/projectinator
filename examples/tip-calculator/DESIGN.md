# Design Spec — T-01: File Structure & Component Responsibilities

A **plain static site, no build step.** All files sit flat in the project root and run by
double-clicking `index.html` (works on `file://`). No ES modules, no relative `import`,
no bundler.

---

## File Structure

```
index.html      Document skeleton + markup for every screen region. One classic <script src>.
styles.css      All styling: layout, theme tokens, component styles, state classes.
app.js          All behaviour: state, rendering, events. Classic script (no modules).
```

Three files, loaded in this order by the browser:

1. `styles.css` via `<link rel="stylesheet" href="styles.css">` in `<head>`.
2. `app.js` via `<script src="app.js"></script>` placed **just before `</body>`** so the DOM
   exists when it runs. No `type="module"`, no `defer` needed.

> Rule: never use `<script type="module">` + `import './x.js'`. Under `file://` browsers
> block those and the page looks dead. One classic `<script src>` only.

---

## `index.html` — responsibilities

Holds structure only; no inline styles, no inline scripts (except the single `<script src>`).

- `<head>`: charset, viewport meta, `<title>`, `<link>` to `styles.css`.
- `<body>` regions, top to bottom:
  - `<header class="app-header">` — app title / branding, primary action button.
  - `<main class="app-main">` — the primary content container that `app.js` renders into.
  - `<footer class="app-footer">` — secondary info / status line.
- Any list or repeated item is rendered by JS into a container element with a stable `id`
  (e.g. `<div id="content"></div>`), or cloned from a `<template>` element.
- `<script src="app.js"></script>` as the last element before `</body>`.

## `styles.css` — responsibilities

Single stylesheet, organised in this order:

1. **Reset / base** — `*{box-sizing:border-box}`, margin reset, base `body` font & colour.
2. **Theme tokens** — CSS custom properties on `:root` (colours, spacing, radius, shadow).
3. **Layout** — header/main/footer, container widths, spacing.
4. **Components** — one block per component (button, card, input, list item).
5. **States** — `.is-active`, `.is-hidden`, `.is-loading`, `.is-error`, `:hover`, `:focus`,
   `:disabled`, empty-state.
6. **Responsive** — one or two `@media` breakpoints at the bottom.

### Colour tokens (`:root`)

| Token             | Value      | Use                                  |
|-------------------|------------|--------------------------------------|
| `--bg`            | `#0f1115`  | page background                      |
| `--surface`       | `#1a1d24`  | cards, panels                        |
| `--text`          | `#e6e8ec`  | primary text                         |
| `--text-muted`    | `#9aa0ab`  | secondary text                       |
| `--accent`        | `#4f8cff`  | primary buttons, links, focus ring   |
| `--accent-hover`  | `#6ba0ff`  | hover state of accent               |
| `--border`        | `#2a2e37`  | dividers, input borders              |
| `--success`       | `#3ecf8e`  | success/confirm                      |
| `--danger`        | `#ff5c6c`  | errors, destructive actions          |

Spacing scale: `--sp-1:4px --sp-2:8px --sp-3:16px --sp-4:24px --sp-5:32px`.
Radius: `--radius:10px`. Shadow: `--shadow:0 2px 12px rgba(0,0,0,.35)`.

### Component states

- **Button** — default (accent bg, white text), `:hover` (accent-hover), `:focus-visible`
  (2px accent outline), `:disabled` (0.5 opacity, no pointer).
- **Card / list item** — default surface; `.is-active` accent left-border; `:hover` subtle lift.
- **Input** — border `--border`; `:focus` border + ring `--accent`; `.is-error` border `--danger`.
- **Global** — `.is-hidden { display:none }`, `.is-loading` (spinner / dimmed), empty-state
  centered muted text.

## `app.js` — responsibilities

One classic script wrapped in an IIFE (or `DOMContentLoaded` handler) to avoid globals.
Conceptual sections, in order:

1. **State** — a single plain object holding all app data (`const state = { ... }`).
2. **DOM refs** — cache elements via `document.getElementById` / `querySelector` once.
3. **Render functions** — pure-ish functions that read `state` and update the DOM
   (`render()`, `renderList()`), toggling the state classes defined in `styles.css`.
4. **Event handlers** — read/modify `state`, then call `render()`. Use event delegation on
   container elements for dynamic items.
5. **Init** — wire listeners, load any persisted data (e.g. `localStorage`), first `render()`.

Data flow: **event → mutate `state` → `render()` → DOM**. One-way, no framework.

---

## Handoff notes for the Developer

- Keep to these three files at project root; do not introduce a build step or modules.
- Use the CSS token names above verbatim so component styles stay consistent.
- `app.js` must not run before the DOM is ready (script placed at end of body).
- All show/hide and status handled by toggling the documented state classes.
