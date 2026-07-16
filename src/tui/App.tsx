// Projectinator TUI — the whole flow: setup -> idea -> plan -> build -> done.
// Dead simple: type what you want, confirm the cost, watch it build.

import React, { useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Spinner, StatusMessage, Badge } from "@inkjs/ui";
import type { Provider } from "../types.js";
import type { OrchestratorEvent } from "../orchestrator.js";
import { C, Header, BudgetBar, Panel, Menu as SelectInput, TextField as TextInput, type TaskView } from "./components.js";
import { Kanban, type BoardTask } from "./Kanban.js";
import { BoardEditor } from "./BoardEditor.js";
import { Team, Standup, ListView } from "./panels.js";
import { EditableBoard } from "./EditableBoard.js";
import { Settings } from "./Settings.js";
import { TEMPLATES } from "./templates.js";
import { getPrefs, getDefaultMode, getNotify, type WorkflowMode } from "./config.js";
import { notifyBuildDone } from "./notify.js";
import {
  availableProviders,
  chooseRegistry,
  planBuild,
  startBuild,
  estimateTasks,
  listProjects,
  openInBrowser,
  mainFileOf,
  addAsset,
  renameProject,
  duplicateProject,
  deleteProject,
  saveProjectTasks,
  exportProject,
  exportJira,
  exportTrello,
  breakdownEpic,
  modelLabel,
  PROVIDER_LABEL,
  type PlanResult,
  type ProjectInfo,
} from "./engine.js";
import { deploy, DEPLOY_META, type DeployTarget } from "./deploy.js";
import type { Task, TaskOutcome } from "../types.js";

type Phase =
  | "setup" | "home" | "settings" | "projects" | "projectActions" | "addAsset" | "rename" | "confirmDelete" | "filterEpic" | "editBoard" | "templates" | "exportMenu" | "deployMenu" | "deploying"
  | "idea" | "change" | "planning" | "plan" | "board" | "building" | "done" | "error";

export default function App(): React.ReactElement {
  const { exit } = useApp();
  const [phase, setPhase] = useState<Phase>("setup");
  const [providers, setProviders] = useState<Provider[]>(() => availableProviders());
  const [scope, setScope] = useState<"full" | "change">("full");
  const [mode, setMode] = useState<WorkflowMode>(() => getDefaultMode());
  const [idea, setIdea] = useState("");
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [error, setError] = useState<string>("");

  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [spent, setSpent] = useState(0);
  const [gate, setGate] = useState<{ resolve: (d: "continue" | "stop") => void } | null>(null);
  const [buildResult, setBuildResult] = useState<{ halted: boolean; files: string[]; workspace: string } | null>(null);

  // Existing-project context (open/resume/make-changes).
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selected, setSelected] = useState<ProjectInfo | null>(null);
  const [targetWorkspace, setTargetWorkspace] = useState<string | undefined>(undefined);
  const [seed, setSeed] = useState<TaskOutcome[] | undefined>(undefined);
  const [assetPath, setAssetPath] = useState("");
  const [assetMsg, setAssetMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [assetReturn, setAssetReturn] = useState<Phase>("projectActions");
  const [renameDraft, setRenameDraft] = useState("");
  const [viewMode, setViewMode] = useState<"board" | "list">("board");
  const [epicFilter, setEpicFilter] = useState<string | null>(null);
  const [flash, setFlash] = useState<string>("");
  const [deployState, setDeployState] = useState<{
    target: DeployTarget;
    status: "running" | "done" | "error";
    url?: string;
    error?: string;
    log: string[];
  } | null>(null);

  // Reload the projects list and re-point `selected` at the given dir (after a mutation).
  const reselect = (dir: string | null) => {
    const list = listProjects();
    setProjects(list);
    setSelected(dir ? list.find((p) => p.dir === dir) ?? null : null);
    return list;
  };

  const resetBuildContext = () => {
    setIdea("");
    setPlan(null);
    setTasks([]);
    setSpent(0);
    setBuildResult(null);
    setTargetWorkspace(undefined);
    setSeed(undefined);
    setSelected(null);
    setMode(getDefaultMode());
    setGate(null);
  };

  // Esc goes back one screen. Phases with their own Esc handling (board editors,
  // settings) are left out so we don't double-fire.
  const goBack = () => {
    switch (phase) {
      case "idea": resetBuildContext(); return setPhase("home");
      case "templates": return setPhase("home");
      case "change": return setPhase(selected ? "projectActions" : buildResult ? "done" : "home");
      case "rename": return setPhase("projectActions");
      case "addAsset": return setPhase(assetReturn);
      case "plan": return setPhase("idea");
      case "exportMenu": return setPhase("projectActions");
      case "deployMenu": return setPhase("projectActions");
      case "filterEpic": return setPhase("projectActions");
      case "projectActions": return setPhase("projects");
      case "projects": return setPhase("home");
      case "home": return setPhase("setup");
      case "done": resetBuildContext(); return setPhase("home");
      case "error": return setPhase("home");
    }
  };

  // global quit (not while typing an idea/change)
  const typing = phase === "idea" || phase === "change" || phase === "addAsset" || phase === "rename";
  useInput((input, key) => {
    if (key.ctrl && input === "c") return exit();
    if (input === "q" && !typing) return exit();
    if (key.escape) goBack();
  });

  // ---- planning effect ----
  useEffect(() => {
    if (phase !== "planning") return;
    let alive = true;
    planBuild(idea, providers, scope, targetWorkspace)
      .then((p) => {
        if (!alive) return;
        setPlan(p);
        setTasks(p.tasks.map((t) => ({ id: t.id, capability: t.capability, status: "pending", title: t.title })));
        setPhase("plan");
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      });
    return () => {
      alive = false;
    };
  }, [phase, idea, providers, scope, targetWorkspace]);

  // ---- building effect ----
  useEffect(() => {
    if (phase !== "building" || !plan) return;
    const onEvent = (e: OrchestratorEvent) => {
      if (e.type === "task_start") {
        setTasks((ts) => ts.map((t) => (t.id === e.task.id ? { ...t, status: "running", model: e.modelId } : t)));
      } else if (e.type === "task_done") {
        setSpent(e.runningTotal);
        setTasks((ts) =>
          ts.map((t) =>
            t.id === e.outcome.taskId
              ? {
                  ...t,
                  status: "done",
                  cost: (t.cost ?? 0) + e.outcome.cost,
                  verdict: e.outcome.verdict ? (e.outcome.verdict.passed ? "PASS" : "FAIL") : t.verdict,
                }
              : t,
          ),
        );
      } else if (e.type === "task_skipped") {
        setTasks((ts) => ts.map((t) => (t.id === e.taskId ? { ...t, status: "skipped" } : t)));
      } else if (e.type === "test_failed") {
        setTasks((ts) => ts.map((t) => (t.id === e.taskId ? { ...t, status: "failed", verdict: "FAIL" } : t)));
      } else if (e.type === "retry_dev") {
        setTasks((ts) => ts.map((t) => (t.id === e.taskId ? { ...t, status: "running" } : t)));
      }
    };

    const prefs = getPrefs();
    // In approval mode, pause once before development starts (design → dev gate).
    const onGate =
      mode === "approval"
        ? () => new Promise<"continue" | "stop">((resolve) => setGate({ resolve }))
        : undefined;
    const handle = startBuild(idea, plan, {
      concurrency: prefs.concurrency,
      budgetCapUSD: prefs.budgetCapUSD,
      onEvent,
      workspace: targetWorkspace,
      seedOutcomes: seed,
      mode,
      onGate,
    });
    let alive = true;
    handle.promise
      .then((r) => {
        if (!alive) return;
        setSpent(r.totalCost);
        setBuildResult({ halted: r.halted, files: r.files, workspace: handle.workspace });
        setPhase("done");
        if (getNotify()) {
          notifyBuildDone(
            "Projectinator",
            `Build ${r.halted ? "halted" : "complete"} · $${r.totalCost.toFixed(2)}${r.files.length ? ` · ${r.files.length} file${r.files.length === 1 ? "" : "s"}` : ""}`,
          );
        }
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      });
    return () => {
      alive = false;
    };
  }, [phase, plan, idea]);

  // ================= screens =================

  if (phase === "setup") {
    const ready = providers.length > 0;
    const mode = chooseRegistry(providers).lock
      ? `locked to ${PROVIDER_LABEL[providers[0]!]}`
      : "best model per role";
    return (
      <Box flexDirection="column">
        <Header />
        {ready ? (
          <>
            <Text color={C.good} bold>✓ Ready.</Text>
            <Box marginTop={1} gap={1} flexWrap="wrap">
              {providers.map((p) => (
                <Badge key={p} color="green">{PROVIDER_LABEL[p]}</Badge>
              ))}
            </Box>
            <Text color={C.dim}>{"\n"}Routing: {mode}.</Text>
            <Box marginTop={1}>
              <SelectInput
                items={[
                  { label: "🟢 Start", value: "go" },
                  { label: "🔧 Settings", value: "settings" },
                  { label: "🚪 Quit", value: "quit" },
                ]}
                onSelect={(i) => (i.value === "go" ? setPhase("home") : i.value === "settings" ? setPhase("settings") : exit())}
              />
            </Box>
          </>
        ) : (
          <>
            <Text color={C.bad}>No API key yet.</Text>
            <Box marginTop={1} flexDirection="column">
              <Text color={C.dim}>Add one right here in Settings (no file editing needed).</Text>
            </Box>
            <Box marginTop={1}>
              <SelectInput
                items={[{ label: "🔧 Settings — add a key", value: "settings" }, { label: "🚪 Quit", value: "quit" }]}
                onSelect={(i) => (i.value === "settings" ? setPhase("settings") : exit())}
              />
            </Box>
          </>
        )}
      </Box>
    );
  }

  if (phase === "home") {
    const projs = listProjects();
    const items = [
      { label: "🆕 New build", value: "new" },
      { label: "📄 Start from a template", value: "templates" },
      ...(projs.length ? [{ label: `📂 Open a project (${projs.length})`, value: "open" }] : []),
      { label: "🔧 Settings", value: "settings" },
      { label: "🚪 Quit", value: "quit" },
    ];
    return (
      <Box flexDirection="column">
        <Header />
        <Panel title="What would you like to do?">
          <SelectInput
            items={items}
            onSelect={(i) => {
              if (i.value === "new") {
                resetBuildContext();
                setScope("full");
                setPhase("idea");
              } else if (i.value === "templates") {
                setPhase("templates");
              } else if (i.value === "open") {
                setProjects(projs);
                setPhase("projects");
              } else if (i.value === "settings") {
                setPhase("settings");
              } else exit();
            }}
          />
        </Panel>
      </Box>
    );
  }

  if (phase === "settings") {
    return (
      <Box flexDirection="column">
        <Header />
        <Settings
          onExit={() => {
            const next = availableProviders();
            setProviders(next);
            setPhase(next.length ? "home" : "setup");
          }}
        />
      </Box>
    );
  }

  if (phase === "projects") {
    const mark = (s: ProjectInfo["status"]) => (s === "complete" ? "✓" : s === "halted" ? "⚠" : "·");
    const items = [
      ...projects.map((p) => ({
        label: `${mark(p.status)}  ${p.idea.slice(0, 46)}${p.idea.length > 46 ? "…" : ""}   $${p.totalCost.toFixed(2)}`,
        value: p.slug,
      })),
      { label: "🔙 Back", value: "__back" },
    ];
    return (
      <Box flexDirection="column">
        <Header />
        <Text bold>Your projects <Text color={C.dim}>(newest first)</Text></Text>
        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(i) => {
              if (i.value === "__back") setPhase("home");
              else {
                setSelected(projects.find((p) => p.slug === i.value) ?? null);
                setPhase("projectActions");
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase === "projectActions" && selected) {
    const canResume = selected.status === "halted";
    const doneIds = new Set(selected.state.outcomes.map((o) => o.taskId));
    const costById = new Map<string, number>();
    const modelById = new Map<string, string>();
    for (const o of selected.state.outcomes) {
      costById.set(o.taskId, (costById.get(o.taskId) ?? 0) + o.cost);
      modelById.set(o.taskId, o.modelId);
    }
    const allBoard: BoardTask[] = selected.state.tasks.map((t) => ({
      id: t.id,
      capability: t.capability,
      title: t.title,
      epic: t.epic,
      dependsOn: t.dependsOn,
      status: doneIds.has(t.id) ? "done" : "pending",
      cost: costById.get(t.id),
      assignee: modelById.has(t.id) ? modelLabel(modelById.get(t.id)!) : undefined,
    }));
    const board = epicFilter ? allBoard.filter((t) => (t.epic || "General") === epicFilter) : allBoard;
    const epics = [...new Set(allBoard.map((t) => t.epic || "General"))];
    const items = [
      { label: "📋 Edit board", value: "editBoard" },
      { label: "📤 Export (Markdown, CSV, Jira, Trello)", value: "export" },
      { label: "🚀 Deploy (Cloudflare, Vercel, Netlify)", value: "deploy" },
      { label: `🔀 View: ${viewMode === "board" ? "Board → List" : "List → Board"}`, value: "view" },
      ...(epics.length > 1 ? [{ label: `🔎 Filter: ${epicFilter ?? "All epics"}`, value: "filter" }] : []),
      { label: "🌐 Open in browser", value: "open" },
      ...(canResume ? [{ label: "⏩ Resume build", value: "resume" }] : []),
      { label: "📝 Make changes", value: "change" },
      { label: "📎 Add a file / image", value: "asset" },
      { label: "📛 Rename", value: "rename" },
      { label: "📑 Duplicate", value: "duplicate" },
      { label: "❌ Delete", value: "delete" },
      { label: "🔙 Back", value: "back" },
    ];
    return (
      <Box flexDirection="column">
        <Header />
        <Text bold wrap="truncate-end">{selected.idea}</Text>
        {flash ? <Box marginTop={1}><StatusMessage variant="success">{flash}</StatusMessage></Box> : null}
        <Box marginTop={1}><Standup tasks={allBoard} spent={selected.totalCost} /></Box>
        <Box marginTop={1}><Team /></Box>
        {board.length > 0 ? (
          <Box marginTop={1}>
            <Panel title={`${viewMode === "list" ? "List" : "Board"}${epicFilter ? ` · ${epicFilter}` : ""}`}>
              {viewMode === "list" ? <ListView tasks={board} /> : <Kanban tasks={board} />}
            </Panel>
          </Box>
        ) : null}
        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(i) => {
              if (i.value !== "export") setFlash("");
              if (i.value === "editBoard") setPhase("editBoard");
              else if (i.value === "export") { setFlash(""); setPhase("exportMenu"); }
              else if (i.value === "deploy") { setFlash(""); setPhase("deployMenu"); }
              else if (i.value === "view") setViewMode((v) => (v === "board" ? "list" : "board"));
              else if (i.value === "filter") setPhase("filterEpic");
              else if (i.value === "open") openInBrowser(mainFileOf(selected.dir));
              else if (i.value === "back") setPhase("projects");
              else if (i.value === "rename") {
                setRenameDraft(selected.idea);
                setPhase("rename");
              } else if (i.value === "duplicate") {
                const newDir = duplicateProject(selected.dir);
                reselect(newDir);
                setPhase("projectActions");
              } else if (i.value === "delete") {
                setPhase("confirmDelete");
              } else if (i.value === "asset") {
                setTargetWorkspace(selected.dir);
                setAssetPath("");
                setAssetMsg(null);
                setAssetReturn("projectActions");
                setPhase("addAsset");
              } else if (i.value === "change") {
                setTargetWorkspace(selected.dir);
                setSeed(undefined);
                setIdea("");
                setScope("change");
                setPhase("change");
              } else if (i.value === "resume") {
                const { registry, lock } = chooseRegistry(providers);
                const done = new Set(selected.state.outcomes.map((o) => o.taskId));
                setPlan({
                  tasks: selected.state.tasks,
                  provider: lock ?? providers[0]!,
                  modelId: "",
                  estCost: estimateTasks(selected.state.tasks, registry).total,
                  registry,
                  lock,
                });
                setTasks(
                  selected.state.tasks.map((t) => ({
                    id: t.id, capability: t.capability, title: t.title,
                    status: done.has(t.id) ? "done" : "pending",
                  })),
                );
                setSpent(selected.state.totalCost);
                setTargetWorkspace(selected.dir);
                setSeed(selected.state.outcomes);
                setIdea(selected.idea);
                setPhase("building");
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase === "editBoard" && selected) {
    const doneIds = new Set(selected.state.outcomes.map((o) => o.taskId));
    return (
      <Box flexDirection="column">
        <Header />
        <EditableBoard
          tasks={selected.state.tasks}
          doneIds={doneIds}
          onSave={(t) => {
            saveProjectTasks(selected.dir, t);
            reselect(selected.dir);
            setPhase("projectActions");
          }}
          onCancel={() => setPhase("projectActions")}
        />
      </Box>
    );
  }

  if (phase === "exportMenu" && selected) {
    const dir = selected.dir;
    const run = (fn: () => string | string[], done: () => void) => {
      try {
        const out = fn();
        const paths = Array.isArray(out) ? out : [out];
        reselect(dir);
        setFlash(`Exported → ${paths.map((p) => p.split("/").pop()).join(", ")}  (in the project folder)`);
      } catch (e) {
        setFlash(e instanceof Error ? e.message : "Export failed.");
      }
      done();
    };
    return (
      <Box flexDirection="column">
        <Header />
        <Text bold>Export backlog</Text>
        <Text color={C.dim}>Writes files into the project folder. Import them into your tool of choice.</Text>
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: "📝 Markdown + CSV (readable + spreadsheet)", value: "md" },
              { label: "🟦 Jira CSV (Jira → External System Import → CSV)", value: "jira" },
              { label: "🟩 Trello CSV (Trello CSV-import Power-Up)", value: "trello" },
              { label: "📦 All formats", value: "all" },
              { label: "🔙 Back", value: "back" },
            ]}
            onSelect={(i) => {
              const back = () => setPhase("projectActions");
              if (i.value === "back") return back();
              if (i.value === "md") return run(() => { const { md, csv } = exportProject(dir); return [md, csv]; }, back);
              if (i.value === "jira") return run(() => exportJira(dir), back);
              if (i.value === "trello") return run(() => exportTrello(dir), back);
              if (i.value === "all") return run(() => {
                const { md, csv } = exportProject(dir);
                return [md, csv, exportJira(dir), exportTrello(dir)];
              }, back);
            }}
          />
        </Box>
        <Text color={C.dim}>{"\n"}Esc to go back.</Text>
      </Box>
    );
  }

  if (phase === "deployMenu" && selected) {
    const dir = selected.dir;
    const name = selected.idea || dir.split("/").pop() || "app";
    const start = (target: DeployTarget) => {
      setDeployState({ target, status: "running", log: [] });
      setPhase("deploying");
      deploy(target, dir, name, (line) =>
        setDeployState((prev) => (prev ? { ...prev, log: [...prev.log.slice(-60), line] } : prev)),
      )
        .then((res) => setDeployState((prev) => (prev ? { ...prev, status: "done", url: res.url } : prev)))
        .catch((e) => setDeployState((prev) => (prev ? { ...prev, status: "error", error: e instanceof Error ? e.message : String(e) } : prev)));
    };
    const targets: DeployTarget[] = ["cloudflare", "vercel", "netlify"];
    return (
      <Box flexDirection="column">
        <Header />
        <Text bold>Deploy</Text>
        <Text color={C.dim}>Publishes the built site publicly. Each target needs its CLI installed and signed in.</Text>
        <Box marginTop={1}>
          <SelectInput
            items={[
              ...targets.map((t) => ({ label: `🚀 ${DEPLOY_META[t].label}   (${DEPLOY_META[t].cli})`, value: t })),
              { label: "🔙 Back", value: "back" },
            ]}
            onSelect={(i) => {
              if (i.value === "back") return setPhase("projectActions");
              start(i.value as DeployTarget);
            }}
          />
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text color={C.dim}>Sign-in per target (one-time):</Text>
          {targets.map((t) => (
            <Text key={t} color={C.dim}>  {DEPLOY_META[t].label}: {DEPLOY_META[t].auth}</Text>
          ))}
        </Box>
        <Text color={C.dim}>{"\n"}Esc to go back.</Text>
      </Box>
    );
  }

  if (phase === "deploying" && deployState) {
    const ds = deployState;
    const meta = DEPLOY_META[ds.target];
    return (
      <Box flexDirection="column">
        <Header />
        <Text bold>Deploy → {meta.label}</Text>
        {ds.status === "running" ? <Box marginTop={1}><Spinner label="Deploying… (first run can take a minute)" /></Box> : null}
        {ds.log.length ? (
          <Box marginTop={1} flexDirection="column">
            {ds.log.slice(-8).map((l, idx) => (
              <Text key={idx} color={C.dim} wrap="truncate-end">{l}</Text>
            ))}
          </Box>
        ) : null}
        {ds.status === "done" ? (
          <Box marginTop={1}>
            {ds.url
              ? <StatusMessage variant="success">Live at {ds.url}</StatusMessage>
              : <StatusMessage variant="success">Deployed. (No URL parsed — check the log above.)</StatusMessage>}
          </Box>
        ) : null}
        {ds.status === "error" ? (
          <Box marginTop={1}><StatusMessage variant="error">{ds.error}</StatusMessage></Box>
        ) : null}
        {ds.status !== "running" ? (
          <Box marginTop={1}>
            <SelectInput items={[{ label: "🔙 Back", value: "back" }]} onSelect={() => { setDeployState(null); setPhase("projectActions"); }} />
          </Box>
        ) : null}
      </Box>
    );
  }

  if (phase === "filterEpic" && selected) {
    const epics = [...new Set(selected.state.tasks.map((t) => t.epic || "General"))];
    return (
      <Box flexDirection="column">
        <Header />
        <Text bold>Filter by epic</Text>
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: "All epics", value: "__all" },
              ...epics.map((e) => ({ label: e, value: e })),
            ]}
            onSelect={(i) => {
              setEpicFilter(i.value === "__all" ? null : i.value);
              setPhase("projectActions");
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase === "rename" && selected) {
    return (
      <Box flexDirection="column">
        <Header />
        <Text bold>Rename project</Text>
        <Box marginTop={1}>
          <Text color={C.accent}>{"› "}</Text>
          <TextInput
            value={renameDraft}
            onChange={setRenameDraft}
            onSubmit={() => {
              if (renameDraft.trim()) renameProject(selected.dir, renameDraft.trim());
              reselect(selected.dir);
              setPhase("projectActions");
            }}
          />
        </Box>
        <Text color={C.dim}>{"\n"}Enter to save · Esc to go back.</Text>
      </Box>
    );
  }

  if (phase === "confirmDelete" && selected) {
    return (
      <Box flexDirection="column">
        <Header />
        <Text bold color={C.bad}>Delete this project?</Text>
        <Text color={C.dim} wrap="truncate-end">{"  "}{selected.idea}</Text>
        <Text color={C.dim}>{"  "}This permanently removes its folder and files. Can't be undone.</Text>
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: "No, keep it", value: "no" },
              { label: "Yes, delete", value: "yes" },
            ]}
            onSelect={(i) => {
              if (i.value === "yes") {
                deleteProject(selected.dir);
                const list = reselect(null);
                setPhase(list.length ? "projects" : "home");
              } else setPhase("projectActions");
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase === "addAsset") {
    return (
      <Box flexDirection="column">
        <Header />
        <Text bold>Add a file to this project</Text>
        <Text color={C.dim}>Paste the full path to an image or file. Tip: drag the file into the terminal to paste its path. ~ works.</Text>
        {assetMsg ? <Text color={assetMsg.ok ? C.good : C.bad}>{"\n"}{assetMsg.ok ? "✓ " : "✗ "}{assetMsg.text}</Text> : null}
        <Box marginTop={1}>
          <Text color={C.accent}>{"› "}</Text>
          <TextInput
            value={assetPath}
            onChange={setAssetPath}
            placeholder="/Users/you/Pictures/avatar.png"
            onSubmit={() => {
              if (!assetPath.trim()) {
                setPhase(assetReturn);
                return;
              }
              const r = targetWorkspace
                ? addAsset(targetWorkspace, assetPath)
                : ({ ok: false, error: "No project selected." } as const);
              setAssetMsg(r.ok ? { ok: true, text: `Added ${r.name}. You can now ask to use it in “Make changes”.` } : { ok: false, text: r.error });
              if (r.ok) setAssetPath("");
            }}
          />
        </Box>
        <Text color={C.dim}>{"\n"}Enter to add · empty Enter or Esc to go back.</Text>
      </Box>
    );
  }

  if (phase === "change") {
    return (
      <Box flexDirection="column">
        <Header />
        <Text bold>What should change?</Text>
        <Text color={C.dim}>Building on the existing files in this project.</Text>
        <Box marginTop={1}>
          <Text color={C.accent}>{"› "}</Text>
          <TextInput
            value={idea}
            onChange={setIdea}
            onSubmit={() => idea.trim() && setPhase("planning")}
            placeholder="make the header dark blue and add a footer with a copyright line"
          />
        </Box>
        <Text color={C.dim}>{"\n"}Enter to continue · Esc to go back.</Text>
      </Box>
    );
  }

  if (phase === "templates") {
    return (
      <Box flexDirection="column">
        <Header />
        <Text bold>Start from a template</Text>
        <Text color={C.dim}>Pick one — you can edit the tasks on the board after.</Text>
        <Box marginTop={1}>
          <SelectInput
            items={[
              ...TEMPLATES.map((t) => ({ label: `${t.name}  —  ${t.blurb}`, value: t.name })),
              { label: "🔙 Back", value: "__back" },
            ]}
            onSelect={(i) => {
              if (i.value === "__back") {
                setPhase("home");
                return;
              }
              const tpl = TEMPLATES.find((t) => t.name === i.value)!;
              resetBuildContext();
              setScope("full");
              setIdea(tpl.idea);
              setPhase("planning");
            }}
          />
        </Box>
        <Text color={C.dim}>{"\n"}Esc to go back.</Text>
      </Box>
    );
  }

  if (phase === "idea") {
    return (
      <Box flexDirection="column">
        <Header />
        <Text bold>What do you want to build?</Text>
        <Box marginTop={1}>
          <Text color={C.accent}>{"› "}</Text>
          <TextInput value={idea} onChange={setIdea} onSubmit={() => idea.trim() && setPhase("planning")} placeholder="a landing page for a coffee shop with a menu and contact form" />
        </Box>
        <Text color={C.dim}>{"\n"}Enter to continue · Esc to go back.</Text>
      </Box>
    );
  }

  if (phase === "planning") {
    return (
      <Box flexDirection="column">
        <Header />
        <Spinner label="Breaking your idea into a plan…" />
        <Text color={C.dim}>{"\n"}“{idea}”</Text>
      </Box>
    );
  }

  if (phase === "plan" && plan) {
    const prefs = getPrefs();
    const overCap = plan.estCost > prefs.budgetCapUSD;
    return (
      <Box flexDirection="column">
        <Header />
        <Text bold>Plan ready.</Text>
        <Box marginTop={1}><Team /></Box>
        <Box marginTop={1} flexDirection="column">
          <Text>
            {"  "}Tasks: <Text color={C.accent} bold>{plan.tasks.length}</Text>
            {"   "}Estimated cost: <Badge color={overCap ? "red" : C.accent}>${plan.estCost.toFixed(2)}</Badge>
            <Text color={C.dim}> (cap ${prefs.budgetCapUSD})</Text>
          </Text>
          <Text color={C.dim}>
            {"  "}Runs {prefs.concurrency} tasks at once. {targetWorkspace ? "Edits this project's files." : "Output goes to a fresh folder."}
          </Text>
        </Box>
        {overCap && <Text color={C.bad}>{"\n"}Estimate exceeds the ${prefs.budgetCapUSD} cap — it may halt partway.</Text>}
        <Text color={C.dim}>{"\n"}Workflow: {mode === "approval" ? "approval-gated (approve the backlog, then again after design before dev)" : "auto-run"}.</Text>
        <Box marginTop={1}>
          <Panel title="Ready?">
          <SelectInput
            items={
              mode === "approval"
                ? [
                    { label: `Open the board & approve (${plan.tasks.length}) →`, value: "board" },
                    { label: "Change idea", value: "idea" },
                    { label: "Switch to auto-run", value: "auto" },
                    { label: "🚪 Quit", value: "quit" },
                  ]
                : [
                    { label: `Plan the sprint on the board (${plan.tasks.length} in backlog) →`, value: "board" },
                    { label: `Build everything now  ($${plan.estCost.toFixed(2)})`, value: "build" },
                    { label: "Change idea", value: "idea" },
                    { label: "Switch to approval-gated", value: "approval" },
                    { label: "🚪 Quit", value: "quit" },
                  ]
            }
            onSelect={(i) => {
              if (i.value === "build") setPhase("building");
              else if (i.value === "board") setPhase("board");
              else if (i.value === "auto") setMode("auto");
              else if (i.value === "approval") setMode("approval");
              else if (i.value === "idea") {
                setIdea("");
                setPhase("idea");
              } else exit();
            }}
          />
          </Panel>
        </Box>
      </Box>
    );
  }

  if (phase === "board" && plan) {
    const commit = (newTasks: Task[]) => {
      const safe = newTasks.length ? newTasks : plan.tasks; // never build an empty board
      const { total } = estimateTasks(safe, plan.registry);
      setPlan({ ...plan, tasks: safe, estCost: total });
      setTasks(safe.map((t) => ({ id: t.id, capability: t.capability, status: "pending", title: t.title })));
      // In approval mode, approving on the board IS the go-ahead → build now.
      setPhase(mode === "approval" ? "building" : "plan");
    };
    return (
      <Box flexDirection="column">
        <Header />
        <BoardEditor
          tasks={plan.tasks}
          onDone={commit}
          onCancel={() => setPhase("plan")}
          onBreakdown={(epic, current) => breakdownEpic(epic, current, providers, targetWorkspace)}
        />
      </Box>
    );
  }

  if (phase === "building") {
    const running = tasks.filter((t) => t.status === "running").length;
    const metaById = new Map((plan?.tasks ?? []).map((t) => [t.id, { deps: t.dependsOn ?? [], epic: t.epic }]));
    const board: BoardTask[] = tasks.map((t) => ({
      id: t.id,
      capability: t.capability,
      title: t.title,
      epic: metaById.get(t.id)?.epic,
      dependsOn: metaById.get(t.id)?.deps,
      status: t.status,
      cost: t.cost,
      verdict: t.verdict,
      assignee: t.model ? modelLabel(t.model) : undefined,
    }));
    return (
      <Box flexDirection="column">
        <Header />
        <Text bold>
          Building… <Text color={C.dim}>({running} running)</Text>
        </Text>
        {gate ? (
          <Box marginTop={1}>
            <Panel title="⏸  Review gate — design done" borderColor={C.accent}>
              <Text>Design is complete. Approve to start development, or stop here.</Text>
              <Text color={C.dim}>Spent so far: ${spent.toFixed(2)}. Open the files to review before deciding.</Text>
              <Box marginTop={1}>
                <SelectInput
                  items={[
                    { label: "✅ Approve — start development", value: "continue" },
                    { label: "🛑 Stop here", value: "stop" },
                  ]}
                  onSelect={(i) => {
                    gate.resolve(i.value as "continue" | "stop");
                    setGate(null);
                  }}
                />
              </Box>
            </Panel>
          </Box>
        ) : null}
        <Box marginTop={1}>
          <Panel title="Board">
            <Kanban tasks={board} />
          </Panel>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Standup tasks={board} spent={spent} />
          <BudgetBar spent={spent} cap={getPrefs().budgetCapUSD} />
        </Box>
      </Box>
    );
  }

  if (phase === "done" && buildResult) {
    return (
      <Box flexDirection="column">
        <Header />
        <Text bold color={buildResult.halted ? C.warn : C.good}>
          {buildResult.halted ? "⚠ Build halted (budget cap)." : "✓ Build complete."}
        </Text>
        <Box marginTop={1}>
          <Standup
            tasks={tasks.map((t) => ({ id: t.id, capability: t.capability, title: t.title, status: t.status, cost: t.cost, verdict: t.verdict }))}
            spent={spent}
          />
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>
            {"  "}Total cost: <Text color={C.accent}>${spent.toFixed(2)}</Text>
          </Text>
          <Text color={C.dim}>{"  "}Files: {buildResult.files.join(", ") || "(none)"}</Text>
          <Text color={C.dim}>{"  "}Location: {buildResult.workspace}</Text>
          {buildResult.halted && <Text color={C.dim}>{"  "}Choose “Resume build” from your projects to continue.</Text>}
        </Box>
        <Box marginTop={1}>
          <SelectInput
            items={[
              ...(buildResult.files.some((f) => f.endsWith(".html")) ? [{ label: "🌐 Open in browser", value: "open" }] : []),
              { label: "📎 Add a file / image", value: "asset" },
              { label: "📝 Make changes", value: "change" },
              { label: "🆕 New build", value: "new" },
              { label: "🏠 Home", value: "home" },
              { label: "🚪 Quit", value: "quit" },
            ]}
            onSelect={(i) => {
              if (i.value === "open") openInBrowser(mainFileOf(buildResult.workspace));
              else if (i.value === "asset") {
                setTargetWorkspace(buildResult.workspace);
                setAssetPath("");
                setAssetMsg(null);
                setAssetReturn("done");
                setPhase("addAsset");
              } else if (i.value === "change") {
                setTargetWorkspace(buildResult.workspace);
                setSeed(undefined);
                setIdea("");
                setScope("change");
                setPhase("change");
              } else if (i.value === "new") {
                resetBuildContext();
                setScope("full");
                setPhase("idea");
              } else if (i.value === "home") {
                resetBuildContext();
                setPhase("home");
              } else exit();
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase === "error") {
    return (
      <Box flexDirection="column">
        <Header />
        <Text color={C.bad}>Something went wrong:</Text>
        <Text color={C.dim}>{"  "}{error}</Text>
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: "🔄 Try again", value: "retry" },
              { label: "🏠 Home", value: "home" },
              { label: "🚪 Quit", value: "quit" },
            ]}
            onSelect={(i) => {
              if (i.value === "retry") setPhase(scope === "change" ? "change" : "idea");
              else if (i.value === "home") {
                resetBuildContext();
                setScope("full");
                setPhase("home");
              } else exit();
            }}
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box>
      <Spinner label="Loading…" />
    </Box>
  );
}
