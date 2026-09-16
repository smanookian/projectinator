// Theme + icon context and the root wrapper that makes appearance switching live. `ThemedApp`
// owns the active ThemeId and IconMode (both persisted in config), re-renders the tree on
// change, keeps the live stores in sync (so `C` and `roleGlyph` read the right values), and
// re-provisions the @inkjs/ui component theme so Select/Spinner/ProgressBar follow too.

import React, { createContext, useContext, useEffect, useState } from "react";
import { ThemeProvider as UIThemeProvider } from "@inkjs/ui";
import { resolveTheme, setActiveTheme, buildUiTheme, type Theme, type ThemeId } from "./theme.js";
import { getTheme, setTheme, getIconMode, setIconMode as persistIconMode } from "./config.js";
import { setIconMode as syncIconMode, type IconMode } from "./icons.js";

export interface ThemeApi {
  id: ThemeId;
  theme: Theme;
  setTheme: (t: ThemeId) => void;
  iconMode: IconMode;
  setIconMode: (m: IconMode) => void;
}

// Default (no provider) is dark + nerd with no-op setters — tests that mount <App/> directly
// still render, they just can't switch appearance.
export const ThemeCtx = createContext<ThemeApi>({
  id: "dark",
  theme: resolveTheme("dark"),
  setTheme: () => {},
  iconMode: "nerd",
  setIconMode: () => {},
});

export function useThemeCtx(): ThemeApi {
  return useContext(ThemeCtx);
}

// Prime both live stores to persisted config before the first paint, so a saved light theme
// or ASCII icon mode never flashes its default.
setActiveTheme(resolveTheme(getTheme()));
syncIconMode(getIconMode());

export function ThemedApp({ children }: { children: React.ReactNode }): React.ReactElement {
  const [id, setId] = useState<ThemeId>(() => getTheme());
  const [iconMode, setIconModeState] = useState<IconMode>(() => getIconMode());
  const theme = resolveTheme(id);
  useEffect(() => {
    setActiveTheme(theme);
  }, [theme]);
  useEffect(() => {
    syncIconMode(iconMode);
  }, [iconMode]);
  const api: ThemeApi = {
    id,
    theme,
    setTheme: (t) => { setTheme(t); setId(t); },
    iconMode,
    setIconMode: (m) => { persistIconMode(m); setIconModeState(m); },
  };
  return (
    <UIThemeProvider theme={buildUiTheme(theme)}>
      <ThemeCtx.Provider value={api}>{children}</ThemeCtx.Provider>
    </UIThemeProvider>
  );
}