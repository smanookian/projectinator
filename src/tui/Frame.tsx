// The persistent app frame: content on top, a status bar pinned to the bottom
// of the viewport on every screen — so the chrome stops jumping between phases.
// (Phase 1 of the TUI redesign; header still lives inside each screen.)

import React from "react";
import { Box, Text } from "ink";
import { C, useTermRows, useTermCols } from "./components.js";
import { sessionCost } from "../session-cost.js";
import { getPrefs } from "./config.js";

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** A short, human label for the current phase — shown faintly in the status bar. */
const PHASE_LABEL: Record<string, string> = {
  setup: "Setup",
  home: "Home",
  assessing: "Reading your idea",
  setCap: "Budget cap",
  exportMenu: "Export",
  filterEpic: "Filter",
  rename: "Rename",
  confirmDelete: "Delete",
  saveTemplate: "Save template",
  addAsset: "Add asset",
  error: "Error",
  projects: "Projects",
  projectActions: "Project",
  settings: "Settings",
  bakeoff: "Bake-off",
  idea: "New build",
  change: "Change",
  stack: "Stack",
  intake: "Intake",
  planMode: "Plan",
  council: "Council",
  approveEpics: "Epics",
  planning: "Planning",
  plan: "Plan",
  board: "Plan board",
  editBoard: "Edit board",
  kanban: "Board",
  building: "Building",
  done: "Done",
  preview: "Preview",
  deployMenu: "Deploy",
  deploying: "Deploying",
  retro: "Retro",
  burndown: "Burndown",
  history: "History",
};

/** Bottom status bar: brand · project · phase  —  session cost · budget cap. */
export function StatusBar({
  projectName,
  phase,
}: {
  projectName?: string;
  phase?: string;
}): React.ReactElement {
  const cols = useTermCols();
  const spent = sessionCost();
  const cap = getPrefs().budgetCapUSD;
  const overHalf = spent >= cap / 2;
  const label = phase ? PHASE_LABEL[phase] ?? phase : undefined;

  return (
    <Box
      width={cols}
      borderStyle="single"
      borderColor={C.borderSubtle}
      borderTop
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
      justifyContent="space-between"
    >
      <Box>
        <Text color={C.accent} bold>PROJECTINATOR</Text>
        {projectName ? <Text color={C.textMuted}>{`  ·  ${truncate(projectName, Math.max(12, Math.floor(cols * 0.4)))}`}</Text> : null}
        {label ? <Text color={C.textSubtle}>{`  ·  ${label}`}</Text> : null}
      </Box>
      <Box>
        <Text color={C.textSubtle}>session </Text>
        <Text color={overHalf ? C.warn : C.accent} bold>{`$${spent.toFixed(2)}`}</Text>
        <Text color={C.textSubtle}>{`  ·  cap $${cap}`}</Text>
      </Box>
    </Box>
  );
}

/** Wraps a screen: its content grows to fill the viewport, the status bar sits
 *  pinned at the bottom edge. Header still renders at the top of each screen. */
export function AppFrame({
  children,
  projectName,
  phase,
}: {
  children: React.ReactNode;
  projectName?: string;
  phase?: string;
}): React.ReactElement {
  const rows = useTermRows();
  return (
    <Box flexDirection="column" minHeight={rows}>
      <Box flexGrow={1} flexDirection="column">{children}</Box>
      <StatusBar projectName={projectName} phase={phase} />
    </Box>
  );
}
