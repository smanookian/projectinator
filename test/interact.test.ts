// interact_app: the Tester drives the page with a short step script. Against real
// Chromium: a working calculator passes; a wrong expectation names the failing step;
// a missing element fails with Playwright's reason; the tool coerces loose step objects.

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { interactCheck, chromiumAvailable } from "../src/preview.js";
import { buildInteractTool } from "../src/roles.js";

const hasChromium = await chromiumAvailable();
const none = undefined as never;

const CALC = `<!doctype html><html lang="en"><head><title>Calc</title></head><body>
<input id="a" type="number"><input id="b" type="number"><button id="add">Add</button>
<p id="out">—</p>
<script>document.getElementById("add").onclick=()=>{document.getElementById("out").textContent=String(+a.value + +b.value);}</script>
</body></html>`;

describe.skipIf(!hasChromium)("interactCheck", () => {
  const fixture = () => { const d = mkdtempSync(join(tmpdir(), "pi-interact-")); writeFileSync(join(d, "index.html"), CALC); return d; };

  it("passes a working flow and screenshots the end state", async () => {
    const dir = fixture();
    try {
      const r = await interactCheck(dir, "index.html", [
        { fill: "#a", value: "2" }, { fill: "#b", value: "3" }, { click: "#add" }, { expectText: "#out", contains: "5" },
      ], { screenshotPath: join(dir, ".checks", "x.png") });
      expect(r.ok).toBe(true);
      expect(r.steps.map((s) => s.ok)).toEqual([true, true, true, true]);
      expect(existsSync(join(dir, ".checks", "x.png"))).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  it("a wrong expectation fails at that step with what was actually shown", async () => {
    const dir = fixture();
    try {
      const r = await interactCheck(dir, "index.html", [{ fill: "#a", value: "2" }, { fill: "#b", value: "3" }, { click: "#add" }, { expectText: "#out", contains: "6" }, { click: "#add" }]);
      expect(r.ok).toBe(false);
      expect(r.steps).toHaveLength(4); // stops at the failure; step 5 never runs
      expect(r.steps[3]).toMatchObject({ step: 4, ok: false });
      expect(r.steps[3]!.detail).toMatch(/got "5"/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  it("a missing element fails with a reason instead of hanging", async () => {
    const dir = fixture();
    try {
      const r = await interactCheck(dir, "index.html", [{ click: "#nope" }]);
      expect(r.ok).toBe(false);
      expect(r.steps[0]!.detail).toMatch(/click #nope — /);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  it("the tool coerces loose steps, reports per step, and records the screenshot", async () => {
    const dir = fixture();
    const shots: string[] = [];
    const { tool } = buildInteractTool(dir, true, "T-1-r0", shots);
    try {
      const reply = await tool.execute("c", { steps: [{ fill: "#a", value: "1" }, { fill: "#b", value: "1" }, { click: "#add" }, { expectText: "#out", contains: "2" }, { bogus: true }] }, none, none, none);
      const text = String((reply.content[0] as { text?: unknown }).text);
      expect(text).toMatch(/PASSED \(4\/4 steps\)/); // the bogus step is dropped, not counted
      expect(shots).toHaveLength(1);
      expect(shots[0]).toMatch(/T-1-r0-interact1\.png$/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);
});
