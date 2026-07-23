// Shared vulnerability->finding mapping for the two dependency-vulnerability
// checks: vendor-vulnerable (prod deps + vendored libs, addon.vendor.vulnerabilities)
// and vendor-vulnerable-dev (SCA dev deps, addon.vendor.devVulnerabilities). The
// OSV audit ran once in the network pre-step (src/vendor/verify.js auditNpm), which
// recorded each vulnerable package with the file + token to anchor it; this maps
// each recorded vulnerability to a finding, anchored at its declaration line.
// Deterministic, no network.
//
// Both registry entries are severity:auto, so the finding's severity is set here
// from the advisory's OSV band: high / critical -> error, moderate / medium ->
// warning, everything else (low / unknown) -> info. Every recorded vulnerability
// is reported; none are dropped.
//
// Belongs here: turning each recorded vulnerability into a finding (+ a feed note)
// and mapping its band to a finding severity. Does NOT belong here: the OSV
// query/parse (-> src/vendor/verify.js), the pinned-version resolution (->
// src/vendor/resolve.js + src/vendor/locks.js), and the wording (->
// assets/registry.yaml).

import { VERDICT } from "./enum.js";
import { finding, SEVERITY } from "../report/finding.js";
import { manifestTokenLine, lineContaining } from "./util.js";

/** @typedef {import("../checks/registry.js").RunContext} RunContext */
/** @typedef {import("../report/finding.js").Severity} Severity */
/** @typedef {import("../vendor/verify.js").VendorVuln} VendorVuln */

/**
 * Map an OSV/GHSA severity band to a finding severity. GHSA labels the middle
 * band "moderate" while raw CVSS calls it "medium". Both map to warning.
 * Anything not high/critical/moderate/medium (low, unknown, an unrecognized
 * label) is informational - reported, but neither an error nor a warning.
 * @param {string} band  The recorded OSV band (auditNpm lowercases it).
 * @returns {Severity}
 */
function severityForBand(band) {
  switch (String(band).toLowerCase()) {
    case "critical":
    case "high":
      return SEVERITY.ERROR;
    case "moderate":
    case "medium":
      return SEVERITY.WARNING;
    default:
      return SEVERITY.INFO;
  }
}

/**
 * Turn each recorded vulnerability into a finding, anchored at its declaration
 * line in the packaged file, and emit a feed note per finding.
 * @param {RunContext} ctx
 * @param {VendorVuln[]} vulns  The vulnerability records to report.
 * @returns {import("../report/finding.js").Finding[]}
 */
export function vulnFindings(ctx, vulns) {
  const { addon } = ctx;
  const textByFile = new Map();
  /**
   * Read a packaged file's text, memoizing it per path.
   * @param {string} file  The packaged file path to read.
   * @returns {string}  The file's UTF-8 text, or "" when absent.
   */
  const fileText = (file) => {
    if (!textByFile.has(file)) {
      textByFile.set(file, addon.files?.get(file)?.toString("utf8") ?? "");
    }
    return textByFile.get(file);
  };
  const findings = [];
  for (const { name, version, ids, severity, fixed, file, token } of vulns) {
    const text = fileText(file);
    // A quoted JSON token (a package.json dep name) or a plain substring (the
    // VENDOR-file source URL) - whichever locates the declaration line. An empty
    // token means there is no declaration line (a hash-identified library), so
    // the finding anchors at the file with no line.
    const line = token
      ? (manifestTokenLine(text, token) ?? lineContaining(text, token))
      : null;
    const loc = line ? { line } : undefined;
    ctx.note?.(
      file,
      loc,
      `${name}@${version} has known vulnerabilities (${ids.join(", ")})`,
      VERDICT.FAIL
    );
    findings.push(
      finding({
        file,
        loc,
        item: name,
        // severity:auto - this maps the finding's severity from the advisory band;
        // the raw band string still fills the {{severity}} response slot via
        // data.severity.
        severity: severityForBand(severity),
        data: {
          version,
          ids: ids.join(", "),
          severity,
          fixed: fixed.length ? fixed.join(", ") : "a patched release",
        },
      })
    );
  }
  return findings;
}
