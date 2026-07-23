// The post-summary recheck consumer for data-exfiltration. data-exfiltration hands
// over each remote-transmission site it could not clear from the narrow per-site
// view (its residual "unsure" manual items); when --llm-review runs, those are
// appended to the add-on summary under this entry's `summary-prompt` and re-judged
// with the whole add-on in view (so a user opt-in defined in any settings or
// background module is visible, not only the options page in the narrow corpus).
// resolveRecheck maps each verdict: pass -> consented (drop), fail -> an
// exfiltration finding, unsure or no verdict -> manual review. It runs in the
// post-summary phase, inferred from being the producer's post-summary-recheck
// target; with no summary nothing is handed over and the producer's items stand.
//
// Belongs here: only the delegation. Does NOT belong here: the outbound-sink
// analysis (-> data-exfiltration + src/lib/outbound-sinks.js), the wording
// (-> assets/registry.yaml), or the verdict mapping (-> src/lib/recheck.js).

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
