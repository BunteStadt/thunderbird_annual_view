// Flags a bundled third-party library version disallowed by Mozilla's add-on policy
// (banned -> error) or discouraged (unadvised -> warning) - the curated policy in
// assets/library-blocks.yaml. The vendor audit (src/vendor/verify.js) matched each
// identified/declared (name, version) against the policy BEFORE its OSV query,
// recording hits on addon.vendor.blocked (a banned one also skipped the OSV request);
// this check maps that set to findings, anchored at the declaration line. Deterministic,
// no network.
//
// Distinct from vendor-vulnerable, which reports published CVE advisories (OSV): this
// is Mozilla POLICY, which can ban a version that has no formal advisory. severity:auto
// - the check sets each finding's severity: banned -> error, unadvised -> warning.
//
// Belongs here: choosing the blocked set and mapping it to findings (the severity:auto
// status mapping). Does NOT belong here: the policy match + file loading (->
// src/lib/library-blocks.js), the OSV audit (-> src/vendor/verify.js), and the
// wording (-> assets/registry.yaml).

import { VERDICT } from "../../lib/enum.js";
import { finding, SEVERITY } from "../../report/finding.js";
import { manifestTokenLine, lineContaining } from "../../lib/util.js";

/** @typedef {import("../registry.js").RunContext} RunContext */

export default {
  /**
   * @param {RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    const { addon } = ctx;
    const blocked = addon?.vendor?.blocked ?? [];
    const textByFile = new Map();
    /**
     * Read a packaged file's text, memoizing it per path.
     * @param {string} file  The packaged file path.
     * @returns {string}  The file's UTF-8 text, or "" when absent.
     */
    const fileText = (file) => {
      if (!textByFile.has(file)) {
        textByFile.set(file, addon.files?.get(file)?.toString("utf8") ?? "");
      }
      return textByFile.get(file);
    };
    const findings = [];
    for (const { name, version, status, reason, file, token } of blocked) {
      const text = fileText(file);
      // A quoted JSON token (a package.json dep name) or a plain substring (a VENDOR
      // source URL) locates the declaration line. An empty token (a hash-identified
      // library) has no declaration line, so the finding anchors at the file.
      const line = token
        ? (manifestTokenLine(text, token) ?? lineContaining(text, token))
        : null;
      const loc = line ? { line } : undefined;
      const statusText = status === "banned" ? "disallowed" : "discouraged";
      ctx.note?.(
        file,
        loc,
        `${name}@${version} is ${statusText} by Mozilla add-on policy`,
        VERDICT.FAIL
      );
      findings.push(
        finding({
          file,
          loc,
          item: name,
          // severity:auto - a banned version is rejected (error); an unadvised one
          // is a warning. The human status word fills the {{status}} response slot.
          severity: status === "banned" ? SEVERITY.ERROR : SEVERITY.WARNING,
          data: { version, reason, status: statusText },
        })
      );
    }
    return findings;
  },
};
