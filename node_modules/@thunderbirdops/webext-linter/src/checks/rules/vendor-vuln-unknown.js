// Flags a vendored library that could not be checked for known vulnerabilities.
// The network pre-step (src/vendor/verify.js auditGithub) already tried to prove
// an npm identity for every github-sourced VENDOR entry - by content-hash
// matching the bundled bytes against a candidate npm package, deterministically
// and then via an LLM-proposed name - and audited the ones it could. The entries
// it could NOT resolve are recorded on addon.vendor.unaudited; this check just
// reads that and surfaces one info per entry, so the reviewer knows the library
// went unaudited and the developer is nudged toward an npm-hosted source.
// Deterministic, no network: a pure reader of the shared store.
//
// (First-party trusted-org github sources are never recorded as unaudited - they
// are accepted by provenance - so they produce nothing here. npm-sourced entries
// and resolved github twins are audited by vendor-vulnerable instead.)
//
// Belongs here: turning each addon.vendor.unaudited entry into an info finding +
// note. Does NOT belong here: the resolution/audit attempt (-> src/vendor/
// verify.js), or the wording (-> the registry).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { lineContaining } from "../../lib/util.js";

/** @typedef {import("../registry.js").RunContext} RunContext */

export default {
  /**
   * @param {RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    const { addon } = ctx;
    const vendor = addon?.vendor;
    const unaudited = vendor?.unaudited ?? [];
    const vendorName = vendor?.vendorFile ?? null;
    const vendorText = vendorName
      ? (addon.files?.get(vendorName)?.toString("utf8") ?? "")
      : "";
    const findings = [];
    for (const { path, source } of unaudited) {
      const line = source ? lineContaining(vendorText, source) : null;
      const loc = line ? { line } : undefined;
      ctx.note?.(
        vendorName,
        loc,
        `${path} (source ${source}) could not be checked for known vulnerabilities`,
        VERDICT.SKIPPED
      );
      findings.push(
        finding({
          file: vendorName,
          loc,
          // The generic message has no {{item}} slot, so `item` surfaces on the
          // location line: show the unauditable CDN source URL (the actionable
          // thing), not the local vendored path.
          item: source,
        })
      );
    }
    return findings;
  },
};
