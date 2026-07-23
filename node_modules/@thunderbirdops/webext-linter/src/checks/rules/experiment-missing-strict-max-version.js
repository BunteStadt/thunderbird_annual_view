// A valid Experiment (declares experiment_apis and is reviewed rather than
// rejected - allowed via --allow-experiments or a pristine upstream copy) must
// pin a strict_max_version. Experiments call internal APIs that change between
// major Thunderbird versions, so without a maximum they break silently on
// upgrade. This is a deterministic-phase check, so it runs only when the experiment
// is valid (an invalid one short-circuits to the invalid-experiment phase). Silent for
// non-Experiments and for Experiments that already declare a max.
//
// Belongs here: flagging an allowed Experiment that omits strict_max_version.
// Does NOT belong here: detecting Experiment status or reading the max version
// (-> isExperiment and strictMaxVersion in src/lib/util.js). Rejecting
// experiments when they are NOT allowed (-> experiment-not-allowed.js).
// Flagging a strict_max_version on a non-Experiment (->
// non-experiment-strict-max-version.js). Authored wording (->
// assets/registry.yaml). Severity (-> the experiment-missing-strict-max-version
// registry entry, stamped by src/checks/registry.js).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { isExperiment, strictMaxVersion } from "../../lib/util.js";

/** @typedef {import("../registry.js").RunContext} RunContext */
export default {
  /**
   * @param {RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    const m = ctx.manifest;
    if (!m) {
      ctx.note?.(
        "manifest.json",
        null,
        "manifest did not parse",
        VERDICT.SKIPPED
      );
      return [];
    }
    if (!isExperiment(m)) {
      ctx.note?.("manifest.json", null, "not an Experiment", VERDICT.SKIPPED);
      return [];
    }
    const max = strictMaxVersion(m);
    if (max != null) {
      ctx.note?.(
        "manifest.json",
        null,
        `Experiment pins strict_max_version ${max}`,
        VERDICT.PASS
      );
      return [];
    }
    ctx.note?.(
      "manifest.json",
      null,
      "Experiment lacks strict_max_version",
      VERDICT.FAIL
    );
    return [finding({ file: "manifest.json" })];
  },
};
