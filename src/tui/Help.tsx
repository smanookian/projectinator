// The `?` dialog: every key, grouped — like Musinator's help. One list, so the keys the app
// answers and the keys it documents can't drift apart without this file changing too.

import React from "react";
import { Box, Text } from "ink";
import { C, Panel } from "./components.js";
import { BOARD_KEYS } from "./EditBoard.js";
import { PLAN_KEYS } from "./PlanBoard.js";

export const KEY_GROUPS: { title: string; keys: { keys: string; label: string }[] }[] = [
  { title: "Everywhere", keys: [
    { keys: "?", label: "this help" },
    { keys: "tab", label: "sidebar ⇄ page" },
    { keys: "Esc / Backspace", label: "back / close" },
    { keys: "q", label: "quit (asks first)" },
  ] },
  { title: "Go to (from any page)", keys: [
    { keys: "N", label: "new build" },
    { keys: "/", label: "find a project" },
    { keys: "P", label: "all projects" },
    { keys: "H", label: "home" },
    { keys: "t", label: "themes" },
    { keys: "S", label: "settings" },
    { keys: "M", label: "newer models for your team" },
    { keys: "U", label: "update Projectinator" },
  ] },
  { title: "Lists and menus", keys: [
    { keys: "↑↓ / j k", label: "move" },
    { keys: "g G / Home End", label: "first / last" },
    { keys: "PgUp PgDn", label: "page" },
    { keys: "Enter", label: "open" },
  ] },
  { title: "Board", keys: [...BOARD_KEYS, { keys: "b", label: "build the backlog (project board)" }] },
  { title: "Plan board (before a build)", keys: PLAN_KEYS },
  { title: "While building", keys: [
    { keys: "←→ ↑↓ / h l j k", label: "pick a card (details below the board)" },
    { keys: "p", label: "pause / resume" },
    { keys: "a", label: "add work (the PM plans it)" },
    { keys: "r", label: "remove a task that hasn't started" },
    { keys: "x", label: "stop after the running tasks" },
  ] },
  { title: "Transcripts and diffs", keys: [
    { keys: "↑↓ / j k", label: "scroll" },
    { keys: "PgUp PgDn ^u ^d", label: "page" },
    { keys: "←→", label: "previous / next run" },
    { keys: "1-9", label: "open a screenshot" },
  ] },
];

export function Help(): React.ReactElement {
  // Two columns of groups, split where the rows (heading + keys + gap) are closest to even.
  const rows = KEY_GROUPS.map((g) => g.keys.length + 2);
  const total = rows.reduce((a, b) => a + b, 0);
  let half = 0;
  for (let acc = 0; half < KEY_GROUPS.length && acc + rows[half]! / 2 < total / 2; half++) acc += rows[half]!;
  const column = (groups: typeof KEY_GROUPS) => (
    <Box flexDirection="column" flexBasis="50%" flexGrow={1}>
      {groups.map((g) => (
        <Box key={g.title} flexDirection="column" marginBottom={1}>
          <Text bold color={C.text}>{`▾ ${g.title}`}</Text>
          {g.keys.map((k) => (
            <Box key={k.keys}>
              <Box width={20} flexShrink={0} paddingLeft={2}><Text color={C.accent}>{k.keys}</Text></Box>
              <Text color={C.textMuted} wrap="truncate-end">{k.label}</Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
  return (
    <Panel title="Keys">
      <Box columnGap={2}>
        {column(KEY_GROUPS.slice(0, half))}
        {column(KEY_GROUPS.slice(half))}
      </Box>
      <Text color={C.textMuted}>Esc or ? closes this.</Text>
    </Panel>
  );
}
