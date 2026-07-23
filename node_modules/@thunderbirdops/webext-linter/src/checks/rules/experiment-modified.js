// Flags a bundled Experiment that IS a recognised published Thunderbird API
// draft but is not the unmodified latest version (locally modified or an older
// draft). Such a submission stays on the normal review path (so the developer
// gets full feedback) but is rejected by this error until they bundle the
// unmodified latest upstream copy. Silent for non-Experiments, pristine
// experiments, and unsupported ones (those abort via experiment-not-allowed).
//
// Belongs here: turning the per-experiment classification
// (ctx.experiments, from src/experiments/verify.js) into one finding per
// `modified` experiment. Does NOT belong here: classifying the files
// (src/experiments/verify.js), authored wording (assets/registry.yaml), or
// severity (that registry entry).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { isExperiment } from "../../lib/util.js";

/** @typedef {import("../registry.js").RunContext} RunContext */
export default {
  /**
   * @param {RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    const m = ctx.manifest;
    if (!m || !isExperiment(m)) {
      ctx.note?.("manifest.json", null, "not an Experiment", VERDICT.SKIPPED);
      return [];
    }
    const groups = ctx.experiments?.groups;
    if (!Array.isArray(groups)) {
      ctx.note?.(
        "manifest.json",
        null,
        "no experiment classification",
        VERDICT.SKIPPED
      );
      return [];
    }
    const findings = [];
    for (const g of groups) {
      const loc = g.line ? { line: g.line, column: 0 } : null;
      if (g.status === "modified") {
        ctx.note?.(
          "manifest.json",
          loc,
          `${g.name} (modified draft)`,
          VERDICT.FAIL
        );
        findings.push(finding({ file: "manifest.json", loc, item: g.name }));
      } else if (g.status === "pristine") {
        ctx.note?.("manifest.json", loc, g.name, VERDICT.PASS);
      } else {
        // unsupported: not a known upstream draft, so there is nothing to
        // compare against - this check has no say (experiment-not-allowed does).
        ctx.note?.(
          "manifest.json",
          loc,
          `${g.name} (not a known upstream draft)`,
          VERDICT.SKIPPED
        );
      }
    }
    return findings;
  },
};
