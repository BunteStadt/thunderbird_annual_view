// Rejects a declared third-party file whose bytes do not match what its pinned
// source serves: it appears modified from the upstream release. The byte
// comparison (EOL-tolerant) ran once in the pre-step (src/vendor/verify.js),
// which recorded each fetched file as `verified` or `modified` on addon.vendor;
// this check only reads those results. It narrates every verified file to the
// feed as a [pass] and turns each `modified` result into a finding.
// Deterministic, no network.
//
// Belongs here: turning each `modified` result into a finding and narrating the
// `verified` ones. Does NOT belong here: the fetch/compare (-> src/vendor/
// verify.js), resolving the store (-> src/vendor/resolve.js), and the wording
// (-> assets/registry.yaml).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";

/** @typedef {import("../registry.js").RunContext} RunContext */

export default {
  /**
   * @param {RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    const results = ctx.addon?.vendor?.results ?? [];
    const findings = [];
    for (const { path, source, outcome } of results) {
      if (outcome === "verified") {
        ctx.note?.(path, null, `verified against ${source}`, VERDICT.PASS);
      } else if (outcome === "modified") {
        ctx.note?.(path, null, `does not match ${source}`, VERDICT.FAIL);
        findings.push(
          finding({
            file: path,
            item: path,
            data: { url: source },
          })
        );
      }
    }
    return findings;
  },
};
