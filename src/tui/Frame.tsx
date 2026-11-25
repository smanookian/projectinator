// The persistent app frame, in the same look family as Musinator / Todonator / Calinator:
// screen content on top, one filled status bar pinned to the bottom of the viewport on every
// screen — app state on the left, the current screen's keys on the right.

import React from "react";
import { Box, Text } from "ink";
import { C, useTermRows, useTermCols, InputActive, Framed } from "./components.js";
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
const PAGER = "↑↓ j k / PgUp PgDn scroll · Esc back";

const PHASE_HINTS: Record<string, string> = {
  setup: NAV, home: NAV, projects: NAV, projectActions: NAV, settings: NAV,
  templates: NAV, myTemplates: NAV, tplActions: NAV, importTemplate: TYPING,
  exportMenu: NAV, deployMenu: NAV, filterEpic: NAV, confirmDelete: NAV, publish: NAV,
  planMode: NAV, approveEpics: NAV, plan: NAV, stack: NAV, bakeoff: NAV,
  kanban: "←→↑↓ pick a card · e edit · a add · d delete · Esc back",
  find: "type to search · ↑↓ pick · Enter open · Esc close",
  models: "↑↓ pick · Enter switch · s skip · Esc later",
  update: "Enter install · s skip · r restart · Esc later",
  updateAsk: "y yes · n no",
  retro: NAV, history: NAV, transcripts: NAV, done: NAV, error: NAV, preview: NAV,
  burndown: "←/→ sprint · Esc back",
  idea: TYPING, change: TYPING, rename: TYPING, addAsset: TYPING, setCap: TYPING,
  importProject: TYPING, saveTemplate: TYPING, intake: TYPING,
  transcript: `${PAGER} · ←/→ next run · 1-9 open a screenshot`,
  diff: PAGER,
  board: "←→↑↓ pick · > Ready · < Backlog · Enter build · e edit · Esc back",
  building: "p pause · a add · r remove · x stop · ←→↑↓ pick a card",
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
  find: "Find",
  models: "Newer models",
  update: "Update",
  updateAsk: "Updates",
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

/** Bottom status bar: app · project · screen and the session cost on the left, then any notices
 *  in the accent ("v0.29.0 available: U"), the current screen's keys on the right. One filled
 *  row, full width. `sidebar` switches the keys to the sidebar's while it has focus, or adds the
 *  `tab` hint when it can take focus. */
export function StatusBar({
  projectName,
  phase,
  sidebar,
  notices = [],
}: {
  projectName?: string;
  phase?: string;
  sidebar?: "focused" | "available" | "hidden";
  notices?: string[];
}): React.ReactElement {
  const cols = useTermCols();
  const spent = sessionCost();
  const cap = getPrefs().budgetCapUSD;
  const overHalf = spent >= cap / 2;
  const label = phase ? PHASE_LABEL[phase] ?? phase : undefined;
  // The screen's own keys come first and the generic ones last, so a narrow bar (or one with
  // notices) cuts "? help · q quit" rather than the keys you need here.
  const keys = sidebar === "focused"
    ? "↑↓ move · Enter open · tab/Esc back · q quit"
    : `${phase && PHASE_HINTS[phase] ? `${PHASE_HINTS[phase]} · ` : ""}${sidebar === "available" ? "tab sidebar · " : sidebar === "hidden" ? "\\ sidebar · " : ""}? help · q quit`;
  return (
    <Box width={cols} backgroundColor={C.statusBar} paddingX={1} justifyContent="space-between" flexShrink={0}>
      <Box flexShrink={0}>
        <Text color={C.accent}>● </Text>
        <Text color={C.text} bold>Projectinator</Text>
        {projectName ? <Text color={C.text}>{` · ${truncate(projectName, Math.max(12, Math.floor(cols * 0.25)))}`}</Text> : null}
        {label ? <Text color={C.textMuted}>{` · ${label}`}</Text> : null}
        <Text color={C.textMuted}> · </Text>
        <Text color={overHalf ? C.warn : C.text}>{`$${spent.toFixed(2)}`}</Text>
        <Text color={C.textMuted}>{` of $${cap}`}</Text>
      </Box>
      {notices.length ? (
        <Box flexShrink={0} marginLeft={2}>
          <Text color={C.accent} bold>{notices.join(" · ")}</Text>
        </Box>
      ) : null}
      <Box flexShrink={1} marginLeft={2}>
        <Text color={C.textMuted} wrap="truncate-end">{keys}</Text>
      </Box>
    </Box>
  );
}

/** A floating dialog over everything, like Musinator's Settings: accent rounded border on the
 *  dialog fill, a soft drop shadow one row down and two columns right, centred on the screen. */
function Dialog({ children }: { children: React.ReactNode }): React.ReactElement {
  const rows = useTermRows();
  const cols = useTermCols();
  const width = Math.min(cols - 6, 104);
  return (
    <Box position="absolute" top={1} left={Math.max(0, Math.floor((cols - width - 2) / 2))} flexDirection="column">
      <Box>
        <Box width={width} maxHeight={rows - 4} flexDirection="column" overflow="hidden"
          borderStyle="round" borderColor={C.accent} backgroundColor={C.dialogBg} paddingX={2} paddingY={1}>
          <Framed.Provider value={true}>{children}</Framed.Provider>
        </Box>
        <Box width={2} marginTop={1} backgroundColor={C.shadow} />
      </Box>
      <Box marginLeft={2} width={width} height={1} backgroundColor={C.shadow} />
    </Box>
  );
}

/** Wraps every screen in the persistent frame: the status bar pinned at the bottom edge, and —
 *  for wizard steps and Settings — a floating dialog over everything. On wide terminals the
 *  sidebar sits on the left and the page lives in a main pane beside it (title bar = the
 *  page; accent while the page owns the keyboard); narrow terminals get the bare page. */
export function AppFrame({
  children,
  projectName,
  phase,
  pagePhase,
  pageProject,
  sidebar,
  sidebarFocused,
  sidebarHidden,
  dialog,
  notices,
}: {
  children: React.ReactNode;
  projectName?: string;
  phase?: string;
  /** The phase drawn as the page (differs from `phase` while a dialog is open). */
  pagePhase?: string;
  /** The project the page belongs to, for the main pane's title. */
  pageProject?: string;
  /** The nav pane; omitted on narrow terminals. */
  sidebar?: React.ReactNode;
  sidebarFocused?: boolean;
  /** The terminal has room for the sidebar but you hid it (`\`). */
  sidebarHidden?: boolean;
  /** When set, the page behind is inert and this floats on top. */
  dialog?: React.ReactNode;
  /** Short "something newer is out" lines for the status bar. */
  notices?: string[];
}): React.ReactElement {
  const rows = useTermRows();
  const pageActive = !dialog && !sidebarFocused;
  const label = pagePhase ? PHASE_LABEL[pagePhase] ?? pagePhase : "";
  const page = (
    <InputActive.Provider value={pageActive}>
      <Box flexDirection="column" flexShrink={0}>{children}</Box>
    </InputActive.Provider>
  );
  return (
    // Fixed height + overflow hidden so overly-tall content clips at the bottom
    // instead of pushing the frame past the viewport (which would unpin the status bar).
    <Box flexDirection="column" height={rows} overflow="hidden" backgroundColor={C.bg}>
      {sidebar ? (
        <Box flexGrow={1} overflow="hidden" paddingX={1} columnGap={1}>
          {sidebar}
          <Box flexGrow={1} flexShrink={1} flexDirection="column" overflow="hidden"
            borderStyle="round" borderColor={pageActive ? C.borderActive : C.border}>
            <Box backgroundColor={pageActive ? C.accent : C.titleBar} paddingX={1} flexShrink={0}>
              <Text bold color={pageActive ? C.onAccent : C.text} wrap="truncate-end">
                {pageProject ? `${pageProject} · ${label}` : label}
              </Text>
            </Box>
            <Box flexGrow={1} flexDirection="column" paddingX={1} overflow="hidden">
              <Framed.Provider value={true}>{page}</Framed.Provider>
            </Box>
          </Box>
        </Box>
      ) : (
        <Box flexGrow={1} flexDirection="column" paddingX={1} overflow="hidden">{page}</Box>
      )}
      <StatusBar
        projectName={projectName}
        phase={phase}
        sidebar={dialog ? undefined : sidebarHidden ? "hidden" : !sidebar ? undefined : sidebarFocused ? "focused" : "available"}
        notices={notices}
      />
      {dialog ? <Dialog>{dialog}</Dialog> : null}
    </Box>
  );
}
