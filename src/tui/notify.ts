// Fire a desktop notification + sound when a build finishes, so you can look away
// during a build and get pinged. macOS uses osascript; other platforms ring the bell.
// Optionally POST the same news to a webhook (Slack/Discord/n8n/anything JSON).

import { spawn } from "node:child_process";

export function notifyBuildDone(title: string, message: string): void {
  try {
    if (process.platform === "darwin") {
      const script = `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)} sound name "Glass"`;
      const child = spawn("osascript", ["-e", script], { detached: true, stdio: "ignore" });
      child.unref();
    } else if (process.platform === "win32") {
      // PowerShell balloon-free ping: just the console bell.
      process.stdout.write("\x07");
    } else {
      process.stdout.write("\x07"); // terminal bell
    }
  } catch {
    /* best effort — never break the build on a notification failure */
  }
}

export interface BuildWebhookPayload {
  event: "build.finished";
  status: "complete" | "halted";
  haltReason?: string;
  idea: string;
  totalCost: number;
  files: string[];
  workspace: string;
  /** ISO timestamp. */
  at: string;
}

/** POST a JSON summary to `url`. Best effort with a 5 s timeout; resolves to whether
 *  the endpoint accepted it (2xx). Never throws — a dead webhook must not fail a build. */
export async function postWebhook(url: string, payload: BuildWebhookPayload): Promise<boolean> {
  if (!url) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "projectinator" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
