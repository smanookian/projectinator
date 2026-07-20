// Small PM panels: the AI Team roster, the Standup summary line, and a List view.

import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { C, ROLE_META, Panel, Chip } from "./components.js";
import { groupByEpic, type BoardTask } from "./Kanban.js";
import { effectiveRoster, modelLabel } from "./engine.js";

/** The AI team: each role and the model playing it right now. */
export function Team(): React.ReactElement {
  const rows = effectiveRoster();
  return (
    <Panel title="Your team">
      {rows.map((r) => (
        <Box key={r.capability}>
          <Text>{ROLE_META[r.capability].emoji} </Text>
          <Box width={16}><Text color={C.dim}>{ROLE_META[r.capability].label}</Text></Box>
          <Text color={C.text}>{modelLabel(r.model ?? "—")}</Text>
        </Box>
      ))}
    </Panel>
  );
}

function isDone(t: BoardTask): boolean {
  return t.status === "done" || t.status === "skipped";
}

/** One-line standup: what's done, running, ready, spent, and needing attention. */
export function Standup({ tasks, spent }: { tasks: BoardTask[]; spent?: number }): React.ReactElement {
  const done = tasks.filter(isDone).length;
  const running = tasks.filter((t) => t.status === "running").length;
  const failed = tasks.filter((t) => t.status === "failed" || t.verdict === "FAIL").length;
  const doneIds = new Set(tasks.filter(isDone).map((t) => t.id));
  const ready = tasks.filter((t) => t.status === "pending" && (t.dependsOn ?? []).every((d) => doneIds.has(d))).length;
  const backlog = tasks.filter((t) => t.status === "pending" && !(t.dependsOn ?? []).every((d) => doneIds.has(d))).length;
  const cost = spent ?? tasks.reduce((a, t) => a + (t.cost ?? 0), 0);

  return (
    <Box gap={1} flexWrap="wrap">
      <Chip label={`${done} done`} dotColor={C.good} />
      {running > 0 ? <Chip label={`${running} running`} dotColor={C.info} /> : null}
      <Chip label={`${ready} ready`} dotColor="cyan" />
      <Chip label={`${backlog} backlog`} />
      <Chip label={`$${cost.toFixed(2)}`} dotColor={C.accent} />
      {failed > 0 ? <Chip label={`${failed} review`} dotColor={C.bad} active /> : null}
    </Box>
  );
}

const STATUS_MARK: Record<BoardTask["status"], { m: string; c: string }> = {
  done: { m: "✓", c: C.good },
  skipped: { m: "·", c: C.dim },
  running: { m: "●", c: "cyan" },
  failed: { m: "✗", c: C.bad },
  pending: { m: "○", c: C.dim },
};

/** Flat list view, grouped by epic. Read-only alternative to the board. */
export function ListView({ tasks }: { tasks: BoardTask[] }): React.ReactElement {
  const lanes = groupByEpic(tasks);
  return (
    <Box flexDirection="column">
      {lanes.map((lane) => (
        <Box key={lane.epic} flexDirection="column" marginBottom={1}>
          <Text color={C.accent}>▊ {lane.epic}</Text>
          {lane.tasks.map((t) => {
            const s = STATUS_MARK[t.status];
            return (
              <Box key={t.id}>
                <Box width={2}>
                  {t.status === "running" ? <Text color="cyan"><Spinner type="dots" /></Text> : <Text color={s.c}>{s.m}</Text>}
                </Box>
                <Box width={7}><Text color={C.dim}>{t.id}</Text></Box>
                <Box width={3}><Text>{ROLE_META[t.capability].emoji}</Text></Box>
                <Box flexGrow={1}><Text color={C.text} wrap="truncate-end">{t.title}</Text></Box>
                <Box width={10} justifyContent="flex-end">
                  {t.verdict ? <Text color={t.verdict === "PASS" ? C.good : C.bad}>{t.verdict}</Text>
                    : t.cost ? <Text color={C.dim}>${t.cost.toFixed(2)}</Text> : <Text> </Text>}
                </Box>
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
