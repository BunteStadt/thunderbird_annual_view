// Flags a source URL that the VENDOR file pairs with MORE THAN ONE bundled file.
// A file source can only verify a single file, so such a pairing is ambiguous - the
// developer must give each file its own source, or declare the containing directory
// with one directory source. resolveVendor pulls these entries out of the manifest
// (they are not verified) and records them on `vendor.ambiguousSources`; this rule
// just turns each into a finding.
//
// Belongs here: turning the resolveVendor `ambiguousSources` list into findings.
// Does NOT belong here: the parse / pairing (src/normalize/vendor.js), the offline
// resolve (src/vendor/resolve.js), or the wording (assets/registry.yaml).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";

/** @typedef {import("../registry.js").RunContext} RunContext */

export default {
  /**
   * @param {RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    const vendor = ctx.addon?.vendor;
    const file = vendor?.vendorFile ?? "VENDOR";
    const out = [];
    for (const { source, paths } of vendor?.ambiguousSources ?? []) {
      const files = paths.join(", ");
      ctx.note?.(file, null, `${source} -> ${files}`, VERDICT.FAIL);
      out.push(finding({ file, item: source, data: { files } }));
    }
    return out;
  },
};
