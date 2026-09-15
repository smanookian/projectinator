// Local models: we write ONE provider entry into Pi's models.json, Pi's runtime must load
// it so resolvePiModel(runtime, "local", id) works, the server probe lists models, and
// the rest of the app treats "local" as available, $0 and never a cloud fallback.
// PI_CODING_AGENT_DIR is redirected so the user's real ~/.pi/agent is untouched.

import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const piDir = mkdtempSync(join(tmpdir(), "pi-local-"));
const prevDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = piDir;

const { getLocalModels, setLocalModels, probeLocalServer, piModelsJsonPath } = await import("../src/local-models.js");
const { piRuntime, resolvePiModel } = await import("../src/executor.js");
const { getModel } = await import("../src/models.js");
const { availableProviders, allModels } = await import("../src/tui/engine.js");
const { lockRegistryToProvider } = await import("../src/roles.js");

afterAll(() => { process.env.PI_CODING_AGENT_DIR = prevDir; rmSync(piDir, { recursive: true, force: true }); });
beforeEach(() => rmSync(piModelsJsonPath(), { force: true }));

describe("local models", () => {
  it("writes only our provider entry, leaving other entries alone; empty list removes it", () => {
    writeFileSync(piModelsJsonPath(), JSON.stringify({ providers: { "my-proxy": { baseUrl: "https://x", api: "anthropic-messages", models: [{ id: "m" }] } } }));
    setLocalModels({ baseUrl: "http://localhost:11434/v1/", models: ["qwen2.5-coder:14b", " llama3.1:8b "] });
    const json = JSON.parse(readFileSync(piModelsJsonPath(), "utf8"));
    expect(Object.keys(json.providers).sort()).toEqual(["local", "my-proxy"]);
    expect(json.providers.local.baseUrl).toBe("http://localhost:11434/v1"); // trailing slash stripped
    expect(json.providers.local.api).toBe("openai-completions");
    expect(getLocalModels()).toEqual({ baseUrl: "http://localhost:11434/v1", models: ["qwen2.5-coder:14b", "llama3.1:8b"] });
    setLocalModels({ baseUrl: "http://localhost:11434/v1", models: [] });
    expect(getLocalModels()).toBeUndefined();
    expect(JSON.parse(readFileSync(piModelsJsonPath(), "utf8")).providers["my-proxy"]).toBeDefined();
  });

  it("Pi's runtime loads the entry and resolves the model — the whole point", async () => {
    setLocalModels({ baseUrl: "http://localhost:11434/v1", models: ["qwen2.5-coder:14b"] });
    const rt = await piRuntime();
    const m = resolvePiModel(rt, "local", "qwen2.5-coder:14b");
    expect(m.id).toBe("qwen2.5-coder:14b");
    expect(m.provider).toBe("local");
    expect(() => resolvePiModel(rt, "local", "not-configured")).toThrow(/no model/);
  });

  it("is available without a key, prices at $0, appears in the model list, and locks to itself", () => {
    expect(availableProviders()).not.toContain("local");
    setLocalModels({ baseUrl: "http://localhost:11434/v1", models: ["qwen2.5-coder:32b", "llama3.1:8b"] });
    expect(availableProviders()).toContain("local");
    expect(getModel("llama3.1:8b")).toMatchObject({ provider: "local", cost: { input: 0, output: 0 } });
    expect(allModels().filter((m) => m.provider === "local").map((m) => m.id)).toEqual(["qwen2.5-coder:32b", "llama3.1:8b"]);
    const reg = lockRegistryToProvider("local");
    const code = reg.find((e) => e.capability === "code" && e.tier === "high")!.byBackend.api;
    const review = reg.find((e) => e.capability === "review" && e.tier === "fast")!.byBackend.api;
    expect(code).toEqual({ provider: "local", model: "qwen2.5-coder:32b" }); // biggest → strong
    expect(review).toEqual({ provider: "local", model: "qwen2.5-coder:32b" }); // first listed → cheap
  });

  it("probeLocalServer lists models from an OpenAI-compatible /models, and reports a dead server", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/v1/models") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ data: [{ id: "a:7b" }, { id: "b:14b" }] })); }
      else res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as { port: number };
    try {
      expect(await probeLocalServer(`http://127.0.0.1:${port}/v1`)).toEqual({ ok: true, models: ["a:7b", "b:14b"] });
    } finally {
      server.close();
    }
    const dead = await probeLocalServer("http://127.0.0.1:1/v1");
    expect(dead.ok).toBe(false);
    if (!dead.ok) expect(dead.error).toMatch(/not reachable/);
  });
});
