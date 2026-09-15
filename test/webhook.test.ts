// postWebhook: delivers the JSON summary to a real local endpoint, and never throws
// when the endpoint is dead or rejects — a broken webhook must not fail a build.

import { describe, it, expect } from "vitest";
import { createServer, type IncomingMessage } from "node:http";
import { postWebhook, type BuildWebhookPayload } from "../src/tui/notify.js";

const payload: BuildWebhookPayload = {
  event: "build.finished", status: "complete", idea: "a tip calculator", totalCost: 0.46,
  files: ["index.html"], workspace: "/tmp/x", at: "2026-09-15T00:00:00.000Z",
};

function readBody(req: IncomingMessage): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  let s = "";
  req.setEncoding("utf8");
  req.on("data", (c: string) => { s += c; });
  req.on("end", () => resolve(s));
  return promise;
}

describe("postWebhook", () => {
  it("POSTs the payload as JSON and resolves true on 2xx", async () => {
    const got = Promise.withResolvers<{ method: string; type: string; body: string }>();
    const server = createServer(async (req, res) => {
      got.resolve({ method: req.method ?? "", type: String(req.headers["content-type"]), body: await readBody(req) });
      res.writeHead(204).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as { port: number };
    try {
      expect(await postWebhook(`http://127.0.0.1:${port}/hook`, payload)).toBe(true);
      const g = await got.promise;
      expect(g.method).toBe("POST");
      expect(g.type).toBe("application/json");
      expect(JSON.parse(g.body)).toEqual(payload);
    } finally {
      server.close();
    }
  });

  it("resolves false (no throw) on a non-2xx or unreachable endpoint", async () => {
    const server = createServer((_req, res) => res.writeHead(500).end());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as { port: number };
    try {
      expect(await postWebhook(`http://127.0.0.1:${port}/hook`, payload)).toBe(false);
    } finally {
      server.close();
    }
    expect(await postWebhook("http://127.0.0.1:1/nope", payload)).toBe(false);
    expect(await postWebhook("", payload)).toBe(false);
  });
});
