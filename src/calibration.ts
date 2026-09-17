// Self-calibrating token estimates. After each real task, we record its measured
// token usage per (capability, difficulty) AND per (capability, difficulty, model).
// The router prefers the per-model average (a Haiku and an Opus run of the same task
// differ a lot), then the generic bucket, then the static table. Persisted globally.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataHome } from "./tui/config.js";
import type { Capability, Difficulty } from "./types.js";

interface Sample {
  input: number; // total input tokens (fresh + cache-read)
  output: number;
  cachedFraction: number; // share of input served from cache
  n: number; // sample count (capped so recent runs still move the average)
  /** Mean wall-clock ms per run (absent for samples recorded before timing existed). */
  ms?: number;
}

type Calibration = Record<string, Sample>;

const MIN_SAMPLES = 2; // trust calibration only after a couple of runs
const MAX_N = 20; // cap so old runs don't dominate

function calPath(): string {
  return join(dataHome(), "calibration.json");
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
    mkdirSync(dataHome(), { recursive: true });
    writeFileSync(calPath(), JSON.stringify(cal, null, 2) + "\n");
  } catch {
    /* best effort — never break a build on a calibration write */
  }
}

function fold(cal: Calibration, k: string, inputTotal: number, output: number, cachedFraction: number, ms?: number): void {
  const prev = cal[k];
  if (!prev) {
    cal[k] = { input: inputTotal, output, cachedFraction, n: 1, ...(ms ? { ms } : {}) };
    return;
  }
  const n = Math.min(prev.n, MAX_N);
  cal[k] = {
    input: (prev.input * n + inputTotal) / (n + 1),
    output: (prev.output * n + output) / (n + 1),
    cachedFraction: (prev.cachedFraction * n + cachedFraction) / (n + 1),
    n: prev.n + 1,
    ...(ms ? { ms: prev.ms ? (prev.ms * n + ms) / (n + 1) : ms } : prev.ms ? { ms: prev.ms } : {}),
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
  durationMs?: number,
): void {
  if (!(inputTotal > 0)) return;
  const cal = load();
  fold(cal, key(capability, difficulty), inputTotal, output, cachedFraction, durationMs);
  if (modelId) fold(cal, key(capability, difficulty, modelId), inputTotal, output, cachedFraction, durationMs);
  save(cal);
}

/** Typical wall-clock ms for a bucket (per-model if known), or undefined before any timed run. */
export function expectedDurationMs(capability: Capability, difficulty: Difficulty, modelId?: string): number | undefined {
  const cal = load();
  const s = (modelId && cal[key(capability, difficulty, modelId)]) || cal[key(capability, difficulty)];
  return s?.ms;
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
