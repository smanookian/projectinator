// "Is this task taking too long?" — pure, so the rule is testable and the UI just asks.
//
// A task is flagged once it has run for longer than BOTH a floor (nobody wants a "slow"
// badge at 20 s) and the larger of: 2x the typical duration of its bucket/model (from
// calibration, when known) or half its timeout. With no history and no timeout it never
// flags — we have nothing to compare against.

import type { Capability, Difficulty } from "./types.js";
import { expectedDurationMs } from "./calibration.js";

const FLOOR_MS = 60_000;

export function stuckThresholdMs(capability: Capability, difficulty: Difficulty, modelId: string | undefined, timeoutMs: number): number | undefined {
  const typical = expectedDurationMs(capability, difficulty, modelId);
  const fromHistory = typical ? typical * 2 : undefined;
  const fromTimeout = timeoutMs > 0 ? timeoutMs / 2 : undefined;
  if (fromHistory === undefined && fromTimeout === undefined) return undefined;
  return Math.max(FLOOR_MS, fromHistory ?? 0, fromTimeout ?? 0);
}

export function isStuck(elapsedMs: number, capability: Capability, difficulty: Difficulty, modelId: string | undefined, timeoutMs: number): boolean {
  const t = stuckThresholdMs(capability, difficulty, modelId, timeoutMs);
  return t !== undefined && elapsedMs > t;
}
