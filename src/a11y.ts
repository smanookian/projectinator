// Deterministic page-quality facts for the Tester. No model, no Lighthouse — a handful
// of DOM/CSS checks that are cheap, stable, and map to real user-facing defects.
// `pageFacts` runs inside the page (Playwright page.evaluate); the WCAG contrast math is
// exported separately so it can be tested without a browser.

export interface PageFacts {
  lang: boolean; // <html lang> present
  title: boolean; // non-empty <title>
  h1: boolean; // at least one <h1>
  imagesWithoutAlt: number;
  unlabeledControls: number; // input/select/textarea without label/aria-label/aria-labelledby
  /** Worst text/background contrast ratio among body text and headings (WCAG). */
  minContrast: number | null; // null when nothing measurable
  lowContrastSamples: string[]; // e.g. "h2 (2.1:1)"
}

/** Relative luminance of an sRGB triple (0..255 each), per WCAG 2.x. */
export function luminance(r: number, g: number, b: number): number {
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours, 1..21. */
export function contrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
  const l1 = luminance(...fg);
  const l2 = luminance(...bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Parse "rgb(a, b, c)" / "rgba(a, b, c, x)". Returns undefined for transparent or unparsable. */
export function parseRgb(css: string): [number, number, number] | undefined {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/.exec(css);
  if (!m) return undefined;
  if (m[4] !== undefined && parseFloat(m[4]) === 0) return undefined;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}


export const WCAG_AA = 4.5;

/** The function body serialised into the page. Must be self-contained: no imports, no
 *  closures — Playwright stringifies it. Mirrors the helpers above; keep both in sync. */
export const PAGE_FACTS_SCRIPT = `(() => {
  const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratio = (a, b) => { const l1 = lum(...a), l2 = lum(...b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); };
  const parse = (css) => { const m = /rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)(?:\\s*,\\s*([\\d.]+))?\\s*\\)/.exec(css || ""); if (!m) return null; const a = m[4] === undefined ? 1 : parseFloat(m[4]); return { rgb: [+m[1], +m[2], +m[3]], a }; };
  // Effective background: walk up until an opaque colour; default white.
  const bgOf = (el) => { let e = el; while (e) { const p = parse(getComputedStyle(e).backgroundColor); if (p && p.a > 0) return p.a >= 1 ? p.rgb : p.rgb.map((c, i) => Math.round(c * p.a + 255 * (1 - p.a))); e = e.parentElement; } return [255, 255, 255]; };
  const samples = [];
  let min = null;
  const targets = [document.body, ...document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,a,button,label")].filter(Boolean);
  for (const el of targets) {
    const text = (el.innerText || "").trim();
    if (!text) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    const fg = parse(cs.color); if (!fg) continue;
    const bg = bgOf(el);
    const fgc = fg.a >= 1 ? fg.rgb : fg.rgb.map((c, i) => Math.round(c * fg.a + bg[i] * (1 - fg.a)));
    const r = ratio(fgc, bg);
    if (min === null || r < min) min = r;
    if (r < 4.5 && samples.length < 5) samples.push(el.tagName.toLowerCase() + " (" + r.toFixed(1) + ":1) \\"" + text.slice(0, 30) + "\\"");
  }
  const controls = [...document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea")];
  const unlabeled = controls.filter((c) => {
    if (c.getAttribute("aria-label") || c.getAttribute("aria-labelledby") || c.getAttribute("title")) return false;
    if (c.id && document.querySelector('label[for="' + CSS.escape(c.id) + '"]')) return false;
    return !c.closest("label");
  }).length;
  return {
    lang: !!document.documentElement.getAttribute("lang"),
    title: !!document.title.trim(),
    h1: !!document.querySelector("h1"),
    imagesWithoutAlt: [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).length,
    unlabeledControls: unlabeled,
    minContrast: min,
    lowContrastSamples: samples,
  };
})()`;

/** Human lines for the Tester, only for facts that are actual problems. Empty = clean. */
export function describeFacts(f: PageFacts): string[] {
  const out: string[] = [];
  if (!f.title) out.push("no <title> (low)");
  if (!f.lang) out.push("<html> has no lang attribute (low)");
  if (!f.h1) out.push("no <h1> heading (low)");
  if (f.imagesWithoutAlt) out.push(`${f.imagesWithoutAlt} image${f.imagesWithoutAlt === 1 ? "" : "s"} without alt text (medium)`);
  if (f.unlabeledControls) out.push(`${f.unlabeledControls} form control${f.unlabeledControls === 1 ? "" : "s"} without a label (medium)`);
  if (f.minContrast !== null && f.minContrast < WCAG_AA) out.push(`low text contrast, worst ${f.minContrast.toFixed(1)}:1 (WCAG AA needs 4.5:1) — ${f.lowContrastSamples.join(", ")} (medium)`);
  return out;
}
