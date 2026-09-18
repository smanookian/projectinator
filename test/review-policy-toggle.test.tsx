// The review policy is a spend decision, so it has to be reachable and it has to stick:
// Settings → Build defaults → "Code reviews" cycles Hard tasks only → Every code task → Off,
// persisting each step (default "high" makes reviews ~22% cheaper than reviewing every task).

import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { Settings } from "../src/tui/Settings.js";
import { getPrefs, setPrefs, getWebhookUrl, setWebhookUrl } from "../src/tui/config.js";

const DOWN = "\u001b[B";
const ENTER = "\r";

function app() {
  const r = render(<Settings onExit={() => {}} />);
  const key = async (s: string) => { r.stdin.write(s); await new Promise((res) => setTimeout(res, 40)); };
  const frame = () => r.lastFrame() ?? "";
  const focused = () => frame().split("\n").find((l) => l.includes("❯")) ?? "";
  return { key, frame, focused, cleanup: () => r.unmount() };
}

describe("review policy toggle", () => {
  it("is reachable in Settings and cycles high → all → off, persisting each step", async () => {
    setPrefs({ reviewPolicy: "high" });
    const a = app();
    try {
      expect(a.frame()).toMatch(/Code reviews:\s*Hard tasks only/);

      for (let i = 0; i < 20 && !a.focused().includes("Code reviews"); i++) await a.key(DOWN);
      expect(a.focused(), "could not reach the Code reviews row").toContain("Code reviews");

      await a.key(ENTER);
      expect(getPrefs().reviewPolicy).toBe("all");
      expect(a.frame()).toMatch(/Code reviews:\s*Every code task/);

      await a.key(ENTER);
      expect(getPrefs().reviewPolicy).toBe("off");
      expect(a.frame()).toMatch(/Code reviews:\s*Off/);

      await a.key(ENTER);
      expect(getPrefs().reviewPolicy).toBe("high");
    } finally {
      a.cleanup();
      setPrefs({ reviewPolicy: "high" });
    }
  });
});

describe("preferences survive a reload", () => {
  // loadConfig() used to project an explicit field list, so anything missing from it was
  // written to disk and dropped on read — the webhook, both per-task limits, parallel code and
  // the review policy all silently reverted to their defaults.
  it("every pref written is the pref read back", () => {
    const wanted = {
      budgetCapUSD: 50,
      concurrency: 5,
      budgetAlertPct: 60,
      taskTimeoutMin: 20,
      taskCostCapUSD: 7,
      parallelCode: true,
      reviewPolicy: "all",
    } as const;
    const before = getPrefs();
    try {
      setPrefs({ ...wanted });
      expect(getPrefs()).toMatchObject(wanted);
    } finally {
      setPrefs({ ...before });
    }
  });

  it("the webhook URL survives too", () => {
    const before = getWebhookUrl();
    try {
      setWebhookUrl("https://example.com/hook");
      expect(getWebhookUrl()).toBe("https://example.com/hook");
    } finally {
      setWebhookUrl(before);
    }
  });
});
