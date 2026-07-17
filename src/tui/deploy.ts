// One-click deploy — ship a built static site to Cloudflare Pages, Vercel, or
// Netlify by shelling out to that provider's CLI. No secrets stored here: auth
// comes from the CLI's own login (browser) or a token env var the user sets.

import { spawn } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

export type DeployTarget = "cloudflare" | "vercel" | "netlify";

export interface TargetMeta {
  label: string;
  cli: string;
  install: string;
  auth: string;
  /** Regex to pull the live URL out of the CLI output. */
  urlPattern: RegExp;
}

export const DEPLOY_META: Record<DeployTarget, TargetMeta> = {
  cloudflare: {
    label: "Cloudflare Pages",
    cli: "wrangler",
    install: "npm i -g wrangler",
    auth: "wrangler login   (or set CLOUDFLARE_API_TOKEN)",
    urlPattern: /https:\/\/[^\s]+\.pages\.dev/g,
  },
  vercel: {
    label: "Vercel",
    cli: "vercel",
    install: "npm i -g vercel",
    auth: "vercel login   (or set VERCEL_TOKEN)",
    urlPattern: /https:\/\/[^\s]+\.vercel\.app/g,
  },
  netlify: {
    label: "Netlify",
    cli: "netlify",
    install: "npm i -g netlify-cli",
    auth: "netlify login   (or set NETLIFY_AUTH_TOKEN)",
    urlPattern: /https:\/\/[^\s]+\.netlify\.app/g,
  },
};

// Project metadata / non-servable files we never want on the public site.
const INTERNAL = new Set([
  "build-state.json", "DESIGN-SPEC.md", "export.md", "export.csv",
  "jira-import.csv", "trello-import.csv", "node_modules",
]);

/** Sanitise a project name into a deploy-safe slug (Cloudflare/Vercel project id). */
export function deploySlug(name: string): string {
  return (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)) || "projectinator-app";
}

/** Copy servable web files into <dir>/.deploy, dropping internal metadata. */
export function stageForDeploy(dir: string): string {
  const staging = join(dir, ".deploy");
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  let copied = 0;
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue; // .deploy, hidden files
    if (INTERNAL.has(name)) continue;
    cpSync(join(dir, name), join(staging, name), { recursive: true });
    copied++;
  }
  if (copied === 0) throw new Error("No web files to deploy — build the app first.");
  return staging;
}

function buildArgs(target: DeployTarget, staging: string, slug: string): string[] {
  switch (target) {
    case "cloudflare":
      return ["pages", "deploy", staging, "--project-name", slug, "--branch", "main", "--commit-dirty=true"];
    case "vercel":
      return [staging, "--prod", "--yes"];
    case "netlify":
      return ["deploy", "--dir", staging, "--prod"];
  }
}

export interface DeployResult {
  url?: string;
  output: string;
}

/** Run a deploy. Streams output via onLog; resolves with the live URL (if found).
 *  Rejects with a helpful message when the CLI is missing or the deploy fails. */
export function deploy(
  target: DeployTarget,
  dir: string,
  projectName: string,
  onLog: (line: string) => void,
): Promise<DeployResult> {
  return new Promise((resolve, reject) => {
    let staging: string;
    try {
      staging = stageForDeploy(dir);
    } catch (e) {
      reject(e);
      return;
    }
    const meta = DEPLOY_META[target];
    const args = buildArgs(target, staging, deploySlug(projectName));
    const child = spawn(meta.cli, args, { cwd: dir, env: process.env });

    let output = "";
    const onData = (buf: Buffer) => {
      const text = buf.toString();
      output += text;
      for (const line of text.split("\n")) {
        const t = line.trimEnd();
        if (t) onLog(t);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(new Error(`${meta.cli} is not installed. Install it:\n  ${meta.install}\nthen sign in:\n  ${meta.auth}`));
      } else {
        reject(err);
      }
    });

    child.on("close", (code) => {
      if (code === 0) {
        const matches = output.match(meta.urlPattern);
        resolve({ url: matches ? matches[matches.length - 1] : undefined, output });
      } else {
        const tail = output.trim().split("\n").slice(-8).join("\n");
        reject(new Error(`${meta.label} deploy failed (exit ${code}).\nIf it's an auth error, sign in:\n  ${meta.auth}\n\n${tail}`));
      }
    });
  });
}
