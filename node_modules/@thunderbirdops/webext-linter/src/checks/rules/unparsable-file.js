// A JS file that failed to parse, so its API checks were skipped - a
// static-analysis coverage gap (info), reported with the parser's own error.
//
// Belongs here: turning per-file parse errors recorded in ctx.apiUsages into
// findings. Does NOT belong here: dynamic-access limitations (->
// api-coverage.js), producing ctx.apiUsages (the upstream parse step), authored
// wording (-> assets/registry.yaml), and severity (-> that registry entry).

import { finding } from "../../report/finding.js";

/** @typedef {import("../registry.js").RunContext} RunContext */

export default {
  /**
   * @param {RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    const findings = [];
    for (const src of ctx.apiUsages || []) {
      if (src.parseError) {
        findings.push(
          finding({ file: src.file, data: { detail: src.parseError } })
        );
      }
    }
    return findings;
  },
};
