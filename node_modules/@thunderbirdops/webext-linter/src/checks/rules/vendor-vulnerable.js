// Flags a pinned npm library whose bundled version has known security
// advisories - a package.json dependency OR an npm-sourced VENDOR entry. The OSV
// audit ran once in the network pre-step (src/vendor/verify.js auditNpm), which
// recorded each vulnerable package on addon.vendor.vulnerabilities with the file +
// token to anchor it; this check maps that set to findings via the shared
// lib/vuln-findings.js mapper (also used by vendor-vulnerable-dev for the SCA dev
// set). Deterministic, no network.
//
// Belongs here: choosing the prod/vendored vulnerability set. Does NOT belong
// here: the vulnerability->finding mapping incl. the severity:auto band mapping
// (-> src/lib/vuln-findings.js), the OSV query/parse (-> src/vendor/verify.js),
// the pinned-version resolution (-> src/vendor/resolve.js + src/vendor/locks.js),
// and the wording (-> assets/registry.yaml).

import { vulnFindings } from "../../lib/vuln-findings.js";

export default {
  /**
   * @param {import("../registry.js").RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    return vulnFindings(ctx, ctx.addon?.vendor?.vulnerabilities ?? []);
  },
};
