// The manifest content_security_policy allows 'unsafe-eval', which permits
// dynamic code execution - not allowed.
//
// Belongs here: emitting the finding when the CSP allows 'unsafe-eval'. Does NOT
// belong here: CSP parsing (-> src/scan/csp.js via getEvalScan in
// src/lib/eval-scan.js), authored wording (-> assets/registry.yaml), and
// severity (-> that registry entry).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { getEvalScan } from "../../lib/eval-scan.js";
import { manifestTokenLine } from "../../lib/util.js";

export default {
  run(ctx) {
    if (!getEvalScan(ctx).unsafeEval) {
      return [];
    }
    ctx.note?.("manifest.json", null, "CSP 'unsafe-eval'", VERDICT.FAIL);
    const text = ctx.manifestText;
    const line = manifestTokenLine(text, "content_security_policy");
    return [finding({ file: "manifest.json", loc: line ? { line } : null })];
  },
};
