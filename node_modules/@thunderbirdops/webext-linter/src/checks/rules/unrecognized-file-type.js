// A packaged file the add-on LOADS (declared in the manifest, or via a <script src>) whose
// suffix is in no recognized type - the browser executes/uses it, but no check could classify
// it, so it went unreviewed. The backstop that makes the JS-corpus suffix list safe: an
// un-enumerated suffix stops being a silent gap and becomes a loud finding.
//
// Belongs here: turning reachability's precomputed unrecognizedRefs into findings. Does NOT
// belong here: detecting the refs (that is the manifest / <script> walk in
// src/lib/reachability.js), the recognized-suffix set (src/util/files.js
// RECOGNIZED_EXTS), authored wording (assets/registry.yaml), and severity (that entry).

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
    for (const ref of buildReachability(ctx).unrecognizedRefs) {
      findings.push(
        finding({
          file: ref.file,
          data: {
            referrer:
              ref.line != null ? `${ref.referrer}:${ref.line}` : ref.referrer,
          },
        })
      );
    }
    return findings;
  },
};
