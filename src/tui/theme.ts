// Themes — the color system every component reads through `C`. Same look family as
// Musinator, Todonator and Calinator: every theme starts as a small upstream palette (or the
// user's Omarchy colors) and goes through one function, `derive`, which computes the UI roles
// and then fixes contrast: text 4.5:1, borders and the selection marker 3:1. Ported from
// Musinator's `crates/themes` so the apps share palettes, roles and contrast rules.
//
// `C` is a Proxy over the live theme, so the hundreds of `C.accent` / `C.dim` call sites
// re-read the current palette on re-render. It is deliberately NOT a React hook: module-level
// constants and non-React code also read `C`. Components that must react to a switch
// re-render via ThemeCtx.

import { readFileSync, existsSync, statSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, basename } from "node:path";
import { defaultTheme, extendTheme } from "@inkjs/ui";

export type ThemeId = string;

/** Every color the UI draws with (all `#rrggbb`). */
export interface Theme {
  id: ThemeId;
  /** Shown in the theme picker, e.g. `Catppuccin Mocha`. */
  label: string;
  dark: boolean;
  /** App background. */
  bg: string;
  /** Normal text. */
  text: string;
  /** Secondary text: ids, costs, hints. */
  textMuted: string;
  /** Same as textMuted (the family has one secondary text color). */
  textSubtle: string;
  dim: string;
  /** Focused border, focused title-bar fill, the active item. */
  accent: string;
  /** Text on the accent title bar. */
  onAccent: string;
  /** Unfocused pane title-bar fill. */
  titleBar: string;
  /** Selected-row tint in the focused pane. */
  selection: string;
  /** Text on the selection tint. */
  selectionFg: string;
  /** The `→` selection marker. */
  marker: string;
  /** Bottom status bar fill. */
  statusBar: string;
  /** Floating dialog fill. */
  dialogBg: string;
  /** Dialog drop shadow. */
  shadow: string;
  /** Unfocused pane border. */
  border: string;
  borderSubtle: string;
  /** Focused pane border. */
  borderActive: string;
  good: string;
  warn: string;
  bad: string;
  /** Running / ready work. */
  info: string;
}

// ---- color math (sRGB, WCAG contrast, hue-keeping lightness fixes) ----

type Rgb = [number, number, number];

function hex(s: string): Rgb | undefined {
  let h = s.trim().replace(/^#|^0x/, "");
  if (!/^[0-9a-f]+$/i.test(h)) return undefined;
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return undefined;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

function toHex(c: Rgb): string {
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}

function luminance(c: Rgb): number {
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/** Blends toward `b`: t=0 is `a`, t=1 is `b`. */
function mix([r, g, b]: Rgb, [r2, g2, b2]: Rgb, t: number): Rgb {
  const k = Math.min(1, Math.max(0, t));
  return [Math.round(r + (r2 - r) * k), Math.round(g + (g2 - g) * k), Math.round(b + (b2 - b) * k)];
}

function toHsl([r8, g8, b8]: Rgb): [number, number, number] {
  const r = r8 / 255, g = g8 / 255, b = b8 / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = (((g - b) / d) % 6 + 6) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): Rgb {
  const L = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * L - 1)) * Math.min(1, Math.max(0, s));
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const sector: [number, number, number][] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]];
  const [r, g, b] = sector[Math.min(5, Math.floor(hp))]!;
  const m = L - c / 2;
  const f = (v: number) => Math.min(255, Math.max(0, Math.round((v + m) * 255)));
  return [f(r), f(g), f(b)];
}

/** WCAG 2.x contrast ratio between two `#rrggbb` colors, 1 to 21. */
export function contrast(a: string, b: string): number {
  const la = luminance(hex(a)!), lb = luminance(hex(b)!);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** `fg` unchanged if it reaches `min` against every bg; else moves its lightness (same hue
 *  and saturation) just far enough. If no lightness works, the best one found. */
function legibleOn(fg: Rgb, bgs: Rgb[], min: number): Rgb {
  const worst = (c: Rgb) => Math.min(...bgs.map((b) => contrast(toHex(c), toHex(b))));
  const start = worst(fg);
  if (start >= min) return fg;
  const [h, s, l] = toHsl(fg);
  const avg = bgs.reduce((a, b) => a + luminance(b), 0) / bgs.length;
  const lighterFirst = luminance(fg) >= avg;
  let best: [Rgb, number] = [fg, start];
  for (const lighter of [lighterFirst, !lighterFirst]) {
    const STEPS = 512;
    for (let i = 1; i <= STEPS; i++) {
      const t = i / STEPS;
      const c = fromHsl(h, s, lighter ? l + (1 - l) * t : l * (1 - t));
      const w = worst(c);
      if (w >= min) return c;
      if (w > best[1]) best = [c, w];
    }
  }
  return best[0];
}

// ---- palettes → themes ----

/** The few colors a theme is built from. */
interface Palette {
  dark: boolean;
  bg: Rgb;
  fg: Rgb;
  muted: Rgb;
  /** A surface/line color a step or two above `bg`. */
  border: Rgb;
  accent: Rgb;
  red: Rgb;
  green: Rgb;
  yellow: Rgb;
  /** Running / ready work (blue-ish). */
  info: Rgb;
}

const TEXT = 4.5; // required contrast for text
const UI = 3.0; // required contrast for borders and the selection marker
const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

function derive(id: string, label: string, p: Palette): Theme {
  const bg = p.bg;
  // Fills. These stay subtle on purpose.
  const titleBar = mix(bg, p.border, 0.45);
  const selection = mix(bg, p.accent, 0.2);
  const statusBar = mix(bg, p.accent, 0.18);
  const dialogBg = p.dark ? mix(bg, p.fg, 0.06) : mix(bg, WHITE, 0.6);
  const shadow = p.dark ? mix(bg, BLACK, 0.6) : mix(bg, BLACK, 0.2);
  const fills = [bg, titleBar, selection, statusBar, dialogBg];
  const fg = legibleOn(p.fg, fills, TEXT);
  const muted = legibleOn(p.muted, fills, TEXT);
  const accent = legibleOn(p.accent, [bg, selection, dialogBg], TEXT);
  const onAccent = legibleOn(bg, [accent], TEXT);
  const marker = legibleOn(accent, [bg, selection, dialogBg], UI);
  const border = legibleOn(p.border, [bg], UI);
  const status = (c: Rgb) => toHex(legibleOn(c, [bg, selection, dialogBg], TEXT));
  const mutedHex = toHex(muted);
  return {
    id, label, dark: p.dark,
    bg: toHex(bg),
    text: toHex(fg),
    textMuted: mutedHex, textSubtle: mutedHex, dim: mutedHex,
    accent: toHex(accent),
    onAccent: toHex(onAccent),
    titleBar: toHex(titleBar),
    selection: toHex(selection),
    selectionFg: toHex(fg),
    marker: toHex(marker),
    statusBar: toHex(statusBar),
    dialogBg: toHex(dialogBg),
    shadow: toHex(shadow),
    border: toHex(border), borderSubtle: toHex(border), borderActive: toHex(accent),
    good: status(p.green), warn: status(p.yellow), bad: status(p.red), info: status(p.info),
  };
}

/** Order: bg, fg, muted, border, accent, red, green, yellow, info. Same upstream palettes as
 *  Musinator (its viz-low color is our `info`). */
const PALETTES: [string, string, boolean, string[]][] = [
  ["catppuccin-mocha", "Catppuccin Mocha", true, ["#1e1e2e", "#cdd6f4", "#7f849c", "#45475a", "#89b4fa", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa"]],
  ["catppuccin-macchiato", "Catppuccin Macchiato", true, ["#24273a", "#cad3f5", "#8087a2", "#494d64", "#8aadf4", "#ed8796", "#a6da95", "#eed49f", "#8aadf4"]],
  ["catppuccin-frappe", "Catppuccin Frappé", true, ["#303446", "#c6d0f5", "#838ba7", "#51576d", "#8caaee", "#e78284", "#a6d189", "#e5c890", "#8caaee"]],
  ["catppuccin-latte", "Catppuccin Latte", false, ["#eff1f5", "#4c4f69", "#8c8fa1", "#bcc0cc", "#1e66f5", "#d20f39", "#40a02b", "#df8e1d", "#1e66f5"]],
  ["tokyo-night", "Tokyo Night", true, ["#1a1b26", "#c0caf5", "#565f89", "#414868", "#7aa2f7", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7"]],
  ["tokyo-night-storm", "Tokyo Night Storm", true, ["#24283b", "#c0caf5", "#565f89", "#414868", "#7aa2f7", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7"]],
  ["tokyo-night-day", "Tokyo Night Day", false, ["#e1e2e7", "#3760bf", "#848cb5", "#a8aecb", "#2e7de9", "#f52a65", "#587539", "#8c6c3e", "#2e7de9"]],
  ["rose-pine", "Rosé Pine", true, ["#191724", "#e0def4", "#6e6a86", "#403d52", "#c4a7e7", "#eb6f92", "#9ccfd8", "#f6c177", "#9ccfd8"]],
  ["rose-pine-moon", "Rosé Pine Moon", true, ["#232136", "#e0def4", "#6e6a86", "#44415a", "#c4a7e7", "#eb6f92", "#9ccfd8", "#f6c177", "#9ccfd8"]],
  ["rose-pine-dawn", "Rosé Pine Dawn", false, ["#faf4ed", "#575279", "#9893a5", "#dfdad9", "#907aa9", "#b4637a", "#56949f", "#ea9d34", "#56949f"]],
  ["gruvbox-dark", "Gruvbox Dark", true, ["#282828", "#ebdbb2", "#928374", "#504945", "#fe8019", "#fb4934", "#b8bb26", "#fabd2f", "#83a598"]],
  ["gruvbox-light", "Gruvbox Light", false, ["#fbf1c7", "#3c3836", "#928374", "#d5c4a1", "#af3a03", "#9d0006", "#79740e", "#b57614", "#076678"]],
  ["nord", "Nord", true, ["#2e3440", "#d8dee9", "#616e88", "#4c566a", "#88c0d0", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1"]],
  ["dracula", "Dracula", true, ["#282a36", "#f8f8f2", "#6272a4", "#44475a", "#bd93f9", "#ff5555", "#50fa7b", "#f1fa8c", "#8be9fd"]],
  ["one-dark", "One Dark", true, ["#282c34", "#abb2bf", "#5c6370", "#3e4451", "#61afef", "#e06c75", "#98c379", "#e5c07b", "#61afef"]],
  ["solarized-dark", "Solarized Dark", true, ["#002b36", "#839496", "#586e75", "#073642", "#268bd2", "#dc322f", "#859900", "#b58900", "#268bd2"]],
  ["solarized-light", "Solarized Light", false, ["#fdf6e3", "#657b83", "#93a1a1", "#eee8d5", "#268bd2", "#dc322f", "#859900", "#b58900", "#268bd2"]],
  ["kanagawa-wave", "Kanagawa Wave", true, ["#1f1f28", "#dcd7ba", "#727169", "#54546d", "#7e9cd8", "#e82424", "#98bb6c", "#e6c384", "#7e9cd8"]],
  ["everforest-dark", "Everforest Dark", true, ["#2d353b", "#d3c6aa", "#859289", "#4f585e", "#a7c080", "#e67e80", "#a7c080", "#dbbc7f", "#7fbbb3"]],
  ["ayu-mirage", "Ayu Mirage", true, ["#1f2430", "#cccac2", "#707a8c", "#707a8c", "#ffcc66", "#ff6666", "#87d96c", "#ffa659", "#5ccfe6"]],
  ["github-dark", "GitHub Dark", true, ["#0d1117", "#c9d1d9", "#8b949e", "#30363d", "#58a6ff", "#f85149", "#3fb950", "#d29922", "#58a6ff"]],
  ["github-light", "GitHub Light", false, ["#ffffff", "#24292f", "#57606a", "#d0d7de", "#0969da", "#cf222e", "#1a7f37", "#9a6700", "#0969da"]],
];

function fromList(dark: boolean, c: string[]): Palette {
  const [bg, fg, muted, border, accent, red, green, yellow, info] = c.map((x) => hex(x)!) as [Rgb, Rgb, Rgb, Rgb, Rgb, Rgb, Rgb, Rgb, Rgb];
  return { dark, bg, fg, muted, border, accent, red, green, yellow, info };
}

/** All built-in themes, families next to each other. */
export const BUILTIN: Theme[] = PALETTES.map(([id, label, dark, c]) => derive(id, label, fromList(dark, c)));

/** Id of the theme used when nothing else is set (same default as the other apps). */
export const DEFAULT_ID = "catppuccin-mocha";

// ---- match-omarchy ----

/** Id of the theme that follows Omarchy. */
export const OMARCHY_ID = "match-omarchy";

/** Omarchy "current" dirs, newest layout first. */
function omarchyCurrentDirs(): string[] {
  const home = process.env.HOME || homedir();
  return [join(home, ".local/state/omarchy/current"), join(home, ".config/omarchy/current")];
}

/** The active Omarchy theme dir, if Omarchy is installed. */
export function omarchyThemeDir(): string | undefined {
  return omarchyCurrentDirs().map((c) => join(c, "theme")).find((d) => existsSync(d) && statSync(d).isDirectory());
}

/** Existing paths a watcher should watch to notice an Omarchy theme switch. */
export function omarchyWatchPaths(): string[] {
  return omarchyCurrentDirs().flatMap((c) => [join(c, "theme"), join(c, "theme.name"), c]).filter((p) => existsSync(p));
}

/** Flat `[section] key = "value"` TOML reader — all Omarchy color files need. */
function readToml(path: string): Map<string, Map<string, string>> | undefined {
  let src: string;
  try { src = readFileSync(path, "utf8"); } catch { return undefined; }
  const out = new Map<string, Map<string, string>>([["", new Map()]]);
  let section = out.get("")!;
  for (const raw of src.split("\n")) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    const sec = /^\[([^\]]+)\]$/.exec(line);
    if (sec) { section = new Map(); out.set(sec[1]!.trim(), section); continue; }
    const kv = /^([A-Za-z0-9_.-]+)\s*=\s*["']([^"']*)["']/.exec(line);
    if (kv) section.set(kv[1]!, kv[2]!);
  }
  return out;
}

function fromColors(t: Map<string, string>): Palette | undefined {
  const c = (k: string) => (t.get(k) ? hex(t.get(k)!) : undefined);
  const bg = c("background"), fg = c("foreground");
  if (!bg || !fg) return undefined;
  const get = (keys: string[], fallback: Rgb) => keys.map(c).find(Boolean) ?? fallback;
  const mode = t.get("mode");
  return {
    dark: mode === "light" ? false : mode === "dark" ? true : luminance(bg) < luminance(fg),
    bg, fg,
    muted: get(["muted", "bright_black", "dark_foreground"], mix(bg, fg, 0.5)),
    border: get(["selection", "lighter_background"], mix(bg, fg, 0.25)),
    accent: get(["accent", "blue"], fg),
    red: get(["red", "bright_red"], fg),
    green: get(["green", "bright_green"], fg),
    yellow: get(["yellow", "bright_yellow"], fg),
    info: get(["blue", "bright_blue"], fg),
  };
}

function fromAlacritty(t: Map<string, Map<string, string>>): Palette | undefined {
  const pick = (sec: string, k: string) => { const v = t.get(sec)?.get(k); return v ? hex(v) : undefined; };
  const bg = pick("colors.primary", "background"), fg = pick("colors.primary", "foreground");
  if (!bg || !fg) return undefined;
  const hue = (k: string) => pick("colors.normal", k) ?? pick("colors.bright", k) ?? fg;
  return {
    dark: luminance(bg) < luminance(fg),
    bg, fg,
    muted: pick("colors.bright", "black") ?? mix(bg, fg, 0.5),
    border: pick("colors.selection", "background") ?? mix(bg, fg, 0.25),
    accent: hue("blue"),
    red: hue("red"), green: hue("green"), yellow: hue("yellow"), info: hue("blue"),
  };
}

/** `retro-stripes` → `Retro Stripes`, from `<dir>/../theme.name` or the dir name. */
function omarchyThemeName(dir: string): string {
  let raw = "";
  try { raw = readFileSync(join(dirname(dir), "theme.name"), "utf8").trim(); } catch { /* fall back to dir name */ }
  if (!raw) { try { raw = basename(realpathSync(dir)); } catch { raw = basename(dir); } }
  return raw.split(/[-_ ]/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** The `match-omarchy` theme built from an Omarchy theme dir. */
export function loadOmarchyTheme(dir: string): Theme | undefined {
  const colors = readToml(join(dir, "colors.toml"));
  const alacritty = colors ? undefined : readToml(join(dir, "alacritty.toml"));
  const p = (colors && fromColors(colors.get("")!)) ?? (alacritty && fromAlacritty(alacritty));
  return p ? derive(OMARCHY_ID, `Match Omarchy (${omarchyThemeName(dir)})`, p) : undefined;
}

/** The `match-omarchy` theme for the active Omarchy theme, if Omarchy is installed. */
export function omarchyTheme(): Theme | undefined {
  const dir = omarchyThemeDir();
  return dir ? loadOmarchyTheme(dir) : undefined;
}

/** Every theme the picker offers: match-omarchy first (when Omarchy is installed), then
 *  the built-ins. */
export function allThemes(): Theme[] {
  const o = omarchyTheme();
  return o ? [o, ...BUILTIN] : BUILTIN;
}

/** A theme by id; unknown ids (and match-omarchy without Omarchy) fall back to the default. */
export function resolveTheme(id?: ThemeId | null): Theme {
  if (id === OMARCHY_ID) { const o = omarchyTheme(); if (o) return o; }
  return BUILTIN.find((t) => t.id === id) ?? BUILTIN.find((t) => t.id === DEFAULT_ID)!;
}

/** Every color pair the UI draws, as [pair, ratio, required]. */
export function contrastReport(t: Theme): [string, number, number][] {
  const pairs: [string, string, string, number][] = [
    ["text/bg", t.text, t.bg, TEXT],
    ["muted/bg", t.textMuted, t.bg, TEXT],
    ["accent/bg", t.accent, t.bg, TEXT],
    ["onAccent/accent", t.onAccent, t.accent, TEXT],
    ["text/titleBar", t.text, t.titleBar, TEXT],
    ["muted/titleBar", t.textMuted, t.titleBar, TEXT],
    ["selectionFg/selection", t.selectionFg, t.selection, TEXT],
    ["muted/selection", t.textMuted, t.selection, TEXT],
    ["accent/selection", t.accent, t.selection, TEXT],
    ["marker/selection", t.marker, t.selection, UI],
    ["border/bg", t.border, t.bg, UI],
    ["text/statusBar", t.text, t.statusBar, TEXT],
    ["muted/statusBar", t.textMuted, t.statusBar, TEXT],
    ["text/dialogBg", t.text, t.dialogBg, TEXT],
    ["muted/dialogBg", t.textMuted, t.dialogBg, TEXT],
    ["accent/dialogBg", t.accent, t.dialogBg, TEXT],
    ["marker/dialogBg", t.marker, t.dialogBg, UI],
    ["warn/dialogBg", t.warn, t.dialogBg, TEXT],
    ["bad/dialogBg", t.bad, t.dialogBg, TEXT],
    ["good/bg", t.good, t.bg, TEXT],
    ["warn/bg", t.warn, t.bg, TEXT],
    ["bad/bg", t.bad, t.bg, TEXT],
    ["info/bg", t.info, t.bg, TEXT],
  ];
  return pairs.map(([n, a, b, min]) => [n, contrast(a, b), min]);
}

// ---- live store: the active theme + a Proxy so `C.x` reads it on every access ----

let current: Theme = resolveTheme(DEFAULT_ID); // primed to the persisted theme at startup (theme-context.tsx)

export function setActiveTheme(t: Theme): void {
  current = t;
}
export function activeTheme(): Theme {
  return current;
}

export const C = new Proxy({} as Theme, {
  get(_target, key: string | symbol) {
    return (current as unknown as Record<string | symbol, unknown>)[key];
  },
});

// ---- @inkjs/ui component theme, resolved from the active theme ----

export function buildUiTheme(theme: Theme) {
  const accent = theme.accent;
  return extendTheme(defaultTheme, {
    components: {
      MultiSelect: {
        styles: {
          focusIndicator: () => ({ color: theme.marker }),
          selectedIndicator: () => ({ color: accent }),
          label: ({ isFocused, isSelected }: { isFocused: boolean; isSelected: boolean }) => ({
            color: isFocused || isSelected ? accent : theme.text,
            bold: isFocused,
          }),
          highlightedText: () => ({ color: accent, bold: true }),
        },
      },
      Spinner: { styles: { frame: () => ({ color: accent }) } },
      ProgressBar: { styles: { completed: () => ({ color: accent }), remaining: () => ({ color: theme.border }) } },
    },
  });
}
