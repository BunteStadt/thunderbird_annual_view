// Rejects a bundled file that was IDENTIFIED (its bytes match a pinned upstream
// release on the jsDelivr CDN or a declared VENDOR source) but did NOT clear the
// popularity trust bar AND is minified/obfuscated. (A Mozilla hash-DB match is never
// gated - DB membership is the trust signal - so it never becomes untrusted.) Such a
// file is
// both untrusted (not a confirmed widely-used library, so it does not earn the
// review exemption) and unreviewable (machine-generated), so the dev must ship a
// readable build. The popularity verdict + the untrusted tagging happen earlier
// (src/lib/cdn-lookup.js, src/vendor/verify.js -> markUntrusted); this
// check just reports the unreadable ones. Identity is still OSV-audited.
//
// Belongs here: selecting the untrusted entries that are unreadable and emitting
// one finding per file. Does NOT belong here: the popularity bar / classification
// (-> src/lib/bundled.js, cdn-lookup.js, src/vendor/verify.js), the
// readable case (-> untrusted-library.js), authored wording (-> registry.yaml),
// severity (-> that registry entry), report formatting (-> src/report/format.js).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { untrustedLibs } from "../../lib/bundled.js";

/** @typedef {import("../registry.js").RunContext} RunContext */
export default {
  /**
   * @param {RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    const findings = [];
    for (const lib of untrustedLibs(ctx)) {
      if (!lib.unreadable) {
        continue; // a readable one is untrusted-library's (info) concern
      }
      const item = lib.name || lib.file;
      ctx.note?.(lib.file, null, item, VERDICT.FAIL);
      findings.push(finding({ file: lib.file, item, hint: lib.source }));
    }
    return findings;
  },
};
