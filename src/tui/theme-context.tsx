// Theme + icon context and the root wrapper that makes appearance switching live. `ThemedApp`
// owns the active ThemeId and IconMode (both persisted in config), re-renders the tree on
// change, keeps the live stores in sync (so `C` and `roleGlyph` read the right values), and
// re-provisions the @inkjs/ui component theme so MultiSelect/Spinner/ProgressBar follow too.
// With `match-omarchy` active it watches the Omarchy theme files and repaints on a switch.

import React, { createContext, useContext, useEffect, useState } from "react";
import { watch, type FSWatcher } from "node:fs";
import { ThemeProvider as UIThemeProvider } from "@inkjs/ui";
import { resolveTheme, setActiveTheme, buildUiTheme, omarchyWatchPaths, OMARCHY_ID, DEFAULT_ID, type Theme, type ThemeId } from "./theme.js";
import { getTheme, setTheme, getIconMode, setIconMode as persistIconMode } from "./config.js";
import { setIconMode as syncIconMode, type IconMode } from "./icons.js";

export interface ThemeApi {
  id: ThemeId;
  theme: Theme;
  /** Switch and persist. */
  setTheme: (t: ThemeId) => void;
  /** Paint a theme without persisting it (live preview in the picker); `null` ends it. */
  previewTheme: (t: ThemeId | null) => void;
  iconMode: IconMode;
  setIconMode: (m: IconMode) => void;
}

// Default (no provider) is the default theme + nerd with no-op setters — tests that mount
// <App/> directly still render, they just can't switch appearance.
export const ThemeCtx = createContext<ThemeApi>({
  id: DEFAULT_ID,
  theme: resolveTheme(DEFAULT_ID),
  setTheme: () => {},
  previewTheme: () => {},
  iconMode: "nerd",
  setIconMode: () => {},
});

export function useThemeCtx(): ThemeApi {
  return useContext(ThemeCtx);
}

// Prime both live stores to persisted config before the first paint, so a saved theme or
// ASCII icon mode never flashes its default.
setActiveTheme(resolveTheme(getTheme()));
syncIconMode(getIconMode());

export function ThemedApp({ children }: { children: React.ReactNode }): React.ReactElement {
  const [id, setId] = useState<ThemeId>(() => getTheme());
  const [preview, setPreview] = useState<ThemeId | null>(null);
  // Bumped when the Omarchy theme files change, so match-omarchy re-reads them.
  const [omarchyRev, setOmarchyRev] = useState(0);
  const [iconMode, setIconModeState] = useState<IconMode>(() => getIconMode());
  const shown = preview ?? id;
  const [theme, setThemeState] = useState<Theme>(() => resolveTheme(shown));

  useEffect(() => {
    const t = resolveTheme(shown);
    setActiveTheme(t);
    setThemeState(t);
  }, [shown, omarchyRev]);

  useEffect(() => {
    if (shown !== OMARCHY_ID) return;
    // Omarchy swaps a symlink and rewrites files; coalesce the burst into one repaint.
    let timer: NodeJS.Timeout | undefined;
    const bump = () => { clearTimeout(timer); timer = setTimeout(() => setOmarchyRev((n) => n + 1), 150); };
    const watchers: FSWatcher[] = [];
    for (const p of omarchyWatchPaths()) {
      try { watchers.push(watch(p, bump)); } catch { /* path vanished mid-switch; the others still fire */ }
    }
    return () => { clearTimeout(timer); for (const w of watchers) w.close(); };
  }, [shown]);

  useEffect(() => {
    syncIconMode(iconMode);
  }, [iconMode]);

  const api: ThemeApi = {
    id,
    theme,
    setTheme: (t) => { setTheme(t); setId(t); setPreview(null); },
    previewTheme: setPreview,
    iconMode,
    setIconMode: (m) => { persistIconMode(m); setIconModeState(m); },
  };
  return (
    <UIThemeProvider theme={buildUiTheme(theme)}>
      <ThemeCtx.Provider value={api}>{children}</ThemeCtx.Provider>
    </UIThemeProvider>
  );
}
