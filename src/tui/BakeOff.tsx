// Model bake-off — run one task across the connected roster (every provider you hold a
// key for, plus local models), judge quality (text) or let the real Tester score each
// build (code), compare cost, mark the quality/$ frontier, and optionally save the winner
// as the model for that role. The founding idea, in the cockpit.

import React, { useState } from "react";
import { Box, Text } from "ink";
import { Spinner, StatusMessage } from "@inkjs/ui";
import { C, Panel, Menu as SelectInput, KeyHint, TextField as TextInput } from "./components.js";
import { setRoleModel, modelLabel, bakeoffCandidates, rosterTester } from "./engine.js";
import { runBakeoff, bakeoffTask, type BakeoffResult } from "../bakeoff.js";
import type { Capability } from "../types.js";

const CAPS: { label: string; value: Capability }[] = [
  { label: "Design — spec / UI", value: "design" },
  { label: "Plan — decompose / decide", value: "plan" },
  { label: "Test — review reasoning", value: "test" },
  { label: "Code — each model builds it, the real Tester scores it (slower, costs more)", value: "code" },
];

const SAMPLE: Record<string, string> = {
  design: "Design a pricing page with 3 tiers (Free, Pro, Team): layout, components, colors, states",
  plan: "Plan an MVP task backlog for a URL shortener with analytics",
  test: "Review this login flow spec and list the edge cases a tester must check",
  code: "Build a single-page tip calculator: bill input, tip % buttons (10/15/20), live total; index.html + style.css + script.js",
};

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
    const candidates = bakeoffCandidates(cap);
    if (candidates.length < 2) return setView({ kind: "error", msg: "A bake-off needs at least two models — connect another provider (Settings → API keys) or add a local model." });
    runBakeoff(bakeoffTask(prompt, cap), candidates, {
      tester: rosterTester(),
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
            <Text color={C.dim}>Run one task across your connected roster ({bakeoffCandidates("design").map((c) => modelLabel(c.model)).join(", ") || "no models"}),</Text>
            <Text color={C.dim}>judge quality, compare cost + speed, see the quality/$ frontier. Save the winner as that role's model.</Text>
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
        <Panel title={`Bake-off task — ${cap}`}>
          <Text color={C.textMuted}>Edit the task, then run it across: {bakeoffCandidates(cap).map((c) => modelLabel(c.model)).join(", ")}.</Text>
          {cap === "code" ? <Text color={C.textMuted}>Each model builds in its own scratch folder; the Tester ({modelLabel(rosterTester()?.model ?? "?")}) runs every build. Judge-free: the verdict is the score.</Text> : null}
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
            <Text color={C.textSubtle}>Clear the text and press Enter to cancel.</Text>
          </Box>
        </Panel>
      </Box>
    );
  }

  // ---------- running ----------
  if (view.kind === "running") {
    return (
      <Box flexDirection="column">
        <Panel title={`Running bake-off — ${cap}`}>
          <Spinner label={cap === "code" ? "Each model builds, then the Tester runs it (real spend)…" : "Running each model, then judging (real spend)…"} />
          <Box marginTop={1} flexDirection="column">
            {log.slice(-8).map((l, i) => <Text key={i} color={C.textSubtle} wrap="truncate-end">{l}</Text>)}
          </Box>
        </Panel>
      </Box>
    );
  }

  // ---------- error ----------
  if (view.kind === "error") {
    return (
      <Box flexDirection="column">
        <Panel title="Bake-off failed" borderColor={C.bad}>
          <StatusMessage variant="error">{view.msg}</StatusMessage>
          <Box marginTop={1}>
            <SelectInput items={[{ label: "Back", value: "back" }]} onSelect={() => setView({ kind: "pickCap" })} />
          </Box>
        </Panel>
      </Box>
    );
  }

  // ---------- results ----------
  const { result } = view;
  const scoreOf = new Map(result.scores.map((s) => [s.model, s]));
  const cheapest = result.entries.filter((e) => !e.error).sort((a, b) => a.cost - b.cost)[0];
  const winnerModel = result.winner?.split("/").slice(1).join("/"); // OpenRouter slugs contain "/"
  return (
    <Box flexDirection="column">
      {notice ? <Box marginBottom={1}><StatusMessage variant="success">{notice}</StatusMessage></Box> : null}
      <Panel title={`Bake-off results — ${cap}`}>
      <Box flexDirection="column">
        <Text color={C.textSubtle}>{"model".padEnd(22)}{"score".padEnd(7)}{"cost".padEnd(11)}{"time".padEnd(7)}{cap === "code" ? "files" : "tok"}</Text>
        {result.entries.map((e) => {
          const key = `${e.provider}/${e.model}`;
          const sc = scoreOf.get(key);
          const win = key === result.winner;
          const onFront = result.pareto.includes(key);
          return (
            <Text key={key} color={win ? C.accent : e.error ? C.warn : C.text}>
              {(win ? "🏆 " : onFront ? " ★ " : "   ") + modelLabel(e.model)}
              {"  "}
              {(e.error ? "ERR" : sc ? `${sc.score}/10` : "—").padEnd(7)}
              {(e.error ? "—" : `$${e.cost.toFixed(4)}`).padEnd(11)}
              {(e.error ? "—" : `${(e.ms / 1000).toFixed(1)}s`).padEnd(7)}
              {e.error ? "" : String(cap === "code" ? e.files?.length ?? 0 : e.outputTokens)}
            </Text>
          );
        })}
      </Box>
      {result.winner ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={C.dim}>🏆 Best quality: {modelLabel(winnerModel ?? "")}  ·  💸 Cheapest: {cheapest ? modelLabel(cheapest.model) : "—"}  ·  ⚖ Best value: {result.bestValue ? modelLabel(result.bestValue.split("/").slice(1).join("/")) : "—"}  ({cap === "code" ? "tester" : "judge"}: {modelLabel(result.judge?.split("/").slice(1).join("/") ?? "")})</Text>
          <Text color={C.dim}>★ = on the quality/$ frontier (no model is both better and cheaper).</Text>
          {result.scores.sort((a, b) => b.score - a.score).map((s) => (
            <Text key={s.model} color={C.dim} wrap="truncate-end">  {s.score}/10 {modelLabel(s.model.split("/").slice(1).join("/") || s.model)} — {s.reason}</Text>
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
      </Panel>
    </Box>
  );
}
