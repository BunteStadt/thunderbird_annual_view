// Flags a pinned npm devDependency whose version has known OSV advisories. Dev
// dependencies are build-time only and never shipped, but in SCA mode the reviewer
// builds the add-on from source, so a vulnerable build tool runs on the reviewer's
// machine. The OSV audit ran in the network pre-step (src/vendor/verify.js
// verifyScaDependencies -> auditNpm), recording each hit on
// addon.vendor.devVulnerabilities; this check maps that set to findings via the
// shared lib/vuln-findings.js mapper - identical to vendor-vulnerable, but for the
// dev set (SCA-only; the registry entry is sca:true).
//
// Belongs here: choosing the dev vulnerability set. Does NOT belong here: the
// vulnerability->finding mapping incl. the severity:auto band mapping
// (-> src/lib/vuln-findings.js), the OSV query (-> src/vendor/verify.js), and
// the wording (-> assets/registry.yaml).

import { vulnFindings } from "../../lib/vuln-findings.js";

export default {
  /**
   * @param {import("../registry.js").RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    return vulnFindings(ctx, ctx.addon?.vendor?.devVulnerabilities ?? []);
  },
};
