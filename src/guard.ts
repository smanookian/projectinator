// Build modes. The roles write and run code on this machine with the permissions of whoever
// started Projectinator — Pi ships no sandbox, by design ("Pi does not include a built-in
// sandbox", docs/security.md). Safe mode is a guard, not a sandbox: it refuses the commands a
// build has no business running, and tells the model why so it can find another way.
//
// It cannot stop a determined exploit (a build may legitimately write a script and run it
// inside its own workspace). It stops the realistic accident: a destructive command aimed
// outside the project, or a role reading your API keys.

import { isAbsolute, resolve, sep } from "node:path";
import { homedir } from "node:os";

export type { BuildMode } from "./types.js";
import type { BuildMode } from "./types.js";

export interface GuardVerdict {
  /** Undefined when the call is allowed. */
  reason?: string;
}

/** Paths a build never needs, and that leak credentials if read. */
const SECRETS = [
  ".ssh", ".aws", ".gnupg", ".netrc", ".npmrc", ".docker/config.json",
  ".pi/agent/auth.json", ".projectinator/config.json", ".config/gh/hosts.yml",
  "/etc/shadow", "/etc/passwd",
];

/** Commands that are never part of building an app in a scratch directory. */
const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  // The bare-root case never reaches the path scan below: "/" on its own is not a path token.
  { pattern: /\brm\s+(-[A-Za-z]+\s+)*\/(\s|$)/, why: "deleting the filesystem root" },
  { pattern: /\bsudo\b|\bdoas\b|\bsu\s+-/, why: "elevating privileges" },
  { pattern: /\bmkfs(\.|\b)|\bdd\s+[^|]*\bof=\/dev\//, why: "writing to a device" },
  { pattern: /\bshutdown\b|\breboot\b|\bhalt\b|\bkill\s+-9\s+-1\b/, why: "shutting the machine down" },
  { pattern: /:\s*\(\s*\)\s*\{.*\|.*&\s*\}\s*;/, why: "a fork bomb" },
  { pattern: /\bchmod\s+(-[A-Za-z]+\s+)*777\s+\/(\s|$)/, why: "making the filesystem world-writable" },
  { pattern: /\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|d|k)?sh\b/, why: "piping a download straight into a shell" },
  { pattern: /\bgit\s+push\b/, why: "pushing to a remote (use Ship → Publish, which asks you first)" },
  { pattern: /\bssh\b\s+[^-]|\bscp\b|\brsync\b[^|]*::/, why: "connecting to another machine" },
  { pattern: /\bcrontab\b|\bsystemctl\b|\blaunchctl\b/, why: "installing a background service" },
];

/** Verbs that destroy or overwrite whatever path follows them. */
const DESTRUCTIVE = /\b(rm|rmdir|mv|shred|truncate|chown|chmod|tee)\b|>>?\s*(?!\s)/;

const norm = (p: string) => resolve(p.replace(/^~(?=\/|$)/, homedir()));

/** Is `p` inside `root` (or the root itself)? */
export function inside(root: string, p: string): boolean {
  const a = resolve(root);
  const b = norm(p);
  return b === a || b.startsWith(a + sep);
}

/** Absolute or home-relative paths mentioned in a shell command. */
function pathsIn(command: string): string[] {
  const out: string[] = [];
  for (const m of command.matchAll(/(?:^|[\s'"=(])(~\/[^\s'";|&)]*|\/[^\s'";|&)]*)/g)) {
    const p = m[1];
    if (p && p.length > 1) out.push(p);
  }
  return out;
}

/**
 * Decide whether a tool call may proceed. Pure so the rules are testable without a model.
 * `auto` allows everything — the behaviour before build modes existed.
 */
export function checkToolCall(
  mode: BuildMode,
  toolName: string,
  input: Record<string, unknown>,
  workspace: string,
): GuardVerdict {
  if (mode === "auto") return {};

  // Writes and edits must land in the project being built.
  if ((toolName === "write" || toolName === "edit") && typeof input.path === "string") {
    if (!inside(workspace, input.path)) {
      return { reason: `writing outside the project folder (${input.path}). Build only inside ${workspace}.` };
    }
  }

  if (toolName === "read" && typeof input.path === "string") {
    const p = norm(input.path);
    if (SECRETS.some((s) => p.endsWith(s.startsWith("/") ? s : sep + s) || p.includes(sep + s + sep))) {
      return { reason: `reading credentials (${input.path}). A build never needs them.` };
    }
  }

  if (toolName === "bash" && typeof input.command === "string") {
    const cmd = input.command;
    for (const { pattern, why } of FORBIDDEN) {
      if (pattern.test(cmd)) return { reason: `${why}. Not allowed during a build.` };
    }
    for (const p of pathsIn(cmd)) {
      const abs = norm(p);
      if (SECRETS.some((s) => abs.includes(s.startsWith("/") ? s : sep + s))) {
        return { reason: `touching credentials (${p}). A build never needs them.` };
      }
      // A destructive verb aimed outside the workspace is the accident worth preventing.
      if (DESTRUCTIVE.test(cmd) && (isAbsolute(p) || p.startsWith("~")) && !inside(workspace, p)) {
        return { reason: `changing files outside the project folder (${p}). Work inside ${workspace}.` };
      }
    }
  }

  return {};
}

/** The message handed back to the model when a call is refused. */
export function refusalFor(reason: string): string {
  return `Blocked by Projectinator's safe mode: ${reason} Find another way that stays inside the project folder, or tell the user what you need.`;
}
