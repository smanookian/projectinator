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
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

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

export interface RenderReport {
  ok: boolean; // rendered with no JS/console errors
  file: string;
  title: string;
  text: string; // rendered body text (trimmed)
  errors: string[]; // console errors + uncaught page errors
  screenshotPath?: string;
}

/** Load a built page in headless Chromium and report what actually happened. */
export async function renderCheck(
  dir: string,
  file = "index.html",
  opts: { screenshotPath?: string; timeoutMs?: number } = {},
): Promise<RenderReport> {
  const { chromium } = await import("playwright");
  const server = await startStaticServer(dir);
  const browser = await chromium.launch({ headless: true });
  const errors: string[] = [];
  try {
    const page = await browser.newPage();
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console.error: ${m.text()}`); });
    page.on("pageerror", (e) => errors.push(`uncaught: ${e.message}`));
    page.on("requestfailed", (r) => {
      const url = r.url();
      // Ignore favicon noise; flag real missing assets.
      if (!url.endsWith("/favicon.ico")) errors.push(`failed request: ${url} (${r.failure()?.errorText ?? "?"})`);
    });
    await page.goto(`${server.url}/${file}`, { waitUntil: "networkidle", timeout: opts.timeoutMs ?? 15_000 });
    const title = await page.title().catch(() => "");
    const text = (await page.locator("body").innerText().catch(() => "")).trim().slice(0, 800);
    if (opts.screenshotPath) {
      try { await page.screenshot({ path: opts.screenshotPath, fullPage: true }); } catch { /* non-fatal */ }
    }
    return { ok: errors.length === 0, file, title, text, errors, screenshotPath: opts.screenshotPath };
  } finally {
    await browser.close();
    await server.close();
  }
}
