// Offline: the tester's verdict must say whether the app was actually executed.
// Without Chromium, check_app refuses (and says so to the model) and any PASS is
// stamped runtimeChecked=false so the UI can flag it. No browser, no spend.

import { describe, it, expect } from "vitest";
import { buildCheckTool, buildVerdictTool, buildRolePrompt } from "../src/roles.js";

describe("task notes are human-only", () => {
  it("buildRolePrompt never includes a task's notes", () => {
    const prompt = buildRolePrompt(
      { id: "T-9", title: "Build the header", capability: "code", difficulty: "low", estTokens: { input: 1, output: 1 }, notes: "SECRET-NOTE-42" },
      "some context",
    );
    expect(prompt).not.toContain("SECRET-NOTE-42");
  });
});

// Pi tool execute() takes (id, params, signal, onUpdate, ctx); our tools use the first two.
const none = undefined as never;

function firstText(reply: { content: unknown[] }): string {
  const part = reply.content[0];
  if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
  throw new Error("expected a text part");
}

describe("tester verdict without Chromium", () => {
  it("check_app declines with the install hint and the verdict is not runtime-checked", async () => {
    const check = buildCheckTool("/nonexistent", false);
    const verdict = buildVerdictTool(check.rendered);

    const text = firstText(await check.tool.execute("call-0", {}, none, none, none));
    expect(text).toMatch(/UNAVAILABLE/);
    expect(text).toMatch(/npx playwright install chromium/);
    expect(check.rendered()).toBe(false);

    await verdict.tool.execute("call-1", { passed: true, bugs: [] }, none, none, none);
    expect(verdict.get()).toEqual({ passed: true, bugs: [], runtimeChecked: false });
  });

  it("a verdict submitted before any check_app call is not runtime-checked even with Chromium", async () => {
    const check = buildCheckTool("/nonexistent", true);
    const verdict = buildVerdictTool(check.rendered);
    await verdict.tool.execute("call-1", { passed: true, bugs: [] }, none, none, none);
    expect(verdict.get()?.runtimeChecked).toBe(false);
  });
});
