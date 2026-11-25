// A saved project's board, edited in place: pick a card on the board and change it right there
// — the prompt opens in the details pane. Every change saves at once (`onChange`). Built (done)
// tasks are locked except their epic and note; everything else is fair game.

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Capability, Difficulty, Task } from "../types.js";
import { C, TextField, useInputActive } from "./components.js";
import { TaskBoard } from "./TaskBoard.js";
import { byColumn, columnOf, firstCard, type BoardTask } from "./Kanban.js";
import { estimateTokens } from "../estimate.js";

const CAPS: Capability[] = ["plan", "design", "code", "review", "test", "ops"];
const DIFFS: Difficulty[] = ["trivial", "low", "medium", "high"];

type Prompt =
  | { kind: "title" | "epic" | "deps" | "notes"; draft: string }
  | { kind: "add"; draft: string }
  | { kind: "delete" };

const LABEL: Record<Prompt["kind"], string> = {
  title: "Title",
  epic: "Epic",
  deps: "Depends on (ids)",
  notes: "Note (yours only, never sent to the model)",
  add: "New task",
  delete: "",
};

/** The keys this board answers, for the help screen and the details pane. */
export const BOARD_KEYS: { keys: string; label: string }[] = [
  { keys: "←→ ↑↓ / h l j k", label: "move between cards" },
  { keys: "g / G", label: "top / bottom of column" },
  { keys: "e", label: "edit the title" },
  { keys: "a", label: "add a task to this epic" },
  { keys: "d", label: "delete (asks first)" },
  { keys: "n", label: "note" },
  { keys: "E", label: "epic" },
  { keys: "D", label: "depends on" },
  { keys: "c / f", label: "next role / next difficulty" },
  { keys: "K / J", label: "move the card up / down" },
  { keys: "b", label: "build the backlog" },
];

export function ProjectBoard({
  tasks,
  view,
  doneIds,
  maxPerCol,
  onChange,
  onBuild,
  onBack,
  onTyping,
}: {
  tasks: Task[];
  /** The same tasks as board cards (status, spend, model). */
  view: BoardTask[];
  doneIds: Set<string>;
  maxPerCol: number;
  onChange: (tasks: Task[]) => void;
  /** Build what's not done yet; absent when nothing is left to build. */
  onBuild?: () => void;
  onBack: () => void;
  /** True while a text field has the keyboard (so the app's single-key shortcuts stay off). */
  onTyping: (typing: boolean) => void;
}): React.ReactElement {
  const active = useInputActive();
  const [selectedId, setSelectedId] = useState<string | undefined>(() => firstCard(view));
  const [prompt, setPromptState] = useState<Prompt | null>(null);
  const [message, setMessage] = useState("");
  const setPrompt = (p: Prompt | null) => {
    setPromptState(p);
    onTyping(p !== null); // a prompt (even the delete y/n) owns the keyboard
  };
  const selected = tasks.find((t) => t.id === selectedId);
  const locked = !!selected && doneIds.has(selected.id);

  const update = (id: string, patch: Partial<Task>) => onChange(tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const nextId = () => {
    const ids = new Set(tasks.map((t) => t.id));
    let n = tasks.length + 1;
    let id = `T-${String(n).padStart(2, "0")}`;
    while (ids.has(id)) id = `T-${String(++n).padStart(2, "0")}`;
    return id;
  };

  // Move the card past its neighbour in the same column (board order = task order).
  const reorder = (dir: -1 | 1) => {
    if (!selected) return;
    const done = new Set(view.filter((t) => t.status === "done" || t.status === "skipped").map((t) => t.id));
    const me = view.find((t) => t.id === selected.id)!;
    const col = byColumn(view)[columnOf(me, done)];
    const neighbour = col[col.findIndex((t) => t.id === selected.id) + dir];
    if (!neighbour) return;
    const next = [...tasks];
    const a = next.findIndex((t) => t.id === selected.id);
    const b = next.findIndex((t) => t.id === neighbour.id);
    [next[a], next[b]] = [next[b]!, next[a]!];
    onChange(next);
  };

  const submit = (p: Prompt & { draft: string }) => {
    const text = p.draft.trim();
    if (p.kind === "add") {
      if (text) {
        const id = nextId();
        onChange([...tasks, { id, title: text, capability: "code", difficulty: "low", dependsOn: [], epic: selected?.epic || "General", estTokens: estimateTokens("code", "low") }]);
        setSelectedId(id);
      }
    } else if (selected) {
      if (p.kind === "title") update(selected.id, { title: text || selected.title });
      else if (p.kind === "epic") update(selected.id, { epic: text || selected.epic });
      else if (p.kind === "notes") update(selected.id, { notes: text || undefined });
      else if (p.kind === "deps") {
        const ids = new Set(tasks.map((t) => t.id));
        const deps = text.split(/[\s,]+/).filter((d) => d && d !== selected.id && ids.has(d));
        update(selected.id, { dependsOn: [...new Set(deps)] });
      }
    }
    setPrompt(null);
  };

  useInput((input, key) => {
    if (prompt?.kind === "delete") {
      if (input === "y" && selected) {
        const ix = tasks.findIndex((t) => t.id === selected.id);
        const rest = tasks.filter((t) => t.id !== selected.id);
        onChange(rest.map((t) => ({ ...t, dependsOn: (t.dependsOn ?? []).filter((d) => d !== selected.id) })));
        setSelectedId(rest[Math.min(ix, rest.length - 1)]?.id);
        setMessage(`Deleted ${selected.id}.`);
      }
      setPrompt(null);
      return;
    }
    if (prompt) {
      if (key.escape) setPrompt(null);
      return; // the text field has the keyboard
    }
    if (key.escape || key.backspace || key.delete) return onBack();
    setMessage("");
    if (input === "a") return setPrompt({ kind: "add", draft: "" });
    if (input === "b") {
      if (onBuild) onBuild();
      else setMessage("Everything on this board is built. Add a task with a.");
      return;
    }
    if (!selected) return;
    if (input === "K") return reorder(-1);
    if (input === "J") return reorder(1);
    if (input === "n") return setPrompt({ kind: "notes", draft: selected.notes ?? "" });
    if (input === "E") return setPrompt({ kind: "epic", draft: selected.epic || "General" });
    if (locked && (input === "e" || input === "D" || input === "c" || input === "f" || input === "d")) {
      setMessage(`${selected.id} is already built — only its epic (E) and note (n) can change.`);
      return;
    }
    if (input === "e") setPrompt({ kind: "title", draft: selected.title });
    else if (input === "D") setPrompt({ kind: "deps", draft: (selected.dependsOn ?? []).join(" ") });
    else if (input === "d") setPrompt({ kind: "delete" });
    else if (input === "c") {
      const cap = CAPS[(CAPS.indexOf(selected.capability) + 1) % CAPS.length]!;
      update(selected.id, { capability: cap, estTokens: estimateTokens(cap, selected.difficulty) });
    } else if (input === "f") {
      const diff = DIFFS[(DIFFS.indexOf(selected.difficulty) + 1) % DIFFS.length]!;
      update(selected.id, { difficulty: diff, estTokens: estimateTokens(selected.capability, diff) });
    }
  }, { isActive: active });

  const line = prompt?.kind === "delete" ? (
    <Text color={C.warn}>{`Delete ${selected?.id ?? ""}? y to delete, any other key keeps it`}</Text>
  ) : prompt ? (
    <Box>
      <Text color={C.accent}>{`${LABEL[prompt.kind]}: `}</Text>
      {/* Keyed so each prompt starts from its own text, not the last prompt's. */}
      {/* Functional update: the field can report a change after submit closed the prompt,
          and a stale `{ ...prompt }` would reopen it. */}
      <TextField key={`${prompt.kind}-${selectedId}`} value={prompt.draft} onChange={(v) => setPromptState((p) => (p && p.kind !== "delete" ? { ...p, draft: v } : p))} onSubmit={() => submit(prompt)} />
    </Box>
  ) : message ? (
    <Text color={C.warn} wrap="truncate-end">{message}</Text>
  ) : (
    <Text color={C.textMuted} wrap="truncate-end">n note · E epic · D depends · c role · f difficulty · K/J move · b build · ? all keys</Text>
  );

  return (
    <TaskBoard
      tasks={view}
      selectedId={selectedId}
      onSelect={setSelectedId}
      maxPerCol={maxPerCol}
      hints="e edit · a add · d delete"
      prompt={line}
      navDisabled={prompt !== null}
    />
  );
}
