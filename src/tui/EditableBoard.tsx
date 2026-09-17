// Directly edit a project's board: reorganize epics, rename, retag, add or delete
// tasks. Done tasks are locked (they're already built). Saves back to build-state.

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Capability, Difficulty, Task } from "../types.js";
import { C, ROLE_META, KeyHint, TextField as TextInput, useTermRows } from "./components.js";
import { roleGlyph } from "./icons.js";
import { estimateTokens } from "../estimate.js";
import { groupByEpic } from "./Kanban.js";

const CAPS: Capability[] = ["plan", "design", "code", "review", "test", "ops"]
const DIFFS: Difficulty[] = ["trivial", "low", "medium", "high"];

export function EditableBoard({
  tasks,
  doneIds,
  onSave,
  onCancel,
}: {
  tasks: Task[];
  doneIds: Set<string>;
  onSave: (tasks: Task[]) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [items, setItems] = useState<Task[]>(() => tasks.map((t) => ({ ...t })));
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState(false);
  const [field, setField] = useState<"title" | "epic" | "deps" | "notes">("title");
  const [draft, setDraft] = useState("");
  const [warn, setWarn] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set()); // epic name → hidden
  const termRows = useTermRows();

  const lanes = groupByEpic(items);
  const ordered = lanes.filter((l) => !collapsed.has(l.epic)).flatMap((l) => l.tasks);
  const selected = ordered[Math.min(cursor, ordered.length - 1)];
  const isDone = (id: string) => doneIds.has(id);

  const update = (id: string, patch: Partial<Task>) =>
    setItems((is) => is.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const nextId = () => {
    const ids = new Set(items.map((t) => t.id));
    let n = items.length + 1;
    let id = `T-${String(n).padStart(2, "0")}`;
    while (ids.has(id)) id = `T-${String(++n).padStart(2, "0")}`;
    return id;
  };

  const toggleEpic = (epic: string) => {
    setCollapsed((cs) => {
      const n = new Set(cs);
      if (n.has(epic)) n.delete(epic); else n.add(epic);
      return n;
    });
    setCursor(0);
  };

  useInput((input, key) => {
    if (editing) return;
    if (key.upArrow) return setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) return setCursor((c) => Math.min(ordered.length - 1, c + 1));
    if (/^[1-9]$/.test(input)) { const lane = lanes[Number(input) - 1]; if (lane) toggleEpic(lane.epic); return; }
    if (input === "[" || input === "]") {
      if (!selected) return;
      const dir = input === "[" ? -1 : 1;
      const idx = items.findIndex((t) => t.id === selected.id);
      let j = idx + dir;
      while (j >= 0 && j < items.length) {
        if ((items[j]!.epic || "General") === (selected.epic || "General")) break;
        j += dir;
      }
      if (j < 0 || j >= items.length) return;
      const next = [...items];
      const [moved] = next.splice(idx, 1);
      next.splice(j, 0, moved!);
      setItems(next);
      const newOrdered = groupByEpic(next).filter((l) => !collapsed.has(l.epic)).flatMap((l) => l.tasks);
      setCursor(newOrdered.findIndex((t) => t.id === moved!.id));
      return;
    }
    if (input === "a") {
      const id = nextId();
      const epic = selected?.epic || "General";
      setItems((is) => [...is, { id, title: "New task", capability: "code", difficulty: "low", dependsOn: [], epic, estTokens: estimateTokens("code", "low") }]);
      setField("title");
      setDraft("New task");
      setEditing(true);
      setWarn("");
      return;
    }
    if (!selected) return;
    if (key.return) return onSave(items);
    if (key.escape) return onCancel();
    if (input === "g") { setField("epic"); setDraft(selected.epic || "General"); setEditing(true); return; }
    if (input === "D") { setField("deps"); setDraft((selected.dependsOn ?? []).join(" ")); setEditing(true); return; }
    if (input === "n") { setField("notes"); setDraft(selected.notes ?? ""); setEditing(true); return; }
    // fields below don't change built work
    if (isDone(selected.id)) {
      setWarn(`${selected.id} is already built — only its epic (g) and notes (n) can be changed.`);
      return;
    }
    if (input === "e") { setField("title"); setDraft(selected.title); setEditing(true); }
    else if (input === "c") {
      const cap = CAPS[(CAPS.indexOf(selected.capability) + 1) % CAPS.length]!;
      update(selected.id, { capability: cap, estTokens: estimateTokens(cap, selected.difficulty) });
    } else if (input === "f") {
      const diff = DIFFS[(DIFFS.indexOf(selected.difficulty) + 1) % DIFFS.length]!;
      update(selected.id, { difficulty: diff, estTokens: estimateTokens(selected.capability, diff) });
    } else if (input === "d") {
      setItems((is) => is.filter((t) => t.id !== selected.id));
      setCursor((c) => Math.max(0, c - 1));
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold color={C.text}>Edit board <Text color={C.dim}>({items.length} tasks)</Text></Text>
      {warn ? <Text color={C.warn}>{warn}</Text> : null}
      {editing && field === "epic" && selected ? (
        <Box><Text color={C.accent}>Epic for {selected.id}: </Text>
          <TextInput value={draft} onChange={setDraft} onSubmit={() => { update(selected.id, { epic: draft.trim() || selected.epic }); setEditing(false); }} />
        </Box>
      ) : null}
      {editing && field === "deps" && selected ? (
        <Box><Text color={C.accent}>{selected.id} depends on (ids): </Text>
          <TextInput
            value={draft}
            onChange={setDraft}
            onSubmit={() => {
              const ids = new Set(items.map((t) => t.id));
              const deps = draft.split(/[\s,]+/).filter((d) => d && d !== selected.id && ids.has(d));
              update(selected.id, { dependsOn: [...new Set(deps)] });
              setEditing(false);
            }}
          />
        </Box>
      ) : null}
      {editing && field === "notes" && selected ? (
        <Box><Text color={C.accent}>Note for {selected.id} (yours only, never sent to the model): </Text>
          <TextInput value={draft} onChange={setDraft} onSubmit={() => { update(selected.id, { notes: draft.trim() || undefined }); setEditing(false); }} />
        </Box>
      ) : null}

      {lanes.map((lane, i) => {
        const isCollapsed = collapsed.has(lane.epic);
        return (
          <Box key={lane.epic} flexDirection="column" marginTop={1}>
            <Text color={C.accent}>{(isCollapsed ? "▸" : "▾")} <Text color={C.dim}>{i + 1}</Text> {lane.epic}{isCollapsed ? <Text color={C.dim}>  · {lane.tasks.length} task{lane.tasks.length === 1 ? "" : "s"}</Text> : null}</Text>
            {isCollapsed ? null : lane.tasks.map((t) => {
            const sel = selected?.id === t.id;
            const done = isDone(t.id);
            return (
              <Box key={t.id} flexDirection="column">
                <Box>
                  <Box width={2}><Text color={C.accent}>{sel ? "›" : " "}</Text></Box>
                  <Box width={2}><Text color={done ? C.good : C.dim}>{done ? "✓" : "○"}</Text></Box>
                  <Box width={7}><Text color={C.dim}>{t.id}</Text></Box>
                  <Box width={3}><Text color={C.text}>{roleGlyph(t.capability)}</Text></Box>
                  <Box width={16}><Text color={sel ? C.accent : C.dim}>{t.capability}/{t.difficulty}</Text></Box>
                  <Box flexGrow={1}>
                    {sel && editing && field === "title" ? (
                      <TextInput value={draft} onChange={setDraft} onSubmit={() => { update(t.id, { title: draft.trim() || t.title }); setEditing(false); }} />
                    ) : (
                      <Text color={sel ? C.text : done ? C.dim : C.text} wrap="truncate-end">{t.title}</Text>
                    )}
                  </Box>
                </Box>
                {t.notes ? <Box marginLeft={30}><Text color={C.dim} wrap="truncate-end">✎ {t.notes}</Text></Box> : null}
              </Box>
            );
          })}
          </Box>
        );
      })}
      <Box marginTop={1}>
        <KeyHint compact={termRows < 32} hints={[
          { keys: "↑↓", label: "pick" },
          { keys: "1-9", label: "collapse" },
          { keys: "[ ]", label: "reorder" },
          { keys: "g", label: "epic" },
          { keys: "D", label: "deps" },
          { keys: "n", label: "note" },
          { keys: "e", label: "rename" },
          { keys: "c", label: "cap" },
          { keys: "f", label: "diff" },
          { keys: "a", label: "add" },
          { keys: "d", label: "delete" },
          { keys: "Enter", label: "save" },
          { keys: "Esc", label: "back" },
        ]} />
      </Box>
    </Box>
  );
}
