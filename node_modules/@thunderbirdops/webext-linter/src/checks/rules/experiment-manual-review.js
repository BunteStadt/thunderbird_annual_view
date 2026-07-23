// Escalates a whole-add-on manual review for every Experiment submission:
// Experiments (experiment_apis) run with full access to Thunderbird's internals,
// so they need a careful human code review beyond the automated checks. Emits one
// locus-less manual-review reminder (no findings, so no severity). Silent for
// non-Experiments; an unsupported experiment never reaches here (it aborts via
// experiment-not-allowed in the invalid-experiment phase).
//
// Belongs here: the isExperiment gate and the single escalation. Does NOT belong
// here: the deterministic->manual routing (registry.js + escalation.js) or the
// authored instructions/response (assets/registry.yaml).

import { VERDICT } from "../../lib/enum.js";
import { isExperiment } from "../../lib/util.js";

/** @typedef {import("../registry.js").RunContext} RunContext */
/** @typedef {import("../escalation.js").Escalation} Escalation */

export default {
  /**
   * @param {RunContext} ctx
   * @returns {{findings: [], escalations: Escalation[]}}
   */
  run(ctx) {
    const m = ctx.manifest;
    if (!m || !isExperiment(m)) {
      ctx.note?.("manifest.json", null, "not an Experiment", VERDICT.SKIPPED);
      return { findings: [], escalations: [] };
    }
    ctx.note?.(
      "manifest.json",
      null,
      "Experiment - manual review",
      VERDICT.UNSURE
    );
    // A whole-add-on reminder: no locus, so it renders as the instruction +
    // suggested response alone under Extended manual review.
    return { findings: [], escalations: [{}] };
  },
};
