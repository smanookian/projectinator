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
        // Unselected items are explicitly white (not `undefined`, which renders
        // as the terminal's default fg and reads gray) so Select rows match the
        // custom GroupedMenu's white unselected rows.
        label: ({ isFocused, isSelected }: { isFocused: boolean; isSelected: boolean }) => ({
          color: isFocused || isSelected ? AMBER : "white",
        }),
        highlightedText: () => ({ color: AMBER, bold: true }),
      },
    },
    MultiSelect: {
      styles: {
        focusIndicator: () => ({ color: AMBER }),
        selectedIndicator: () => ({ color: AMBER }),
        label: ({ isFocused, isSelected }: { isFocused: boolean; isSelected: boolean }) => ({
          color: isFocused || isSelected ? AMBER : "white",
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
