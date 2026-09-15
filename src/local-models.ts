// Local models (Ollama, LM Studio, vLLM — anything OpenAI-compatible on this machine).
//
// Pi already supports custom providers via ~/.pi/agent/models.json; we own ONE entry in
// that file, provider id "local", and never touch anything else in it. Pi's ModelRuntime
// loads the file, so resolvePiModel(runtime, "local", "<id>") works with no other change.
// Models cost $0 and need no key; availability = the entry exists and lists ≥1 model.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const LOCAL_PROVIDER_ID = "local";
export const DEFAULT_LOCAL_URL = "http://localhost:11434/v1"; // Ollama's default; LM Studio is :1234/v1

export interface LocalModelsConfig {
  baseUrl: string;
  models: string[];
}

interface PiModelsJson {
  providers?: Record<string, {
    baseUrl?: string;
    api?: string;
    apiKey?: string;
    compat?: Record<string, unknown>;
    models?: { id: string; name?: string; contextWindow?: number; maxTokens?: number }[];
  }>;
  [k: string]: unknown;
}

export function piModelsJsonPath(): string {
  return join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "models.json");
}

function readPi(): PiModelsJson {
  try {
    const p = piModelsJsonPath();
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as PiModelsJson) : {};
  } catch {
    return {};
  }
}

/** The local entry as configured, or undefined when none. */
export function getLocalModels(): LocalModelsConfig | undefined {
  const p = readPi().providers?.[LOCAL_PROVIDER_ID];
  if (!p?.baseUrl || !p.models?.length) return undefined;
  return { baseUrl: p.baseUrl, models: p.models.map((m) => m.id) };
}

/** Write (or remove, when `models` is empty) our provider entry; other entries untouched. */
export function setLocalModels(cfg: LocalModelsConfig): void {
  const pi = readPi();
  pi.providers ??= {};
  const models = cfg.models.map((s) => s.trim()).filter(Boolean);
  if (!models.length) delete pi.providers[LOCAL_PROVIDER_ID];
  else {
    pi.providers[LOCAL_PROVIDER_ID] = {
      baseUrl: cfg.baseUrl.trim().replace(/\/+$/, ""),
      api: "openai-completions",
      apiKey: "local", // servers ignore it; Pi wants something non-empty to mark the provider "authed"
      // Local servers rarely implement these; Pi's docs recommend switching them off.
      compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, supportsUsageInStreaming: false, maxTokensField: "max_tokens" },
      models: models.map((id) => ({ id, name: id, contextWindow: 32_000, maxTokens: 8_192 })),
    };
  }
  const p = piModelsJsonPath();
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, JSON.stringify(pi, null, 2) + "\n");
}

/** Ask the server for its model list (OpenAI-compatible GET /models). 3 s timeout. */
export async function probeLocalServer(baseUrl: string): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3_000);
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, { signal: ctrl.signal });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} from ${baseUrl}/models` };
    const json = (await res.json()) as { data?: { id?: string }[] };
    const models = (json.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string" && id.length > 0);
    return { ok: true, models };
  } catch (e) {
    return { ok: false, error: `${baseUrl} not reachable (${e instanceof Error ? e.message : String(e)}) — is the server running?` };
  } finally {
    clearTimeout(timer);
  }
}
