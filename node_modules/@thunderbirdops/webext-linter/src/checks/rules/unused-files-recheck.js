// The post-summary recheck consumer for unused-files. unused-files hands over the
// files it could not resolve to a loader from a single site (its residual "unsure"
// manual items); when --llm-review runs, those are appended to the add-on
// summary under this entry's `summary-prompt` rubric and re-judged with the whole
// add-on in view. The shared resolveRecheck maps each verdict: pass -> loaded
// (drop), fail -> an unused finding, unsure or no verdict -> manual review. It runs
// in the post-summary phase, inferred from being unused-files' post-summary-recheck
// target; with no summary nothing is handed over, so it emits nothing and
// unused-files' own manual items stand.
//
// Belongs here: only the delegation. Does NOT belong here: the reachability/loader
// analysis (-> unused-files + src/lib/reachability.js), the wording (->
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
