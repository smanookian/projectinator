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

/** Slim top bar (OpenCode-style header): brand ▌ + project · phase on the left,
 *  a faint tagline on the right, with a subtle rule underneath. Full width. */
export function TopBar({
  projectName,
  phase,
}: {
  projectName?: string;
  phase?: string;
}): React.ReactElement {
  const cols = useTermCols();
  const label = phase ? PHASE_LABEL[phase] ?? phase : undefined;
  return (
    <Box
      width={cols}
      borderStyle="single"
      borderColor={C.borderSubtle}
      borderBottom
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
      justifyContent="space-between"
    >
      <Box>
        <Text color={C.accent} bold>▌ PROJECTINATOR</Text>
        {projectName ? <Text color={C.textMuted}>{`   ${truncate(projectName, Math.max(12, Math.floor(cols * 0.4)))}`}</Text> : null}
        {label ? <Text color={C.textSubtle}>{`   ·  ${label}`}</Text> : null}
      </Box>
      <Box><Text color={C.textSubtle}>your AI build team</Text></Box>
    </Box>
  );
}

/** Bottom status bar: a global shortcut hint on the left, session cost + budget
 *  cap on the right, with a subtle rule on top. Full width. */
export function StatusBar(): React.ReactElement {
  const cols = useTermCols();
  const spent = sessionCost();
  const cap = getPrefs().budgetCapUSD;
  const overHalf = spent >= cap / 2;
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
        <Text color={C.textSubtle}>q</Text>
        <Text color={C.textSubtle}> quit</Text>
      </Box>
      <Box>
        <Text color={C.textSubtle}>session </Text>
        <Text color={overHalf ? C.warn : C.accent} bold>{`$${spent.toFixed(2)}`}</Text>
        <Text color={C.textSubtle}>{`  ·  cap $${cap}`}</Text>
      </Box>
    </Box>
  );
}

/** Wraps every screen in the persistent frame: slim top bar, the screen content
 *  (padded, growing to fill the viewport), and the status bar pinned at the
 *  bottom edge. Replaces the old per-screen boxed Header. */
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
      <TopBar projectName={projectName} phase={phase} />
      <Box flexGrow={1} flexDirection="column" paddingX={1} paddingTop={1}>{children}</Box>
      <StatusBar />
    </Box>
  );
}
