# Tip calculator — example build

Built end to end by Projectinator (PM → design → 3× code → test, all on
Anthropic, $0.46, tester verdict PASS).

Kept as a regression artifact for the **"runs on double-click" fix**. The idea
deliberately asked for three separate files (`index.html`, `styles.css`,
`app.js`) — the same multi-file split that previously produced an app wired with
ES modules, which browsers block on `file://` (blank page on double-click).

With the fix in place the Developer emits a classic non-module `<script src>`
plus an IIFE, so it works both ways:

- **Double-click `index.html`** (file://) — works.
- Served over http (`python3 -m http.server`) — works.

Verified: `renderCheck` reports `doubleClickBroken: false`; entering $100 @ 20%
yields Tip $20.00 / Total $120.00.
