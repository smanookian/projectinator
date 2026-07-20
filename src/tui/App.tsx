// Projectinator TUI — the whole flow: setup -> idea -> plan -> build -> done.
// Dead simple: type what you want, confirm the cost, watch it build.

import React, { useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Spinner, StatusMessage, Badge } from "@inkjs/ui";
import type { Provider } from "../types.js";
import type { OrchestratorEvent } from "../orchestrator.js";
import { C, BudgetBar, Panel, Menu as SelectInput, GroupedMenu, KeyHint, useTermRows, TextField as TextInput, type TaskView, type MenuGroup } from "./components.js";
import { Kanban, type BoardTask } from "./Kanban.js";
import { BoardEditor } from "./BoardEditor.js";
import { Team, Standup, ListView } from "./panels.js";
import { EditableBoard } from "./EditableBoard.js";
import { AppFrame } from "./Frame.js";
import { Settings } from "./Settings.js";
import { BakeOff } from "./BakeOff.js";
import { Intake, type Answer } from "./Intake.js";
import { enrichBrief } from "../intake.js";
import type { IntakeQuestion } from "../intake.js";
import { StackPick } from "./StackPick.js";
import { stackInstruction, type StackChoice } from "../stack.js";
import type { Epic, CouncilResult } from "../council.js";
import { allTemplates, saveUserTemplate, deleteUserTemplate, exportTemplate, importTemplate, type Template } from "./templates.js";
import { getPrefs, getDefaultMode, getNotify, getPreferredStack, type WorkflowMode } from "./config.js";
import { notifyBuildDone } from "./notify.js";
import {
  availableProviders,
  chooseRegistry,
  planBuild,
  assessBuild,
  councilBuild,
  setProjectBudget,
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
  projectHistory,
  undoLastTask,
  projectRetro,
  projectBurndown,
  getRetroNarrative,
  generateRetroNarrative,
  breakdownEpic,
  modelLabel,
  PROVIDER_LABEL,
  type PlanResult,
  type ProjectInfo,
} from "./engine.js";
import { deploy, DEPLOY_META, type DeployTarget } from "./deploy.js";
import { startStaticServer, type StaticServer } from "../preview.js";
import type { Task, TaskOutcome } from "../types.js";

type Phase =
  | "setup" | "home" | "settings" | "projects" | "projectActions" | "addAsset" | "rename" | "confirmDelete" | "filterEpic" | "editBoard" | "kanban" | "templates" | "exportMenu" | "deployMenu" | "deploying" | "preview" | "bakeoff" | "history" | "retro" | "burndown" | "saveTemplate" | "importTemplate" | "myTemplates" | "tplActions"
  | "idea" | "change" | "stack" | "assessing" | "intake" | "planMode" | "council" | "approveEpics" | "planning" | "plan" | "board" | "building" | "done" | "error" | "setCap";

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
  const [intakeQs, setIntakeQs] = useState<IntakeQuestion[]>([]);
  const [approvedEpics, setApprovedEpics] = useState<Epic[] | null>(null);
  const [council, setCouncil] = useState<{ loading: boolean; result: CouncilResult | null; error: string }>({ loading: false, result: null, error: "" });
  // Keep `idea` as the raw user input; derive the brief from these so re-entering
  // the stack/intake steps never double-appends (bug: back-nav re-appended text).
  const [stackChoice, setStackChoice] = useState<StackChoice | null>(null);
  const [intakeAnswers, setIntakeAnswers] = useState<Answer[] | null>(null);
  const [narr, setNarr] = useState<{ loading: boolean; text: string; error: string }>({ loading: false, text: "", error: "" });
  const [tplName, setTplName] = useState("");
  const [tplPath, setTplPath] = useState("");
  const [tplSel, setTplSel] = useState<Template | null>(null);
  const [projectCap, setProjectCap] = useState<number | null>(null); // per-build cap override
  const [capDraft, setCapDraft] = useState("");
  const [capReturn, setCapReturn] = useState<Phase>("plan");
  const [deployState, setDeployState] = useState<{
    target: DeployTarget;
    status: "running" | "done" | "error";
    url?: string;
    error?: string;
    log: string[];
  } | null>(null);
  const [preview, setPreview] = useState<{ server: StaticServer; error?: string } | { error: string } | null>(null);

  const termRows = useTermRows();

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
    setProjectCap(null);
    setApprovedEpics(null);
    setCouncil({ loading: false, result: null, error: "" });
    setStackChoice(null);
    setIntakeAnswers(null);
    setEpicFilter(null);
  };

  // The brief the planner sees: raw idea + stack instruction (+ intake answers).
  // Pure function of state, so it's idempotent no matter how the user navigates.
  const composeBrief = (withIntake: boolean): string => {
    const base = idea + (stackChoice ? stackInstruction(stackChoice) : "");
    return withIntake ? enrichBrief(base, intakeAnswers ?? []) : base;
  };

  // Esc goes back one screen. Phases with their own Esc handling (board editors,
  // settings) are left out so we don't double-fire.
  const goBack = () => {
    switch (phase) {
      case "idea": resetBuildContext(); return setPhase("home");
      case "stack": resetBuildContext(); return setPhase("home");
      case "assessing": resetBuildContext(); return setPhase("home");
      case "intake": return setPhase("idea");
      case "planMode": resetBuildContext(); return setPhase("home");
      case "approveEpics": return setPhase("planMode");
      case "setCap": return setPhase(capReturn);
      case "templates": return setPhase("home");
      case "saveTemplate": return setPhase("projectActions");
      case "importTemplate": setFlash(""); return setPhase("templates");
      case "myTemplates": setFlash(""); return setPhase("templates");
      case "tplActions": return setPhase("myTemplates");
      case "change": return setPhase(selected ? "projectActions" : buildResult ? "done" : "home");
      case "rename": return setPhase("projectActions");
      case "addAsset": return setPhase(assetReturn);
      case "plan": return setPhase("idea");
      case "confirmDelete": return setPhase("projectActions");
      case "exportMenu": return setPhase("projectActions");
      case "deployMenu": return setPhase("projectActions");
      case "history": return setPhase("projectActions");
      case "retro": return setPhase("projectActions");
      case "burndown": return setPhase("projectActions");
      case "kanban": return setPhase("projectActions");
      case "preview": {
        if (preview && "server" in preview) void preview.server.close();
        setPreview(null);
        return setPhase("projectActions");
      }
      case "filterEpic": return setPhase("projectActions");
      case "projectActions": return setPhase("projects");
      case "projects": return setPhase("home");
      case "home": return setPhase("setup");
      case "done": resetBuildContext(); return setPhase("home");
      case "error": return setPhase("home");
    }
  };

  // global quit (not while typing an idea/change)
  // Any phase that hosts a text/number input must be here, or the App-level
  // useInput below quits on a "q" keystroke (both handlers see every key).
  const typing =
    phase === "idea" || phase === "change" || phase === "addAsset" || phase === "rename" ||
    phase === "bakeoff" || phase === "intake" || phase === "setCap" || phase === "stack" ||
    phase === "saveTemplate" || phase === "importTemplate" || phase === "settings" ||
    phase === "editBoard" || phase === "board";
  useInput((input, key) => {
    if (key.ctrl && input === "c") return exit();
    if (input === "q" && !typing) return exit();
    if (key.escape) goBack();
  });

  // ---- stack effect: apply the default stack (skip the picker) when one is set ----
  useEffect(() => {
    if (phase !== "stack") return;
    const pref = getPreferredStack();
    if (pref !== "ask") {
      setStackChoice({ platform: "web", framework: pref });
      setPhase("assessing");
    }
  }, [phase]);

  // ---- intake effect: for a fresh build, ask the PM if it needs clarification ----
  useEffect(() => {
    if (phase !== "assessing") return;
    let alive = true;
    // Only interview for fresh full builds; targeted changes go straight to planning.
    if (scope !== "full" || targetWorkspace) {
      setPhase("planning");
      return;
    }
    assessBuild(composeBrief(false), providers) // intake not answered yet
      .then((qs) => {
        if (!alive) return;
        if (qs.length) {
          setIntakeQs(qs);
          setPhase("intake");
        } else {
          setPhase("planMode");
        }
      })
      .catch(() => { if (alive) setPhase("planMode"); }); // never block on intake
    return () => { alive = false; };
  }, [phase, idea, providers, scope, targetWorkspace]);

  // ---- council effect: run the deep plan when entering "council" ----
  useEffect(() => {
    if (phase !== "council") return;
    let alive = true;
    setCouncil({ loading: true, result: null, error: "" });
    councilBuild(composeBrief(true), providers)
      .then((result) => {
        if (!alive) return;
        if (result.epics.length) {
          setCouncil({ loading: false, result, error: "" });
          setPhase("approveEpics");
        } else {
          setApprovedEpics(null); // council came back empty — fall back to normal planning
          setPhase("planning");
        }
      })
      .catch(() => { if (alive) { setApprovedEpics(null); setPhase("planning"); } });
    return () => { alive = false; };
  }, [phase, idea, providers]);

  // ---- planning effect ----
  useEffect(() => {
    if (phase !== "planning") return;
    let alive = true;
    planBuild(composeBrief(true), providers, scope, targetWorkspace, approvedEpics ?? undefined)
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
      budgetCapUSD: projectCap ?? prefs.budgetCapUSD,
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
  // Each phase renders its own content; AppFrame (below) wraps the result in the
  // persistent frame (status bar pinned to the bottom on every screen).
  const screen: React.ReactElement = (() => {

  if (phase === "setup") {
    const ready = providers.length > 0;
    const mode = chooseRegistry(providers).lock
      ? `locked to ${PROVIDER_LABEL[providers[0]!]}`
      : "best model per role";
    return (
      <Box flexDirection="column">
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
      ...(projs.length ? [{ label: `📂 Projects (${projs.length}) — open, spend, status`, value: "open" }] : []),
      { label: "🆚 Compare models (bake-off)", value: "bakeoff" },
      { label: "🔧 Settings", value: "settings" },
      { label: "🚪 Quit", value: "quit" },
    ];
    return (
      <Box flexDirection="column">
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
              } else if (i.value === "bakeoff") {
                setPhase("bakeoff");
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

  if (phase === "bakeoff") {
    return (
      <Box flexDirection="column">
        <BakeOff onExit={() => setPhase("home")} />
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
    const total = projects.reduce((a, p) => a + p.totalCost, 0);
    const nComplete = projects.filter((p) => p.status === "complete").length;
    const nHalted = projects.filter((p) => p.status === "halted").length;
    const nRunning = projects.filter((p) => p.status === "running").length;
    return (
      <Box flexDirection="column">
        <Text bold>Your projects <Text color={C.dim}>(newest first)</Text></Text>
        <Text>
          <Text color={C.dim}>{projects.length} projects · spent </Text><Text color={C.accent}>${total.toFixed(2)}</Text>
          <Text color={C.dim}> · </Text><Text color={C.good ?? "green"}>{nComplete}✓</Text> <Text color={nHalted ? C.warn : C.dim}>{nHalted}⚠</Text> <Text color={C.dim}>{nRunning}·</Text>
        </Text>
        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(i) => {
              if (i.value === "__back") setPhase("home");
              else {
                const proj = projects.find((p) => p.slug === i.value) ?? null;
                setSelected(proj);
                setProjectCap(proj?.state.budgetCapUSD ?? null); // carry the saved cap into resume/change
                setEpicFilter(null); // don't carry a filter from a previously-opened project
                setPhase("projectActions");
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase === "projectActions" && selected) {
    const doneIds = new Set(selected.state.outcomes.map((o) => o.taskId));
    // Buildable if it was halted OR the backlog has tasks that were never built.
    const hasUnbuilt = selected.state.tasks.some((t) => !doneIds.has(t.id));
    const canResume = selected.status === "halted" || hasUnbuilt;
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
    const menuGroups: MenuGroup[] = [
      { title: "Work", items: [
        { label: "➕ Add to backlog (describe it, the PM plans it)", value: "change" },
        { label: "📋 Board (view columns · add · reorder · edit)", value: "kanban" },
        { label: "📎 Add a file / image", value: "asset" },
        ...(canResume ? [{ label: selected.status === "halted" ? "⏩ Resume build" : `🔨 Build the backlog (${selected.state.tasks.filter((t) => !doneIds.has(t.id)).length} to do)`, value: "resume" }] : []),
      ] },
      { title: "See it", items: [
        { label: "👀 Preview in browser (live server, auto-reload)", value: "preview" },
      ] },
      { title: "Reports", items: [
        { label: "📊 Retro (build summary)", value: "retro" },
        { label: "📉 Burndown (progress + spend)", value: "burndown" },
        { label: "📜 History (per-task commits)", value: "history" },
      ] },
      { title: "Ship", items: [
        { label: "🚀 Deploy (Cloudflare, Vercel, Netlify)", value: "deploy" },
        { label: "📤 Export (Markdown, CSV, Jira, Trello)", value: "export" },
      ] },
      { title: "Manage", items: [
        { label: `💰 Budget cap: ${selected.state.budgetCapUSD != null ? `$${selected.state.budgetCapUSD}` : "global default"}`, value: "cap" },
        { label: "💾 Save as template", value: "saveTpl" },
        { label: "📛 Rename", value: "rename" },
        { label: "📑 Duplicate", value: "duplicate" },
        { label: "❌ Delete", value: "delete" },
        { label: "🔙 Back", value: "back" },
      ] },
    ];
    return (
      <Box flexDirection="column">
        <Text bold wrap="truncate-end">{selected.idea}</Text>
        {flash ? <Box marginTop={1}><StatusMessage variant="success">{flash}</StatusMessage></Box> : null}
        <Box marginTop={1}><Standup tasks={allBoard} spent={selected.totalCost} /></Box>
        <Box marginTop={1}><Team /></Box>
        <Box marginTop={1}>
          <GroupedMenu
            groups={menuGroups}
            maxRows={Math.max(6, termRows - 20)}
            onSelect={(i) => {
              if (i.value !== "export") setFlash("");
              if (i.value === "editBoard") setPhase("editBoard");
              else if (i.value === "kanban") { setFlash(""); setPhase("kanban"); }
              else if (i.value === "export") { setFlash(""); setPhase("exportMenu"); }
              else if (i.value === "deploy") { setFlash(""); setPhase("deployMenu"); }
              else if (i.value === "view") setViewMode((v) => (v === "board" ? "list" : "board"));
              else if (i.value === "filter") setPhase("filterEpic");
              else if (i.value === "open") openInBrowser(mainFileOf(selected.dir));
              else if (i.value === "history") { setFlash(""); setPhase("history"); }
              else if (i.value === "retro") { setFlash(""); setNarr({ loading: false, text: getRetroNarrative(selected.dir) ?? "", error: "" }); setPhase("retro"); }
              else if (i.value === "burndown") { setFlash(""); setPhase("burndown"); }
              else if (i.value === "cap") { setCapReturn("projectActions"); setCapDraft(selected.state.budgetCapUSD != null ? String(selected.state.budgetCapUSD) : ""); setPhase("setCap"); }
              else if (i.value === "saveTpl") { setFlash(""); setTplName(selected.idea.slice(0, 40)); setPhase("saveTemplate"); }
              else if (i.value === "preview") {
                const dir = selected.dir;
                setPreview(null);
                setPhase("preview");
                startStaticServer(dir, { liveReload: true })
                  .then((server) => {
                    setPreview({ server });
                    const main = mainFileOf(dir).split("/").pop() || "index.html";
                    openInBrowser(`${server.url}/${main}`);
                  })
                  .catch((e) => setPreview({ error: e instanceof Error ? e.message : String(e) }));
              }
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
        <EditableBoard
          tasks={selected.state.tasks}
          doneIds={doneIds}
          onSave={(t) => {
            saveProjectTasks(selected.dir, t);
            reselect(selected.dir);
            setPhase("kanban"); // back to the board view
          }}
          onCancel={() => setPhase("kanban")}
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
        <Box marginTop={1}><KeyHint hints={[{ keys: "Esc", label: "go back" }]} /></Box>
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
        <Box marginTop={1}><KeyHint hints={[{ keys: "Esc", label: "go back" }]} /></Box>
      </Box>
    );
  }

  if (phase === "deploying" && deployState) {
    const ds = deployState;
    const meta = DEPLOY_META[ds.target];
    return (
      <Box flexDirection="column">
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

  if (phase === "burndown" && selected) {
    const b = projectBurndown(selected.dir);
    const W = 18;
    const money = (n: number) => `$${n.toFixed(2)}`;
    const maxCost = b ? Math.max(0.0001, ...b.steps.map((s) => s.cumCost)) : 1;
    const remBar = (rem: number) => "█".repeat(Math.round((rem / (b?.taskCount || 1)) * W)).padEnd(W, "·");
    const costBar = (c: number) => "█".repeat(Math.max(0, Math.round((c / maxCost) * W))).padEnd(W, " ");
    return (
      <Box flexDirection="column">
        <Text bold wrap="truncate-end">Burndown — {selected.idea}</Text>
        {!b || b.steps.length === 0 ? (
          <Box marginTop={1}><Text color={C.dim}>No steps yet — run the build.</Text></Box>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            <Text color={C.dim}>Tasks remaining after each step (X = completion order, {b.taskCount} total)</Text>
            {b.steps.map((s, i) => (
              <Text key={i} wrap="truncate-end">
                {`${(i + 1).toString().padStart(2)} ${s.taskId}`.padEnd(9)} <Text color={C.accent}>{remBar(s.remaining)}</Text> {String(s.remaining).padStart(2)}{s.retry ? <Text color={C.warn}>  ↻ retry</Text> : null}
              </Text>
            ))}
            <Box marginTop={1} flexDirection="column">
              <Text color={C.dim}>Cumulative spend (total {money(b.totalCost)})</Text>
              {b.steps.map((s, i) => (
                <Text key={i} wrap="truncate-end">
                  {`${(i + 1).toString().padStart(2)} ${s.taskId}`.padEnd(9)} <Text color={C.good ?? "green"}>{costBar(s.cumCost)}</Text> {money(s.cumCost)}
                </Text>
              ))}
            </Box>
          </Box>
        )}
        <Box marginTop={1}>
          <SelectInput items={[{ label: "🔙 Back", value: "back" }]} onSelect={() => setPhase("projectActions")} />
        </Box>
      </Box>
    );
  }

  if (phase === "kanban" && selected) {
    const done = new Set(selected.state.outcomes.map((o) => o.taskId));
    const costBy = new Map<string, number>();
    const modelBy = new Map<string, string>();
    for (const o of selected.state.outcomes) {
      costBy.set(o.taskId, (costBy.get(o.taskId) ?? 0) + o.cost);
      modelBy.set(o.taskId, o.modelId);
    }
    const tasks: BoardTask[] = selected.state.tasks.map((t) => ({
      id: t.id,
      capability: t.capability,
      title: t.title,
      epic: t.epic,
      dependsOn: t.dependsOn,
      status: done.has(t.id) ? "done" : "pending",
      cost: costBy.get(t.id),
      assignee: modelBy.has(t.id) ? modelLabel(modelBy.get(t.id)!) : undefined,
    }));
    return (
      <Box flexDirection="column">
        <Text bold wrap="truncate-end">{selected.idea}</Text>
        <Box marginTop={1}><Standup tasks={tasks} spent={selected.totalCost} /></Box>
        <Box marginTop={1}>
          <Panel title="Board">
            <Kanban tasks={tasks} compact maxPerCol={Math.max(4, termRows - 14)} />
          </Panel>
        </Box>
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: "📝 Edit board (add · reorder · deps · rename)", value: "edit" },
              { label: "🔙 Back", value: "back" },
            ]}
            onSelect={(i) => setPhase(i.value === "edit" ? "editBoard" : "projectActions")}
          />
        </Box>
      </Box>
    );
  }

  if (phase === "retro" && selected) {
    const r = projectRetro(selected.dir);
    const money = (n: number) => `$${n.toFixed(2)}`;
    const maxEpic = r ? Math.max(1, ...r.byEpic.map((e) => e.cost)) : 1;
    const bar = (cost: number) => "█".repeat(Math.max(1, Math.round((cost / maxEpic) * 16)));
    return (
      <Box flexDirection="column">
        <Text bold wrap="truncate-end">Retro — {selected.idea}</Text>
        {!r ? (
          <Box marginTop={1}><Text color={C.dim}>No build data yet.</Text></Box>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            <Text>
              <Text color={C.dim}>Status </Text>{r.status}
              <Text color={C.dim}>   ·   Cost </Text><Text color={C.accent}>{money(r.totalCost)}</Text>
              <Text color={C.dim}>   ·   Tasks </Text>{r.doneCount}/{r.taskCount}
              <Text color={C.dim}>   ·   Tests </Text><Text color={C.good ?? "green"}>{r.tests.passed}✓</Text> <Text color={r.tests.failed ? (C.bad ?? "red") : C.dim}>{r.tests.failed}✗</Text>
            </Text>
            {r.estCost > 0 ? (() => {
              const delta = r.estCost > 0 ? Math.round(((r.totalCost - r.estCost) / r.estCost) * 100) : 0;
              const under = r.totalCost <= r.estCost;
              return (
                <Text>
                  <Text color={C.dim}>Predicted </Text>{money(r.estCost)}
                  <Text color={C.dim}> → actual </Text><Text color={C.accent}>{money(r.totalCost)}</Text>
                  <Text color={under ? (C.good ?? "green") : C.warn}>  {delta >= 0 ? "+" : ""}{delta}% {under ? "under" : "over"}</Text>
                </Text>
              );
            })() : null}

            {r.byEpic.length ? (
              <Box flexDirection="column" marginTop={1}>
                <Text color={C.dim}>Cost by epic</Text>
                {r.byEpic.map((e) => (
                  <Text key={e.epic} wrap="truncate-end">  <Text color={C.accent}>{bar(e.cost)}</Text> {money(e.cost).padEnd(7)} <Text color={C.dim}>{e.epic} ({e.tasks})</Text></Text>
                ))}
              </Box>
            ) : null}

            <Box flexDirection="column" marginTop={1}>
              <Text color={C.dim}>Cost by model</Text>
              {r.byModel.map((m) => (
                <Text key={m.model} wrap="truncate-end">  {money(m.cost).padEnd(7)} <Text color={C.dim}>{modelLabel(m.model)} ({m.tasks})</Text></Text>
              ))}
            </Box>

            {r.topCost.length ? (
              <Box flexDirection="column" marginTop={1}>
                <Text color={C.dim}>Priciest tasks</Text>
                {r.topCost.map((t) => (
                  <Text key={t.taskId} wrap="truncate-end">  {money(t.cost).padEnd(7)} <Text color={C.dim}>{t.taskId}</Text> {t.title}</Text>
                ))}
              </Box>
            ) : null}

            {r.retries.length ? (
              <Box marginTop={1}><Text color={C.warn}>Rebuilds: {r.retries.map((x) => `${x.taskId}×${x.rounds}`).join(", ")}</Text></Box>
            ) : null}

            {r.bugs.length ? (
              <Box flexDirection="column" marginTop={1}>
                <Text color={C.dim}>Tester flagged {r.bugs.length} issue{r.bugs.length === 1 ? "" : "s"}:</Text>
                {r.bugs.slice(0, 5).map((b, i) => (
                  <Text key={i} wrap="truncate-end">  <Text color={b.severity === "high" ? (C.bad ?? "red") : C.warn}>[{b.severity}]</Text> {b.description}</Text>
                ))}
              </Box>
            ) : (
              <Box marginTop={1}><Text color={C.good ?? "green"}>No open issues flagged by the tester.</Text></Box>
            )}

            {narr.loading ? (
              <Box marginTop={1}><Spinner label="Writing the retro narrative…" /></Box>
            ) : narr.error ? (
              <Box marginTop={1}><StatusMessage variant="error">{narr.error}</StatusMessage></Box>
            ) : narr.text ? (
              <Box marginTop={1}>
                <Panel title="🧠 AI narrative">
                  {narr.text.split("\n").map((line, i) => <Text key={i} wrap="wrap">{line}</Text>)}
                </Panel>
              </Box>
            ) : null}
          </Box>
        )}
        <Box marginTop={1}>
          <SelectInput
            items={[
              ...(r && !narr.loading ? [{ label: narr.text ? "🧠 Regenerate AI narrative" : "🧠 Generate AI narrative", value: "narrate" }] : []),
              { label: "🔙 Back", value: "back" },
            ]}
            onSelect={(i) => {
              if (i.value === "narrate") {
                setNarr({ loading: true, text: "", error: "" });
                generateRetroNarrative(selected.dir, providers)
                  .then((text) => setNarr({ loading: false, text, error: "" }))
                  .catch((e) => setNarr({ loading: false, text: "", error: e instanceof Error ? e.message : String(e) }));
              } else {
                setPhase("projectActions");
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase === "history" && selected) {
    const dir = selected.dir;
    const commits = projectHistory(dir);
    const canUndo = commits.length > 1; // more than the initial commit
    return (
      <Box flexDirection="column">
        <Text bold>History — {selected.idea}</Text>
        <Text color={C.dim}>One commit per finished task, newest first. Diff/checkout in the project folder with git.</Text>
        {flash ? <Box marginTop={1}><StatusMessage variant="success">{flash}</StatusMessage></Box> : null}
        <Box marginTop={1} flexDirection="column">
          {commits.length ? (
            commits.slice(0, 20).map((c) => (
              <Text key={c.hash} wrap="truncate-end"><Text color={C.accent}>{c.hash}</Text>  {c.msg}</Text>
            ))
          ) : (
            <Text color={C.dim}>No history yet (this project predates git-per-build, or git isn't installed).</Text>
          )}
        </Box>
        <Box marginTop={1}>
          <SelectInput
            items={[
              ...(canUndo ? [{ label: "⏪ Undo last task (revert files + reopen it to rebuild)", value: "undo" }] : []),
              { label: "🔙 Back", value: "back" },
            ]}
            onSelect={(i) => {
              if (i.value === "undo") {
                const r = undoLastTask(dir);
                reselect(dir);
                setFlash(r.ok ? `Undid ${r.taskId ?? "last task"}. Resume the build to rebuild it.` : (r.error ?? "Undo failed."));
              } else {
                setFlash("");
                setPhase("projectActions");
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase === "preview") {
    const stop = () => {
      if (preview && "server" in preview) void preview.server.close();
      setPreview(null);
      setPhase("projectActions");
    };
    const url = preview && "server" in preview ? preview.server.url : null;
    const err = preview && "error" in preview ? preview.error : null;
    return (
      <Box flexDirection="column">
        <Text bold>Live preview</Text>
        <Box marginTop={1} flexDirection="column">
          {err ? <StatusMessage variant="error">{err}</StatusMessage> : null}
          {!err && !url ? <Spinner label="Starting local server…" /> : null}
          {url ? (
            <>
              <StatusMessage variant="success">Serving at {url}</StatusMessage>
              <Text color={C.dim}>Opened in your browser. It auto-reloads when the files change</Text>
              <Text color={C.dim}>(e.g. after a resume/change build). ES modules + fetch work here,</Text>
              <Text color={C.dim}>unlike opening the file directly.</Text>
            </>
          ) : null}
        </Box>
        <Box marginTop={1}>
          <SelectInput items={[{ label: "⏹ Stop preview & go back", value: "stop" }]} onSelect={stop} />
        </Box>
      </Box>
    );
  }

  if (phase === "filterEpic" && selected) {
    const epics = [...new Set(selected.state.tasks.map((t) => t.epic || "General"))];
    return (
      <Box flexDirection="column">
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
        <Box marginTop={1}><KeyHint hints={[{ keys: "Enter", label: "save" }, { keys: "Esc", label: "go back" }]} /></Box>
      </Box>
    );
  }

  if (phase === "confirmDelete" && selected) {
    return (
      <Box flexDirection="column">
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
        <Box marginTop={1}><KeyHint hints={[{ keys: "Enter", label: "add" }, { keys: "Esc", label: "go back" }]} /></Box>
      </Box>
    );
  }

  if (phase === "change") {
    return (
      <Box flexDirection="column">
        <Text bold>Add to the backlog</Text>
        <Text color={C.dim}>Describe what to add or change — the PM plans it into new tasks against this project's files.</Text>
        <Box marginTop={1}>
          <Text color={C.accent}>{"› "}</Text>
          <TextInput
            value={idea}
            onChange={setIdea}
            onSubmit={() => idea.trim() && setPhase("assessing")}
            placeholder="make the header dark blue and add a footer with a copyright line"
          />
        </Box>
        <Box marginTop={1}><KeyHint hints={[{ keys: "Enter", label: "continue" }, { keys: "Esc", label: "go back" }]} /></Box>
      </Box>
    );
  }

  if (phase === "saveTemplate" && selected) {
    return (
      <Box flexDirection="column">
        <Text bold>Save as template</Text>
        <Text color={C.dim}>Reuse this project's brief as a starting point for future builds.</Text>
        <Box marginTop={1}>
          <Text color={C.accent}>{"name › "}</Text>
          <TextInput
            value={tplName}
            onChange={setTplName}
            onSubmit={() => {
              const name = tplName.trim();
              if (!name) { setPhase("projectActions"); return; }
              saveUserTemplate({ name, blurb: selected.idea.slice(0, 48), idea: selected.state.idea ?? selected.idea });
              setFlash(`Saved template “${name}”.`);
              setPhase("projectActions");
            }}
          />
        </Box>
        <Box marginTop={1}><KeyHint hints={[{ keys: "Enter", label: "save" }, { keys: "Esc", label: "cancel" }]} /></Box>
      </Box>
    );
  }

  if (phase === "importTemplate") {
    return (
      <Box flexDirection="column">
        <Text bold>Import a shared template</Text>
        <Text color={C.dim}>Paste the path to a .pitemplate.json file someone shared.</Text>
        {flash ? <Box marginTop={1}><StatusMessage variant="error">{flash}</StatusMessage></Box> : null}
        <Box marginTop={1}>
          <Text color={C.accent}>{"› "}</Text>
          <TextInput
            value={tplPath}
            onChange={setTplPath}
            onSubmit={() => {
              if (!tplPath.trim()) { setPhase("templates"); return; }
              try {
                const t = importTemplate(tplPath);
                setFlash(`Imported “${t.name}”.`);
                setPhase("templates");
              } catch (e) {
                setFlash(e instanceof Error ? e.message : "Import failed.");
              }
            }}
          />
        </Box>
        <Box marginTop={1}><KeyHint hints={[{ keys: "Enter", label: "import" }, { keys: "Esc", label: "cancel" }]} /></Box>
      </Box>
    );
  }

  if (phase === "myTemplates") {
    const mine = allTemplates().filter((t) => !t.builtin);
    return (
      <Box flexDirection="column">
        <Text bold>My templates</Text>
        {flash ? <Box marginTop={1}><StatusMessage variant="success">{flash}</StatusMessage></Box> : null}
        <Box marginTop={1}>
          <SelectInput
            items={[
              ...mine.map((t) => ({ label: `★ ${t.name}  —  ${t.blurb}`, value: t.name })),
              { label: "🔙 Back", value: "__back" },
            ]}
            onSelect={(i) => {
              if (i.value === "__back") { setFlash(""); setPhase("templates"); return; }
              setTplSel(mine.find((t) => t.name === i.value) ?? null);
              setPhase("tplActions");
            }}
          />
        </Box>
        <Box marginTop={1}><KeyHint hints={[{ keys: "Esc", label: "go back" }]} /></Box>
      </Box>
    );
  }

  if (phase === "tplActions" && tplSel) {
    return (
      <Box flexDirection="column">
        <Text bold>{tplSel.name}</Text>
        {flash ? <Box marginTop={1}><StatusMessage variant="success">{flash}</StatusMessage></Box> : null}
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: "📤 Share — export to a file", value: "export" },
              { label: "❌ Delete", value: "delete" },
              { label: "🔙 Back", value: "back" },
            ]}
            onSelect={(i) => {
              if (i.value === "export") { const p = exportTemplate(tplSel); setFlash(`Shared → ${p}`); setPhase("myTemplates"); }
              else if (i.value === "delete") { deleteUserTemplate(tplSel.name); setFlash(`Deleted “${tplSel.name}”.`); setPhase("myTemplates"); }
              else setPhase("myTemplates");
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase === "templates") {
    const tpls = allTemplates();
    const hasUser = tpls.some((t) => !t.builtin);
    return (
      <Box flexDirection="column">
        <Text bold>Start from a template</Text>
        <Text color={C.dim}>Pick one — you can edit the tasks on the board after. ★ = yours.</Text>
        {flash ? <Box marginTop={1}><StatusMessage variant="success">{flash}</StatusMessage></Box> : null}
        <Box marginTop={1}>
          <SelectInput
            items={[
              ...tpls.map((t) => ({ label: `${t.builtin ? "  " : "★ "}${t.name}  —  ${t.blurb}`, value: `t:${t.name}` })),
              { label: "📥 Import a shared template…", value: "__import" },
              ...(hasUser ? [{ label: "📇 Manage my templates", value: "__manage" }] : []),
              { label: "🔙 Back", value: "__back" },
            ]}
            onSelect={(i) => {
              if (i.value === "__back") { setFlash(""); setPhase("home"); return; }
              if (i.value === "__import") { setFlash(""); setTplPath(""); setPhase("importTemplate"); return; }
              if (i.value === "__manage") { setFlash(""); setPhase("myTemplates"); return; }
              const name = i.value.slice(2);
              const tpl = tpls.find((t) => t.name === name)!;
              resetBuildContext();
              setScope("full");
              setIdea(tpl.idea);
              setPhase("stack");
            }}
          />
        </Box>
        <Box marginTop={1}><KeyHint hints={[{ keys: "Esc", label: "go back" }]} /></Box>
      </Box>
    );
  }

  if (phase === "idea") {
    return (
      <Box flexDirection="column">
        <Text bold>What do you want to build?</Text>
        <Box marginTop={1}>
          <Text color={C.accent}>{"› "}</Text>
          <TextInput value={idea} onChange={setIdea} onSubmit={() => idea.trim() && setPhase("stack")} placeholder="a landing page for a coffee shop with a menu and contact form" />
        </Box>
        <Box marginTop={1}><KeyHint hints={[{ keys: "Enter", label: "continue" }, { keys: "Esc", label: "go back" }]} /></Box>
      </Box>
    );
  }

  if (phase === "stack") {
    // When a default stack is set, the effect above skips straight to assessing.
    if (getPreferredStack() !== "ask") {
      return (
        <Box flexDirection="column">
          <Spinner label="Preparing…" />
        </Box>
      );
    }
    return (
      <Box flexDirection="column">
        <Text bold>What should I build it with?</Text>
        <Box marginTop={1}>
          <StackPick
            onDone={(choice: StackChoice) => {
              setStackChoice(choice);
              setPhase("assessing");
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase === "assessing") {
    return (
      <Box flexDirection="column">
        <Spinner label="Reading your request…" />
        <Text color={C.dim}>{"\n"}“{idea}”</Text>
      </Box>
    );
  }

  if (phase === "intake") {
    return (
      <Box flexDirection="column">
        <Text bold>A few quick questions</Text>
        <Text color={C.dim}>The PM needs a little more to build the right thing.</Text>
        <Box marginTop={1}>
          <Intake
            questions={intakeQs}
            onDone={(answers: Answer[]) => {
              setIntakeAnswers(answers);
              setPhase("planMode");
            }}
            onCancel={() => setPhase("idea")}
          />
        </Box>
      </Box>
    );
  }

  if (phase === "planMode") {
    return (
      <Box flexDirection="column">
        <Text bold>How should the team plan this?</Text>
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: "⚡ Quick plan — one PM breaks it into tasks", value: "quick" },
              { label: "🏛 Deep plan — a council debates epics first, you approve (costs more)", value: "deep" },
            ]}
            onSelect={(i) => {
              if (i.value === "deep") setPhase("council");
              else { setApprovedEpics(null); setPhase("planning"); }
            }}
          />
        </Box>
        <Box flexDirection="column" marginTop={1}>
          <Text color={C.dim}>Deep plan is worth it for bigger/complex builds.</Text>
          <KeyHint hints={[{ keys: "Esc", label: "go back" }]} />
        </Box>
      </Box>
    );
  }

  if (phase === "council") {
    return (
      <Box flexDirection="column">
        <Text bold>Planning council in session…</Text>
        <Box marginTop={1}><Spinner label="Architect, product, and risk leads are proposing epics, then synthesizing…" /></Box>
      </Box>
    );
  }

  if (phase === "approveEpics" && council.result) {
    const epics = council.result.epics;
    return (
      <Box flexDirection="column">
        <Text bold>Proposed epics ({epics.length})</Text>
        <Text color={C.dim}>The council merged the architect / product / risk views. Approve to expand into tasks.</Text>
        <Box marginTop={1} flexDirection="column">
          {epics.map((e, i) => (
            <Box key={i} flexDirection="column" marginBottom={1}>
              <Text><Text color={C.accent}>{i + 1}. {e.name}</Text></Text>
              <Text color={C.dim} wrap="wrap">   {e.rationale}</Text>
            </Box>
          ))}
        </Box>
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: "✅ Approve — expand these epics into tasks", value: "approve" },
              { label: "⚡ Skip epics — quick plan instead", value: "quick" },
              { label: "🔙 Back", value: "back" },
            ]}
            onSelect={(i) => {
              if (i.value === "approve") { setApprovedEpics(epics); setPhase("planning"); }
              else if (i.value === "quick") { setApprovedEpics(null); setPhase("planning"); }
              else setPhase("planMode");
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase === "planning") {
    return (
      <Box flexDirection="column">
        <Spinner label={approvedEpics ? "Expanding the approved epics into tasks…" : "Breaking your idea into a plan…"} />
        <Text color={C.dim}>{"\n"}“{idea}”</Text>
      </Box>
    );
  }

  if (phase === "setCap") {
    const globalCap = getPrefs().budgetCapUSD;
    return (
      <Box flexDirection="column">
        <Text bold>Budget cap for this project</Text>
        <Text color={C.dim}>The build halts if spend passes this. Leave blank to use the global default (${globalCap}).</Text>
        <Box marginTop={1}>
          <Text color={C.accent}>{"$ "}</Text>
          <TextInput
            value={capDraft}
            onChange={setCapDraft}
            onSubmit={() => {
              const v = capDraft.trim();
              const parsed = v === "" ? null : parseFloat(v);
              const cap = parsed != null && parsed > 0 ? parsed : null;
              if (capReturn === "projectActions" && selected) {
                setProjectBudget(selected.dir, cap ?? undefined);
                setProjectCap(cap);
                reselect(selected.dir);
                setPhase("projectActions");
              } else {
                setProjectCap(cap);
                setPhase("plan");
              }
            }}
          />
        </Box>
        <Box marginTop={1}><KeyHint hints={[{ keys: "Enter", label: "save" }, { keys: "Esc", label: "cancel" }]} /></Box>
      </Box>
    );
  }

  if (phase === "plan" && plan) {
    const prefs = getPrefs();
    const effCap = projectCap ?? prefs.budgetCapUSD;
    const overCap = plan.estCost > effCap;
    return (
      <Box flexDirection="column">
        <Text bold>Plan ready.</Text>
        <Box marginTop={1}><Team /></Box>
        <Box marginTop={1} flexDirection="column">
          <Text>
            {"  "}Tasks: <Text color={C.accent} bold>{plan.tasks.length}</Text>
            {"   "}Estimated cost: <Badge color={overCap ? "red" : C.accent}>${plan.estCost.toFixed(2)}</Badge>
            <Text color={C.dim}> (cap ${effCap}{projectCap != null ? " · this project" : ""})</Text>
          </Text>
          <Text color={C.dim}>
            {"  "}Runs {prefs.concurrency} tasks at once. {targetWorkspace ? "Edits this project's files." : "Output goes to a fresh folder."}
          </Text>
        </Box>
        {overCap && <Text color={C.bad}>{"\n"}Estimate exceeds the ${effCap} cap — it may halt partway.</Text>}
        <Text color={C.dim}>{"\n"}Workflow: {mode === "approval" ? "approval-gated (approve the backlog, then again after design before dev)" : "auto-run"}.</Text>
        <Box marginTop={1}>
          <Panel title="Ready?">
          <SelectInput
            items={[
              // When adding to an existing project, let the user just queue the
              // new tasks without building them right now.
              ...(scope === "change" && selected
                ? [{ label: `➕ Add ${plan.tasks.length} task${plan.tasks.length === 1 ? "" : "s"} to the backlog (don't build yet)`, value: "backlog" }]
                : []),
              ...(mode === "approval"
                ? [
                    { label: `Open the board & approve (${plan.tasks.length}) →`, value: "board" },
                    { label: `💰 Budget cap: $${effCap}`, value: "cap" },
                    { label: "Change idea", value: "idea" },
                    { label: "Switch to auto-run", value: "auto" },
                    { label: "🚪 Quit", value: "quit" },
                  ]
                : [
                    { label: `Plan the sprint on the board (${plan.tasks.length} in backlog) →`, value: "board" },
                    { label: `Build everything now  ($${plan.estCost.toFixed(2)})`, value: "build" },
                    { label: `💰 Budget cap: $${effCap}`, value: "cap" },
                    { label: "Change idea", value: "idea" },
                    { label: "Switch to approval-gated", value: "approval" },
                    { label: "🚪 Quit", value: "quit" },
                  ]),
            ]}
            onSelect={(i) => {
              if (i.value === "backlog" && selected) {
                // Merge the new tasks into the project's backlog without building.
                // Give them clean sequential ids (T-03, T-04, …) so they read well.
                const existing = selected.state.tasks;
                const used = new Set(existing.map((t) => t.id));
                let n = 0;
                const nextId = () => {
                  let id: string;
                  do { id = `T-${String(++n).padStart(2, "0")}`; } while (used.has(id));
                  used.add(id);
                  return id;
                };
                const idMap = new Map<string, string>();
                const reided = plan.tasks.map((t) => {
                  const nid = nextId();
                  idMap.set(t.id, nid);
                  return { ...t, id: nid };
                });
                const merged = [
                  ...existing,
                  ...reided.map((t) => ({ ...t, dependsOn: (t.dependsOn ?? []).map((d) => idMap.get(d) ?? d) })),
                ];
                saveProjectTasks(selected.dir, merged);
                reselect(selected.dir);
                setFlash(`Added ${plan.tasks.length} task${plan.tasks.length === 1 ? "" : "s"} to the backlog.`);
                setPhase("kanban");
              }
              else if (i.value === "build") setPhase("building");
              else if (i.value === "board") setPhase("board");
              else if (i.value === "cap") { setCapReturn("plan"); setCapDraft(String(effCap)); setPhase("setCap"); }
              else if (i.value === "auto") setMode("auto");
              else if (i.value === "approval") setMode("approval");
              else if (i.value === "idea") {
                setIdea("");
                // A change build must go back to the change screen (keeps its
                // targetWorkspace + scope), not the fresh-build idea/stack path.
                setPhase(scope === "change" ? "change" : "idea");
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
            <Kanban tasks={board} compact maxPerCol={Math.max(2, Math.floor((termRows - (gate ? 20 : 12)) / 2))} />
          </Panel>
        </Box>
        <Box marginTop={1}>
          <Standup tasks={board} spent={spent} />
        </Box>
        {(() => {
          const prefs = getPrefs();
          const cap = projectCap ?? prefs.budgetCapUSD;
          const pct = prefs.budgetAlertPct;
          const alerting = spent >= cap * (pct / 100) && spent < cap;
          return (
            <Box marginTop={1} flexDirection="column">
              <BudgetBar spent={spent} cap={cap} />
              {alerting ? (
                <Text color={C.warn}>⚠ {Math.round((spent / cap) * 100)}% of the ${cap} cap spent — nearing the limit.</Text>
              ) : null}
            </Box>
          );
        })()}
      </Box>
    );
  }

  if (phase === "done" && buildResult) {
    return (
      <Box flexDirection="column">
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
              { label: "➕ Add to backlog (describe it, the PM plans it)", value: "change" },
              { label: "📎 Add a file / image", value: "asset" },
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

  })();

  return (
    <AppFrame projectName={selected?.idea} phase={phase}>
      {screen}
    </AppFrame>
  );
}
