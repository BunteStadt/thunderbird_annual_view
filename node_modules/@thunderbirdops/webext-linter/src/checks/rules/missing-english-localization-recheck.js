// The post-summary recheck consumer for missing-english-localization. That check
// escalates when its language detection is low-confidence (too little text, or a
// near-tie with English); when --llm-review runs, that one item is appended to
// the add-on summary under this entry's `summary-prompt` and re-judged by a model
// reading ALL the user-facing text (far more reliable than franc on a short
// sample). resolveRecheck maps the verdict: pass -> English / nothing to localize
// (drop), fail -> a missing-English-localization finding, unsure or no verdict ->
// manual review. It runs in the post-summary phase, inferred from being the
// producer's post-summary-recheck target; with no summary the producer's reminder
// stands.
//
// Belongs here: only the delegation. Does NOT belong here: the language detection
// (-> missing-english-localization), the wording (-> assets/registry.yaml), or the
// verdict mapping (-> src/lib/recheck.js).

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
