// Fire a desktop notification + sound when a build finishes, so you can look away
// during a build and get pinged. macOS uses osascript; other platforms ring the bell.

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
