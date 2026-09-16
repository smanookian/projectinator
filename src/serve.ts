// Serve-for-test for server stacks: spawn the profile's `serve` command on a free PORT,
// wait until it answers HTTP, hand back the URL, and kill the whole process tree when the
// tester is done. Static/Vite stacks don't use this — they're served from a folder.

import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import type { StackProfile } from "./stack.js";

export interface RunningServer {
  url: string;
  /** Output so far (stdout+stderr, last ~200 lines) — for the Tester when something's wrong. */
  log: () => string;
  close: () => Promise<void>;
}

export const SERVER_READY_MS = 20_000;

function freePort(): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const s = createServer();
  s.on("error", reject);
  s.listen(0, "127.0.0.1", () => {
    const { port } = s.address() as { port: number };
    s.close(() => resolve(port));
  });
  return promise;
}

function killTree(child: ChildProcess): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  if (child.exitCode !== null || child.signalCode) return Promise.resolve();
  child.once("exit", () => resolve());
  try {
    // Detached child = its own process group; negative pid signals the whole group.
    if (child.pid) process.kill(-child.pid, "SIGTERM");
  } catch { child.kill("SIGTERM"); }
  setTimeout(() => { try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ } resolve(); }, 3_000).unref();
  return promise;
}

/** Start the profile's server. Rejects with the captured output if it never listens. */
export async function startServer(dir: string, profile: StackProfile): Promise<RunningServer> {
  if (!profile.serve?.length) throw new Error(`${profile.label} has no serve command`);
  const port = await freePort();
  const [cmd, ...args] = profile.serve;
  const child = spawn(cmd!, args, {
    cwd: dir,
    env: { ...process.env, PORT: String(port), NODE_ENV: "production", CI: "1", FORCE_COLOR: "0" },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines: string[] = [];
  const keep = (chunk: Buffer) => { for (const l of chunk.toString().split("\n")) if (l.trim()) { lines.push(l); if (lines.length > 200) lines.shift(); } };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  const url = `http://127.0.0.1:${port}`;
  const log = () => lines.join("\n");
  const close = () => killTree(child);

  const deadline = Date.now() + SERVER_READY_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`the server exited with code ${child.exitCode} before listening on PORT=${port}.\n${log()}`);
    }
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1_000);
      const res = await fetch(url + "/", { signal: ctrl.signal }).finally(() => clearTimeout(t));
      if (res.status < 500) return { url, log, close };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await close();
  throw new Error(`the server did not answer on PORT=${port} within ${SERVER_READY_MS / 1000}s. Make sure it listens on process.env.PORT.\n${log()}`);
}
