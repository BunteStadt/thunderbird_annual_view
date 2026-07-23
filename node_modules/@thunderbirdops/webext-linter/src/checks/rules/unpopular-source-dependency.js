// SCA mode (sca: true). Rejects a declared dependency that is not a confirmed
// widely-used library. In a source-code submission the dependency code is not in
// the readable source (it is pulled in at build) and is mangled in the built XPI,
// so a non-popular one cannot be reviewed - the developer must ship its readable
// source inside --sca-source. The network pre-step (src/vendor/verify.js
// verifyScaDependencies) looked up each package.json dependency's npm popularity
// and, when it is below the trust bar, recorded it on addon.vendor.unpopularDeps.
// This check only reads that and emits one error finding per such dependency,
// anchored at its package.json declaration line. Deterministic, no network.
//
// A POPULAR dependency is not recorded (trusted by ubiquity), so it never reaches
// here. OSV vulnerability auditing of every declared dependency is separate (->
// auditNpm -> vendor-vulnerable).
//
// Belongs here: turning each recorded unpopular dependency into a finding (+ a
// feed note). Does NOT belong here: the popularity lookup (-> src/vendor/
// verify.js), the dep pinning (-> src/vendor/resolve.js + src/vendor/locks.js),
// and the wording (-> assets/registry.yaml).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { manifestTokenLine, lineContaining } from "../../lib/util.js";

/** @typedef {import("../registry.js").RunContext} RunContext */

export default {
  /**
   * @param {RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    const { addon } = ctx;
    const deps = addon?.vendor?.unpopularDeps ?? [];
    const findings = [];
    for (const { name, version, file, token } of deps) {
      const text = addon.files?.get(file)?.toString("utf8") ?? "";
      // Anchor at the dependency's declaration line (a quoted JSON key in
      // package.json); fall back to a plain substring, then to no line.
      const line = token
        ? (manifestTokenLine(text, token) ?? lineContaining(text, token))
        : null;
      const loc = line ? { line } : undefined;
      // The response is collapsible (no {{item}}), so `item` renders on the
      // location line as "package.json:<line> - <name> (<version>)".
      const item = `${name} (${version})`;
      ctx.note?.(
        file,
        loc,
        `${item} - unreviewable build dependency`,
        VERDICT.FAIL
      );
      findings.push(finding({ file, loc, item }));
    }
    return findings;
  },
};
