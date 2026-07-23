// A non-Experiment should NOT pin strict_max_version. Regular MailExtensions
// stay forward-compatible, so a maximum version only blocks installs on newer
// Thunderbird with no benefit. Silent for Experiments (which need one) and for
// non-Experiments that omit it.
//
// Belongs here: flagging a strict_max_version declared by a non-Experiment.
// Does NOT belong here: detecting Experiment status or reading the max version
// (-> isExperiment and strictMaxVersion in src/lib/util.js). Requiring a
// max version on an Experiment (-> experiment-missing-strict-max-version.js).
// Spotting a bump-only resubmission (-> strict-max-version-bump-only.js).
// Authored wording (-> assets/registry.yaml). Severity (-> the non-
// experiment-strict-max-version registry entry, stamped by src/checks/
// registry.js).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import {
  isExperiment,
  strictMaxVersion,
  manifestTokenLine,
} from "../../lib/util.js";

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
    if (isExperiment(m)) {
      ctx.note?.("manifest.json", null, "is an Experiment", VERDICT.SKIPPED);
      return [];
    }
    const max = strictMaxVersion(m);
    if (max == null) {
      ctx.note?.("manifest.json", null, "no strict_max_version", VERDICT.PASS);
      return [];
    }
    ctx.note?.(
      "manifest.json",
      null,
      `strict_max_version ${max} on a non-Experiment`,
      VERDICT.FAIL
    );
    const text = ctx.manifestText;
    const line = manifestTokenLine(text, "strict_max_version");
    return [
      finding({
        file: "manifest.json",
        loc: line ? { line } : null,
        item: String(max),
      }),
    ];
  },
};
