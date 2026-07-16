// EXPERIMENTAL web-login backend. Drives a provider's WEB UI (logged into your paid
// subscription) in a persistent Chromium profile to get ~free completions.
//
// Caveats you accepted: brittle (site DOM changes break selectors), against provider
// ToS (account-ban risk), TEXT ONLY (no tool-calling / no file tools), slow.
//
// Selectors live in PROVIDERS below — when a site changes, edit them there.

import { chromium, type BrowserContext, type Page } from "playwright";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

export type WebProvider = "chatgpt" | "claude" | "gemini";

interface ProviderConfig {
  label: string;
  newChatUrl: string;
  /** The message input (contenteditable or textarea). */
  inputSelector: string;
  /** Selector matching every assistant message; we read the last one. */
  assistantSelector: string;
  /** Selector for the "stop generating" control — present while streaming. */
  stopSelector: string;
}

const PROVIDERS: Record<WebProvider, ProviderConfig> = {
  claude: {
    label: "Claude (claude.ai)",
    newChatUrl: "https://claude.ai/new",
    inputSelector: 'div[contenteditable="true"]',
    assistantSelector: '[class*="claude"]',
    stopSelector: '[data-is-streaming="true"]',
  },
  chatgpt: {
    label: "ChatGPT (chatgpt.com)",
    newChatUrl: "https://chatgpt.com/",
    inputSelector: '#prompt-textarea, div[contenteditable="true"], textarea',
    assistantSelector: '[data-message-author-role="assistant"]',
    stopSelector: 'button[data-testid="stop-button"], button[aria-label*="Stop"]',
  },
  gemini: {
    label: "Gemini (gemini.google.com)",
    newChatUrl: "https://gemini.google.com/app",
    inputSelector: 'rich-textarea div[contenteditable="true"], div[contenteditable="true"], textarea',
    assistantSelector: "message-content, .model-response-text",
    stopSelector: 'button[aria-label*="Stop"], button[aria-label*="stop"]',
  },
};

function profileDir(provider: WebProvider): string {
  const dir = join(homedir(), ".projectinator", "web", provider);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function connectedMarker(provider: WebProvider): string {
  return join(profileDir(provider), ".connected");
}

/** Has this provider been logged in at least once (session saved)? */
export function isConnected(provider: WebProvider): boolean {
  return existsSync(connectedMarker(provider));
}

/** Which providers have a saved session. */
export function connectedProviders(): WebProvider[] {
  return (Object.keys(PROVIDERS) as WebProvider[]).filter(isConnected);
}

function markConnected(provider: WebProvider): void {
  try {
    writeFileSync(connectedMarker(provider), new Date().toISOString());
  } catch {
    /* non-fatal */
  }
}

/** Log out: wipe the saved session (cookies + profile) for a provider. */
export function disconnect(provider: WebProvider): void {
  try {
    rmSync(profileDir(provider), { recursive: true, force: true });
  } catch {
    /* non-fatal */
  }
}

// Push the run window far off-screen so it drives the session without stealing
// focus or cluttering the desktop. Login windows stay on-screen (you interact).
const OFFSCREEN_ARGS = ["--window-position=-3200,-3200", "--window-size=1280,900"];

async function openContext(
  provider: WebProvider,
  opts: { headless: boolean; offscreen?: boolean },
): Promise<BrowserContext> {
  return chromium.launchPersistentContext(profileDir(provider), {
    headless: opts.headless,
    viewport: { width: 1280, height: 900 },
    args: [
      "--disable-blink-features=AutomationControlled",
      ...(opts.offscreen ? OFFSCREEN_ARGS : []),
    ],
  });
}

// One long-lived background browser per provider, reused across completions so
// nothing pops up per task. Launched on first webComplete, closed on app exit.
const runContexts = new Map<WebProvider, BrowserContext>();

async function runContext(provider: WebProvider): Promise<BrowserContext> {
  const existing = runContexts.get(provider);
  if (existing) return existing;
  const ctx = await openContext(provider, { headless: false, offscreen: true });
  ctx.on("close", () => {
    if (runContexts.get(provider) === ctx) runContexts.delete(provider);
  });
  runContexts.set(provider, ctx);
  return ctx;
}

/** Close every background browser. Call on app exit. */
export async function closeWebSessions(): Promise<void> {
  const ctxs = [...runContexts.values()];
  runContexts.clear();
  await Promise.all(ctxs.map((c) => c.close().catch(() => {})));
}

/** Open a real browser window so you can log in once; the session is saved to disk. */
export async function webLogin(provider: WebProvider): Promise<void> {
  const cfg = PROVIDERS[provider];
  const ctx = await openContext(provider, { headless: false });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  // Non-fatal: even if the page is slow / behind a challenge, the window is open
  // and you can log in (or navigate) manually.
  try {
    await page.goto(cfg.newChatUrl, { waitUntil: "commit", timeout: 60_000 });
  } catch {
    /* keep the window open regardless */
  }
  process.stdout.write(`\n  A browser opened for ${cfg.label}.\n  Log in there (wait for it to load), then press Enter here to save the session…`);
  await new Promise<void>((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question("", () => {
      rl.close();
      resolve();
    });
  });
  await ctx.close();
  markConnected(provider);
  process.stdout.write("  Session saved.\n");
}

/** Non-interactive login for the TUI: open the login window and resolve once the
 *  caller signals done (e.g. user pressed a key in the app). Returns a handle to
 *  finish. The window shows the real site so you can log in. */
export async function webLoginBegin(provider: WebProvider): Promise<{
  finish: () => Promise<void>;
  cancel: () => Promise<void>;
}> {
  const cfg = PROVIDERS[provider];
  const ctx = await openContext(provider, { headless: false });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  try {
    await page.goto(cfg.newChatUrl, { waitUntil: "commit", timeout: 60_000 });
  } catch {
    /* keep the window open regardless */
  }
  return {
    finish: async () => {
      await ctx.close();
      markConnected(provider);
    },
    cancel: async () => {
      await ctx.close();
    },
  };
}

async function lastAssistantText(page: Page, cfg: ProviderConfig): Promise<string> {
  const nodes = page.locator(cfg.assistantSelector);
  const count = await nodes.count();
  if (count === 0) return "";
  return (await nodes.nth(count - 1).innerText()).trim();
}

/** Send one prompt to the provider's web UI and return the reply text.
 *  Runs HEADED by default — claude.ai/chatgpt block headless browsers. Set
 *  opts.headless=true to try headless (often challenged). */
export async function webComplete(
  provider: WebProvider,
  prompt: string,
  opts: { headless?: boolean; timeoutMs?: number } = {},
): Promise<string> {
  const cfg = PROVIDERS[provider];
  const timeoutMs = opts.timeoutMs ?? 90_000;
  // Reuse the one background browser; open a fresh page (= fresh chat) per ask.
  const ctx = await runContext(provider);
  const page = await ctx.newPage();
  try {
    try {
      await page.goto(cfg.newChatUrl, { waitUntil: "commit", timeout: 60_000 });
    } catch {
      /* proceed — the input wait below is the real readiness check */
    }

    const input = page.locator(cfg.inputSelector).first();
    try {
      await input.waitFor({ state: "visible", timeout: 45_000 });
    } catch (e) {
      // Diagnose: dump what actually loaded so we can fix selectors / spot a challenge.
      const shot = join(profileDir(provider), "debug.png");
      try { await page.screenshot({ path: shot, fullPage: false }); } catch { /* ignore */ }
      const url = page.url();
      const title = await page.title().catch(() => "");
      const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 200).replace(/\s+/g, " ");
      throw new Error(
        `Input never appeared.\n    url: ${url}\n    title: ${title}\n    page text: "${body}…"\n    screenshot: ${shot}\n    (looks like a login/challenge page? → the session may not be carrying over, or the selector changed)`,
      );
    }
    await input.click();
    await input.fill(prompt);
    await page.keyboard.press("Enter");

    // Wait for a reply to appear, then for it to stop changing.
    const deadline = Date.now() + timeoutMs;
    let last = "";
    let stable = 0;
    while (Date.now() < deadline) {
      try {
        await page.waitForTimeout(700);
        const text = await lastAssistantText(page, cfg);
        const streaming = (await page.locator(cfg.stopSelector).count()) > 0;
        if (text && text === last && !streaming) {
          stable++;
          if (stable >= 3) return text; // ~2s unchanged and not streaming → done
        } else {
          stable = 0;
        }
        last = text;
      } catch {
        break; // page/context closed — return whatever we captured
      }
    }
    if (last) return last;
    throw new Error("No response captured (selectors may be stale, or you're not logged in).");
  } finally {
    await page.close().catch(() => {}); // keep the context alive for the next ask
  }
}

/** Diagnostic: send a prompt, wait, then dump candidate selectors so we can find the
 *  right one for the assistant reply. Headed. */
export async function webDump(provider: WebProvider, prompt: string): Promise<void> {
  const cfg = PROVIDERS[provider];
  const ctx = await openContext(provider, { headless: false });
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    try { await page.goto(cfg.newChatUrl, { waitUntil: "commit", timeout: 60_000 }); } catch { /* ignore */ }
    const input = page.locator(cfg.inputSelector).first();
    await input.waitFor({ state: "visible", timeout: 45_000 });
    await input.click();
    await input.fill(prompt);
    await page.keyboard.press("Enter");
    console.log("  sent — waiting 18s for the reply to render…");
    await page.waitForTimeout(18_000);

    const report = await page.evaluate(() => {
      const cands = [
        // chatgpt
        '[data-message-author-role="assistant"]', ".markdown",
        // gemini
        "message-content", ".model-response-text", "model-response",
        // claude
        '[class*="claude"]', ".font-claude-message", "[data-is-streaming]",
        // generic
        ".prose", '[class*="message"]', "[data-testid]", "main div[tabindex]",
      ];
      const out: { sel: string; count: number; lastText: string }[] = [];
      for (const sel of cands) {
        const els = document.querySelectorAll(sel);
        const last = els[els.length - 1] as HTMLElement | undefined;
        out.push({ sel, count: els.length, lastText: (last?.innerText ?? "").slice(0, 100).replace(/\s+/g, " ") });
      }
      return { url: location.href, title: document.title, cands: out };
    });
    console.log("\n  url:", report.url, "\n  title:", report.title, "\n  --- candidate selectors ---");
    for (const c of report.cands) console.log(`  [${c.count}] ${c.sel}\n        last: "${c.lastText}"`);
    console.log("");
  } finally {
    await ctx.close();
  }
}

export function isWebProvider(s: string): s is WebProvider {
  return s === "chatgpt" || s === "claude" || s === "gemini";
}

export { PROVIDERS };
