// Reports the runner's own static-analysis coverage gaps from dynamic/aliased
// access that cannot be resolved statically. Reads ctx.apiUsages, which the
// parse step populates, and forwards each limitation's diagnostic as the item.
// A file that failed to parse is the separate unparsable-file check.
//
// Belongs here: turning parser limitations recorded in ctx.apiUsages into
// findings, keyed by the parser's own diagnostic string. Does NOT belong here:
// parse failures (-> unparsable-file.js), producing ctx.apiUsages (the upstream
// parse step), authored wording (-> assets/registry.yaml), and severity (-> the
// api-coverage registry entry, stamped by src/checks/registry.js).

import { finding } from "../../report/finding.js";
import { buildReachability } from "../../lib/reachability.js";

/** @typedef {import("../registry.js").RunContext} RunContext */

export default {
  /**
   * @param {RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    const findings = [];
    // Only report coverage gaps in the pure WebExtension tree (experiment/core and
    // dead code are out).
    const webext = buildReachability(ctx).pureWebExtensionReachable;
    for (const src of ctx.apiUsages || []) {
      if (!webext.has(src.file)) {
        continue;
      }
      for (const lim of src.limitations || []) {
        // lim.reason is the parser's own diagnostic (data), passed through.
        findings.push(
          finding({
            item: lim.reason,
            file: src.file,
            loc: { line: lim.line, column: lim.column },
          })
        );
      }
    }
    return findings;
  },
};
