// Self-calibrating token estimates. After each real task, we record its measured
// token usage per (capability, difficulty). estimateTokens uses the running average
// once there are enough samples, so estimates sharpen with use. Persisted globally.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Capability, Difficulty } from "./types.js";

interface Sample {
  input: number; // total input tokens (fresh + cache-read)
  output: number;
  cachedFraction: number; // share of input served from cache
  n: number; // sample count (capped so recent runs still move the average)
}

type Calibration = Record<string, Sample>;

const MIN_SAMPLES = 2; // trust calibration only after a couple of runs
const MAX_N = 20; // cap so old runs don't dominate

function calPath(): string {
  return join(homedir(), ".projectinator", "calibration.json");
}
const key = (c: Capability, d: Difficulty) => `${c}/${d}`;

function load(): Calibration {
  try {
    if (!existsSync(calPath())) return {};
    return JSON.parse(readFileSync(calPath(), "utf-8")) as Calibration;
  } catch {
    return {};
  }
}

function save(cal: Calibration): void {
  try {
    mkdirSync(join(homedir(), ".projectinator"), { recursive: true });
    writeFileSync(calPath(), JSON.stringify(cal, null, 2) + "\n");
  } catch {
    /* best effort — never break a build on a calibration write */
  }
}

/** Fold a real measurement into the running average for its bucket. */
export function recordActual(
  capability: Capability,
  difficulty: Difficulty,
  inputTotal: number,
  output: number,
  cachedFraction: number,
): void {
  if (!(inputTotal > 0)) return;
  const cal = load();
  const k = key(capability, difficulty);
  const prev = cal[k];
  if (!prev) {
    cal[k] = { input: inputTotal, output, cachedFraction, n: 1 };
  } else {
    const n = Math.min(prev.n, MAX_N);
    cal[k] = {
      input: (prev.input * n + inputTotal) / (n + 1),
      output: (prev.output * n + output) / (n + 1),
      cachedFraction: (prev.cachedFraction * n + cachedFraction) / (n + 1),
      n: prev.n + 1,
    };
  }
  save(cal);
}

/** All recorded samples keyed "capability/difficulty" (for the accuracy view). */
export function allSamples(): Record<string, { input: number; output: number; cachedFraction: number; n: number }> {
  return load();
}

/** Calibrated estimate for a bucket, once enough samples exist. */
export function calibratedTokens(
  capability: Capability,
  difficulty: Difficulty,
): { input: number; output: number; cachedInputFraction: number } | undefined {
  const s = load()[key(capability, difficulty)];
  if (!s || s.n < MIN_SAMPLES) return undefined;
  return {
    input: Math.round(s.input),
    output: Math.round(s.output),
    cachedInputFraction: Math.min(0.95, Math.max(0, s.cachedFraction)),
  };
}
