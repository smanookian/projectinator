// The update dialogs, as in Musinator: the first-start question ("check once a day?") and the
// `U` window — what's new, Enter installs (a global npm install replaces itself; anything else
// shows the command to run), s skips that version, r restarts into the new one.

import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Spinner } from "@inkjs/ui";
import { C, Panel, useInputActive } from "./components.js";
import { detectInstall, installGlobal, isNewer, latestVersion, MANUAL, releaseNotes, skipVersion } from "../update.js";

export interface Release {
  version: string;
  notes: string[];
}

/** Ask npm for a newer version; its notes come from the CHANGELOG. null = up to date or offline. */
export async function findRelease(current: string): Promise<Release | null> {
  const latest = await latestVersion();
  if (!latest || !isNewer(latest, current)) return null;
  return { version: latest, notes: await releaseNotes(latest) };
}

export function UpdateAsk({ onAnswer }: { onAnswer: (yes: boolean) => void }): React.ReactElement {
  const active = useInputActive();
  useInput((input, key) => {
    if (input === "y" || key.return) onAnswer(true);
    else if (input === "n" || key.escape) onAnswer(false);
  }, { isActive: active });
  return (
    <Panel title="Check for updates once a day?">
      <Text color={C.text}>When it starts, Projectinator asks npm whether a new version is out.</Text>
      <Text color={C.text}>Nothing else is sent. Change it in Settings → Updates.</Text>
      <Box marginTop={1}><Text color={C.textMuted}>y yes · n no</Text></Box>
    </Panel>
  );
}

type State =
  | { kind: "checking" }
  | { kind: "latest" }
  | { kind: "offline" }
  | { kind: "ready"; rel: Release }
  | { kind: "manual"; rel: Release; why: string; cmd: string }
  | { kind: "installing"; rel: Release }
  | { kind: "done"; rel: Release }
  | { kind: "failed"; rel: Release; output: string };

export function UpdateDialog({
  current,
  known,
  onFound,
  onSkipped,
  onRestart,
}: {
  current: string;
  /** A release the daily check already found; otherwise the dialog checks now. */
  known: Release | null;
  onFound: (rel: Release | null) => void;
  onSkipped: () => void;
  onRestart: () => void;
}): React.ReactElement {
  const active = useInputActive();
  const [state, setState] = useState<State>({ kind: "checking" });

  useEffect(() => {
    let alive = true;
    const show = (rel: Release) => {
      const kind = detectInstall();
      setState(kind === "npm-global" ? { kind: "ready", rel } : { kind: "manual", rel, ...MANUAL[kind] });
    };
    if (known) show(known);
    else {
      void latestVersion().then(async (latest) => {
        if (!alive) return;
        if (!latest) return setState({ kind: "offline" });
        if (!isNewer(latest, current)) { onFound(null); return setState({ kind: "latest" }); }
        const rel = { version: latest, notes: await releaseNotes(latest) };
        if (!alive) return;
        onFound(rel);
        show(rel);
      });
    }
    return () => { alive = false; };
  }, []);

  useInput((input, key) => {
    if ((state.kind === "ready" || state.kind === "failed") && (key.return || input === "i")) {
      const rel = state.rel;
      setState({ kind: "installing", rel });
      // npm keeps going if the dialog closes; the result lands here if it's still open.
      void installGlobal(rel.version).then((r) => setState(r.ok ? { kind: "done", rel } : { kind: "failed", rel, output: r.output }));
    } else if ((state.kind === "ready" || state.kind === "manual") && input === "s") {
      skipVersion(state.rel.version);
      onSkipped();
    } else if (state.kind === "done" && (key.return || input === "r")) onRestart();
  }, { isActive: active });

  const rel = "rel" in state ? state.rel : null;
  return (
    <Panel title={rel ? `Projectinator v${rel.version} is out. You have v${current}.` : "Updates"}>
      {state.kind === "checking" ? <Spinner label="Asking npm for the newest version…" /> : null}
      {state.kind === "latest" ? <Text color={C.text}>{`You have the newest version (v${current}).`}</Text> : null}
      {state.kind === "offline" ? <Text color={C.warn}>Couldn't reach registry.npmjs.org. Try again later.</Text> : null}
      {rel ? (
        <Box flexDirection="column">
          {(rel.notes.length ? rel.notes.slice(0, 16) : ["(No notes for this version.)"]).map((l, i) => (
            <Text key={i} color={C.text} wrap="truncate-end">{l || " "}</Text>
          ))}
          {rel.notes.length > 16 ? <Text color={C.textMuted}>…</Text> : null}
        </Box>
      ) : null}
      <Box marginTop={1} flexDirection="column">
        {state.kind === "ready" ? <Text color={C.textMuted}>Enter install · s skip this version · Esc later</Text> : null}
        {state.kind === "manual" ? (
          <>
            <Text color={C.text}>{state.why} Run:</Text>
            <Text color={C.accent}>{`  ${state.cmd}`}</Text>
            <Text color={C.textMuted}>s skip this version · Esc close</Text>
          </>
        ) : null}
        {state.kind === "installing" ? <Spinner label="Installing with npm…" /> : null}
        {state.kind === "done" ? (
          <>
            <Text color={C.good}>{`Installed v${state.rel.version}. Your projects and keys are untouched.`}</Text>
            <Text color={C.textMuted}>r restart now · Esc later (the next start uses it)</Text>
          </>
        ) : null}
        {state.kind === "failed" ? (
          <>
            <Text color={C.bad}>npm failed — nothing changed. If it's a permissions error, fix your npm prefix.</Text>
            <Text color={C.textMuted} wrap="truncate-end">{state.output}</Text>
            <Text color={C.textMuted}>Enter try again · Esc close</Text>
          </>
        ) : null}
        {state.kind === "latest" || state.kind === "offline" ? <Text color={C.textMuted}>Esc close</Text> : null}
      </Box>
    </Panel>
  );
}
