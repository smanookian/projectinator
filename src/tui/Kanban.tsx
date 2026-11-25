// The Scrum board: four column panes — Backlog · Not started · In progress · Done — in the
// family look (rounded border, title bar). Used live during a build and as the project board.
// Presentational: selection and keys live in TaskBoard.tsx.

import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { Capability, Difficulty } from "../types.js";
import { C, useInputActive } from "./components.js";
import { roleGlyph } from "./icons.js";

export interface BoardTask {
  id: string;
  capability: Capability;
  title: string;
  epic?: string;
  dependsOn?: string[];
  difficulty?: Difficulty;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  cost?: number;
  verdict?: "PASS" | "PASS*" | "FAIL";
  /** The teammate (model) working this task, when known. */
  assignee?: string;
  /** Human annotation from the board. */
  notes?: string;
  /** For running tasks: seconds since it started, and whether it's over its expected time. */
  elapsedSec?: number;
  stuck?: boolean;
}

export type Col = "backlog" | "notStarted" | "inProgress" | "done";

export const COLUMNS: { key: Col; label: string }[] = [
  { key: "backlog", label: "Backlog" },
  { key: "notStarted", label: "Not started" },
  { key: "inProgress", label: "In progress" },
  { key: "done", label: "Done" },
];

export function columnOf(t: BoardTask, done: Set<string>): Col {
  if (t.status === "done" || t.status === "skipped") return "done";
  if (t.status === "running" || t.status === "failed") return "inProgress";
  const ready = (t.dependsOn ?? []).every((d) => done.has(d));
  return ready ? "notStarted" : "backlog";
}

/** Tasks per column, in board order. */
export function byColumn(tasks: BoardTask[]): Record<Col, BoardTask[]> {
  const done = new Set(tasks.filter((t) => t.status === "done" || t.status === "skipped").map((t) => t.id));
  const out: Record<Col, BoardTask[]> = { backlog: [], notStarted: [], inProgress: [], done: [] };
  for (const t of tasks) out[columnOf(t, done)].push(t);
  return out;
}

/** The top card of the leftmost non-empty column — where a fresh selection starts. */
export function firstCard(tasks: BoardTask[]): string | undefined {
  const cols = byColumn(tasks);
  return COLUMNS.map((c) => cols[c.key][0]).find(Boolean)?.id;
}

/** Group tasks by epic, preserving first-seen order. */
export function groupByEpic<T extends { epic?: string }>(tasks: T[]): { epic: string; tasks: T[] }[] {
  const order: string[] = [];
  const map = new Map<string, T[]>();
  for (const t of tasks) {
    const e = t.epic || "General";
    if (!map.has(e)) {
      map.set(e, []);
      order.push(e);
    }
    map.get(e)!.push(t);
  }
  return order.map((epic) => ({ epic, tasks: map.get(epic)! }));
}

/** mm:ss for a running card. */
export function clock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** One-line card. A flex row, so only the title shrinks and truncates; the glyph, id, clock
 *  and cost keep their width. With `marker`, a 2-column `→` slot leads the row. */
function MiniCard({ t, sel, active, marker }: { t: BoardTask; sel: boolean; active: boolean; marker: boolean }): React.ReactElement {
  const running = t.status === "running";
  const on = sel && active;
  return (
    <Box flexShrink={0} backgroundColor={on ? C.selection : sel ? C.titleBar : undefined}>
      {marker ? <Box flexShrink={0} width={2}><Text color={C.marker}>{on ? "→" : " "}</Text></Box> : null}
      <Box flexShrink={0} marginRight={1}>
        {running ? <Text color={C.info}><Spinner type="dots" /></Text> : t.status === "failed" ? <Text color={C.bad}>✗</Text> : <Text color={C.text}>{roleGlyph(t.capability)}</Text>}
      </Box>
      <Box flexShrink={0} marginRight={1}><Text color={C.dim}>{t.id}</Text></Box>
      <Box flexShrink={1} flexGrow={1}>
        <Text color={running ? C.info : on ? C.selectionFg : C.text} bold={on} wrap="truncate-end">{t.title}</Text>
      </Box>
      {running && t.elapsedSec !== undefined ? <Box flexShrink={0} marginLeft={1}><Text color={t.stuck ? C.warn : C.dim}>{clock(t.elapsedSec)}{t.stuck ? " slow" : ""}</Text></Box> : null}
      {t.verdict ? <Box flexShrink={0} marginLeft={1}><Text color={t.verdict === "FAIL" ? C.bad : t.verdict === "PASS*" ? C.warn : C.good}>{t.verdict}</Text></Box> : null}
      {t.cost ? <Box flexShrink={0} marginLeft={1}><Text color={C.dim}>${t.cost.toFixed(2)}</Text></Box> : null}
    </Box>
  );
}

/** The 4-column board: one-line cards, at most `maxPerCol` per column. Without a selection
 *  the In progress pane is the live one and carries the accent; with `selectedId` the focused
 *  column does, the selected card gets the `→` and tint, and a long column scrolls to keep it
 *  in view. Chrome: 3 rows (border 2 + title bar 1) on top of the cards. */
export function Kanban({
  tasks,
  maxPerCol,
  selectedId,
}: {
  tasks: BoardTask[];
  maxPerCol?: number;
  /** The selected card, when the board is interactive. */
  selectedId?: string;
}): React.ReactElement {
  const active = useInputActive();
  const cols = byColumn(tasks);
  const cap = Math.max(2, maxPerCol ?? 6);
  const interactive = selectedId !== undefined;
  const focusCol = interactive ? COLUMNS.find((c) => cols[c.key].some((t) => t.id === selectedId))?.key : "inProgress";
  return (
    <Box>
      {COLUMNS.map((col, i) => {
        const list = cols[col.key];
        const lit = col.key === focusCol && (active || !interactive);
        const selIx = list.findIndex((t) => t.id === selectedId);
        // Scroll so the selected card stays visible; each clipped end costs one row.
        const start = selIx >= cap ? selIx - cap + 2 : 0;
        const room = start > 0 ? cap - 1 : cap;
        const shown = list.slice(start, start + room);
        const below = list.length - start - shown.length;
        return (
          // flexBasis 0: columns split the width evenly instead of growing to fit long titles
          // (which pushed the Done pane past the right edge beside the sidebar).
          <Box key={col.key} flexDirection="column" flexBasis={0} flexGrow={1} marginLeft={i ? 1 : 0} overflow="hidden"
            borderStyle="round" borderColor={lit ? C.borderActive : C.border}>
            <Box backgroundColor={lit ? C.accent : C.titleBar} paddingX={1}>
              <Text bold color={lit ? C.onAccent : C.text} wrap="truncate-end">{`${col.label} · ${list.length}`}</Text>
            </Box>
            <Box flexDirection="column" paddingX={interactive ? 0 : 1} paddingRight={1}>
              {list.length === 0 ? <Text color={C.dim}>{interactive ? "  ·" : "·"}</Text> : null}
              {start > 0 ? <Text color={C.dim}>{`  ↑ ${start} more`}</Text> : null}
              {shown.map((t) => <MiniCard key={t.id} t={t} sel={t.id === selectedId} active={active} marker={interactive} />)}
              {below > 0 ? <Text color={C.dim}>{`${interactive ? "  " : ""}+${below} more`}</Text> : null}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
