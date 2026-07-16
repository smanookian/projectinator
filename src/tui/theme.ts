// Custom @inkjs/ui theme — recolors the library's components (blue/green by default)
// to our amber accent so the whole app reads as one system.

import { defaultTheme, extendTheme } from "@inkjs/ui";

const AMBER = "#e0a72d";

export const uiTheme = extendTheme(defaultTheme, {
  components: {
    Select: {
      styles: {
        focusIndicator: () => ({ color: AMBER }),
        selectedIndicator: () => ({ color: AMBER }),
        label: ({ isFocused, isSelected }: { isFocused: boolean; isSelected: boolean }) => ({
          color: isFocused || isSelected ? AMBER : undefined,
        }),
        highlightedText: () => ({ color: AMBER, bold: true }),
      },
    },
    Spinner: {
      styles: {
        frame: () => ({ color: AMBER }),
      },
    },
    ProgressBar: {
      styles: {
        completed: () => ({ color: AMBER }),
      },
    },
  },
});
