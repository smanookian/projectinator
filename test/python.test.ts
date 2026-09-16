// Python server stack: prepareForTest creates the project's own venv from requirements.txt
// (real python3, empty requirements → no network), startServer runs `.venv/bin/python
// main.py` on a free PORT and the Tester renders against it. A missing requirements.txt is
// the install failure the Tester must see.

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareForTest } from "../src/prepare.js";
import { startServer } from "../src/serve.js";
import { PROFILES, profileFor, stackInstruction, stackChoiceFor } from "../src/stack.js";
import { renderCheck, chromiumAvailable } from "../src/preview.js";

const hasPython = spawnSync("python3", ["-c", "import venv"]).status === 0;
const hasChromium = await chromiumAvailable();

const MAIN = `import os
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"<!doctype html><html lang='en'><head><title>Py</title></head><body><h1>PY-MARKER</h1></body></html>"
        self.send_response(200); self.send_header("content-type", "text/html"); self.end_headers(); self.wfile.write(body)
port = int(os.environ.get("PORT", "8000"))
print("listening on", port, flush=True)
HTTPServer(("127.0.0.1", port), H).serve_forever()
`;

function project(withRequirements = true): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-py-"));
  if (withRequirements) writeFileSync(join(dir, "requirements.txt"), "");
  writeFileSync(join(dir, "main.py"), MAIN);
  return dir;
}

describe("python stack profile", () => {
  it("is chosen for backend/python, excluded from git/share, and the brief asks for main.py + PORT", () => {
    expect(profileFor({ platform: "backend", framework: "python" }).id).toBe("python");
    expect(profileFor(stackChoiceFor("python")).id).toBe("python");
    expect(PROFILES.python.exclude).toContain(".venv/");
    const brief = stackInstruction({ platform: "backend", framework: "python" });
    expect(brief).toMatch(/requirements\.txt/);
    expect(brief).toMatch(/main\.py/);
    expect(brief).toMatch(/PORT/);
  });
});

describe.skipIf(!hasPython)("python stack: prepare + serve", () => {
  it("creates the venv once (cached after), then serves main.py on PORT", async () => {
    const dir = project();
    try {
      const p1 = prepareForTest(dir, PROFILES.python);
      expect(p1.ok).toBe(true);
      expect(existsSync(join(dir, ".venv", "bin", "python"))).toBe(true);
      const p2 = prepareForTest(dir, PROFILES.python);
      expect(p2.log).toEqual(["install: up to date (cached)"]);
      const srv = await startServer(dir, PROFILES.python);
      try {
        expect(srv.log()).toMatch(/listening on \d+/);
        const html = await (await fetch(srv.url)).text();
        expect(html).toContain("PY-MARKER");
        if (hasChromium) {
          const r = await renderCheck(dir, "", { baseUrl: srv.url, checksDir: join(dir, ".checks"), checksPrefix: "T-r0" });
          expect(r.ok).toBe(true);
          expect(r.text).toContain("PY-MARKER");
        }
      } finally { await srv.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  it("no requirements.txt → install failure names the file", () => {
    const dir = project(false);
    try {
      const p = prepareForTest(dir, PROFILES.python);
      expect(p.ok).toBe(false);
      expect(p.failedStep).toBe("install");
      expect(p.output).toMatch(/requirements\.txt is missing/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
