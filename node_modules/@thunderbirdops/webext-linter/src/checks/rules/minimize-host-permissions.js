// Broad (global-host) permissions requested as REQUIRED. Global host access
// should be requested as optional and only for the specific hosts needed.
// Checks host_permissions (MV3) and the permissions array (MV2 host patterns).
//
// Belongs here: scanning the required host lists for broad patterns (<all_urls>
// or a "*" host, per isBroadHost) and emitting one finding per distinct match.
// Does NOT belong here: deciding whether a match pattern is broad (->
// isBroadHost in src/lib/util.js). Validating that a host pattern is
// well-formed or known (-> manifest-unknown-permission.js). Authored wording (->
// assets/registry.yaml). Severity (-> the minimize-host-permissions registry
// entry, stamped by src/checks/registry.js).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import {
  asArray,
  isBroadHost,
  isMatchPattern,
  manifestPathLine,
} from "../../lib/util.js";

export default {
  run(ctx) {
    const m = ctx.manifest;
    if (!m) {
      return [];
    }
    const out = [];
    const seen = new Set();
    for (const key of ["host_permissions", "permissions"]) {
      asArray(m[key]).forEach((p, i) => {
        // Only host match patterns are this check's concern (named permissions
        // in the MV2 array are not hosts); narrate each one, broad = fail.
        if (typeof p !== "string" || seen.has(p) || !isMatchPattern(p)) {
          return;
        }
        seen.add(p);
        const broad = isBroadHost(p);
        ctx.note?.(
          "manifest.json",
          null,
          p,
          broad ? VERDICT.FAIL : VERDICT.PASS
        );
        if (broad) {
          const line = manifestPathLine(ctx, key, i);
          out.push(
            finding({
              file: "manifest.json",
              loc: line ? { line } : null,
              item: p,
            })
          );
        }
      });
    }
    return out;
  },
};
