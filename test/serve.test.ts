// Node server stack: startServer spawns `npm start` on a free PORT, waits for HTTP, and
// kills the process tree; check_app renders against it. Failure modes: a server that
// crashes and one that never listens — both must come back as text, not hangs.

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, SERVER_READY_MS } from "../src/serve.js";
import { PROFILES } from "../src/stack.js";
import { renderCheck, interactCheck, chromiumAvailable } from "../src/preview.js";
import { buildCheckTool } from "../src/roles.js";

const hasChromium = await chromiumAvailable();
const none = undefined as never;

/** A zero-dependency Node server project (so no npm ci is needed: node_modules is faked). */
function serverProject(serverJs: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-node-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "srv", private: true, type: "module", scripts: { start: "node server.js" } }));
  writeFileSync(join(dir, "package-lock.json"), JSON.stringify({ name: "srv", lockfileVersion: 3, packages: {} }));
  mkdirSync(join(dir, "node_modules")); // prepareForTest sees a cached install
  mkdirSync(join(dir, ".checks")); writeFileSync(join(dir, ".checks", "prepare.json"), "{}");
  writeFileSync(join(dir, "server.js"), serverJs);
  return dir;
}

const GOOD = `import { createServer } from "node:http";
let count = 0;
createServer((req, res) => {
  if (req.url === "/inc") { count++; res.writeHead(302, { location: "/" }); return res.end(); }
  res.setHeader("content-type", "text/html");
  res.end('<!doctype html><html lang="en"><head><title>Counter</title></head><body><h1>SERVER-MARKER</h1><p id="n">' + count + '</p><a id="inc" href="/inc">inc</a></body></html>');
}).listen(process.env.PORT || 3000, () => console.log("listening on " + process.env.PORT));`;

describe.skipIf(!hasChromium)("node server stack", () => {
  it("starts on PORT, renders GET /, drives it, and shuts down", async () => {
    const dir = serverProject(GOOD);
    try {
      const srv = await startServer(dir, PROFILES.node);
      try {
        expect(srv.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        expect(srv.log()).toMatch(/listening on \d+/);
        const r = await renderCheck(dir, "", { baseUrl: srv.url, checksDir: join(dir, ".checks"), checksPrefix: "T-r0" });
        expect(r.ok).toBe(true);
        expect(r.text).toContain("SERVER-MARKER");
        expect(r.doubleClickBroken).toBe(false); // n/a for servers
        expect(r.viewports).toHaveLength(3);
        const i = await interactCheck(dir, "", [{ click: "#inc" }, { expectText: "#n", contains: "1" }], { baseUrl: srv.url });
        expect(i.ok).toBe(true);
      } finally {
        await srv.close();
      }
      // The port is free again: a fresh fetch must fail.
      await expect(fetch(srv.url)).rejects.toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  it("check_app for a node project starts the server and reports what it saw", async () => {
    const dir = serverProject(GOOD);
    try {
      const tool = buildCheckTool(dir, true, "T-1-r0", PROFILES.node);
      const reply = await tool.tool.execute("c", {}, none, none, none);
      const text = String((reply.content[0] as { text?: unknown }).text);
      expect(text).toMatch(/server started on http:\/\/127\.0\.0\.1:\d+ \(npm start\)/);
      expect(text).toMatch(/rendered GET \/: OK/);
      expect(text).toContain("SERVER-MARKER");
      expect(tool.rendered()).toBe(true);
      expect(tool.screenshots()).toHaveLength(3);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  it("a server that crashes on start is reported with its output", async () => {
    const dir = serverProject(`console.error("boom: missing config"); process.exit(3);`);
    try {
      await expect(startServer(dir, PROFILES.node)).rejects.toThrow(/exited with code 3[\s\S]*boom: missing config/);
      const tool = buildCheckTool(dir, true, "T-1-r0", PROFILES.node);
      const text = String(((await tool.tool.execute("c", {}, none, none, none)).content[0] as { text?: unknown }).text);
      expect(text).toMatch(/server failed to start — this is a HIGH-severity bug/);
      expect(text).toMatch(/boom/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  it("a server that ignores PORT and never answers is reported after the readiness window", async () => {
    // Listens on a fixed unrelated port → our probe on PORT never succeeds.
    const dir = serverProject(`import { createServer } from "node:http"; createServer((q, s) => s.end("x")).listen(0, () => console.log("wrong port"));`);
    try {
      const t0 = Date.now();
      await expect(startServer(dir, PROFILES.node)).rejects.toThrow(/did not answer on PORT=\d+[\s\S]*listens on process\.env\.PORT/);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(SERVER_READY_MS - 500);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);
});
