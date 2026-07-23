// Heuristic: the developer's own code shipped minified - mechanically unreadable
// (not obfuscated to hide behavior, just stripped of whitespace/names), which
// cannot be reviewed as-is. Flags such a JS file - that is NOT a recognized
// third-party library (those are missing-library's job) - so the reviewer can
// require the original source. Detects minified line geometry (a very long,
// dense line). A file that is also obfuscated is obfuscated-code's job (the
// stronger signal), so it is excluded here.
//
// Belongs here: selecting the classifier verdicts that are minified (and not
// obfuscated) AND not a library, and emitting one finding per such file.
//
// Does NOT belong here: the classification heuristics themselves (->
// src/lib/bundled.js, classifyAddonJs), the library-signal verdict and
// its finding (-> missing-library.js), the obfuscated verdict (->
// obfuscated-code.js), authored wording (-> assets/registry.yaml), severity (->
// that registry entry, stamped by src/checks/registry.js), and report
// formatting (-> src/report/format.js).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { classifyAddonJs, isMinifiedFirstParty } from "../../lib/bundled.js";

/** @typedef {import("../registry.js").RunContext} RunContext */
export default {
  /**
   * @param {RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    const findings = [];
    for (const c of classifyAddonJs(ctx)) {
      if (c.library || c.obfuscation.fail || c.untrusted) {
        // library -> missing-library; obfuscated -> obfuscated-code; untrusted (a
        // not-popular CDN match) -> untrusted-minified-library if unreadable, else
        // untrusted-library.
        continue;
      }
      ctx.note?.(
        c.file,
        null,
        c.minified ? "minified" : "readable",
        c.minified ? VERDICT.FAIL : VERDICT.PASS
      );
      if (isMinifiedFirstParty(c)) {
        findings.push(finding({ file: c.file }));
      }
    }
    return findings;
  },
};
