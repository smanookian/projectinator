// Themes — the color system every component reads through `C`. One primary accent
// (amber), and everything else supports it: text, muted metadata, surfaces, borders,
// and the four status colors. Two built-ins (dark = today's exact palette, light = a
// resolve against a light terminal), plus a live store so `C` follows the active theme.
// Design: docs/DESIGN.md ("A1 warm amber cockpit").
//
// `C` is a Proxy over the live theme, so the hundreds of existing `C.accent` / `C.dim`
// call sites keep working verbatim and re-read the current palette on re-render. It is
// deliberately NOT a React hook: module-level constants (e.g. color tables) and non-React
// code also read `C`. Components that must react to a switch re-render via ThemeCtx.

import { defaultTheme, extendTheme } from "@inkjs/ui";

export type ThemeId = "dark" | "light";

export interface Theme {
  id: ThemeId;
  label: string;
  /** One primary accent — interactive / in-focus elements only. */
  accent: string;
  /** Dimmed accent (secondary emphasis). */
  accentMuted: string;
  // text
  text: string;
  textMuted: string;
  textSubtle: string;
  dim: string; // legacy alias — same as textMuted
  // surfaces (panels / cards)
  bgPanel: string;
  bgElement: string;
  // borders
  border: string;
  borderSubtle: string;
  borderActive: string;
  // status
  good: string;
  warn: string;
  bad: string;
  info: string;
}

/** Today's exact palette — dark is unchanged, so this is a no-op until light ships in P2. */
export const DARK: Theme = {
  id: "dark", label: "Amber (dark)",
  accent: "#e0a72d", accentMuted: "#a67c1f",
  text: "white", textMuted: "#9aa0a6", textSubtle: "#6b7178", dim: "#9aa0a6",
  bgPanel: "#1b1b1b", bgElement: "#242424",
  border: "#3a3a3a", borderSubtle: "#2a2a2a", borderActive: "#e0a72d",
  good: "green", warn: "yellow", bad: "red", info: "cyan",
};

/** Amber on a light terminal: darker text, darker accent + status colors for contrast. */
export const LIGHT: Theme = {
  id: "light", label: "Amber (light)",
  accent: "#b8860b", accentMuted: "#8a6508",
  text: "#1f2328", textMuted: "#57606a", textSubtle: "#8b949e", dim: "#57606a",
  bgPanel: "#f0f1f2", bgElement: "#e8eaec",
  border: "#d0d3d6", borderSubtle: "#e3e5e8", borderActive: "#b8860b",
  good: "#1a7f37", warn: "#9a6700", bad: "#cf222e", info: "#0969da",
};

export const THEMES: Record<ThemeId, Theme> = { dark: DARK, light: LIGHT };

export function resolveTheme(id?: ThemeId | null): Theme {
  return THEMES[id ?? "dark"] ?? DARK;
}

// ---- live store: the active theme + a Proxy so `C.x` reads it on every access ----

let current: Theme = DARK; // primed to the persisted theme at startup (theme-context.tsx)

export function setActiveTheme(t: Theme): void {
  current = t;
}
export function activeTheme(): Theme {
  return current;
}

export const C = new Proxy({} as Theme, {
  get(_target, key: string | symbol) {
    return (current as unknown as Record<string | symbol, string>)[key];
  },
});

// ---- @inkjs/ui component theme, resolved by accent (Select/Spinner/ProgressBar focus) ----

export function buildUiTheme(accent: string) {
  return extendTheme(defaultTheme, {
    components: {
      Select: {
        styles: {
          focusIndicator: () => ({ color: accent }),
          selectedIndicator: () => ({ color: accent }),
          label: ({ isFocused, isSelected }: { isFocused: boolean; isSelected: boolean }) => ({
            color: isFocused || isSelected ? accent : "white",
          }),
          highlightedText: () => ({ color: accent, bold: true }),
        },
      },
      MultiSelect: {
        styles: {
          focusIndicator: () => ({ color: accent }),
          selectedIndicator: () => ({ color: accent }),
          label: ({ isFocused, isSelected }: { isFocused: boolean; isSelected: boolean }) => ({
            color: isFocused || isSelected ? accent : "white",
          }),
          highlightedText: () => ({ color: accent, bold: true }),
        },
      },
      Spinner: { styles: { frame: () => ({ color: accent }) } },
      ProgressBar: { styles: { completed: () => ({ color: accent }) } },
    },
  });
}