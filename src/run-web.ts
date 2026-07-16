// EXPERIMENTAL web-login CLI.
//
//   npm run web -- login claude              open a browser, log in once (session saved)
//   npm run web -- ask claude "2+2? one word"   send a prompt via your web session
//
// This is the standalone proof-of-concept. Wiring it into the full build pipeline
// (parsing tasks/verdicts/code from text) is a separate step.

import { webLogin, webComplete, webDump, isWebProvider, PROVIDERS } from "./web/session.js";

const [cmd, provider, ...rest] = process.argv.slice(2);

function usage(): never {
  console.log("\n  Usage:");
  console.log("    npm run web -- login <provider>");
  console.log('    npm run web -- ask <provider> "your prompt"');
  console.log(`\n  Providers: ${Object.keys(PROVIDERS).join(", ")}\n`);
  process.exit(1);
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
    process.exit(1);
  }
} else if (cmd === "dump") {
  const prompt = rest.join(" ").trim() || "say hello in one word";
  console.log(`  Diagnosing ${PROVIDERS[provider].label} DOM…\n`);
  await webDump(provider, prompt);
} else {
  usage();
}
