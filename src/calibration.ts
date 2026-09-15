// Self-calibrating token estimates. After each real task, we record its measured
// token usage per (capability, difficulty) AND per (capability, difficulty, model).
// The router prefers the per-model average (a Haiku and an Opus run of the same task
// differ a lot), then the generic bucket, then the static table. Persisted globally.

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
const key = (c: Capability, d: Difficulty, model?: string) => (model ? `${c}/${d}/${model}` : `${c}/${d}`);

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

function fold(cal: Calibration, k: string, inputTotal: number, output: number, cachedFraction: number): void {
  const prev = cal[k];
  if (!prev) {
    cal[k] = { input: inputTotal, output, cachedFraction, n: 1 };
    return;
  }
  const n = Math.min(prev.n, MAX_N);
  cal[k] = {
    input: (prev.input * n + inputTotal) / (n + 1),
    output: (prev.output * n + output) / (n + 1),
    cachedFraction: (prev.cachedFraction * n + cachedFraction) / (n + 1),
    n: prev.n + 1,
  };
}

/** Fold a real measurement into the running averages for its bucket and its model. */
export function recordActual(
  capability: Capability,
  difficulty: Difficulty,
  inputTotal: number,
  output: number,
  cachedFraction: number,
  modelId?: string,
): void {
  if (!(inputTotal > 0)) return;
  const cal = load();
  fold(cal, key(capability, difficulty), inputTotal, output, cachedFraction);
  if (modelId) fold(cal, key(capability, difficulty, modelId), inputTotal, output, cachedFraction);
  save(cal);
}

/** All recorded samples keyed "capability/difficulty[/model]" (for the accuracy view). */
export function allSamples(): Record<string, { input: number; output: number; cachedFraction: number; n: number }> {
  return load();
}

function fromSample(s: Sample | undefined) {
  if (!s || s.n < MIN_SAMPLES) return undefined;
  return {
    input: Math.round(s.input),
    output: Math.round(s.output),
    cachedInputFraction: Math.min(0.95, Math.max(0, s.cachedFraction)),
  };
}

/** Calibrated estimate for a bucket, once enough samples exist (model-agnostic). */
export function calibratedTokens(capability: Capability, difficulty: Difficulty) {
  return fromSample(load()[key(capability, difficulty)]);
}

/** Calibrated estimate for a bucket ON A SPECIFIC MODEL, once enough samples exist.
 *  Undefined when that model hasn't run this bucket enough — callers keep their estimate. */
export function modelCalibratedTokens(capability: Capability, difficulty: Difficulty, modelId: string) {
  return fromSample(load()[key(capability, difficulty, modelId)]);
}
