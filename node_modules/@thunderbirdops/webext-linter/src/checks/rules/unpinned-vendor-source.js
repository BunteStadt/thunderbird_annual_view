// Rejects a VENDOR-declared file whose source is a trusted host but is not
// pinned to an immutable ref (a branch like .../main, or an unversioned URL).
// Such a source can change after review, so the bytes cannot be verified - the
// developer must link to a specific version, tag, or commit. resolveVendor
// classified each declared source offline (src/vendor/sources.js) and recorded
// the non-pinned ones as `unpinned-source` results on addon.vendor. This check
// only reads them. Deterministic, no network.
//
// Belongs here: turning each unpinned-source result into a finding (+ a feed
// note). Does NOT belong here: classifying the URL (-> src/vendor/sources.js),
// resolving the store (-> src/vendor/resolve.js) and the registry wording.

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
    const vendor = ctx.addon?.vendor;
    // Anchor on the VENDOR declaration (file + the line citing the source), with
    // the URL on the locus line - mirrors vendor-vuln-unknown. The vendored file
    // is `item`, surfaced in the response prose.
    const vendorName = vendor?.vendorFile ?? null;
    const vendorText = vendorName
      ? (ctx.addon.files?.get(vendorName)?.toString("utf8") ?? "")
      : "";
    const findings = [];
    for (const { path, source } of (vendor?.results ?? []).filter(
      (r) => r.outcome === "unpinned-source"
    )) {
      const line = lineContaining(vendorText, source);
      const loc = line ? { line } : undefined;
      ctx.note?.(
        vendorName ?? path,
        loc,
        `non-pinned source: ${source}`,
        VERDICT.FAIL
      );
      findings.push(
        finding({
          file: vendorName ?? path,
          loc,
          item: path,
          hint: source,
        })
      );
    }
    return findings;
  },
};
