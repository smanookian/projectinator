// Static-serving + headless render check for built web apps.
//
// Two uses:
//  - renderCheck(): load the built app in a headless browser, collect JS/console
//    errors + the rendered text, so the TESTER role verifies the app actually
//    RUNS (not just that the code reads correctly).
//  - startStaticServer(): a tiny local file server, reused by live preview.
//
// A real http server (not file://) so ES modules, fetch of local assets, and
// relative paths all resolve the way they will in production.

import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import type { Browser } from "playwright";
import { PAGE_FACTS_SCRIPT, type PageFacts } from "./a11y.js";
import { dirname, extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

const TYPES: Record<string, string> = {
  ".html": "text/html", ".htm": "text/html", ".css": "text/css",
  ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
};

export interface StaticServer {
  url: string; // http://127.0.0.1:<port>
  port: number;
  close: () => Promise<void>;
}

// Injected into served HTML when liveReload is on: polls /__mtime and reloads
// when any file in the directory changes (so the page refreshes as a build runs).
const RELOAD_SNIPPET = `<script>(function(){let last=null;setInterval(async function(){try{var r=await fetch('/__mtime');var t=await r.text();if(last!==null&&t!==last){location.reload();}last=t;}catch(e){}},1000);})();</script>`;

/** Newest mtime (ms) across all files in dir — a cheap change signal. */
function maxMtime(dir: string): number {
  let max = 0;
  const walk = (d: string) => {
    let entries: string[];
    try { entries = readdirSync(d); } catch { return; }
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const full = join(d, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full);
      else if (st.mtimeMs > max) max = st.mtimeMs;
    }
  };
  walk(dir);
  return max;
}

/** Serve `dir` on a random loopback port. Path traversal is blocked.
 *  opts.liveReload injects a poller that reloads the page when files change. */
export function startStaticServer(dir: string, opts: { liveReload?: boolean } = {}): Promise<StaticServer> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      try {
        const reqPath = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
        if (opts.liveReload && reqPath === "/__mtime") {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end(String(maxMtime(dir)));
          return;
        }
        // Resolve within dir; reject anything that escapes it.
        const rel = normalize(reqPath).replace(/^(\.\.[/\\])+/, "");
        let filePath = join(dir, rel);
        if (!filePath.startsWith(dir)) { res.writeHead(403).end("forbidden"); return; }
        let st;
        try { st = statSync(filePath); } catch { res.writeHead(404).end("not found"); return; }
        if (st.isDirectory()) filePath = join(filePath, "index.html");
        const type = TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
        if (opts.liveReload && type === "text/html") {
          let html = readFileSync(filePath, "utf8");
          html = html.includes("</body>") ? html.replace("</body>", `${RELOAD_SNIPPET}</body>`) : html + RELOAD_SNIPPET;
          res.writeHead(200, { "Content-Type": type });
          res.end(html);
          return;
        }
        res.writeHead(200, { "Content-Type": type });
        res.end(readFileSync(filePath));
      } catch {
        res.writeHead(500).end("error");
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

export interface ViewportResult {
  width: number;
  screenshotPath: string;
  /** Page is wider than the viewport — the classic broken-phone-layout signal. */
  overflowsHorizontally: boolean;
  /** Rendered body text length at this width (0 = blank). */
  textLength: number;
}

export interface RenderReport {
  ok: boolean; // rendered over http with no JS/console errors
  file: string;
  title: string;
  text: string; // rendered body text (trimmed)
  errors: string[]; // console errors + uncaught page errors (http)
  screenshotPath?: string;
  /** One entry per checked width (phone/tablet/desktop) when `checksDir` was given. */
  viewports: ViewportResult[];
  /** Deterministic quality facts from the http render (undefined if evaluation failed). */
  facts?: PageFacts;
  // The way a non-technical user opens the folder: double-click → file://.
  // ES modules + relative imports (and fetch of local assets) die here even
  // though they work over a server — so we render BOTH and compare.
  fileOk: boolean; // rendered over file:// with no errors AND real content
  fileText: string; // rendered body text via file://
  fileErrors: string[]; // errors seen via file://
  // True when the app clearly works over a server but is broken on double-click
  // (renders content over http, but blank/erroring over file://). The classic
  // "AI shipped an app that only runs behind a server the user won't start".
  doubleClickBroken: boolean;
}

/** Widths the tester screenshots: phone, tablet, desktop. */
export const VIEWPORTS = [390, 820, 1280] as const;

/** Screenshot one page at each width; report overflow + text length per width. */
async function renderViewports(
  browser: Browser,
  url: string,
  outDir: string,
  prefix: string,
  timeoutMs: number,
): Promise<ViewportResult[]> {
  mkdirSync(outDir, { recursive: true });
  const out: ViewportResult[] = [];
  for (const width of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
      const screenshotPath = join(outDir, `${prefix}-${width}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const m = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        textLength: (document.body?.innerText ?? "").trim().length,
      }));
      out.push({ width, screenshotPath, overflowsHorizontally: m.overflow, textLength: m.textLength });
    } catch {
      out.push({ width, screenshotPath: "", overflowsHorizontally: false, textLength: 0 });
    } finally {
      await page.close();
    }
  }
  return out;
}

interface OneRender { title: string; text: string; errors: string[]; facts?: PageFacts; }

/** Render a single URL and capture title, visible text, and errors. */
async function renderOne(
  browser: Browser,
  url: string,
  opts: { screenshotPath?: string; timeoutMs?: number; facts?: boolean } = {},
): Promise<OneRender> {
  const errors: string[] = [];
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console.error: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`uncaught: ${e.message}`));
  page.on("requestfailed", (r) => {
    const u = r.url();
    if (!u.endsWith("/favicon.ico")) errors.push(`failed request: ${u} (${r.failure()?.errorText ?? "?"})`);
  });
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: opts.timeoutMs ?? 15_000 });
    const title = await page.title().catch(() => "");
    const text = (await page.locator("body").innerText().catch(() => "")).trim().slice(0, 800);
    if (opts.screenshotPath) {
      try { await page.screenshot({ path: opts.screenshotPath, fullPage: true }); } catch { /* non-fatal */ }
    }
    const facts = opts.facts ? await page.evaluate(PAGE_FACTS_SCRIPT).then((f) => f as PageFacts).catch(() => undefined) : undefined;
    return { title, text, errors, facts };
  } finally {
    await page.close();
  }
}

/** Whether the tester can actually run apps: Playwright's Chromium is installed.
 *  No launch, just the executable lookup — cheap enough to call per task.
 *  Dynamic import on purpose (same as renderCheck): playwright is optional. */
export async function chromiumAvailable(): Promise<boolean> {
  try {
    const { chromium } = await import("playwright");
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

export const CHROMIUM_INSTALL_HINT = "run `npx playwright install chromium` to enable real test execution";

/** Load a built page in headless Chromium and report what actually happened —
 *  over http (production-like) AND over file:// (how a user double-clicks it). */
export async function renderCheck(
  dir: string,
  file = "index.html",
  opts: {
    screenshotPath?: string; timeoutMs?: number; checksDir?: string; checksPrefix?: string;
    /** Folder to serve (a build's outDir); default the project itself. */
    serveDir?: string;
    /** Whether the file:// double-click check applies (static stacks only; default true). */
    doubleClick?: boolean;
    /** An already-running server (backend stacks) — render this instead of serving a folder. */
    baseUrl?: string;
  } = {},
): Promise<RenderReport> {
  const { chromium } = await import("playwright");
  const serveDir = opts.serveDir ?? dir;
  const server = opts.baseUrl ? { url: opts.baseUrl, close: async () => {} } : await startStaticServer(serveDir);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    await server.close(); // don't leak the port if Chromium can't launch
    throw e;
  }
  try {
    const pageUrl = `${server.url}/${file}`.replace(/\/+$/, opts.baseUrl && !file ? "/" : "");
    const http = await renderOne(browser, pageUrl, { ...opts, facts: true });
    const viewports = opts.checksDir
      ? await renderViewports(browser, pageUrl, opts.checksDir, opts.checksPrefix ?? "check", opts.timeoutMs ?? 15_000)
      : [];
    const ok = http.errors.length === 0;
    // file:// (double-click) only matters for static stacks; a built app is served.
    const checkFile = (opts.doubleClick ?? true) && !opts.baseUrl;
    const fileR = checkFile ? await renderOne(browser, pathToFileURL(join(serveDir, file)).href, { timeoutMs: opts.timeoutMs }) : { title: "", text: http.text, errors: [] };
    const fileHasContent = fileR.text.length > 0;
    const fileOk = fileR.errors.length === 0 && fileHasContent;
    // Broken-on-double-click = works served, but blank or erroring as a file.
    const doubleClickBroken = checkFile && ok && http.text.length > 0 && !fileOk;

    return {
      ok,
      file,
      title: http.title,
      text: http.text,
      errors: http.errors,
      screenshotPath: opts.screenshotPath,
      viewports,
      facts: http.facts,
      fileOk,
      fileText: fileR.text,
      fileErrors: fileR.errors,
      doubleClickBroken,
    };
  } finally {
    await browser.close();
    await server.close();
  }
}

// ---- interaction probe: a tiny declarative script the Tester writes ----

export type InteractStep =
  | { click: string }
  | { fill: string; value: string }
  | { select: string; value: string }
  | { press: string }
  | { expectText: string; contains: string }
  | { expectVisible: string }
  | { expectUrl: string };

export interface StepResult { step: number; ok: boolean; detail: string }

export interface InteractReport {
  ok: boolean;
  steps: StepResult[];
  errors: string[]; // console/page errors raised DURING the interaction
  screenshotPath?: string;
}

export const INTERACT_MAX_STEPS = 20;
const INTERACT_TOTAL_MS = 10_000;
const STEP_MS = 3_000;

function stepLabel(s: InteractStep): string {
  if ("click" in s) return `click ${s.click}`;
  if ("fill" in s) return `fill ${s.fill} = ${JSON.stringify(s.value)}`;
  if ("select" in s) return `select ${s.select} = ${JSON.stringify(s.value)}`;
  if ("press" in s) return `press ${s.press}`;
  if ("expectText" in s) return `expect ${s.expectText} contains ${JSON.stringify(s.contains)}`;
  if ("expectVisible" in s) return `expect ${s.expectVisible} visible`;
  return `expect url contains ${JSON.stringify(s.expectUrl)}`;
}

/** Run a bounded step script against the served page. Stops at the first failing step
 *  (later steps would be meaningless) but still reports it and screenshots the end state. */
export async function interactCheck(
  dir: string,
  file: string,
  steps: InteractStep[],
  opts: { screenshotPath?: string; serveDir?: string; baseUrl?: string } = {},
): Promise<InteractReport> {
  const { chromium } = await import("playwright");
  const server = opts.baseUrl ? { url: opts.baseUrl, close: async () => {} } : await startStaticServer(opts.serveDir ?? dir);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    await server.close();
    throw e;
  }
  const errors: string[] = [];
  const results: StepResult[] = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console.error: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`uncaught: ${e.message}`));
  const deadline = Date.now() + INTERACT_TOTAL_MS;
  try {
    await page.goto(`${server.url}/${file}`.replace(/\/+$/, "") || server.url, { waitUntil: "networkidle", timeout: 15_000 });
    for (const [i, s] of steps.slice(0, INTERACT_MAX_STEPS).entries()) {
      const n = i + 1;
      if (Date.now() > deadline) { results.push({ step: n, ok: false, detail: `${stepLabel(s)} — skipped: ${INTERACT_TOTAL_MS / 1000}s total budget exhausted` }); break; }
      const t = { timeout: Math.min(STEP_MS, Math.max(200, deadline - Date.now())) };
      try {
        if ("click" in s) await page.locator(s.click).first().click(t);
        else if ("fill" in s) await page.locator(s.fill).first().fill(s.value, t);
        else if ("select" in s) await page.locator(s.select).first().selectOption(s.value, t);
        else if ("press" in s) await page.keyboard.press(s.press);
        else if ("expectText" in s) {
          const text = await page.locator(s.expectText).first().innerText(t);
          if (!text.includes(s.contains)) { results.push({ step: n, ok: false, detail: `${stepLabel(s)} — got ${JSON.stringify(text.trim().slice(0, 120))}` }); break; }
        } else if ("expectVisible" in s) {
          if (!(await page.locator(s.expectVisible).first().isVisible())) { results.push({ step: n, ok: false, detail: `${stepLabel(s)} — not visible (or no such element)` }); break; }
        } else if (!page.url().includes(s.expectUrl)) { results.push({ step: n, ok: false, detail: `${stepLabel(s)} — url is ${page.url()}` }); break; }
        results.push({ step: n, ok: true, detail: stepLabel(s) });
      } catch (e) {
        const msg = e instanceof Error ? e.message.split("\n")[0]! : String(e);
        results.push({ step: n, ok: false, detail: `${stepLabel(s)} — ${msg}` });
        break;
      }
    }
    if (opts.screenshotPath) {
      mkdirSync(dirname(opts.screenshotPath), { recursive: true });
      try { await page.screenshot({ path: opts.screenshotPath, fullPage: true }); } catch { /* non-fatal */ }
    }
    return { ok: results.every((r) => r.ok) && errors.length === 0, steps: results, errors, screenshotPath: opts.screenshotPath };
  } finally {
    await page.close();
    await browser.close();
    await server.close();
  }
}
