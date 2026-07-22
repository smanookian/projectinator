// Validate an API key by hitting each provider's models endpoint (free, no tokens).
// 200 = the key works; 401/403 = rejected. Used before saving a key in Settings so
// bad keys never get stored (the root cause of silent 0-token routing failures).

import type { Provider } from "../types.js";

export interface KeyCheck {
  ok: boolean;
  error?: string;
}

async function withTimeout(url: string, init: RequestInit, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function validateKey(provider: Provider, key: string): Promise<KeyCheck> {
  if (!key.trim()) return { ok: false, error: "Empty key." };
  try {
    let res: Response;
    if (provider === "anthropic") {
      res = await withTimeout("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      });
    } else if (provider === "openai") {
      res = await withTimeout("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
    } else if (provider === "openrouter") {
      // Returns the key's rate-limit/usage info; 401 if the key is bad.
      res = await withTimeout("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: `Bearer ${key}` },
      });
    } else {
      res = await withTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
        {},
      );
    }
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) return { ok: false, error: "Key rejected — check it's correct and active." };
    if (res.status === 400) return { ok: false, error: "Key rejected (bad request) — likely wrong key." };
    return { ok: false, error: `Provider returned HTTP ${res.status}.` };
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? "Timed out — check your connection." : "Couldn't reach the provider.";
    return { ok: false, error: msg };
  }
}
