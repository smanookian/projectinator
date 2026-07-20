// Model bake-off — run one task across models, judge quality, compare cost, and
// optionally save the winner as the model for that role. The founding idea, in
// the cockpit. v1 covers text roles (design, plan, test-reasoning).

import React, { useState } from "react";
import { Box, Text } from "ink";
import { Spinner, StatusMessage } from "@inkjs/ui";
import { C, Panel, Menu as SelectInput, KeyHint, TextField as TextInput } from "./components.js";
import { setRoleModel, modelLabel } from "./engine.js";
import { runBakeoff, bakeoffTask, type BakeoffResult, type Candidate } from "../bakeoff.js";
import type { Capability } from "../types.js";

const CAPS: { label: string; value: Capability }[] = [
  { label: "Design — spec / UI", value: "design" },
  { label: "Plan — decompose / decide", value: "plan" },
  { label: "Test — review reasoning", value: "test" },
];

const SAMPLE: Record<string, string> = {
  design: "Design a pricing page with 3 tiers (Free, Pro, Team): layout, components, colors, states",
  plan: "Plan an MVP task backlog for a URL shortener with analytics",
  test: "Review this login flow spec and list the edge cases a tester must check",
};

// v1 compares the three Claude tiers (what most people hold a key for).
const DEFAULT_CANDIDATES: Candidate[] = [
  { provider: "anthropic", model: "claude-opus-4-8" },
  { provider: "anthropic", model: "claude-sonnet-4-6" },
  { provider: "anthropic", model: "claude-haiku-4-5" },
];

type View =
  | { kind: "pickCap" }
  | { kind: "enterTask" }
  | { kind: "running" }
  | { kind: "results"; result: BakeoffResult }
  | { kind: "error"; msg: string };

export function BakeOff({ onExit }: { onExit: () => void }): React.ReactElement {
  const [cap, setCap] = useState<Capability>("design");
  const [task, setTask] = useState("");
  const [view, setView] = useState<View>({ kind: "pickCap" });
  const [log, setLog] = useState<string[]>([]);
  const [notice, setNotice] = useState("");

  const start = (prompt: string) => {
    setLog([]);
    setNotice("");
    setView({ kind: "running" });
    runBakeoff(bakeoffTask(prompt, cap), DEFAULT_CANDIDATES, {
      onProgress: (m) => setLog((prev) => [...prev.slice(-30), m]),
    })
      .then((result) => setView({ kind: "results", result }))
      .catch((e) => setView({ kind: "error", msg: e instanceof Error ? e.message : String(e) }));
  };

  // ---------- pick capability ----------
  if (view.kind === "pickCap") {
    return (
      <Box flexDirection="column">
        <Panel title="Model bake-off">
          <Box flexDirection="column" marginBottom={1}>
            <Text color={C.dim}>Run one task across the three Claude tiers, judge quality,</Text>
            <Text color={C.dim}>and compare cost + speed. Save the winner as that role's model.</Text>
          </Box>
          <SelectInput
            items={[...CAPS, { label: "Back", value: "__back" }]}
            onSelect={(i) => {
              if (i.value === "__back") return onExit();
              setCap(i.value as Capability);
              setTask(SAMPLE[i.value] ?? "");
              setView({ kind: "enterTask" });
            }}
          />
        </Panel>
      </Box>
    );
  }

  // ---------- enter the task ----------
  if (view.kind === "enterTask") {
    return (
      <Box flexDirection="column">
        <Text bold>Bake-off task ({cap})</Text>
        <Text color={C.dim}>Edit the task, then run it across Opus / Sonnet / Haiku.</Text>
        <Box marginTop={1}>
          <Text color={C.accent}>{"› "}</Text>
          <TextInput
            value={task}
            onChange={setTask}
            onSubmit={() => { if (task.trim()) start(task.trim()); else setView({ kind: "pickCap" }); }}
          />
        </Box>
        <Box flexDirection="column" marginTop={1}>
          <KeyHint hints={[{ keys: "Enter", label: "run" }]} />
          <Text color={C.dim}>Clear the text and press Enter to cancel.</Text>
        </Box>
      </Box>
    );
  }

  // ---------- running ----------
  if (view.kind === "running") {
    return (
      <Box flexDirection="column">
        <Text bold>Running bake-off ({cap})…</Text>
        <Box marginTop={1}><Spinner label="Running each model, then judging (real spend)…" /></Box>
        <Box marginTop={1} flexDirection="column">
          {log.slice(-8).map((l, i) => <Text key={i} color={C.dim} wrap="truncate-end">{l}</Text>)}
        </Box>
      </Box>
    );
  }

  // ---------- error ----------
  if (view.kind === "error") {
    return (
      <Box flexDirection="column">
        <Text bold>Bake-off failed</Text>
        <Box marginTop={1}><StatusMessage variant="error">{view.msg}</StatusMessage></Box>
        <Box marginTop={1}>
          <SelectInput items={[{ label: "Back", value: "back" }]} onSelect={() => setView({ kind: "pickCap" })} />
        </Box>
      </Box>
    );
  }

  // ---------- results ----------
  const { result } = view;
  const scoreOf = new Map(result.scores.map((s) => [s.model, s]));
  const cheapest = result.entries.filter((e) => !e.error).sort((a, b) => a.cost - b.cost)[0];
  const winnerModel = result.winner?.split("/")[1];
  return (
    <Box flexDirection="column">
      {notice ? <Box marginBottom={1}><StatusMessage variant="success">{notice}</StatusMessage></Box> : null}
      <Text bold>Bake-off results — {cap}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text color={C.dim}>{"model".padEnd(22)}{"score".padEnd(7)}{"cost".padEnd(11)}{"time".padEnd(7)}tok</Text>
        {result.entries.map((e) => {
          const key = `${e.provider}/${e.model}`;
          const sc = scoreOf.get(key);
          const win = key === result.winner;
          return (
            <Text key={key} color={win ? C.accent : e.error ? C.warn : C.text}>
              {(win ? "🏆 " : "   ") + modelLabel(e.model)}
              {"  "}
              {(e.error ? "ERR" : sc ? `${sc.score}/10` : "—").padEnd(7)}
              {(e.error ? "—" : `$${e.cost.toFixed(4)}`).padEnd(11)}
              {(e.error ? "—" : `${(e.ms / 1000).toFixed(1)}s`).padEnd(7)}
              {e.error ? "" : String(e.outputTokens)}
            </Text>
          );
        })}
      </Box>
      {result.winner ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={C.dim}>🏆 Best quality: {modelLabel(winnerModel ?? "")}  ·  💸 Cheapest: {cheapest ? modelLabel(cheapest.model) : "—"}  (judge: {modelLabel(result.judge?.split("/")[1] ?? "")})</Text>
          {result.scores.sort((a, b) => b.score - a.score).map((s) => (
            <Text key={s.model} color={C.dim} wrap="truncate-end">  {s.score}/10 {modelLabel(s.model.split("/")[1] ?? s.model)} — {s.reason}</Text>
          ))}
        </Box>
      ) : (
        <Box marginTop={1}><Text color={C.warn}>No winner (need ≥2 valid outputs to judge).</Text></Box>
      )}
      <Box marginTop={1}>
        <SelectInput
          items={[
            ...(winnerModel ? [{ label: `Use ${modelLabel(winnerModel)} for all ${cap} tasks`, value: "save" }] : []),
            { label: "Run another", value: "again" },
            { label: "Back", value: "back" },
          ]}
          onSelect={(i) => {
            if (i.value === "save" && winnerModel) {
              setRoleModel(cap, "high", winnerModel);
              setNotice(`Saved: ${cap} → ${modelLabel(winnerModel)} (all tiers).`);
            } else if (i.value === "again") {
              setView({ kind: "pickCap" });
            } else {
              onExit();
            }
          }}
        />
      </Box>
    </Box>
  );
}
