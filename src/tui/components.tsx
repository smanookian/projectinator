// Shared TUI pieces + theme. Kept small and presentational.

import React, { createContext, useContext, useState, useEffect } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import Spinner from "ink-spinner";
import { TextInput as UITextInput, PasswordInput, ProgressBar } from "@inkjs/ui";
import type { Capability } from "../types.js";
import { C } from "./theme.js";
export { C };
export type { Theme, ThemeId } from "./theme.js";

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

/** Whether the screen rendering here owns the keyboard. False for the page behind a floating
 *  dialog and for the main area while the sidebar has focus: menus and inputs there stay
 *  visible but ignore keys (and the selection shows as a quiet tint without the `→`). */
export const InputActive = createContext(true);
export function useInputActive(): boolean {
  return useContext(InputActive);
}

/** True inside something that already draws the frame — a floating dialog, or the main pane
 *  beside the sidebar: panels there drop their own border and become a heading. */
export const Framed = createContext(false);

type MenuLine =
  | { kind: "gap" }
  | { kind: "header"; text: string }
  | { kind: "item"; text: string; idx: number };

/** A selectable row in the family style: `→` marker and a selection tint when selected.
 *  Children are the row content (text inherits the selection colors). */
export function SelRow({ sel, children }: { sel: boolean; children: React.ReactNode }): React.ReactElement {
  const active = useInputActive();
  const on = sel && active;
  return (
    <Box backgroundColor={on ? C.selection : sel ? C.titleBar : undefined} flexShrink={0}>
      <Text color={C.marker}>{on ? "→ " : "  "}</Text>
      <Box flexGrow={1}>
        <Text color={on ? C.selectionFg : C.text} bold={on} wrap="truncate-end">{children}</Text>
      </Box>
    </Box>
  );
}

/** A vertical menu with non-selectable `▾ Section` headers. Arrow keys move
 *  through the selectable items only (headers are skipped); Enter selects.
 *  When `maxRows` is smaller than the content, it scrolls, keeping the
 *  selection in view, with ↑/↓ hints. `onMove` fires when the highlight moves. */
export function GroupedMenu({
  groups,
  onSelect,
  onMove,
  initial = 0,
  maxRows,
}: {
  groups: MenuGroup[];
  onSelect: (item: MenuItem) => void;
  onMove?: (item: MenuItem) => void;
  /** Index of the item highlighted first. */
  initial?: number;
  maxRows?: number;
}): React.ReactElement {
  const flat = groups.flatMap((g) => g.items);
  const [idx, setIdx] = useState(initial);
  const cur = Math.min(idx, Math.max(0, flat.length - 1));
  const isActive = useInputActive();

  // ↑↓ / j k move (wrapping), g G / Home End jump to the ends, PgUp PgDn move a page.
  useInput((input, key) => {
    if (!flat.length) return;
    const page = Math.max(1, (maxRows ?? 10) - 2);
    let next = cur;
    if (key.upArrow || input === "k") next = (cur - 1 + flat.length) % flat.length;
    else if (key.downArrow || input === "j") next = (cur + 1) % flat.length;
    else if (input === "g" || key.home) next = 0;
    else if (input === "G" || key.end) next = flat.length - 1;
    else if (key.pageUp) next = Math.max(0, cur - page);
    else if (key.pageDown) next = Math.min(flat.length - 1, cur + page);
    else if (key.return) { const it = flat[cur]; if (it) onSelect(it); return; }
    else return;
    setIdx(next);
    const it = flat[next];
    if (it) onMove?.(it);
  }, { isActive });

  // Flatten to display lines (gaps + headers + items) so scrolling is line-exact.
  const rows: MenuLine[] = [];
  let fi = 0;
  groups.forEach((g, gi) => {
    if (gi) rows.push({ kind: "gap" });
    if (g.title) rows.push({ kind: "header", text: g.title });
    g.items.forEach((it) => { rows.push({ kind: "item", text: it.label, idx: fi }); fi++; });
  });

  // Section headers and gaps also cost rows, so on a tight budget they can crowd out almost
  // every selectable item (a 24-row terminal showed ONE). When space is scarce, drop the
  // decoration and spend every row on items.
  const dense = maxRows !== undefined && maxRows < rows.length && maxRows < flat.length + 4;
  const lines = dense ? rows.filter((l) => l.kind === "item") : rows;
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
    // Grow to the pane width (callers often wrap menus in a row Box), so the selection tint
    // spans the whole row like the other apps.
    <Box flexDirection="column" flexGrow={1}>
      {clipTop ? <Text color={C.dim}>  ↑ more</Text> : null}
      {visible.map((l, i) => {
        if (l.kind === "gap") return <Text key={`g${i}`}> </Text>;
        if (l.kind === "header") return <Text key={`h${i}`} color={C.text} bold>{`▾ ${l.text}`}</Text>;
        return <SelRow key={`i${l.idx}`} sel={l.idx === cur}>{l.text}</SelRow>;
      })}
      {clipBot ? <Text color={C.dim}>  ↓ more</Text> : null}
    </Box>
  );
}

/** A single-list menu (items/onSelect): a GroupedMenu with one untitled group. */
export function Menu({
  items,
  onSelect,
  limit,
}: {
  items: MenuItem[];
  onSelect: (item: MenuItem) => void;
  limit?: number;
}): React.ReactElement {
  return <GroupedMenu groups={[{ title: "", items }]} onSelect={onSelect} maxRows={limit ?? 16} />;
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
  const active = useInputActive();
  return <UITextInput isDisabled={!active} defaultValue={value} placeholder={placeholder} onChange={onChange} onSubmit={() => onSubmit()} />;
}

/** Masked input for secrets. */
export function Password({
  onSubmit,
  placeholder,
}: {
  onSubmit: (v: string) => void;
  placeholder?: string;
}): React.ReactElement {
  const active = useInputActive();
  return <PasswordInput isDisabled={!active} placeholder={placeholder} onSubmit={onSubmit} />;
}

// Semantic theme tokens now live in theme.ts (dark/light + a live store so `C` follows
// the active theme). Re-exported here so every existing `C.x` import keeps resolving.

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

/** An in-panel key legend, in the family's quiet style: `key label · key label`. The
 *  standard keys (↑↓ / Enter / Esc) live in the status bar (Frame.tsx PHASE_HINTS) so EVERY
 *  screen shows them the same way — use this only for a screen whose key set the footer
 *  can't express: the board editors' full legend, a MultiSelect's Space, the prefs form's
 *  field-by-field Enter. Wraps rather than truncates, so no key gets hidden. */
export function KeyHint({ hints }: { hints: Hint[] }): React.ReactElement {
  return (
    <Text color={C.textMuted}>
      {hints.map((h, i) => (
        <Text key={i}>
          {i ? " · " : ""}
          <Text color={C.text}>{h.keys}</Text>
          {` ${h.label}`}
        </Text>
      ))}
    </Text>
  );
}

/** A bordered pane in the family style: rounded border, a filled title bar on the first row
 *  (accent fill when focused, quiet fill otherwise), content below. A pane only looks focused
 *  while its screen owns the keyboard. `borderColor` marks a warning/danger pane: that color
 *  on the border and the title text. Inside a frame (dialog or main pane, see `Framed`) the
 *  pane draws no border — just a heading in the accent (or `borderColor`). */
export function Panel({
  title,
  borderColor,
  focused = true,
  children,
}: {
  title?: string;
  borderColor?: string;
  focused?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const active = useInputActive();
  const framed = useContext(Framed);
  if (framed) {
    return (
      <Box flexDirection="column" flexShrink={0}>
        {title ? <Box marginBottom={1}><Text bold color={borderColor ?? (focused && active ? C.accent : C.text)} wrap="truncate-end">{title}</Text></Box> : null}
        {children}
      </Box>
    );
  }
  const lit = focused && active;
  const accentBar = lit && !borderColor;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor ?? (lit ? C.borderActive : C.border)} flexShrink={0}>
      {title ? (
        <Box backgroundColor={accentBar ? C.accent : C.titleBar} paddingX={1}>
          <Text bold color={accentBar ? C.onAccent : borderColor ?? C.text} wrap="truncate-end">{title}</Text>
        </Box>
      ) : null}
      <Box flexDirection="column" paddingX={1} paddingTop={title ? 1 : 0}>{children}</Box>
    </Box>
  );
}

/** A quiet status item — a small dot + muted label, like the family's status bars. */
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
    <Box>
      {dotColor ? <Text color={dotColor}>● </Text> : null}
      <Text color={active ? C.text : C.textMuted} bold={active}>{label}</Text>
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
  /** "PASS*" = passed, but the tester never ran the app (no Chromium). */
  verdict?: "PASS" | "PASS*" | "FAIL";
  /** Epoch ms when the current run started (running tasks only). */
  startedAt?: number;
}

const CAP_LABEL: Record<Capability, string> = {
  plan: "plan", design: "design", code: "code", review: "review", test: "test", ops: "ops",
};

/** The AI team: each capability is a role with a friendly name. Icons come from
 *  icons.ts (roleGlyph) so they follow Nerd Font vs ASCII mode. */
export const ROLE_META: Record<Capability, { label: string }> = {
  plan: { label: "Project manager" },
  design: { label: "Designer" },
  code: { label: "Developer" },
  review: { label: "Reviewer" },
  test: { label: "Tester" },
  ops: { label: "Runner" },
};

function statusMark(s: TaskStatus): React.ReactElement {
  switch (s) {
    case "running":
      return (
        <Text color={C.info}>
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
          <Text color={t.verdict === "FAIL" ? C.bad : t.verdict === "PASS*" ? C.warn : C.good}>{t.verdict}</Text>
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
