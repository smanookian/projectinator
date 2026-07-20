// Connect accounts — sign in to your paid Claude / ChatGPT / Gemini web
// subscriptions once; the app then drives one background browser per provider to
// get ~free completions. Brittle + against provider ToS (account-ban risk).

import React, { useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";
import { Spinner, StatusMessage } from "@inkjs/ui";
import { C, Panel, Menu as SelectInput } from "./components.js";
import {
  PROVIDERS,
  isConnected,
  disconnect,
  webLoginBegin,
  webComplete,
  type WebProvider,
} from "../web/session.js";

const ORDER: WebProvider[] = ["claude", "chatgpt", "gemini"];

type View =
  | { kind: "list" }
  | { kind: "actions"; provider: WebProvider }
  | { kind: "connecting"; provider: WebProvider }
  | { kind: "testing"; provider: WebProvider }
  | { kind: "result"; provider: WebProvider; ok: boolean; text: string };

export function WebAccounts({ onExit }: { onExit: () => void }): React.ReactElement {
  const [view, setView] = useState<View>({ kind: "list" });
  const [notice, setNotice] = useState("");
  const [, force] = useState(0);
  const refresh = () => force((n) => n + 1);
  // Handle for the open login browser (webLoginBegin), kept across renders.
  const loginRef = useRef<{ finish: () => Promise<void>; cancel: () => Promise<void> } | null>(null);
  const openingRef = useRef(false);

  // ---- open the login window when we enter "connecting" ----
  useEffect(() => {
    if (view.kind !== "connecting" || openingRef.current) return;
    openingRef.current = true;
    let alive = true;
    void webLoginBegin(view.provider)
      .then((h) => {
        // If the user already left "connecting", close the just-opened browser
        // instead of orphaning it with no UI path to finish/cancel.
        if (!alive) { void h.cancel(); return; }
        loginRef.current = h;
      })
      .catch(() => {
        if (!alive) return;
        setNotice("Could not open the browser.");
        setView({ kind: "list" });
      })
      .finally(() => { openingRef.current = false; });
    return () => { alive = false; };
  }, [view]);

  // ---- run a test completion when we enter "testing" ----
  useEffect(() => {
    if (view.kind !== "testing") return;
    const provider = view.provider;
    let alive = true;
    void webComplete(provider, "Reply with exactly one word: hello")
      .then((text) => { if (alive) setView({ kind: "result", provider, ok: true, text: text.trim() || "(empty)" }); })
      .catch((e) => { if (alive) setView({ kind: "result", provider, ok: false, text: e instanceof Error ? e.message : String(e) }); });
    return () => { alive = false; };
  }, [view]);

  // ---------- list ----------
  if (view.kind === "list") {
    return (
      <Box flexDirection="column">
        {notice ? <Box marginBottom={1}><StatusMessage variant="success">{notice}</StatusMessage></Box> : null}
        <Panel title="Connect accounts">
          <Box flexDirection="column" marginBottom={1}>
            <Text color={C.dim}>Sign in once to your paid web subscriptions. The app reuses one</Text>
            <Text color={C.dim}>background browser per provider — no window pops up per task.</Text>
            <Text color={C.warn}>Uses the web UI (not the API): fragile, and against provider ToS.</Text>
          </Box>
          <SelectInput
            items={[
              ...ORDER.map((p) => ({
                label: `${isConnected(p) ? "🟢" : "⚪"}  ${PROVIDERS[p].label}  ${isConnected(p) ? "(connected)" : "(not connected)"}`,
                value: p,
              })),
              { label: "Back", value: "__back" },
            ]}
            onSelect={(i) => {
              setNotice("");
              if (i.value === "__back") onExit();
              else setView({ kind: "actions", provider: i.value as WebProvider });
            }}
          />
        </Panel>
      </Box>
    );
  }

  // ---------- per-provider actions ----------
  if (view.kind === "actions") {
    const p = view.provider;
    const connected = isConnected(p);
    return (
      <Box flexDirection="column">
        <Text bold>{PROVIDERS[p].label}</Text>
        <Text color={C.dim}>{connected ? "Connected. You can test or disconnect it." : "Not connected yet."}</Text>
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: connected ? "Reconnect (open login again)" : "Connect (open login window)", value: "connect" },
              ...(connected ? [{ label: "Test — send a quick 'hello'", value: "test" }] : []),
              ...(connected ? [{ label: "Disconnect (log out, wipe session)", value: "disconnect" }] : []),
              { label: "Back", value: "__back" },
            ]}
            onSelect={(i) => {
              if (i.value === "__back") setView({ kind: "list" });
              else if (i.value === "connect") setView({ kind: "connecting", provider: p });
              else if (i.value === "test") setView({ kind: "testing", provider: p });
              else if (i.value === "disconnect") {
                disconnect(p);
                setNotice(`Disconnected ${PROVIDERS[p].label}.`);
                refresh();
                setView({ kind: "list" });
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  // ---------- connecting (login window open) ----------
  if (view.kind === "connecting") {
    const p = view.provider;
    return (
      <Box flexDirection="column">
        <Text bold>Connecting {PROVIDERS[p].label}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>A browser window opened. In it:</Text>
          <Text color={C.dim}>  1. Log in to your {PROVIDERS[p].label} account (solve any captcha).</Text>
          <Text color={C.dim}>  2. Wait until the chat screen loads.</Text>
          <Text color={C.dim}>  3. Come back here and choose “I'm logged in”.</Text>
        </Box>
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: "I'm logged in — save the session", value: "done" },
              { label: "Cancel", value: "cancel" },
            ]}
            onSelect={(i) => {
              const h = loginRef.current;
              loginRef.current = null;
              if (i.value === "done") {
                void (h?.finish() ?? Promise.resolve()).then(() => {
                  setNotice(`Connected ${PROVIDERS[p].label}.`);
                  refresh();
                  setView({ kind: "list" });
                });
              } else {
                void (h?.cancel() ?? Promise.resolve()).then(() => setView({ kind: "list" }));
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  // ---------- testing ----------
  if (view.kind === "testing") {
    return (
      <Box flexDirection="column">
        <Text bold>Testing {PROVIDERS[view.provider].label}</Text>
        <Spinner label="Sending a prompt through your web session… (first run launches the browser)" />
      </Box>
    );
  }

  // ---------- result ----------
  if (view.kind === "result") {
    const p = view.provider;
    return (
      <Box flexDirection="column">
        <Text bold>{PROVIDERS[p].label} — test {view.ok ? "passed" : "failed"}</Text>
        <Box marginTop={1}>
          {view.ok
            ? <StatusMessage variant="success">Reply: {view.text}</StatusMessage>
            : <StatusMessage variant="error">{view.text}</StatusMessage>}
        </Box>
        <Box marginTop={1}>
          <SelectInput items={[{ label: "Back", value: "back" }]} onSelect={() => setView({ kind: "list" })} />
        </Box>
      </Box>
    );
  }

  return <Text>…</Text>;
}
