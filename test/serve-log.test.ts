// A server's stdout arrives in chunks, not lines. serve.ts split each chunk on its own, so a
// boundary falling mid-line inserted a newline: "listening on 41765" became "listening on" +
// " 41765". That broke readiness matching 1 run in 6, and would mangle any stack trace the
// Tester reads out of this log.

import { describe, it, expect } from "vitest";
import { startServer } from "../src/serve.js";
import type { StackProfile } from "../src/stack.js";

/** A server that deliberately writes one logical line as two chunks, then serves. */
const chunked = (script: string): StackProfile =>
  ({ label: "chunk probe", serve: [process.execPath, "-e", script] }) as unknown as StackProfile;

const SPLIT_BANNER = `
const http = require('http');
const port = process.env.PORT;
process.stdout.write('listening on ');
setTimeout(() => {
  process.stdout.write(port + '\\n');
  http.createServer((_, res) => { res.writeHead(200); res.end('ok'); }).listen(port, '127.0.0.1');
}, 120);
`;

describe("server log capture", () => {
  it("reassembles a line split across two writes", async () => {
    const srv = await startServer(process.cwd(), chunked(SPLIT_BANNER));
    try {
      expect(srv.log()).toMatch(/listening on \d+/);
      expect(srv.log()).not.toMatch(/listening on\n/);
    } finally { await srv.close(); }
  }, 30_000);

  it("keeps an unterminated final line, so a crash message isn't swallowed", async () => {
    // Writes a fatal-looking message with no trailing newline, then never listens.
    const script = `process.stdout.write('FATAL: cannot bind'); setInterval(() => {}, 1000);`;
    await expect(startServer(process.cwd(), chunked(script))).rejects.toThrow(/FATAL: cannot bind/);
  }, 60_000);
});
