// Token estimation lives in CODE, not in the model.
// The Phase 2 live run proved models estimate their own token use terribly
// (a "high" single-file task used ~1.5k output, not the 12k a model guessed).
// So the PM only tags capability + difficulty; we map that to a token budget here.
//
// CALIBRATION (2026-07-15) — retuned against real getSessionStats from live runs:
//   Phase 2 dev (code, single-file): output ~1.5k, input almost entirely cached
//     (fresh 4 of ~3.3k tokens).
//   Phase 4 mini: design/low, code/low ~ $0.03-0.04 each; test/trivial ~ $0.02.
// Takeaways baked in below:
//   - a "task" is ONE atomic unit (a file / component / spec), not a whole feature,
//     so outputs are small — and output dominates cost (priced ~5-6x input).
//   - Pi caches context aggressively, so most input bills at the cheap cacheRead rate.
// These stay heuristic; wire measured actuals back in for self-calibration later.

import type { Capability, Difficulty, TokenEstimate } from "./types.js";
import { calibratedTokens, allSamples } from "./calibration.js";

type Bucket = { input: number; output: number };

const BUCKETS: Record<Capability, Record<Difficulty, Bucket>> = {
  plan: {
    trivial: { input: 2_000, output: 800 },
    low: { input: 4_000, output: 1_500 },
    medium: { input: 8_000, output: 3_000 },
    high: { input: 12_000, output: 5_000 },
  },
  design: {
    trivial: { input: 4_000, output: 2_000 },
    low: { input: 6_000, output: 3_500 },
    medium: { input: 10_000, output: 6_000 },
    high: { input: 15_000, output: 9_000 },
  },
  code: {
    trivial: { input: 6_000, output: 1_500 },
    low: { input: 10_000, output: 3_000 },
    medium: { input: 25_000, output: 7_000 },
    high: { input: 60_000, output: 14_000 },
  },
  test: {
    trivial: { input: 15_000, output: 1_200 },
    low: { input: 25_000, output: 2_500 },
    medium: { input: 50_000, output: 5_000 },
    high: { input: 80_000, output: 9_000 },
  },
  ops: {
    trivial: { input: 10_000, output: 2_000 },
    low: { input: 20_000, output: 4_000 },
    medium: { input: 40_000, output: 7_000 },
    high: { input: 70_000, output: 12_000 },
  },
};

// Pi auto-caches system prompt + context aggressively (live run: fresh input 4 tokens
// of ~3.3k). Real cached share is often 80-99%; 0.55 is a conservative planning value.
const DEFAULT_CACHED_INPUT_FRACTION = 0.55;

export function estimateTokens(capability: Capability, difficulty: Difficulty): TokenEstimate {
  // Prefer the learned average once we have enough real samples; else the static bucket.
  const learned = calibratedTokens(capability, difficulty);
  if (learned) return learned;
  const b = BUCKETS[capability][difficulty];
  return { input: b.input, output: b.output, cachedInputFraction: DEFAULT_CACHED_INPUT_FRACTION };
}

/** The static baseline (pre-calibration) token budget for a bucket. */
export function baselineTokens(capability: Capability, difficulty: Difficulty): Bucket {
  return BUCKETS[capability][difficulty];
}

export interface AccuracyRow {
  capability: Capability;
  difficulty: Difficulty;
  baseOutput: number;
  actualOutput: number;
  baseInput: number;
  actualInput: number;
  n: number;
  active: boolean; // true once calibration overrides the baseline (enough samples)
}

/** Baseline vs measured tokens for every bucket that has real samples. */
export function estimateAccuracy(): AccuracyRow[] {
  const samples = allSamples();
  const rows: AccuracyRow[] = [];
  for (const cap of Object.keys(BUCKETS) as Capability[]) {
    for (const diff of Object.keys(BUCKETS[cap]) as Difficulty[]) {
      const s = samples[`${cap}/${diff}`];
      if (!s) continue;
      const b = BUCKETS[cap][diff];
      rows.push({
        capability: cap,
        difficulty: diff,
        baseOutput: b.output,
        actualOutput: Math.round(s.output),
        baseInput: b.input,
        actualInput: Math.round(s.input),
        n: s.n,
        active: !!calibratedTokens(cap, diff),
      });
    }
  }
  return rows;
}
