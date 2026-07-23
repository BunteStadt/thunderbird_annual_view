// A run-scoped ceiling on the number of model requests, so one run cannot fan
// out into thousands of calls. The cap is the chosen model's `maxRequests`
// (assets/llm/<type>.yaml, resolved in src/pipeline.js). Every request site - the
// LLM checks' candidate batches, the advisory summaries, the vendor-parse
// fallback, and the SCA build analysis - calls consume() before its model call and
// skips when it returns false; the remaining work then escalates to manual review,
// the same path a token-less run takes. One budget per run, shared across those
// sites (created in src/pipeline.js runPipeline).

import { progress, FEED } from "../util/log.js";

/**
 * @typedef {object} LlmBudget
 * @property {() => Promise<boolean>} consume  Reserve one request: true to
 *   proceed, false once the cap is reached and not extended (after which every
 *   further consume() is false, so the run makes no more model calls).
 */

/**
 * @param {object} opts
 * @param {number} opts.step  The initial cap AND the per-confirmation increment.
 * @param {(used: number, step: number) => boolean | Promise<boolean>}
 *   [opts.confirmMore]  Asked when the cap is reached, and told how many more
 *   requests a yes grants (so the prompt can name the number without knowing where
 *   it came from): a truthy answer grants `step` more (and is re-asked at the next
 *   multiple), a falsy answer stops. Omitted (a non-interactive run) means stop at
 *   the cap with no prompt.
 * @returns {LlmBudget}
 */
export function createLlmBudget({ step, confirmMore }) {
  let used = 0;
  let limit = step;
  let stopped = false;
  return {
    async consume() {
      if (stopped) {
        return false;
      }
      if (used >= limit) {
        const more = confirmMore ? await confirmMore(used, step) : false;
        if (!more) {
          stopped = true;
          progress(
            `LLM request cap reached (${used}); ` +
              "remaining checks escalate to manual review.",
            FEED.STEP
          );
          return false;
        }
        limit += step;
      }
      used += 1;
      return true;
    },
  };
}
