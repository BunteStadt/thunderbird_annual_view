// The manifest content_security_policy allows 'unsafe-inline', which permits
// dynamic code execution via inline scripts - not allowed.
//
// Belongs here: emitting the finding when the CSP allows 'unsafe-inline'. Does
// NOT belong here: CSP parsing (-> src/scan/csp.js via getEvalScan in
// src/lib/eval-scan.js), authored wording (-> assets/registry.yaml), and
// severity (-> that registry entry).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { getEvalScan } from "../../lib/eval-scan.js";
import { manifestTokenLine } from "../../lib/util.js";

export default {
  run(ctx) {
    if (!getEvalScan(ctx).unsafeInline) {
      return [];
    }
    ctx.note?.("manifest.json", null, "CSP 'unsafe-inline'", VERDICT.FAIL);
    const text = ctx.manifestText;
    const line = manifestTokenLine(text, "content_security_policy");
    return [finding({ file: "manifest.json", loc: line ? { line } : null })];
  },
};
