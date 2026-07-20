// Settings — API keys, model-per-role assignments, preferences, web-login (soon).
// Self-contained: manages its own sub-navigation; calls onExit when done.

import React, { useState } from "react";
import { Box, Text } from "ink";
import { Spinner, StatusMessage } from "@inkjs/ui";
import type { Capability, Provider, Tier } from "../types.js";
import { C, Panel, Menu as SelectInput, GroupedMenu, KeyHint, TextField as TextInput, Password, type MenuGroup } from "./components.js";
import { WebAccounts } from "./WebAccounts.js";
import { connectedProviders } from "../web/session.js";
import { estimateAccuracy } from "../estimate.js";
import { availableProviders, effectiveRoster, allModels, setRoleModel, PROVIDER_LABEL } from "./engine.js";
import { setKey, getPrefs, setPrefs, loadConfig, setPreferredProvider, getDefaultMode, setDefaultMode, getNotify, setNotify, getPreferredStack, setPreferredStack, ENV_VAR } from "./config.js";
import { validateKey } from "./validate.js";

type Sub = "menu" | "keys" | "keyEntry" | "models" | "modelPick" | "prefs" | "provider" | "workflow" | "weblogin" | "accuracy" | "stack";

export function Settings({ onExit }: { onExit: () => void }): React.ReactElement {
  const [sub, setSub] = useState<Sub>("menu");
  const [keyProvider, setKeyProvider] = useState<Provider>("anthropic");
  const [keyDraft, setKeyDraft] = useState("");
  const [checking, setChecking] = useState(false);
  const [keyError, setKeyError] = useState("");
  const [role, setRole] = useState<{ capability: Capability; tier: Tier; label: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [, force] = useState(0);
  const refresh = () => force((n) => n + 1);

  // ---------- menu ----------
  if (sub === "menu") {
    const groups: MenuGroup[] = [
      { title: "Models & providers", items: [
        { label: "API keys", value: "keys" },
        { label: "Preferred provider", value: "provider" },
        { label: "Model assignments", value: "models" },
        { label: "Estimate accuracy", value: "accuracy" },
      ] },
      { title: "Build defaults", items: [
        { label: "Default workflow", value: "workflow" },
        { label: `Default stack: ${getPreferredStack()}`, value: "stack" },
        { label: "Budget, speed & alerts", value: "prefs" },
        { label: `Notify on done: ${getNotify() ? "On" : "Off"}`, value: "notify" },
      ] },
      // Web-login (browser automation / OAuth) is parked — vendors closed
      // third-party subscription auth in 2026. Hidden unless PROJECTINATOR_WEB=1.
      ...(process.env.PROJECTINATOR_WEB === "1"
        ? [{ title: "Experimental", items: [{ label: `Connect accounts${connectedProviders().length ? `  (${connectedProviders().length})` : ""}`, value: "weblogin" }] }]
        : []),
      { title: "", items: [{ label: "Back", value: "back" }] },
    ];
    return (
      <Box flexDirection="column">
        {notice ? <Box marginBottom={1}><StatusMessage variant="success">{notice}</StatusMessage></Box> : null}
        <Panel title="Settings">
          <GroupedMenu
            groups={groups}
            onSelect={(i) => {
              setNotice("");
              if (i.value === "back") onExit();
              else if (i.value === "notify") {
                const next = !getNotify();
                setNotify(next);
                setNotice(`Notifications ${next ? "on" : "off"}.`);
              } else setSub(i.value as Sub);
            }}
          />
        </Panel>
      </Box>
    );
  }

  // ---------- API keys ----------
  if (sub === "keys") {
    const have = new Set(availableProviders());
    const providers: Provider[] = ["anthropic", "openai", "google"];
    return (
      <Box flexDirection="column">
        <Panel title="API keys">
          <Text color={C.textMuted}>Select a provider to add or replace its key. Saved to ~/.projectinator (0600).</Text>
          <Box marginTop={1}>
            <SelectInput
              items={[
                ...providers.map((p) => ({
                  label: `${have.has(p) ? "✓" : "·"}  ${PROVIDER_LABEL[p]}  ${have.has(p) ? "(set)" : "(not set)"}`,
                  value: p,
                })),
                { label: "Back", value: "__back" },
              ]}
              onSelect={(i) => {
                if (i.value === "__back") setSub("menu");
                else {
                  setKeyProvider(i.value as Provider);
                  setKeyDraft("");
                  setKeyError("");
                  setChecking(false);
                  setSub("keyEntry");
                }
              }}
            />
          </Box>
        </Panel>
      </Box>
    );
  }

  if (sub === "keyEntry") {
    if (checking) {
      return (
        <Box flexDirection="column">
          <Panel title={`Enter key for ${PROVIDER_LABEL[keyProvider]}`}>
            <Spinner label={`Verifying key with ${PROVIDER_LABEL[keyProvider]}…`} />
          </Panel>
        </Box>
      );
    }
    return (
      <Box flexDirection="column">
        <Panel title={`Enter key for ${PROVIDER_LABEL[keyProvider]}`}>
        <Text color={C.textMuted}>Sets {ENV_VAR[keyProvider]}. Paste and press Enter — it's verified before saving. (hidden)</Text>
        {keyError ? <Box marginTop={1}><StatusMessage variant="error">{keyError}</StatusMessage></Box> : null}
        <Box marginTop={1}>
          <Password
            placeholder="paste your key…"
            onSubmit={(k) => {
              const trimmed = k.trim();
              if (!trimmed) {
                setSub("menu");
                return;
              }
              setKeyError("");
              setChecking(true);
              void validateKey(keyProvider, trimmed).then((res) => {
                setChecking(false);
                if (res.ok) {
                  setKey(keyProvider, trimmed);
                  setNotice(`Saved ${PROVIDER_LABEL[keyProvider]} key (verified ✓).`);
                  setSub("menu");
                } else {
                  setKeyError(res.error ?? "Key rejected.");
                }
              });
            }}
          />
        </Box>
        </Panel>
      </Box>
    );
  }

  // ---------- model assignments ----------
  if (sub === "models") {
    const rows = effectiveRoster();
    const lock = loadConfig().preferredProvider;
    return (
      <Box flexDirection="column">
        <Panel title="Model assignments">
          <Text color={C.textMuted}>Which model plays each role. {lock ? `Pinned to ${PROVIDER_LABEL[lock]} — pick from its models.` : "Saved as overrides."}</Text>
          <Box marginTop={1}>
            <SelectInput
              items={[
                ...rows.map((r) => ({
                  label: `${r.label.padEnd(16)} ${r.model ?? "—"}`,
                  value: `${r.capability}:${r.tier}`,
                })),
                { label: "Back", value: "__back" },
              ]}
              onSelect={(i) => {
                if (i.value === "__back") setSub("menu");
                else {
                  const [capability, tier] = i.value.split(":") as [Capability, Tier];
                  const r = rows.find((x) => x.capability === capability && x.tier === tier)!;
                  setRole({ capability, tier, label: r.label });
                  setSub("modelPick");
                }
              }}
            />
          </Box>
        </Panel>
      </Box>
    );
  }

  if (sub === "modelPick" && role) {
    const lock = loadConfig().preferredProvider;
    const models = lock ? allModels().filter((m) => m.provider === lock) : allModels();
    return (
      <Box flexDirection="column">
        <Panel title={`Pick a model for ${role.label}`}>
          {lock ? <Text color={C.textMuted}>Showing {PROVIDER_LABEL[lock]} models (you've pinned this provider).</Text> : null}
          <Box marginTop={lock ? 1 : 0}>
            <SelectInput
              limit={10}
              items={[
                ...models.map((m) => ({ label: `${m.name}  (${m.provider})`, value: m.id })),
                { label: "Back", value: "__back" },
              ]}
              onSelect={(i) => {
                if (i.value !== "__back") {
                  setRoleModel(role.capability, role.tier, i.value);
                  setNotice(`${role.label} → ${i.value}`);
                  refresh();
                }
                setSub("models");
              }}
            />
          </Box>
        </Panel>
      </Box>
    );
  }

  // ---------- preferred provider ----------
  if (sub === "provider") {
    const have = new Set(availableProviders());
    const current = loadConfig().preferredProvider;
    const providers: Provider[] = ["anthropic", "openai", "google"];
    return (
      <Box flexDirection="column">
        <Panel title="Preferred provider">
          <Text color={C.textMuted}>Pin one provider for every role, or Auto to use the best available. Current: {current ?? "Auto"}.</Text>
          <Box marginTop={1}>
            <SelectInput
              items={[
                { label: `Auto (best available)${!current ? "  ✓" : ""}`, value: "__auto" },
                ...providers.map((p) => ({
                  label: `${PROVIDER_LABEL[p]}${have.has(p) ? "" : " (no key)"}${current === p ? "  ✓" : ""}`,
                  value: p,
                })),
                { label: "Back", value: "__back" },
              ]}
              onSelect={(i) => {
                if (i.value === "__back") {
                  setSub("menu");
                  return;
                }
                const choice = i.value === "__auto" ? undefined : (i.value as Provider);
                setPreferredProvider(choice);
                setNotice(`Preferred provider: ${choice ?? "Auto"}.`);
                setSub("menu");
              }}
            />
          </Box>
        </Panel>
      </Box>
    );
  }

  // ---------- default workflow ----------
  if (sub === "workflow") {
    const current = getDefaultMode();
    return (
      <Box flexDirection="column">
        <Panel title="Default workflow for new builds">
          <Text color={C.textMuted}>Current: {current === "approval" ? "Approval-gated" : "Auto-run"}.</Text>
          <Box marginTop={1}>
            <SelectInput
              items={[
                { label: `Auto-run — confirm cost, then build${current === "auto" ? "  ✓" : ""}`, value: "auto" },
                { label: `Approval-gated — you approve the backlog first${current === "approval" ? "  ✓" : ""}`, value: "approval" },
                { label: "Back", value: "__back" },
              ]}
              onSelect={(i) => {
                if (i.value !== "__back") {
                  setDefaultMode(i.value as "auto" | "approval");
                  setNotice(`Default workflow: ${i.value === "approval" ? "Approval-gated" : "Auto-run"}.`);
                }
                setSub("menu");
              }}
            />
          </Box>
        </Panel>
      </Box>
    );
  }

  // ---------- preferences ----------
  if (sub === "prefs") {
    const prefs = getPrefs();
    return <PrefsEditor initial={prefs} onDone={(p) => { setPrefs(p); setNotice("Preferences saved."); setSub("menu"); }} onCancel={() => setSub("menu")} />;
  }

  // ---------- estimate accuracy (calibration vs baseline) ----------
  if (sub === "accuracy") {
    const rows = estimateAccuracy();
    return (
      <Box flexDirection="column">
        <Panel title="Estimate accuracy">
        <Text color={C.textMuted}>Measured output tokens vs the static baseline, per role/difficulty. Self-calibration</Text>
        <Text color={C.textMuted}>replaces the baseline once a bucket has ≥2 samples (✓ active).</Text>
        <Box marginTop={1} flexDirection="column">
          {rows.length === 0 ? (
            <Text color={C.dim}>No data yet — run some builds and this fills in.</Text>
          ) : (
            <>
              <Text color={C.dim}>{"role/diff".padEnd(16)}{"base".padEnd(8)}{"actual".padEnd(8)}{"Δ".padEnd(8)}{"n".padEnd(4)}live</Text>
              {rows.map((r) => {
                const delta = r.baseOutput > 0 ? Math.round(((r.actualOutput - r.baseOutput) / r.baseOutput) * 100) : 0;
                return (
                  <Text key={`${r.capability}/${r.difficulty}`}>
                    {`${r.capability}/${r.difficulty}`.padEnd(16)}
                    {String(r.baseOutput).padEnd(8)}
                    <Text color={C.accent}>{String(r.actualOutput).padEnd(8)}</Text>
                    <Text color={Math.abs(delta) > 40 ? C.warn : C.dim}>{`${delta >= 0 ? "+" : ""}${delta}%`.padEnd(8)}</Text>
                    {String(r.n).padEnd(4)}
                    {r.active ? <Text color={C.good}>✓</Text> : <Text color={C.dim}>·</Text>}
                  </Text>
                );
              })}
            </>
          )}
        </Box>
        <Box marginTop={1}>
          <SelectInput items={[{ label: "Back", value: "back" }]} onSelect={() => setSub("menu")} />
        </Box>
        </Panel>
      </Box>
    );
  }

  // ---------- default stack ----------
  if (sub === "stack") {
    const current = getPreferredStack();
    return (
      <Box flexDirection="column">
        <Panel title="Default stack for new web builds">
          <Text color={C.textMuted}>“Ask each time” shows the picker; anything else skips it. Current: {current}.</Text>
          <Box marginTop={1}>
            <SelectInput
              items={[
                { label: `Ask each time${current === "ask" ? "  ✓" : ""}`, value: "ask" },
                { label: `Vanilla HTML/CSS/JS${current === "vanilla" ? "  ✓" : ""}`, value: "vanilla" },
                { label: `React (CDN, no build)${current === "react" ? "  ✓" : ""}`, value: "react" },
                { label: `Let the AI decide${current === "ai" ? "  ✓" : ""}`, value: "ai" },
                { label: "Back", value: "__back" },
              ]}
              onSelect={(i) => {
                if (i.value !== "__back") {
                  setPreferredStack(i.value as "ask" | "vanilla" | "react" | "ai");
                  setNotice(`Default stack: ${i.value}.`);
                }
                setSub("menu");
              }}
            />
          </Box>
        </Panel>
      </Box>
    );
  }

  // ---------- connect accounts (web subscriptions) ----------
  if (sub === "weblogin") {
    return <WebAccounts onExit={() => setSub("menu")} />;
  }

  return <Text>…</Text>;
}

function PrefsEditor({
  initial,
  onDone,
  onCancel,
}: {
  initial: { budgetCapUSD: number; concurrency: number; budgetAlertPct: number };
  onDone: (p: { budgetCapUSD: number; concurrency: number; budgetAlertPct: number }) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [cap, setCap] = useState(String(initial.budgetCapUSD));
  const [conc, setConc] = useState(String(initial.concurrency));
  const [pct, setPct] = useState(String(initial.budgetAlertPct));
  const [field, setField] = useState<"cap" | "conc" | "pct">("cap");

  const commit = () => {
    const b = Math.max(1, parseFloat(cap) || initial.budgetCapUSD);
    const c = Math.max(1, Math.floor(parseFloat(conc) || initial.concurrency));
    const p = Math.min(99, Math.max(1, Math.round(parseFloat(pct) || initial.budgetAlertPct)));
    onDone({ budgetCapUSD: b, concurrency: c, budgetAlertPct: p });
  };

  return (
    <Box flexDirection="column">
      <Panel title="Budget, speed & alerts">
      <Box flexDirection="column">
        <Box>
          <Box width={22}><Text color={field === "cap" ? C.accent : C.text}>Budget cap (USD)</Text></Box>
          {field === "cap" ? (
            <TextInput value={cap} onChange={setCap} onSubmit={() => setField("conc")} />
          ) : (
            <Text>{cap}</Text>
          )}
        </Box>
        <Box>
          <Box width={22}><Text color={field === "conc" ? C.accent : C.text}>Tasks at once</Text></Box>
          {field === "conc" ? (
            <TextInput
              value={conc}
              onChange={setConc}
              onSubmit={() => setField("pct")}
            />
          ) : (
            <Text>{conc}</Text>
          )}
        </Box>
        <Box>
          <Box width={22}><Text color={field === "pct" ? C.accent : C.text}>Alert at % of cap</Text></Box>
          {field === "pct" ? (
            <TextInput value={pct} onChange={setPct} onSubmit={commit} />
          ) : (
            <Text>{pct}%</Text>
          )}
        </Box>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text color={C.textSubtle}>Enter moves to the next field, then saves.</Text>
        <KeyHint hints={[{ keys: "Enter", label: "next / save" }, { keys: "Ctrl+C", label: "cancel" }]} />
      </Box>
      </Panel>
    </Box>
  );
}
