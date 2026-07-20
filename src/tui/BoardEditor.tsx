// Interactive planning board with swimlanes (rows = epics). The PM curates before
// building: pull cards Backlog⇄Ready, add/edit/delete, and break an epic down into
// more tasks on demand. In Progress / Done fill during the build.

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Spinner } from "@inkjs/ui";
import type { Capability, Difficulty, Task } from "../types.js";
import { C, KeyHint, TextField as TextInput } from "./components.js";
import { cleanDeps } from "./engine.js";
import { estimateTokens } from "../estimate.js";
import { groupByEpic } from "./Kanban.js";

const CAPS: Capability[] = ["plan", "design", "code", "test", "ops"];
const DIFFS: Difficulty[] = ["trivial", "low", "medium", "high"];

interface Card extends Task {
  parked: boolean;
}

export function BoardEditor({
  tasks,
  onDone,
  onCancel,
  onBreakdown,
}: {
  tasks: Task[];
  onDone: (readyTasks: Task[]) => void;
  onCancel: () => void;
  /** Break an epic into more tasks (calls the PM). Returns new tasks tagged with the epic. */
  onBreakdown?: (epic: string, current: Task[]) => Promise<Task[]>;
}): React.ReactElement {
  // New tasks land in the BACKLOG first (Scrum-style); pull into Ready to build them.
  const [items, setItems] = useState<Card[]>(() => tasks.map((t) => ({ ...t, parked: true })));
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editField, setEditField] = useState<"title" | "epic" | "deps">("title");
  const [draft, setDraft] = useState("");
  const [warn, setWarn] = useState("");
  const [busy, setBusy] = useState<string>(""); // epic being broken down

  const lanes = groupByEpic(items);
  const ordered = lanes.flatMap((l) => l.tasks); // flat cursor order (grouped by epic)
  const selected = ordered[Math.min(cursor, ordered.length - 1)];

  const update = (id: string, patch: Partial<Card>) =>
    setItems((is) => is.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const setAllParked = (parked: boolean) => {
    setItems((is) => is.map((c) => ({ ...c, parked })));
    setWarn("");
  };

  const nextId = () => {
    const ids = new Set(items.map((c) => c.id));
    let n = items.length + 1;
    let id = `T-${String(n).padStart(2, "0")}`;
    while (ids.has(id)) id = `T-${String(++n).padStart(2, "0")}`;
    return id;
  };

  const finish = () => {
    const ready = items.filter((c) => !c.parked);
    if (ready.length === 0) {
      setWarn("Nothing in Ready yet. Move tasks with → , or press A to pull the whole backlog.");
      return;
    }
    onDone(cleanDeps(ready.map(({ parked, ...t }) => t as Task)));
  };

  const breakdown = async (epic: string) => {
    if (!onBreakdown || busy) return;
    setBusy(epic);
    setWarn("");
    try {
      const created = await onBreakdown(epic, items.map(({ parked, ...t }) => t as Task));
      const ids = new Set(items.map((c) => c.id));
      const fresh = created.filter((t) => !ids.has(t.id)).map((t) => ({ ...t, epic: t.epic || epic, parked: true }));
      setItems((is) => [...is, ...fresh]);
    } catch {
      setWarn("Couldn't break down that epic. Try again.");
    } finally {
      setBusy("");
    }
  };

  // Reorder the selected card among its siblings (same epic + same column).
  const reorder = (dir: -1 | 1) => {
    if (!selected) return;
    const idx = items.findIndex((c) => c.id === selected.id);
    let j = idx + dir;
    while (j >= 0 && j < items.length) {
      if ((items[j]!.epic || "General") === (selected.epic || "General") && items[j]!.parked === selected.parked) break;
      j += dir;
    }
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(idx, 1);
    next.splice(j, 0, moved!);
    setItems(next);
    const newOrdered = groupByEpic(next).flatMap((l) => l.tasks);
    setCursor(newOrdered.findIndex((c) => c.id === moved!.id));
  };

  useInput((input, key) => {
    if (editing || busy) return;
    if (key.upArrow) return setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) return setCursor((c) => Math.min(ordered.length - 1, c + 1));
    if (key.leftArrow) return selected && update(selected.id, { parked: true });
    if (key.rightArrow) return selected && update(selected.id, { parked: false });
    if (input === "[") return reorder(-1);
    if (input === "]") return reorder(1);
    if (input === "A") return setAllParked(false);
    if (input === "Z") return setAllParked(true);
    if (input === "a") {
      const id = nextId();
      const epic = selected?.epic || "General";
      setItems((is) => [...is, { id, title: "New task", capability: "code", difficulty: "low", dependsOn: [], epic, estTokens: estimateTokens("code", "low"), parked: true }]);
      setDraft("New task");
      setEditing(true);
      return;
    }
    if (!selected) return;
    if (input === "b") return void breakdown(selected.epic || "General");
    if (input === "e") {
      setEditField("title");
      setDraft(selected.title);
      setEditing(true);
    } else if (input === "g") {
      setEditField("epic");
      setDraft(selected.epic || "General");
      setEditing(true);
    } else if (input === "D") {
      setEditField("deps");
      setDraft((selected.dependsOn ?? []).join(" "));
      setEditing(true);
    } else if (input === "c") {
      const cap = CAPS[(CAPS.indexOf(selected.capability) + 1) % CAPS.length]!;
      update(selected.id, { capability: cap, estTokens: estimateTokens(cap, selected.difficulty) });
    } else if (input === "f") {
      const diff = DIFFS[(DIFFS.indexOf(selected.difficulty) + 1) % DIFFS.length]!;
      update(selected.id, { difficulty: diff, estTokens: estimateTokens(selected.capability, diff) });
    } else if (input === "d") {
      setItems((is) => is.filter((c) => c.id !== selected.id));
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.return) finish();
    else if (key.escape) onCancel();
  });

  const readyCount = items.filter((c) => !c.parked).length;
  const backlogCount = items.length - readyCount;

  const Cell = ({ cards }: { cards: Card[] }) => (
    <Box flexDirection="column" flexBasis="25%" flexGrow={1} marginRight={1}>
      {cards.length === 0 ? <Text color={C.dim}>·</Text> : cards.map((c) => {
        const sel = selected?.id === c.id;
        return (
          <Box key={c.id} flexDirection="column" marginBottom={1}>
            <Box>
              <Text color={C.accent}>{sel ? "› " : "  "}</Text>
              <Text color={C.dim}>{c.id} </Text>
              <Text color={C.accent}>{c.capability}/{c.difficulty}</Text>
            </Box>
            <Box>
              <Text> </Text>
              {sel && editing && editField === "title" ? (
                <TextInput value={draft} onChange={setDraft} onSubmit={() => { update(c.id, { title: draft.trim() || c.title }); setEditing(false); }} />
              ) : (
                <Text color={sel ? C.text : C.dim} wrap="truncate-end">{c.title}</Text>
              )}
            </Box>
            {(c.dependsOn ?? []).length ? <Text color={C.dim}>  ↖ {(c.dependsOn ?? []).join(", ")}</Text> : null}
          </Box>
        );
      })}
    </Box>
  );

  return (
    <Box flexDirection="column">
      <Text bold>Plan board <Text color={C.dim}>({backlogCount} in backlog, {readyCount} ready to build)</Text></Text>
      {warn ? <Text color={C.warn}>{warn}</Text> : null}
      {busy ? <Spinner label={`Breaking down “${busy}”…`} /> : null}
      {editing && editField === "epic" && selected ? (
        <Box>
          <Text color={C.accent}>Epic for {selected.id}: </Text>
          <TextInput value={draft} onChange={setDraft} onSubmit={() => { update(selected.id, { epic: draft.trim() || selected.epic }); setEditing(false); }} />
        </Box>
      ) : null}
      {editing && editField === "deps" && selected ? (
        <Box>
          <Text color={C.accent}>{selected.id} depends on (space-separated ids): </Text>
          <TextInput
            value={draft}
            onChange={setDraft}
            onSubmit={() => {
              const ids = new Set(items.map((c) => c.id));
              const deps = draft.split(/[\s,]+/).filter((d) => d && d !== selected.id && ids.has(d));
              update(selected.id, { dependsOn: [...new Set(deps)] });
              setEditing(false);
            }}
          />
        </Box>
      ) : null}

      {/* column headers */}
      <Box marginTop={1}>
        <Box width={12} />
        <Box flexBasis="25%" flexGrow={1} marginRight={1}><Text color="cyan" bold>BACKLOG {backlogCount}</Text></Box>
        <Box flexBasis="25%" flexGrow={1} marginRight={1}><Text color={C.accent} bold>READY {readyCount}</Text></Box>
        <Box flexBasis="25%" flexGrow={1} marginRight={1}><Text color={C.dim} bold>IN PROGRESS</Text></Box>
        <Box flexBasis="25%" flexGrow={1}><Text color={C.dim} bold>DONE</Text></Box>
      </Box>

      {lanes.map((lane) => (
        <Box key={lane.epic} flexDirection="column" marginTop={1}>
          <Text color={C.accent}>▊ {lane.epic}</Text>
          <Box>
            <Box width={12} />
            <Cell cards={lane.tasks.filter((c) => c.parked)} />
            <Cell cards={lane.tasks.filter((c) => !c.parked)} />
            <Box flexBasis="25%" flexGrow={1} marginRight={1}><Text color={C.dim}>·</Text></Box>
            <Box flexBasis="25%" flexGrow={1}><Text color={C.dim}>·</Text></Box>
          </Box>
        </Box>
      ))}
      <Box marginTop={1}>
        <KeyHint hints={[
          { keys: "↑↓", label: "pick" },
          { keys: "→/←", label: "col" },
          { keys: "[ ]", label: "reorder" },
          { keys: "a", label: "add" },
          { keys: "e", label: "edit" },
          { keys: "g", label: "epic" },
          { keys: "D", label: "deps" },
          { keys: "c", label: "cap" },
          { keys: "f", label: "diff" },
          { keys: "b", label: "break" },
          { keys: "d", label: "del" },
          { keys: "A", label: "all" },
          { keys: "Z", label: "none" },
          { keys: "Enter", label: "build" },
          { keys: "Esc", label: "back" },
        ]} />
      </Box>
    </Box>
  );
}
