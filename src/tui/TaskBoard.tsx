// The interactive board: the four column panes with a selected card, and the task details
// pane under them (as in Todonator's kanban). ←→/h l move between columns, ↑↓/j k within one,
// g/G jump to the top/bottom. Used live during a build (read-only), and as the project and plan
// boards, where EditBoard.tsx adds the edit keys and puts its prompts in the details pane.

import React, { useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { C, ROLE_META, useInputActive } from "./components.js";
import { roleGlyph } from "./icons.js";
import { Kanban, COLUMNS, byColumn, clock, firstCard, type BoardTask, type Col } from "./Kanban.js";

/** Rows the details pane takes (border 2 + title bar 1 + 4 field rows + 1 prompt row). */
export const DETAILS_ROWS = 8;

/** The card under the cursor after a key, or `undefined` if the key doesn't move it. */
function moveSelection(tasks: BoardTask[], selectedId: string | undefined, input: string, key: { leftArrow: boolean; rightArrow: boolean; upArrow: boolean; downArrow: boolean; home: boolean; end: boolean }): string | undefined {
  const cols = byColumn(tasks);
  const ci = Math.max(0, COLUMNS.findIndex((c) => cols[c.key].some((t) => t.id === selectedId)));
  const list = cols[COLUMNS[ci]!.key];
  const ri = Math.max(0, list.findIndex((t) => t.id === selectedId));
  const horiz = key.leftArrow || input === "h" ? -1 : key.rightArrow || input === "l" ? 1 : 0;
  if (horiz) {
    // Skip empty columns; keep roughly the same row.
    for (let c = ci + horiz; c >= 0 && c < COLUMNS.length; c += horiz) {
      const next = cols[COLUMNS[c]!.key];
      if (next.length) return next[Math.min(ri, next.length - 1)]!.id;
    }
    return undefined;
  }
  if (key.upArrow || input === "k") return list[Math.max(0, ri - 1)]?.id;
  if (key.downArrow || input === "j") return list[Math.min(list.length - 1, ri + 1)]?.id;
  if (input === "g" || key.home) return list[0]?.id;
  if (input === "G" || key.end) return list[list.length - 1]?.id;
  return undefined;
}

/** The selected task's fields, two columns, plus one row for a prompt or message. */
export function TaskDetails({
  task,
  doneIds,
  hints,
  prompt,
}: {
  task: BoardTask | undefined;
  doneIds: Set<string>;
  /** Keys for this pane, shown on the right of its title bar. */
  hints?: string;
  /** An edit field, confirmation or warning, on the last row. */
  prompt?: React.ReactNode;
}): React.ReactElement {
  const field = (label: string, value: React.ReactNode) => (
    <Box flexShrink={0}>
      <Box width={9} flexShrink={0}><Text color={C.textMuted}>{label}</Text></Box>
      <Box flexShrink={1}>{typeof value === "string" ? <Text color={C.text} wrap="truncate-end">{value}</Text> : value}</Box>
    </Box>
  );
  const t = task;
  const deps = t?.dependsOn ?? [];
  const status = !t ? "" : t.column === "backlog" ? "in the backlog (> moves it to Ready)"
    : t.column === "notStarted" ? "ready to build"
    : t.status === "running"
    ? `running${t.elapsedSec !== undefined ? ` ${clock(t.elapsedSec)}` : ""}${t.stuck ? " · slow" : ""}`
    : t.status === "done" ? "done" : t.status === "failed" ? "failed" : t.status === "skipped" ? "skipped"
    : deps.every((d) => doneIds.has(d)) ? "ready" : `blocked by ${deps.filter((d) => !doneIds.has(d)).join(", ")}`;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.border} flexShrink={0} height={DETAILS_ROWS}>
      <Box backgroundColor={C.titleBar} paddingX={1} justifyContent="space-between" flexShrink={0}>
        <Box flexShrink={1}><Text bold color={C.text} wrap="truncate-end">{t ? `${t.id} · ${t.title}` : "No tasks"}</Text></Box>
        {hints ? <Box flexShrink={0} marginLeft={2}><Text color={C.textMuted}>{hints}</Text></Box> : null}
      </Box>
      {t ? (
        <Box paddingX={1} flexShrink={0}>
          <Box flexDirection="column" flexBasis="50%" flexGrow={1} marginRight={2}>
            {field("role", `${roleGlyph(t.capability)} ${ROLE_META[t.capability].label}${t.difficulty ? ` · ${t.difficulty}` : ""}`)}
            {field("status", (
              <Text color={t.status === "failed" ? C.bad : t.status === "running" ? C.info : t.status === "done" ? C.good : C.text} wrap="truncate-end">
                {status}{t.verdict ? <Text color={t.verdict === "FAIL" ? C.bad : t.verdict === "PASS*" ? C.warn : C.good}>{` · ${t.verdict}`}</Text> : null}
              </Text>
            ))}
            {field("epic", t.epic || "General")}
            {field("depends", deps.length ? deps.map((d) => `${d}${doneIds.has(d) ? " ✓" : ""}`).join(", ") : "—")}
          </Box>
          <Box flexDirection="column" flexBasis="50%" flexGrow={1}>
            {field("model", t.assignee ?? "—")}
            {field("spent", t.cost ? `$${t.cost.toFixed(2)}` : "—")}
            {field("note", t.notes ? `✎ ${t.notes}` : "—")}
          </Box>
        </Box>
      ) : null}
      <Box paddingX={1} flexShrink={0}>{prompt ?? null}</Box>
    </Box>
  );
}

/** Board + details. Controlled: the parent owns `selectedId` (so edits can follow a card);
 *  `navDisabled` freezes the cursor while a prompt or text field has the keyboard. */
export function TaskBoard({
  tasks,
  selectedId,
  onSelect,
  maxPerCol,
  showDetails = true,
  hints,
  prompt,
  navDisabled,
  labels,
}: {
  tasks: BoardTask[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  maxPerCol: number;
  showDetails?: boolean;
  hints?: string;
  prompt?: React.ReactNode;
  navDisabled?: boolean;
  labels?: Partial<Record<Col, string>>;
}): React.ReactElement {
  const active = useInputActive();
  const current = tasks.find((t) => t.id === selectedId);
  // Keep a valid selection: the first card on mount, and again if the card goes away.
  useEffect(() => {
    const first = current ? undefined : firstCard(tasks);
    if (first) onSelect(first);
  }, [current, tasks.length]);

  useInput((input, key) => {
    const next = moveSelection(tasks, selectedId, input, key);
    if (next && next !== selectedId) onSelect(next);
  }, { isActive: active && !navDisabled });

  const doneIds = new Set(tasks.filter((t) => t.status === "done" || t.status === "skipped").map((t) => t.id));
  return (
    // flexGrow + default shrink: callers place this in a row Box, where a fixed-size child
    // would take its content width (long titles) and run past the pane.
    <Box flexDirection="column" flexGrow={1}>
      <Kanban tasks={tasks} maxPerCol={maxPerCol} selectedId={current?.id ?? ""} labels={labels} />
      {showDetails ? <TaskDetails task={current} doneIds={doneIds} hints={hints} prompt={prompt} /> : null}
    </Box>
  );
}
