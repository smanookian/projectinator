// The left navigation pane, same shape as Musinator's Library pane and Todonator's views pane:
// app pages, then your projects (with spend), then the open project's pages, then the team.
// `tab` moves focus here from the main area (App.tsx owns that); ↑↓ move, Enter opens.

import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { C, ROLE_META } from "./components.js";
import { effectiveRoster, modelLabel } from "./engine.js";

export interface NavItem {
  label: string;
  value: string;
  /** Right-aligned muted text (a project's spend). */
  right?: string;
  /** The page on screen now — drawn in the accent, like Musinator's playing row. */
  current?: boolean;
}

export interface NavGroup {
  /** Empty = no `▾` heading. */
  title: string;
  items: NavItem[];
}

/** Total width of the pane, border included. */
export const SIDEBAR_WIDTH = 32;

export function Sidebar({
  groups,
  focused,
  onSelect,
  upgradable = [],
}: {
  groups: NavGroup[];
  focused: boolean;
  onSelect: (value: string) => void;
  /** Models on the team with a newer version out — marked `↑` (M opens the switch). */
  upgradable?: string[];
}): React.ReactElement {
  const flat = groups.flatMap((g) => g.items);
  const currentIx = Math.max(0, flat.findIndex((i) => i.current));
  const [cursor, setCursor] = useState(currentIx);
  // Focus lands on the page you are on, so Enter right after Tab is a no-op, not a jump.
  useEffect(() => {
    if (focused) setCursor(currentIx);
  }, [focused]);
  const cur = Math.min(cursor, Math.max(0, flat.length - 1));

  useInput((input, key) => {
    if (key.upArrow || input === "k") setCursor((c) => Math.max(0, c - 1));
    else if (key.downArrow || input === "j") setCursor((c) => Math.min(flat.length - 1, c + 1));
    else if (input === "g" || key.home) setCursor(0);
    else if (input === "G" || key.end) setCursor(flat.length - 1);
    else if (key.return) { const it = flat[cur]; if (it) onSelect(it.value); }
  }, { isActive: focused });

  const curValue = flat[cur]?.value;
  return (
    <Box flexDirection="column" width={SIDEBAR_WIDTH} flexShrink={0} borderStyle="round" borderColor={focused ? C.borderActive : C.border} overflow="hidden">
      <Box backgroundColor={focused ? C.accent : C.titleBar} paddingX={1} justifyContent="space-between">
        <Text bold color={focused ? C.onAccent : C.text}>Projectinator</Text>
        <Text color={focused ? C.onAccent : C.textMuted}>{focused ? "↑↓ · enter" : "tab"}</Text>
      </Box>
      {groups.map((g, gi) => (
        <Box key={`${g.title}-${gi}`} flexDirection="column" marginTop={gi ? 1 : 0} flexShrink={0}>
          {g.title ? <Text bold color={C.text} wrap="truncate-end">{`▾ ${g.title}`}</Text> : null}
          {g.items.map((it) => {
            const sel = focused && it.value === curValue;
            return (
              <Box key={it.value} backgroundColor={sel ? C.selection : undefined} flexShrink={0}>
                <Text color={C.marker}>{sel ? "→ " : "  "}</Text>
                <Box flexGrow={1} flexShrink={1}>
                  <Text color={it.current ? C.accent : sel ? C.selectionFg : C.text} bold={sel || it.current} wrap="truncate-end">
                    {it.label}
                  </Text>
                </Box>
                {it.right ? <Box flexShrink={0} marginLeft={1} marginRight={1}><Text color={C.textMuted}>{it.right}</Text></Box> : null}
              </Box>
            );
          })}
        </Box>
      ))}
      <Box flexDirection="column" marginTop={1} flexShrink={0}>
        <Text bold color={C.text}>▾ Your team</Text>
        {effectiveRoster().map((r) => (
          <Box key={r.capability} paddingLeft={2}>
            <Box width={10} flexShrink={0}><Text color={C.textMuted} wrap="truncate-end">{r.capability === "plan" ? "PM" : ROLE_META[r.capability].label}</Text></Box>
            <Box flexGrow={1} flexShrink={1}><Text color={C.textMuted} wrap="truncate-end">{modelLabel(r.model ?? "—")}</Text></Box>
            {r.model && upgradable.includes(r.model) ? <Box flexShrink={0} marginLeft={1}><Text color={C.accent} bold>↑</Text></Box> : null}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
