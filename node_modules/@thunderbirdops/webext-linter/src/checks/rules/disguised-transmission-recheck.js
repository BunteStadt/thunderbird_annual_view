// The post-summary recheck consumer for disguised-transmission. The producer hands
// over each weak covert sink it could not clear from the narrow per-site view (its
// residual "unsure" manual items); when --llm-review runs, those are appended to
// the add-on summary under this entry's `summary-prompt` and re-judged with the
// whole add-on in view. resolveRecheck maps each verdict: pass -> legitimate
// dynamic URL (drop), fail -> a disguised-transmission finding, unsure or no
// verdict -> manual review. It runs in the post-summary phase, inferred from being
// the producer's post-summary-recheck target.
//
// Belongs here: only the delegation. Does NOT belong here: the outbound-sink
// analysis (-> disguised-transmission + src/lib/outbound-sinks.js), the
// wording (-> assets/registry.yaml), or the verdict mapping (-> src/lib/
// recheck.js).

import { resolveRecheck } from "../../lib/recheck.js";

/** @typedef {import("../registry.js").RunContext} RunContext */
/** @typedef {import("../registry.js").LoadedCheck} LoadedCheck */

export default {
  /**
   * @param {RunContext} ctx
   * @param {LoadedCheck} check
   * @returns {{findings: object[], escalations: object[]}}
   */
  run(ctx, check) {
    return resolveRecheck(ctx, check);
  },
};
