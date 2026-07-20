// Shared TUI pieces + theme. Kept small and presentational.

import React, { useState, useEffect } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import Spinner from "ink-spinner";
import { Select, TextInput as UITextInput, PasswordInput, ProgressBar } from "@inkjs/ui";
import type { Capability } from "../types.js";

// ---- adapters: keep our existing call-site prop shape over @inkjs/ui ----

export interface MenuItem {
  label: string;
  value: string;
}

export interface MenuGroup {
  title: string;
  items: MenuItem[];
}

/** Current terminal size (rows), updated on resize. */
export function useTermRows(): number {
  const { stdout } = useStdout();
  const [rows, setRows] = useState(stdout?.rows ?? 24);
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setRows(stdout.rows ?? 24);
    stdout.on("resize", onResize);
    return () => { stdout.off("resize", onResize); };
  }, [stdout]);
  return rows;
}

type MenuLine =
  | { kind: "gap" }
  | { kind: "header"; text: string }
  | { kind: "item"; text: string; idx: number };

/** A vertical menu with dim, non-selectable section headers. Arrow keys move
 *  through the selectable items only (headers are skipped); Enter selects.
 *  When `maxRows` is smaller than the content, it scrolls, keeping the
 *  selection in view, with ↑/↓ hints. */
export function GroupedMenu({
  groups,
  onSelect,
  maxRows,
}: {
  groups: MenuGroup[];
  onSelect: (item: MenuItem) => void;
  maxRows?: number;
}): React.ReactElement {
  const flat = groups.flatMap((g) => g.items);
  const [idx, setIdx] = useState(0);
  const cur = Math.min(idx, Math.max(0, flat.length - 1));

  useInput((_input, key) => {
    if (key.upArrow) setIdx((i) => (i - 1 + flat.length) % flat.length);
    else if (key.downArrow) setIdx((i) => (i + 1) % flat.length);
    else if (key.return) { const it = flat[cur]; if (it) onSelect(it); }
  });

  // Flatten to display lines (gaps + headers + items) so scrolling is line-exact.
  const lines: MenuLine[] = [];
  let fi = 0;
  groups.forEach((g, gi) => {
    if (gi) lines.push({ kind: "gap" });
    if (g.title) lines.push({ kind: "header", text: g.title.toUpperCase() });
    g.items.forEach((it) => { lines.push({ kind: "item", text: it.label, idx: fi }); fi++; });
  });

  const budget = maxRows && maxRows < lines.length ? Math.max(3, maxRows) : lines.length;
  let start = 0;
  let end = lines.length;
  let clipTop = false;
  let clipBot = false;
  if (budget < lines.length) {
    const selLine = lines.findIndex((l) => l.kind === "item" && l.idx === cur);
    start = Math.max(0, Math.min(selLine - Math.floor(budget / 2), lines.length - budget));
    end = start + budget;
    clipTop = start > 0;
    clipBot = end < lines.length;
  }
  const visible = lines.slice(clipTop ? start + 1 : start, clipBot ? end - 1 : end);

  return (
    <Box flexDirection="column">
      {clipTop ? <Text color={C.dim}>  ↑ more</Text> : null}
      {visible.map((l, i) => {
        if (l.kind === "gap") return <Text key={`g${i}`}> </Text>;
        if (l.kind === "header") return <Text key={`h${i}`} color={C.dim} bold>{l.text}</Text>;
        const sel = l.idx === cur;
        return (
          <Text key={`i${l.idx}`} color={sel ? C.accent : C.text} wrap="truncate-end">
            {sel ? "❯ " : "  "}{l.text}
          </Text>
        );
      })}
      {clipBot ? <Text color={C.dim}>  ↓ more</Text> : null}
    </Box>
  );
}

/** SelectInput-shaped wrapper over @inkjs/ui Select (items/onSelect). */
export function Menu({
  items,
  onSelect,
  limit,
}: {
  items: MenuItem[];
  onSelect: (item: MenuItem) => void;
  limit?: number;
}): React.ReactElement {
  return (
    <Select
      options={items}
      visibleOptionCount={limit ?? Math.min(items.length, 16)}
      onChange={(value) => {
        const it = items.find((i) => i.value === value);
        if (it) onSelect(it);
      }}
    />
  );
}

/** Controlled-shaped wrapper over @inkjs/ui TextInput (value/onChange/onSubmit). */
export function TextField({
  value,
  onChange,
  onSubmit,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
}): React.ReactElement {
  return <UITextInput defaultValue={value} placeholder={placeholder} onChange={onChange} onSubmit={() => onSubmit()} />;
}

/** Masked input for secrets. */
export function Password({
  onSubmit,
  placeholder,
}: {
  onSubmit: (v: string) => void;
  placeholder?: string;
}): React.ReactElement {
  return <PasswordInput placeholder={placeholder} onSubmit={onSubmit} />;
}

// Semantic theme tokens (OpenCode-style roles). Old keys (accent/dim/good/warn/
// bad/text) are kept as aliases so every existing call site still works; new
// screens should prefer the richer roles (textMuted, border, borderActive, …).
export const C = {
  // brand / primary
  accent: "#e0a72d", // signal amber
  primary: "#e0a72d",
  accentMuted: "#a67c1f", // dimmed amber — secondary emphasis
  // text
  text: "white",
  textMuted: "#9aa0a6", // secondary text
  textSubtle: "#6b7178", // faint / metadata
  dim: "#9aa0a6", // legacy alias — same gray as textMuted so all metadata matches
  // surfaces (for panels / bars)
  bgPanel: "#1b1b1b",
  bgElement: "#242424",
  // borders
  border: "#3a3a3a",
  borderSubtle: "#2a2a2a",
  borderActive: "#e0a72d",
  // status
  good: "green",
  warn: "yellow",
  bad: "red",
  info: "cyan",
};

/** Current terminal width (columns), updated on resize. */
export function useTermCols(): number {
  const { stdout } = useStdout();
  const [cols, setCols] = useState(stdout?.columns ?? 80);
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setCols(stdout.columns ?? 80);
    stdout.on("resize", onResize);
    return () => { stdout.off("resize", onResize); };
  }, [stdout]);
  return cols;
}

export interface Hint {
  /** The key(s), e.g. "Enter", "Esc", "↑↓", "Ctrl+C". */
  keys: string;
  /** What it does, e.g. "save", "go back". */
  label: string;
}

/** The one place we render keyboard shortcuts, styled after inkui's KeyHint:
 *  each key sits in a small bordered keycap (amber) with its dim action label
 *  beside it, keycaps laid out in a wrapping row. Use this everywhere instead
 *  of ad-hoc "Enter to save · Esc to back" prose so hints look identical across
 *  every screen. */
export function KeyHint({ hints }: { hints: Hint[] }): React.ReactElement {
  return (
    <Box flexWrap="wrap">
      {hints.map((h, i) => (
        <Box key={i} marginRight={2} alignItems="center">
          <Box borderStyle="round" borderColor={C.dim} paddingX={1}>
            <Text color={C.accent}>{h.keys}</Text>
          </Box>
          <Text color={C.dim}>{` ${h.label}`}</Text>
        </Box>
      ))}
    </Box>
  );
}

/** A rounded-border panel with an optional amber title. Frames content sections. */
export function Panel({
  title,
  borderColor,
  children,
}: {
  title?: string;
  borderColor?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor ?? C.border} paddingX={2} paddingY={1} alignSelf="flex-start">
      {title ? <Box marginBottom={1}><Text bold color={C.accent}>{title}</Text></Box> : null}
      {children}
    </Box>
  );
}

/** A quiet, bordered pill — a small status dot + muted label. Replaces loud
 *  filled badges for things like connected providers. */
export function Chip({
  label,
  dotColor,
  active,
}: {
  label: string;
  dotColor?: string;
  active?: boolean;
}): React.ReactElement {
  return (
    <Box borderStyle="round" borderColor={active ? C.borderActive : C.borderSubtle} paddingX={1}>
      {dotColor ? <Text color={dotColor}>● </Text> : null}
      <Text color={active ? C.text : C.textMuted}>{label}</Text>
    </Box>
  );
}

export type TaskStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface TaskView {
  id: string;
  capability: Capability;
  status: TaskStatus;
  title: string;
  cost?: number;
  model?: string;
  verdict?: "PASS" | "FAIL";
}

const CAP_LABEL: Record<Capability, string> = {
  plan: "plan", design: "design", code: "code", test: "test", ops: "ops",
};

/** The AI team: each capability is a role with a friendly name + icon. */
export const ROLE_META: Record<Capability, { emoji: string; label: string }> = {
  plan: { emoji: "🧭", label: "Project manager" },
  design: { emoji: "🎨", label: "Designer" },
  code: { emoji: "🧠", label: "Developer" },
  test: { emoji: "🔎", label: "Tester" },
  ops: { emoji: "🚀", label: "Runner" },
};

function statusMark(s: TaskStatus): React.ReactElement {
  switch (s) {
    case "running":
      return (
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
      );
    case "done":
      return <Text color={C.good}>✓</Text>;
    case "failed":
      return <Text color={C.bad}>✗</Text>;
    case "skipped":
      return <Text color={C.dim}>·</Text>;
    default:
      return <Text color={C.dim}>○</Text>;
  }
}

export function TaskRow({ t }: { t: TaskView }): React.ReactElement {
  const dim = t.status === "pending" || t.status === "skipped";
  return (
    <Box>
      <Box width={2}>{statusMark(t.status)}</Box>
      <Box width={7}>
        <Text color={dim ? C.dim : C.accent}>{CAP_LABEL[t.capability]}</Text>
      </Box>
      <Box flexGrow={1}>
        <Text color={dim ? C.dim : C.text} wrap="truncate-end">
          {t.title}
        </Text>
      </Box>
      <Box width={10} justifyContent="flex-end">
        {t.verdict ? (
          <Text color={t.verdict === "PASS" ? C.good : C.bad}>{t.verdict}</Text>
        ) : t.cost !== undefined ? (
          <Text color={C.dim}>${t.cost.toFixed(2)}</Text>
        ) : (
          <Text> </Text>
        )}
      </Box>
    </Box>
  );
}

export function BudgetBar({ spent, cap }: { spent: number; cap: number }): React.ReactElement {
  const frac = Math.min(1, cap > 0 ? spent / cap : 0);
  const color = frac > 0.9 ? C.bad : frac > 0.66 ? C.warn : C.good;
  return (
    <Box>
      <Text color={C.dim}>spent </Text>
      <Text color={color} bold>${spent.toFixed(2)}</Text>
      <Text color={C.dim}> / ${cap.toFixed(0)}  </Text>
      <Box width={30}>
        <ProgressBar value={frac * 100} />
      </Box>
    </Box>
  );
}
