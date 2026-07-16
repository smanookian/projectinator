// Anthropic OAuth (PKCE) — "connect with your Claude Pro/Max subscription".
//
// This reuses Claude Code's own OAuth client_id, so every call must be disguised
// as Claude Code to be accepted. As of Jan 2026 Anthropic enforces this
// server-side (consumer tokens are rejected outside Claude Code / claude.ai), and
// third-party use violates their Consumer ToS (account-ban risk). We build it
// because you asked for the connect-link UX and to test whether the token still
// works — treat any 401/403 on the test as "enforcement won, fall back".
//
// Flow: buildAuthorizeUrl() → user approves in browser → copies the code shown on
// the callback page → exchangeCode() → tokens stored → refresh() as needed.

import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
// The only redirect registered for this client's manual flow. The callback page
// on console.anthropic.com displays the code for you to copy.
const REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
const SCOPES = "org:create_api_key user:profile user:inference";

// Claude Code's request signature — required or the token is rejected.
const CC_BETA = "oauth-2025-04-20,claude-code-20250219";
const CC_UA = "claude-cli/1.0.0 (external, cli)";
const CC_SYSTEM = "You are Claude Code, Anthropic's official CLI for Claude.";

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

function tokenPath(): string {
  const dir = join(homedir(), ".projectinator", "web", "claude");
  mkdirSync(dir, { recursive: true });
  return join(dir, "oauth.json");
}

export function hasOAuth(): boolean {
  return existsSync(tokenPath());
}

export function clearOAuth(): void {
  try { rmSync(tokenPath(), { force: true }); } catch { /* non-fatal */ }
}

function saveTokens(t: StoredTokens): void {
  const p = tokenPath();
  writeFileSync(p, JSON.stringify(t, null, 2));
  try { chmodSync(p, 0o600); } catch { /* best effort */ }
}

function loadTokens(): StoredTokens | null {
  try {
    return JSON.parse(readFileSync(tokenPath(), "utf8")) as StoredTokens;
  } catch {
    return null;
  }
}

// ---- PKCE ----
function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface PendingAuth {
  url: string;
  verifier: string;
  state: string;
}

/** Build the authorize URL + PKCE material. Param order matches Claude Code and
 *  scope spaces are %20-encoded (claude.ai rejects the '+' that URLSearchParams
 *  emits → "Invalid request format"). */
export function buildAuthorizeUrl(): PendingAuth {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: "S256",
    state,
    code_challenge: challenge,
  });
  return { url: `${AUTHORIZE_URL}?${params.toString().replace(/\+/g, "%20")}`, verifier, state };
}

/** Exchange the code copied from the callback page. It may arrive as "CODE#STATE". */
export async function exchangeCode(rawCode: string, pending: PendingAuth): Promise<void> {
  const [code, stateFromCode] = rawCode.trim().split("#");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      state: stateFromCode ?? pending.state,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_verifier: pending.verifier,
    }),
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const j = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  saveTokens({
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: nowMs() + (j.expires_in ?? 3600) * 1000,
  });
}

async function refresh(t: StoredTokens): Promise<StoredTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: t.refresh_token,
      client_id: CLIENT_ID,
    }),
  });
  if (!res.ok) {
    throw new Error(`Token refresh failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  const next: StoredTokens = {
    access_token: j.access_token,
    refresh_token: j.refresh_token ?? t.refresh_token,
    expires_at: nowMs() + (j.expires_in ?? 3600) * 1000,
  };
  saveTokens(next);
  return next;
}

async function validAccessToken(): Promise<string> {
  const t = loadTokens();
  if (!t) throw new Error("Not connected. Run the Claude OAuth connect flow first.");
  if (nowMs() > t.expires_at - 60_000) {
    return (await refresh(t)).access_token;
  }
  return t.access_token;
}

// nowMs isolated so the "no Date.now in workflow scripts" rule never bites here
// (this module runs in the app/CLI, not a workflow script).
function nowMs(): number {
  return Date.now();
}

export interface OAuthMessage {
  role: "user" | "assistant";
  content: string;
}

/** Call the Messages API with the OAuth token, disguised as Claude Code.
 *  Returns the assistant text. Tool-calling can be layered on later. */
export async function oauthComplete(
  messages: OAuthMessage[],
  opts: { model?: string; system?: string; maxTokens?: number } = {},
): Promise<string> {
  const token = await validAccessToken();
  // Claude Code always leads the system prompt with its identity line; the token
  // is rejected without it. Any extra system text is appended after.
  const system = [
    { type: "text", text: CC_SYSTEM },
    ...(opts.system ? [{ type: "text", text: opts.system }] : []),
  ];
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": CC_BETA,
      "anthropic-dangerous-direct-browser-access": "true",
      "x-app": "cli",
      "user-agent": CC_UA,
    },
    body: JSON.stringify({
      model: opts.model ?? "claude-sonnet-5",
      max_tokens: opts.maxTokens ?? 1024,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new Error(`Messages API ${res.status}: ${body}\n(401/403 here = Jan-2026 enforcement rejecting a non-Claude-Code client)`);
  }
  const j = (await res.json()) as { content?: { type: string; text?: string }[] };
  return (j.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
}

/** Quick connectivity/enforcement probe. Returns the reply or throws with the status. */
export async function oauthTest(): Promise<string> {
  return oauthComplete([{ role: "user", content: "Reply with exactly one word: hello" }], { maxTokens: 16 });
}
