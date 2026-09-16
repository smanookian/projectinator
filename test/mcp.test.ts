// The MCP server over real stdio: a client launches `projectinator mcp`, lists tools, and
// calls the free ones. build_status reads any project folder's build-state.

import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("mcp server", () => {
  it("lists the tools; models and build_status answer without spending", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-mcp-"));
    writeFileSync(join(dir, "build-state.json"), JSON.stringify({
      id: "x", idea: "fixture", status: "halted", haltReason: "budget cap", totalCost: 0.4,
      tasks: [{ id: "T-01", title: "Build it", capability: "code", difficulty: "low", dependsOn: [], estTokens: { input: 1, output: 1 } }, { id: "T-02", title: "Test it", capability: "test", difficulty: "low", dependsOn: ["T-01"], estTokens: { input: 1, output: 1 } }],
      outcomes: [{ taskId: "T-01", capability: "code", provider: "anthropic", modelId: "m", round: 0, cost: 0.4, files: ["index.html"], finalText: "" }],
    }));
    const transport = new StdioClientTransport({ command: "npx", args: ["tsx", "src/cli.ts", "mcp"], env: { ...process.env as Record<string, string>, OPENROUTER_API_KEY: "test", HOME: dir } });
    const client = new Client({ name: "test", version: "0" });
    try {
      await client.connect(transport);
      const tools = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(tools).toEqual(["build", "build_control", "build_status", "models", "plan", "projects"]);

      const models = await client.callTool({ name: "models", arguments: {} });
      const roster = JSON.parse((models.content as { text: string }[])[0]!.text) as { role: string; model?: string }[];
      expect(roster.map((r) => r.role)).toContain("Developer");
      expect(roster.every((r) => r.model)).toBe(true);

      const status = await client.callTool({ name: "build_status", arguments: { workspace: dir } });
      const s = JSON.parse((status.content as { text: string }[])[0]!.text) as { status: string; haltReason: string; tasks: { id: string; status: string }[]; steerable: boolean };
      expect(s.status).toBe("halted");
      expect(s.haltReason).toBe("budget cap");
      expect(s.tasks.map((t) => `${t.id}:${t.status}`)).toEqual(["T-01:done", "T-02:pending"]);
      expect(s.steerable).toBe(false);

      const ctl = await client.callTool({ name: "build_control", arguments: { workspace: dir, action: "pause" } });
      expect(ctl.isError).toBe(true);
    } finally {
      await client.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
