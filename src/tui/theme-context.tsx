// Theme context + the root wrapper that makes theme switching live. `ThemedApp` owns the
// active ThemeId (persisted in config), re-renders the tree on change, keeps the live store
// (`setActiveTheme`) in sync so `C` reads the right palette, and re-provisions the @inkjs/ui
// component theme so Select/Spinner/ProgressBar accents follow too.

import React, { createContext, useContext, useEffect, useState } from "react";
import { ThemeProvider as UIThemeProvider } from "@inkjs/ui";
import { resolveTheme, setActiveTheme, buildUiTheme, type Theme, type ThemeId } from "./theme.js";
import { getTheme, setTheme } from "./config.js";

export interface ThemeApi {
  id: ThemeId;
  theme: Theme;
  set: (t: ThemeId) => void;
}

// Default (no provider) is dark with a no-op setter — tests that mount <App/> directly
// still render, they just can't switch theme.
export const ThemeCtx = createContext<ThemeApi>({
  id: "dark",
  theme: resolveTheme("dark"),
  set: () => {},
});

export function useThemeCtx(): ThemeApi {
  return useContext(ThemeCtx);
}

// Prime the live store to the persisted theme before the first paint, so a saved light
// theme never flashes dark. Idempotent and cheap (one config read).
setActiveTheme(resolveTheme(getTheme()));

export function ThemedApp({ children }: { children: React.ReactNode }): React.ReactElement {
  const [id, setId] = useState<ThemeId>(() => getTheme());
  const theme = resolveTheme(id);
  useEffect(() => {
    setActiveTheme(theme);
  }, [theme]);
  const api: ThemeApi = { id, theme, set: (t) => { setTheme(t); setId(t); } };
  return (
    <UIThemeProvider theme={buildUiTheme(theme.accent)}>
      <ThemeCtx.Provider value={api}>{children}</ThemeCtx.Provider>
    </UIThemeProvider>
  );
}