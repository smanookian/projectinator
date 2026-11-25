// The plan board, before a build: the PM's tasks as cards on the same board as a project's,
// edited the same way. New tasks start in the Backlog (Scrum-style); `>` pulls a card into
// Ready, `<` parks it again, A / Z move everything. Enter (or b) builds what's in Ready; B asks
// the PM to break the card's epic down into more tasks.

import React, { useState } from "react";
import { Box, Text } from "ink";
import { Spinner } from "@inkjs/ui";
import type { Task } from "../types.js";
import { C } from "./components.js";
import { EditBoard } from "./EditBoard.js";
import type { BoardTask } from "./Kanban.js";
import { cleanDeps } from "./engine.js";

/** Plan-board keys on top of the shared edit keys, for the help screen. */
export const PLAN_KEYS: { keys: string; label: string }[] = [
  { keys: "> / <", label: "move a card to Ready / back to Backlog" },
  { keys: "A / Z", label: "everything to Ready / back to Backlog" },
  { keys: "Enter / b", label: "build what's in Ready" },
  { keys: "B", label: "the PM breaks this card's epic down" },
];

export function PlanBoard({
  tasks: initial,
  maxPerCol,
  onDone,
  onCancel,
  onBreakdown,
  onTyping,
}: {
  tasks: Task[];
  maxPerCol: number;
  onDone: (readyTasks: Task[]) => void;
  onCancel: () => void;
  /** Break an epic into more tasks (calls the PM). Returns new tasks tagged with the epic. */
  onBreakdown?: (epic: string, current: Task[]) => Promise<Task[]>;
  onTyping: (typing: boolean) => void;
}): React.ReactElement {
  const [tasks, setTasks] = useState<Task[]>(initial);
  const [ready, setReady] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(""); // epic being broken down
  const [failed, setFailed] = useState(false);

  const view: BoardTask[] = tasks.map((t) => ({ ...t, status: "pending", column: ready.has(t.id) ? "notStarted" : "backlog" }));

  const breakdown = async (epic: string) => {
    if (!onBreakdown || busy) return;
    setBusy(epic);
    setFailed(false);
    try {
      const created = await onBreakdown(epic, tasks);
      const ids = new Set(tasks.map((t) => t.id));
      setTasks((ts) => [...ts, ...created.filter((t) => !ids.has(t.id)).map((t) => ({ ...t, epic: t.epic || epic }))]);
    } catch {
      setFailed(true);
    } finally {
      setBusy("");
    }
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={C.text}>
        Plan board <Text color={C.textMuted}>({tasks.length - ready.size} in backlog, {ready.size} ready to build)</Text>
      </Text>
      <Box marginTop={1} flexDirection="column">
        <EditBoard
          tasks={tasks}
          view={view}
          maxPerCol={maxPerCol}
          labels={{ notStarted: "Ready" }}
          footer="> Ready · < Backlog · A all · Z none · Enter build · B break down epic · ? all keys"
          notice={busy ? <Spinner label={`Breaking down “${busy}”…`} /> : failed ? <Text color={C.warn}>Couldn't break down that epic. Try again.</Text> : undefined}
          onChange={(next) => {
            setTasks(next);
            const ids = new Set(next.map((t) => t.id));
            setReady((r) => new Set([...r].filter((id) => ids.has(id)))); // deleted cards leave Ready
          }}
          onTyping={onTyping}
          onBack={onCancel}
          onKey={(input, key, selected) => {
            if (input === "A") { setReady(new Set(tasks.map((t) => t.id))); return true; }
            if (input === "Z") { setReady(new Set()); return true; }
            if (key.return || input === "b") {
              const go = tasks.filter((t) => ready.has(t.id));
              if (!go.length) return "Nothing in Ready yet. Move cards with >, or press A to pull the whole backlog.";
              onDone(cleanDeps(go));
              return true;
            }
            if (!selected) return false;
            if (input === ">") { setReady((r) => new Set(r).add(selected.id)); return true; }
            if (input === "<") { setReady((r) => { const n = new Set(r); n.delete(selected.id); return n; }); return true; }
            if (input === "B") {
              if (!onBreakdown) return "Breaking an epic down needs the PM (a provider key).";
              void breakdown(selected.epic || "General");
              return true;
            }
            return false;
          }}
        />
      </Box>
    </Box>
  );
}
