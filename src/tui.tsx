// TUI entry — `npm start`.
import React from "react";
import { render } from "ink";
import { ThemeProvider } from "@inkjs/ui";
import App from "./tui/App.js";
import { uiTheme } from "./tui/theme.js";
import { applyKeysToEnv } from "./tui/config.js";
import { listProjects } from "./tui/engine.js";
import { sessionCost } from "./session-cost.js";

// Load any keys saved via Settings into the environment so Pi picks them up.
applyKeysToEnv();

const AMBER = "\x1b[38;2;224;167;45m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const app = render(
  <ThemeProvider theme={uiTheme}>
    <App />
  </ThemeProvider>,
);

let goodbyePrinted = false;
function goodbye(): void {
  if (goodbyePrinted) return;
  goodbyePrinted = true;
  // Fully clear the terminal (screen + scrollback + home cursor) before the send-off.
  process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
  const projects = listProjects();
  const allTime = projects.reduce((a, p) => a + p.totalCost, 0);
  const session = sessionCost();
  process.stdout.write(`${AMBER}PROJECTINATOR${RESET}  ·  your AI build team\n`);
  process.stdout.write(`${DIM}This session: ${AMBER}$${session.toFixed(2)}${RESET}${DIM}  ·  All time: $${allTime.toFixed(2)} across ${projects.length} project${projects.length === 1 ? "" : "s"}.${RESET}\n`);
  process.stdout.write(`${DIM}See you next time.${RESET}\n\n`);
}

app.waitUntilExit().then(() => {
  goodbye();
  process.exit(0); // exit cleanly so nothing keeps the process (and Ctrl+C) alive
});
