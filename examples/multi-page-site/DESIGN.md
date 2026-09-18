# Design Spec — T-01: File Tree

Plain static site. No build step, no bundler, no ES modules. Every page must work
when double-clicked from the file system (`file://`).

## File tree

```
/
├── index.html        Home / landing page
├── about.html        About page
├── contact.html      Contact page
├── pricing.html      Pricing page
├── css/
│   ├── index.css     Styles for index.html only
│   ├── about.css     Styles for about.html only
│   ├── contact.css   Styles for contact.html only
│   └── pricing.css   Styles for pricing.html only
└── DESIGN.md         This spec
```

## What each file holds

| File | Contents |
| --- | --- |
| `index.html` | Full standalone HTML5 document: `<head>` with charset, viewport, title "Home", single `<link rel="stylesheet" href="css/index.css">`. Body: site header with nav, hero section, feature/summary blocks, footer. |
| `about.html` | Standalone document, title "About", links `css/about.css`. Body: header + nav, page heading, prose/story sections, team or values block, footer. |
| `contact.html` | Standalone document, title "Contact", links `css/contact.css`. Body: header + nav, page heading, contact form (name, email, message, submit) plus contact details block, footer. |
| `pricing.html` | Standalone document, title "Pricing", links `css/pricing.css`. Body: header + nav, page heading, pricing tier cards, FAQ / fine-print block, footer. |
| `css/index.css` | All CSS needed by `index.html`: reset/base, tokens (custom properties), header/nav, hero, feature grid, footer, responsive rules. |
| `css/about.css` | All CSS needed by `about.html`, self-contained (own reset/base/tokens/header/footer + about-specific sections). |
| `css/contact.css` | All CSS needed by `contact.html`, self-contained, including form field and button states (default/hover/focus/invalid/disabled). |
| `css/pricing.css` | All CSS needed by `pricing.html`, self-contained, including tier card states (default/hover/featured). |

## Rules

1. **One stylesheet per page.** Each HTML file links exactly one CSS file from `css/`.
   No shared `base.css`, no `@import`. Each CSS file repeats its own reset, tokens,
   header and footer rules so the pages stay independent.
2. **Relative paths only**, no leading slash: `css/index.css`, `about.html`.
   Guarantees correct resolution under `file://`.
3. **No JavaScript files** in this tree. If a page later needs behaviour, add one
   classic `<script src="js/<page>.js"></script>` before `</body>` —
   never `<script type="module">` with relative `import`.
4. **Nav is duplicated in every HTML file** (no includes available without a build
   step) and links: Home → `index.html`, About → `about.html`,
   Pricing → `pricing.html`, Contact → `contact.html`. The link matching the
   current page carries `class="is-current"` with `aria-current="page"`.
5. **No external assets or CDNs.** System font stack only, so the site renders
   identically offline.
6. Flat structure: only the `css/` subdirectory exists. Add `img/` later if images
   are introduced; nothing else at root but the four HTML files.
