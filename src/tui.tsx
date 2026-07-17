// TUI entry — `npm start`.
import React from "react";
import { render } from "ink";
import { ThemeProvider } from "@inkjs/ui";
import App from "./tui/App.js";
import { uiTheme } from "./tui/theme.js";
import { applyKeysToEnv } from "./tui/config.js";
import { listProjects } from "./tui/engine.js";
import { sessionCost } from "./session-cost.js";
import { closeWebSessions } from "./web/session.js";

// Load any keys saved via Settings into the environment so Pi picks them up.
applyKeysToEnv();

const AMBER = "\x1b[38;2;224;167;45m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

// Run in the alternate screen buffer (like vim/htop/opencode): the app owns the
// whole terminal, never scrolls into your shell history, and restores the shell
// exactly as it was on exit.
const ALT_ENTER = "\x1b[?1049h";
const ALT_EXIT = "\x1b[?1049l";
const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";

let screenRestored = false;
function restoreScreen(): void {
  if (screenRestored) return;
  screenRestored = true;
  process.stdout.write(CURSOR_SHOW + ALT_EXIT);
}

process.stdout.write(ALT_ENTER + CURSOR_HIDE);
// Safety nets so a hard exit / signal never leaves the terminal in the alt buffer.
process.on("exit", restoreScreen);
process.on("SIGTERM", () => { restoreScreen(); process.exit(0); });

const app = render(
  <ThemeProvider theme={uiTheme}>
    <App />
  </ThemeProvider>,
);

let goodbyePrinted = false;
function goodbye(): void {
  if (goodbyePrinted) return;
  goodbyePrinted = true;
  // Leaving the alt buffer already restored the shell; just print the send-off below it.
  const projects = listProjects();
  const allTime = projects.reduce((a, p) => a + p.totalCost, 0);
  const session = sessionCost();
  process.stdout.write(`${AMBER}PROJECTINATOR${RESET}  ·  your AI build team\n`);
  process.stdout.write(`${DIM}This session: ${AMBER}$${session.toFixed(2)}${RESET}${DIM}  ·  All time: $${allTime.toFixed(2)} across ${projects.length} project${projects.length === 1 ? "" : "s"}.${RESET}\n`);
  process.stdout.write(`${DIM}See you next time.${RESET}\n\n`);
}

app.waitUntilExit().then(async () => {
  await closeWebSessions(); // shut down any background web-session browsers
  restoreScreen(); // leave the alt buffer → back to the normal shell
  goodbye(); // send-off prints in the normal buffer, below your prompt history
  process.exit(0); // exit cleanly so nothing keeps the process (and Ctrl+C) alive
});
