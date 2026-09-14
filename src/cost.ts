// Cost estimation. Pure math over a token estimate + a model's price block.

import type { Model, TokenEstimate } from "./types.js";

const PER_MILLION = 1_000_000;

/** Resolve the applicable input/output/cache rates, honoring volume tiers.
 *  Highest matching `inputTokensAbove` threshold wins (Pi semantics). */
function ratesFor(model: Model, inputTokens: number) {
  const base = model.cost;
  let rate = { input: base.input, output: base.output, cacheRead: base.cacheRead ?? base.input };
  for (const tier of base.tiers ?? []) {
    if (inputTokens > tier.inputTokensAbove) {
      rate = {
        input: tier.input,
        output: tier.output,
        cacheRead: tier.cacheRead ?? tier.input,
      };
    }
  }
  return rate;
}

/** Estimate USD cost for one task on a given model.
 *  A fraction of input can be served from cache at the cheaper cacheRead rate.
 *  Kept to 4 decimals, not cents: a backlog of sub-cent tasks would otherwise
 *  estimate to $0.00 and under-reserve budget in the parallel scheduler. */
export function estimateCost(est: TokenEstimate, model: Model): number {
  const cachedFraction = clamp01(est.cachedInputFraction ?? 0);
  const rate = ratesFor(model, est.input);

  const freshInput = est.input * (1 - cachedFraction);
  const cachedInput = est.input * cachedFraction;

  const inputCost = (freshInput / PER_MILLION) * rate.input + (cachedInput / PER_MILLION) * rate.cacheRead;
  const outputCost = (est.output / PER_MILLION) * rate.output;

  return Math.round((inputCost + outputCost) * 10_000) / 10_000;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
