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

// Contextual keys, in ONE place, so every screen shows its shortcuts the same way instead
// of some screens carrying an in-panel legend and others nothing at all. Screens with a big
// screen-specific key set (the board editors) keep their own legend as well.
const NAV = "↑↓ pick · Enter confirm · Esc back";
const TYPING = "Enter confirm · Esc back";
const PAGER = "↑↓ / PgUp PgDn scroll · Esc back";

const PHASE_HINTS: Record<string, string> = {
  setup: NAV, home: NAV, projects: NAV, projectActions: NAV, settings: NAV,
  templates: NAV, myTemplates: NAV, tplActions: NAV, importTemplate: TYPING,
  exportMenu: NAV, deployMenu: NAV, filterEpic: NAV, confirmDelete: NAV, publish: NAV,
  planMode: NAV, approveEpics: NAV, plan: NAV, kanban: NAV, stack: NAV, bakeoff: NAV,
  retro: NAV, history: NAV, transcripts: NAV, done: NAV, error: NAV, preview: NAV,
  burndown: "←/→ sprint · Esc back",
  idea: TYPING, change: TYPING, rename: TYPING, addAsset: TYPING, setCap: TYPING,
  importProject: TYPING, saveTemplate: TYPING, intake: TYPING,
  transcript: `${PAGER} · ←/→ next run · 1-9 open a screenshot`,
  diff: PAGER,
  board: "↑↓ pick · Enter build · Esc back · legend below",
  editBoard: "↑↓ pick · Enter save · Esc back · legend below",
  building: "p pause · a add a task · r remove · x stop",
};

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
  diff: "Diff",
  transcripts: "Transcripts",
  transcript: "Transcript",
  importProject: "Import folder",
  publish: "Publish",
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

/** Bottom status bar: the current screen's keys on the left, session cost + budget cap on
 *  the right, with a subtle rule on top. Full width. */
export function StatusBar({ phase }: { phase?: string }): React.ReactElement {
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
      <Box flexShrink={1}>
        <Text color={C.textSubtle} wrap="truncate-end">
          {`${phase && PHASE_HINTS[phase] ? `${PHASE_HINTS[phase]} · ` : ""}q quit`}
        </Text>
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
    // Fixed height + overflow hidden so overly-tall content clips at the bottom
    // instead of pushing the frame past the viewport (which would scroll the top
    // bar off and unpin the status bar).
    <Box flexDirection="column" height={rows} overflow="hidden" backgroundColor={C.bg}>
      <TopBar projectName={projectName} phase={phase} />
      <Box flexGrow={1} flexDirection="column" paddingX={1} paddingTop={1} overflow="hidden">
        <Box flexDirection="column" flexShrink={0}>{children}</Box>
      </Box>
      <StatusBar phase={phase} />
    </Box>
  );
}
