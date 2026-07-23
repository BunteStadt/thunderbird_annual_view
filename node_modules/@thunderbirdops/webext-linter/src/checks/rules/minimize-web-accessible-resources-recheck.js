// The post-summary recheck consumer for minimize-web-accessible-resources.
// minimize-web-accessible-resources hands over the web_accessible_resources
// entries it could not decide from a single referencing site (its residual
// "unsure" manual items); when --llm-review runs, those are appended to the
// add-on summary under this entry's `summary-prompt` and re-judged with the whole
// add-on in view. resolveRecheck maps each verdict: pass -> needed (drop), fail ->
// a needless-exposure finding, unsure or no verdict -> manual review. It runs in
// the post-summary phase, inferred from being the producer's post-summary-recheck
// target; with no summary nothing is handed over and the producer's items stand.
//
// Belongs here: only the delegation. Does NOT belong here: the reachability
// analysis (-> minimize-web-accessible-resources), the wording (->
// assets/registry.yaml), or the verdict mapping (-> src/lib/recheck.js).

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
