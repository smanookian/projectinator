// The Scrum board, as swimlanes. Rows = epics; columns = Backlog · Not Started ·
// In Progress · Done. Used live (during a build) and as the default project view.

import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { Badge } from "@inkjs/ui";
import type { Capability } from "../types.js";
import { C, ROLE_META } from "./components.js";

export interface BoardTask {
  id: string;
  capability: Capability;
  title: string;
  epic?: string;
  dependsOn?: string[];
  status: "pending" | "running" | "done" | "failed" | "skipped";
  cost?: number;
  verdict?: "PASS" | "FAIL";
  /** The teammate (model) working this task, when known. */
  assignee?: string;
}

type Col = "backlog" | "notStarted" | "inProgress" | "done";

function columnOf(t: BoardTask, done: Set<string>): Col {
  if (t.status === "done" || t.status === "skipped") return "done";
  if (t.status === "running" || t.status === "failed") return "inProgress";
  const ready = (t.dependsOn ?? []).every((d) => done.has(d));
  return ready ? "notStarted" : "backlog";
}

const COLS: { key: Col; label: string; color: string }[] = [
  { key: "backlog", label: "BACKLOG", color: C.dim },
  { key: "notStarted", label: "NOT STARTED", color: "cyan" },
  { key: "inProgress", label: "IN PROGRESS", color: C.accent },
  { key: "done", label: "DONE", color: C.good },
];

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

function Card({ t }: { t: BoardTask }): React.ReactElement {
  const running = t.status === "running";
  const failed = t.status === "failed";
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        {running ? <Text color="cyan"><Spinner type="dots" /> </Text> : failed ? <Text color={C.bad}>✗ </Text> : null}
        <Text>{ROLE_META[t.capability].emoji} </Text>
        <Text color={C.dim}>{t.id} </Text>
        <Text color={C.accent}>{t.capability}</Text>
        {t.verdict ? <Text> <Badge color={t.verdict === "PASS" ? "green" : "red"}>{t.verdict}</Badge></Text> : null}
        {t.cost ? <Text color={C.dim}> ${t.cost.toFixed(2)}</Text> : null}
      </Box>
      <Text color={failed ? C.bad : C.text} wrap="truncate-end">{t.title}</Text>
      {t.assignee ? <Text color={C.dim}>{t.assignee}</Text> : null}
    </Box>
  );
}

export function Kanban({ tasks }: { tasks: BoardTask[] }): React.ReactElement {
  const done = new Set(tasks.filter((t) => t.status === "done" || t.status === "skipped").map((t) => t.id));
  const lanes = groupByEpic(tasks);
  const counts: Record<Col, number> = { backlog: 0, notStarted: 0, inProgress: 0, done: 0 };
  for (const t of tasks) counts[columnOf(t, done)]++;

  return (
    <Box flexDirection="column">
      {/* column headers */}
      <Box>
        <Box width={12} />
        {COLS.map((col) => (
          <Box key={col.key} flexBasis="25%" flexGrow={1} marginRight={1}>
            <Text color={col.color} bold>{col.label} <Text color={C.dim}>{counts[col.key]}</Text></Text>
          </Box>
        ))}
      </Box>
      {lanes.map((lane) => {
        const byCol: Record<Col, BoardTask[]> = { backlog: [], notStarted: [], inProgress: [], done: [] };
        for (const t of lane.tasks) byCol[columnOf(t, done)].push(t);
        return (
          <Box key={lane.epic} flexDirection="column" marginTop={1}>
            <Text color={C.accent}>▊ {lane.epic}</Text>
            <Box>
              <Box width={12} />
              {COLS.map((col) => (
                <Box key={col.key} flexDirection="column" flexBasis="25%" flexGrow={1} marginRight={1}>
                  {byCol[col.key].length === 0 ? <Text color={C.dim}>·</Text> : byCol[col.key].map((t) => <Card key={t.id} t={t} />)}
                </Box>
              ))}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
