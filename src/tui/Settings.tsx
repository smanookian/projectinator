// Settings — API keys, model-per-role assignments, preferences, web-login (soon).
// Self-contained: manages its own sub-navigation; calls onExit when done.

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Spinner, StatusMessage } from "@inkjs/ui";
import type { Capability, Provider, Tier } from "../types.js";
import { C, Panel, Menu as SelectInput, GroupedMenu, KeyHint, TextField as TextInput, Password, type MenuGroup } from "./components.js";
import { WebAccounts } from "./WebAccounts.js";
import { connectedProviders } from "../web/session.js";
import { estimateAccuracy } from "../estimate.js";
import { availableProviders, effectiveRoster, allModels, setRoleModel, PROVIDER_LABEL } from "./engine.js";
import { setKey, getPrefs, setPrefs, loadConfig, setPreferredProvider, getDefaultMode, setDefaultMode, getNotify, setNotify, getWebhookUrl, setWebhookUrl, getPreferredStack, setPreferredStack, ENV_VAR, type Prefs, type KeyedProvider } from "./config.js";
import { validateKey } from "./validate.js";
import { openRouterModels, refreshOpenRouterModels } from "../openrouter.js";
import { getLocalModels, setLocalModels, probeLocalServer, DEFAULT_LOCAL_URL } from "../local-models.js";
import { THEMES, resolveTheme, type Theme, type ThemeId } from "./theme.js";
import { useThemeCtx } from "./theme-context.js";

type Sub = "menu" | "keys" | "keyEntry" | "models" | "modelPick" | "orBrowse" | "orPick" | "prefs" | "provider" | "workflow" | "weblogin" | "accuracy" | "stack" | "webhook" | "local" | "localPick" | "theme";

/** Where Esc goes from each sub-screen (everything else falls back to the menu). */
const SUB_PARENT: Partial<Record<Sub, Sub>> = {
  keyEntry: "keys", modelPick: "models", orBrowse: "modelPick", orPick: "orBrowse", localPick: "local",
};

/** Human label for a stack value, so menu rows read "Ask" not "ask" (consistent with On/Off). */
const STACK_VALUE_LABEL: Record<string, string> = { ask: "Ask", vanilla: "Vanilla", react: "React", ai: "AI" };

export function Settings({ onExit }: { onExit: () => void }): React.ReactElement {
  const [sub, setSub] = useState<Sub>("menu");
  const [keyProvider, setKeyProvider] = useState<KeyedProvider>("anthropic");
  const [keyDraft, setKeyDraft] = useState("");
  const [checking, setChecking] = useState(false);
  const [keyError, setKeyError] = useState("");
  const [role, setRole] = useState<{ capability: Capability; tier: Tier; label: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [orQuery, setOrQuery] = useState(""); // OpenRouter model-browser filter
  const [hookDraft, setHookDraft] = useState(() => getWebhookUrl());
  const [localUrl, setLocalUrl] = useState(() => getLocalModels()?.baseUrl ?? DEFAULT_LOCAL_URL);
  const [localProbe, setLocalProbe] = useState<{ busy: boolean; found: string[]; error: string }>({ busy: false, found: [], error: "" });
  const [localChosen, setLocalChosen] = useState<Set<string>>(() => new Set(getLocalModels()?.models ?? []));
  const [, force] = useState(0);
  const refresh = () => force((n) => n + 1);
  const { id: themeId, theme: activeTheme, setTheme: setThemeCtx, iconMode, setIconMode: setIconModeCtx } = useThemeCtx();
  const [localEditing, setLocalEditing] = useState(false); // the Local-models URL field owns the keyboard

  // Esc backs out one level. App.tsx deliberately skips the settings phase in its own goBack
  // (so we don't double-fire), which means this is the ONLY Esc handler in here.
  useInput((_input, key) => {
    if (!key.escape) return;
    if (localEditing) return setLocalEditing(false);
    setNotice("");
    if (sub === "menu") return onExit();
    setSub(SUB_PARENT[sub] ?? "menu");
  });

  // ---------- menu ----------
  if (sub === "menu") {
    const groups: MenuGroup[] = [
      { title: "Models & providers", items: [
        { label: "API keys", value: "keys" },
        { label: "Preferred provider", value: "provider" },
        { label: "Model assignments", value: "models" },
        { label: "Estimate accuracy", value: "accuracy" },
        { label: `Local models: ${getLocalModels() ? `${getLocalModels()!.models.length} configured` : "none"}`, value: "local" },
      ] },
      { title: "Build defaults", items: [
        { label: "Default workflow", value: "workflow" },
        { label: `Default stack: ${STACK_VALUE_LABEL[getPreferredStack()] ?? getPreferredStack()}`, value: "stack" },
        { label: "Budget, speed & alerts", value: "prefs" },
        { label: `Notify on done: ${getNotify() ? "On" : "Off"}`, value: "notify" },
        { label: `Parallel code tasks (git worktrees): ${getPrefs().parallelCode ? "On" : "Off"}`, value: "parallelCode" },
        { label: `Webhook: ${getWebhookUrl() || "Off"}`, value: "webhook" },
      ] },
      { title: "Appearance", items: [
        { label: `Theme: ${activeTheme.label}`, value: "theme" },
        { label: `Icons: ${iconMode === "nerd" ? "Nerd Font" : "Default (no font)"}`, value: "icons" },
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
              } else if (i.value === "parallelCode") {
                const next = !getPrefs().parallelCode;
                setPrefs({ parallelCode: next });
                setNotice(next ? "Parallel code tasks on: independent code tasks build at once, each in its own git worktree, merged back per task. A conflict costs one serial re-run." : "Parallel code tasks off: code tasks run one at a time.");
              } else if (i.value === "icons") {
                const next = iconMode === "nerd" ? "ascii" : "nerd";
                setIconModeCtx(next);
                setNotice(next === "nerd" ? "Role icons: Nerd Font glyphs." : "Role icons: portable ASCII — use this if the glyphs render as boxes.");
              } else setSub(i.value as Sub);
            }}
          />
        </Panel>
      </Box>
    );
  }

  // ---------- local models (Ollama / LM Studio / vLLM) ----------
  if (sub === "local") {
    const cur = getLocalModels();
    // Exactly ONE input is live at a time: either the URL field or the menu. With both
    // mounted, Enter fired the field's submit AND the menu's select, so "Back" probed instead.
    const probe = (raw: string) => {
      const url = raw.trim();
      if (!/^https?:\/\//.test(url)) { setLocalProbe({ busy: false, found: [], error: "URL must start with http:// or https://" }); return; }
      setLocalProbe({ busy: true, found: [], error: "" });
      void probeLocalServer(url).then((r) => {
        if (!r.ok) { setLocalProbe({ busy: false, found: [], error: r.error }); return; }
        if (!r.models.length) { setLocalProbe({ busy: false, found: [], error: "The server is up but lists no models — pull one first (e.g. `ollama pull qwen2.5-coder:14b`)." }); return; }
        setLocalProbe({ busy: false, found: r.models, error: "" });
        setLocalChosen(new Set(cur?.models.filter((m) => r.models.includes(m)) ?? []));
        setSub("localPick");
      });
    };
    return (
      <Box flexDirection="column">
        <Panel title="Local models — Ollama, LM Studio, vLLM">
          <Text color={C.textMuted}>Any OpenAI-compatible server on this machine. Free, private, no key. Registered with Pi as</Text>
          <Text color={C.textMuted}>provider “local”. Small models are weak at the structured tool calls the PM/Tester rely on —</Text>
          <Text color={C.textMuted}>start with the Reviewer and Tester slots (Model assignments) and a ≥14B coder model.</Text>
          {cur ? <Text color={C.good}>{"\n"}✓ {cur.models.length} model{cur.models.length === 1 ? "" : "s"} at {cur.baseUrl}: {cur.models.join(", ")}</Text> : null}
          {localProbe.error ? <Box marginTop={1}><StatusMessage variant="error">{localProbe.error}</StatusMessage></Box> : null}
          <Box marginTop={1}>
            <Text color={C.accent}>Server URL: </Text>
            {localProbe.busy ? (
              <Box><Text color={C.dim}>{localUrl}  </Text><Spinner label="asking the server for its models…" /></Box>
            ) : localEditing ? (
              <TextInput value={localUrl} onChange={setLocalUrl} onSubmit={() => { setLocalEditing(false); probe(localUrl); }} />
            ) : (
              <Text color={C.text}>{localUrl}</Text>
            )}
          </Box>
          <Text color={C.textSubtle}>{"\n"}Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1 · vLLM: http://localhost:8000/v1</Text>
          {localProbe.busy || localEditing ? null : (
            <Box marginTop={1}>
              <SelectInput
                items={[
                  { label: `Connect to ${localUrl}`, value: "__connect" },
                  { label: "Change the URL", value: "__edit" },
                  ...(cur ? [{ label: "Remove local models", value: "__remove" }] : []),
                  { label: "Back", value: "__back" },
                ]}
                onSelect={(i) => {
                  if (i.value === "__connect") return probe(localUrl);
                  if (i.value === "__edit") return setLocalEditing(true);
                  if (i.value === "__remove") { setLocalModels({ baseUrl: cur!.baseUrl, models: [] }); setNotice("Local models removed."); refresh(); }
                  setSub("menu");
                }}
              />
            </Box>
          )}
          <Box marginTop={1}>
            <KeyHint hints={localEditing
              ? [{ keys: "Enter", label: "connect" }, { keys: "Esc", label: "cancel" }]
              : [{ keys: "↑↓", label: "pick" }, { keys: "Enter", label: "choose" }, { keys: "Esc", label: "back" }]} />
          </Box>
        </Panel>
      </Box>
    );
  }

  if (sub === "localPick") {
    const { found } = localProbe;
    return (
      <Box flexDirection="column">
        <Panel title={`Models at ${localUrl}`}>
          <Text color={C.textMuted}>Toggle the ones Projectinator may use, then Save. They'll appear under Model assignments.</Text>
          <Box marginTop={1}>
            <SelectInput
              items={[
                ...found.map((m) => ({ label: `${localChosen.has(m) ? "✓" : "·"}  ${m}`, value: `m:${m}` })),
                { label: `Save (${localChosen.size} selected)`, value: "__save" },
                { label: "Back", value: "__back" },
              ]}
              onSelect={(i) => {
                if (i.value.startsWith("m:")) {
                  const id = i.value.slice(2);
                  setLocalChosen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
                } else if (i.value === "__save") {
                  setLocalModels({ baseUrl: localUrl.trim(), models: [...localChosen] });
                  setNotice(localChosen.size ? `Local models saved: ${[...localChosen].join(", ")}. Assign them under Model assignments.` : "Local models removed.");
                  refresh();
                  setSub("menu");
                } else setSub("local");
              }}
            />
          </Box>
        </Panel>
      </Box>
    );
  }

  // ---------- API keys ----------
  if (sub === "keys") {
    const have = new Set(availableProviders());
    const providers: KeyedProvider[] = ["anthropic", "openai", "google", "openrouter"];
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
                  setKeyProvider(i.value as KeyedProvider);
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
                  if (lock === "openrouter") {
                    setOrQuery("");
                    void refreshOpenRouterModels().then(() => refresh()); // freshen catalog in the background
                    setSub("orBrowse");
                  } else setSub("modelPick");
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

  // ---------- OpenRouter model browser: filter the whole catalog by name ----------
  if ((sub === "orBrowse" || sub === "orPick") && role) {
    const all = openRouterModels();
    const q = orQuery.trim().toLowerCase();
    const matches = q ? all.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)) : all;
    const price = (m: (typeof all)[number]) => `$${m.cost.input}/$${m.cost.output}`;

    if (sub === "orBrowse") {
      return (
        <Box flexDirection="column">
          <Panel title={`OpenRouter model for ${role.label}`}>
            <Text color={C.textMuted}>Type to filter {all.length} models by name or slug — e.g. “kimi”, “deepseek”, “coder”.</Text>
            <Box marginTop={1}>
              <Text color={C.accent}>{"filter › "}</Text>
              <TextInput
                value={orQuery}
                onChange={setOrQuery}
                placeholder="kimi"
                onSubmit={() => {
                  if (!orQuery.trim()) { setSub("models"); return; }
                  if (matches.length) setSub("orPick");
                }}
              />
            </Box>
            <Box marginTop={1} flexDirection="column">
              <Text color={C.textSubtle}>{matches.length} match{matches.length === 1 ? "" : "es"}{matches.length ? " — Enter to choose:" : ""}</Text>
              {matches.slice(0, 6).map((m) => (
                <Text key={m.id} wrap="truncate-end"><Text color={C.textMuted}>{m.name}</Text>  <Text color={C.textSubtle}>{m.id}  {price(m)}</Text></Text>
              ))}
              {matches.length > 6 ? <Text color={C.textSubtle}>  …refine to narrow</Text> : null}
            </Box>
            <Box marginTop={1}><KeyHint hints={[{ keys: "Enter", label: "choose" }, { keys: "empty Enter", label: "back" }]} /></Box>
          </Panel>
        </Box>
      );
    }

    // orPick — select from the filtered matches
    return (
      <Box flexDirection="column">
        <Panel title={`Pick a model  ·  “${orQuery}”  (${matches.length})`}>
          <SelectInput
            limit={12}
            items={[
              ...matches.slice(0, 50).map((m) => ({ label: `${m.name}   ${m.id}   ${price(m)}`, value: m.id })),
              { label: "← Refine filter", value: "__refine" },
              { label: "Back", value: "__back" },
            ]}
            onSelect={(i) => {
              if (i.value === "__refine") { setSub("orBrowse"); return; }
              if (i.value === "__back") { setSub("models"); return; }
              setRoleModel(role.capability, role.tier, i.value);
              setNotice(`${role.label} → ${i.value}`);
              refresh();
              setSub("models");
            }}
          />
        </Panel>
      </Box>
    );
  }

  // ---------- preferred provider ----------
  if (sub === "provider") {
    const have = new Set(availableProviders());
    const current = loadConfig().preferredProvider;
    const providers: Provider[] = ["anthropic", "openai", "google", "openrouter"];
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

  // ---------- webhook ----------
  if (sub === "webhook") {
    return (
      <Box flexDirection="column">
        <Panel title="Webhook on build finished / halted">
          <Text color={C.textMuted}>POSTs a JSON summary (status, idea, cost, files, workspace) to this URL. Works with</Text>
          <Text color={C.textMuted}>Slack/Discord incoming webhooks, n8n, Zapier, or your own endpoint. Leave empty to turn off.</Text>
          <Box marginTop={1}>
            <Text color={C.accent}>URL: </Text>
            <TextInput
              value={hookDraft}
              onChange={setHookDraft}
              onSubmit={() => {
                const url = hookDraft.trim();
                if (url && !/^https?:\/\//.test(url)) { setNotice("Webhook must start with http:// or https://."); return; }
                setWebhookUrl(url);
                setNotice(url ? `Webhook set: ${url}` : "Webhook off.");
                setSub("menu");
              }}
            />
          </Box>
          <Box marginTop={1}><KeyHint hints={[{ keys: "Enter", label: "save" }, { keys: "Esc", label: "back" }]} /></Box>
        </Panel>
      </Box>
    );
  }

  // ---------- estimate accuracy (calibration vs baseline) ----------
  if (sub === "accuracy") {
    const rows = estimateAccuracy();
    return (
      <Box flexDirection="column">
        <Panel title="Estimate accuracy">
        <Text color={C.textMuted}>Measured output tokens vs the static baseline, per role/difficulty — and per model that</Text>
        <Text color={C.textMuted}>ran it (indented). Calibration replaces the baseline once a row has ≥2 samples (✓ live);</Text>
        <Text color={C.textMuted}>the router uses the model row when it exists.</Text>
        <Box marginTop={1} flexDirection="column">
          {rows.length === 0 ? (
            <Text color={C.dim}>No data yet — run some builds and this fills in.</Text>
          ) : (
            <>
              <Text color={C.dim}>{"role/diff · model".padEnd(34)}{"base".padEnd(8)}{"actual".padEnd(8)}{"Δ".padEnd(8)}{"n".padEnd(4)}live</Text>
              {rows.map((r) => {
                const delta = r.baseOutput > 0 ? Math.round(((r.actualOutput - r.baseOutput) / r.baseOutput) * 100) : 0;
                const label = r.model ? `  ↳ ${r.model}` : `${r.capability}/${r.difficulty}`;
                return (
                  <Text key={`${r.capability}/${r.difficulty}/${r.model ?? ""}`}>
                    <Text color={r.model ? C.dim : C.text}>{label.slice(0, 33).padEnd(34)}</Text>
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
          <Text color={C.textMuted}>“Ask each time” shows the picker; anything else skips it. Current: {STACK_VALUE_LABEL[current] ?? current}.</Text>
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

  // ---------- appearance / theme ----------
  if (sub === "theme") {
    return (
      <Box flexDirection="column">
        <Panel title="Appearance — theme">
          <Text color={C.textMuted}>Color theme for the whole app. Dark is the default cockpit; light resolves against a light terminal.</Text>
          <Box marginTop={1}>
            <SelectInput
              items={[
                ...(Object.values(THEMES) as Theme[]).map((t) => ({ label: `${t.label}${t.id === themeId ? "  ✓" : ""}`, value: t.id })),
                { label: "Back", value: "back" },
              ]}
              onSelect={(i) => {
                if (i.value === "back") setSub("menu");
                else {
                  setThemeCtx(i.value as ThemeId);
                  setNotice(`Theme: ${resolveTheme(i.value as ThemeId).label}.`);
                  setSub("menu");
                }
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
  initial: Prefs;
  onDone: (p: Prefs) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [cap, setCap] = useState(String(initial.budgetCapUSD));
  const [conc, setConc] = useState(String(initial.concurrency));
  const [pct, setPct] = useState(String(initial.budgetAlertPct));
  const [tmo, setTmo] = useState(String(initial.taskTimeoutMin));
  const [tcap, setTcap] = useState(String(initial.taskCostCapUSD));
  const [field, setField] = useState<"cap" | "conc" | "pct" | "tmo" | "tcap">("cap");

  const commit = () => {
    const b = Math.max(1, parseFloat(cap) || initial.budgetCapUSD);
    const c = Math.max(1, Math.floor(parseFloat(conc) || initial.concurrency));
    const p = Math.min(99, Math.max(1, Math.round(parseFloat(pct) || initial.budgetAlertPct)));
    // "0" is a valid value here (unlimited), so only a non-number falls back.
    const parse0 = (s: string, fallback: number) => { const n = parseFloat(s); return Number.isFinite(n) ? Math.max(0, n) : fallback; };
    onDone({
      budgetCapUSD: b,
      concurrency: c,
      budgetAlertPct: p,
      taskTimeoutMin: parse0(tmo, initial.taskTimeoutMin),
      taskCostCapUSD: parse0(tcap, initial.taskCostCapUSD),
      parallelCode: initial.parallelCode,
    });
  };

  return (
    <Box flexDirection="column">
      <Panel title="Budget, speed, alerts & task limits">
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
            <TextInput value={pct} onChange={setPct} onSubmit={() => setField("tmo")} />
          ) : (
            <Text>{pct}%</Text>
          )}
        </Box>
        <Box>
          <Box width={22}><Text color={field === "tmo" ? C.accent : C.text}>Task timeout (min)</Text></Box>
          {field === "tmo" ? (
            <TextInput value={tmo} onChange={setTmo} onSubmit={() => setField("tcap")} />
          ) : (
            <Text>{tmo === "0" ? "unlimited" : tmo}</Text>
          )}
        </Box>
        <Box>
          <Box width={22}><Text color={field === "tcap" ? C.accent : C.text}>Task cost cap (USD)</Text></Box>
          {field === "tcap" ? (
            <TextInput value={tcap} onChange={setTcap} onSubmit={commit} />
          ) : (
            <Text>{tcap === "0" ? "unlimited" : tcap}</Text>
          )}
        </Box>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text color={C.textSubtle}>Enter moves to the next field, then saves. A task over its limit is aborted and the build halts (resumable); 0 = unlimited.</Text>
        <KeyHint hints={[{ keys: "Enter", label: "next / save" }, { keys: "Ctrl+C", label: "cancel" }]} />
      </Box>
      </Panel>
    </Box>
  );
}
