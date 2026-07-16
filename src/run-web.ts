// EXPERIMENTAL web-login CLI.
//
//   npm run web -- login claude              open a browser, log in once (session saved)
//   npm run web -- ask claude "2+2? one word"   send a prompt via your web session
//
// This is the standalone proof-of-concept. Wiring it into the full build pipeline
// (parsing tasks/verdicts/code from text) is a separate step.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { webLogin, webComplete, webDump, closeWebSessions, isWebProvider, PROVIDERS } from "./web/session.js";
import { buildAuthorizeUrl, exchangeCode, oauthTest } from "./web/oauth-anthropic.js";

const [cmd, provider, ...rest] = process.argv.slice(2);

function usage(): never {
  console.log("\n  Usage:");
  console.log("    npm run web -- login <provider>");
  console.log('    npm run web -- ask <provider> "your prompt"');
  console.log("    npm run web -- oauth           # Claude: OAuth connect (subscription)");
  console.log("    npm run web -- oauth-test      # Claude: probe if the token still works");
  console.log(`\n  Providers: ${Object.keys(PROVIDERS).join(", ")}\n`);
  process.exit(1);
}

function ask(q: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(q, (a) => { rl.close(); resolve(a); }));
}

// ---- Claude OAuth (subscription) — the enforcement experiment ----
if (cmd === "oauth") {
  const pending = buildAuthorizeUrl();
  console.log("\n  Opening your browser to approve Claude access…");
  console.log("  If it doesn't open, paste this URL manually:\n");
  console.log("    " + pending.url + "\n");
  try { spawn("open", [pending.url], { stdio: "ignore", detached: true }).unref(); } catch { /* print-only */ }
  const code = await ask("  After approving, copy the code shown on the page and paste it here:\n  code> ");
  try {
    await exchangeCode(code, pending);
    console.log("\n  Token stored. Testing whether it survives enforcement…\n");
    const reply = await oauthTest();
    console.log(`  ✅ Works. Reply: ${reply}\n`);
  } catch (e) {
    console.error(`\n  ❌ ${e instanceof Error ? e.message : e}\n`);
    process.exit(1);
  }
  process.exit(0);
} else if (cmd === "oauth-test") {
  try {
    const reply = await oauthTest();
    console.log(`\n  ✅ Works. Reply: ${reply}\n`);
  } catch (e) {
    console.error(`\n  ❌ ${e instanceof Error ? e.message : e}\n`);
    process.exit(1);
  }
  process.exit(0);
}

if (!cmd || !provider || !isWebProvider(provider)) usage();

if (cmd === "login") {
  await webLogin(provider);
  console.log(`  Logged in to ${PROVIDERS[provider].label}. Try: npm run web -- ask ${provider} "hello"\n`);
} else if (cmd === "ask") {
  const prompt = rest.join(" ").trim();
  if (!prompt) usage();
  console.log(`  Asking ${PROVIDERS[provider].label} via your web session…\n`);
  try {
    const reply = await webComplete(provider, prompt);
    console.log("  --- reply ---");
    console.log(reply.split("\n").map((l) => "  " + l).join("\n"));
    console.log("");
  } catch (e) {
    console.error(`  Failed: ${e instanceof Error ? e.message : e}`);
    console.error(`  If selectors are stale, edit src/web/session.ts. If not logged in, run: npm run web -- login ${provider}\n`);
    await closeWebSessions();
    process.exit(1);
  }
  await closeWebSessions(); // one-shot CLI: shut the background browser down
} else if (cmd === "dump") {
  const prompt = rest.join(" ").trim() || "say hello in one word";
  console.log(`  Diagnosing ${PROVIDERS[provider].label} DOM…\n`);
  await webDump(provider, prompt);
} else {
  usage();
}
