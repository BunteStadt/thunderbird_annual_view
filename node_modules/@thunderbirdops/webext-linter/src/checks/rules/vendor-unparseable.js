// Flags a VENDOR file that exists but could not be parsed into a single valid
// declaration - no block pairs a library-like packaged file with a source URL that
// points to a file. The developer declared third-party libraries but in a form the
// tool cannot verify, so the libraries go unchecked: an error until the documented
// format is used (a parseable-but-incomplete VENDOR whose declared file is merely
// absent is missing-vendor-file, not this).
//
// Belongs here: turning the resolveVendor `unparsedVendor` flag into a finding.
// Does NOT belong here: parsing the VENDOR file (src/normalize/vendor.js), the
// offline resolve (src/vendor/resolve.js), or the wording (assets/registry.yaml).

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
    if (!vendor?.unparsedVendor) {
      return [];
    }
    const file = vendor.vendorFile ?? "VENDOR";
    ctx.note?.(file, null, "could not be parsed", VERDICT.FAIL);
    return [finding({ file })];
  },
};
