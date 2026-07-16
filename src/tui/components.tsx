// Shared TUI pieces + theme. Kept small and presentational.

import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { Select, TextInput as UITextInput, PasswordInput, ProgressBar } from "@inkjs/ui";
import type { Capability } from "../types.js";

// ---- adapters: keep our existing call-site prop shape over @inkjs/ui ----

export interface MenuItem {
  label: string;
  value: string;
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

export const C = {
  accent: "#e0a72d", // signal amber
  dim: "gray",
  good: "green",
  warn: "yellow",
  bad: "red",
  text: "white",
};

export function Header(): React.ReactElement {
  return (
    <Box borderStyle="round" borderColor={C.accent} paddingX={1} marginBottom={1} alignSelf="flex-start">
      <Text color={C.accent} bold>PROJECTINATOR</Text>
      <Text color={C.dim}>  ·  your AI build team</Text>
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
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor ?? "gray"} paddingX={1} alignSelf="flex-start">
      {title ? <Text bold color={C.accent}>{title}</Text> : null}
      {children}
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
