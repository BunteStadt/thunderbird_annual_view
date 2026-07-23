// Routes the third-party declarations that cannot be settled automatically to
// manual review: no source URL declared, a source on a host we may not fetch,
// and a source we could not fetch. (A not-popular-but-verified library is no
// longer here - it is treated as authored code; see markUntrusted /
// untrusted-library.) The verification
// pre-step (src/vendor/resolve.js + src/vendor/verify.js) recorded each of these
// on addon.vendor. This check reads them and escalates one manual-review item per
// case. Deterministic, no network - the deterministic->manual routing is wired in
// registry.js and escalation.js. (A VENDOR file that parses to nothing is the
// vendor-unparseable check's error finding, not a manual item here.)
//
// Belongs here: turning each unverifiable result into a manual-review escalation
// (+ a feed note). Does NOT belong here: the fetch/classify/parse work (->
// src/vendor/{verify,sources,resolve}.js) and the authored instructions (->
// assets/registry.yaml).

import { VERDICT } from "../../lib/enum.js";
import { readVendorFile } from "../../normalize/vendor.js";
import { VENDOR_TRUSTED_HOSTS } from "../../config.js";

/** @typedef {import("../registry.js").RunContext} RunContext */
/** @typedef {import("../escalation.js").Escalation} Escalation */

// The hosts vendor verification will fetch from, named in the untrusted reason so
// the developer knows where to move the source. Derived from the single config
// list (config.js VENDOR_TRUSTED_HOSTS) so it stays correct if that set changes.
const TRUSTED_HOSTS = VENDOR_TRUSTED_HOSTS.map((h) => `https://${h}`).join(
  ", "
);

// Results this check owns, each mapped to its manual-review reason. Reasons do
// not repeat the source URL (it is listed separately on the location line, which
// reads "<VENDOR file> - <declared file> - <source URL> - <reason>"); the
// untrusted reason does name the trusted hosts the source could move to.
const REASON = {
  "no-url": "no source URL declared",
  untrusted: `source not on a trusted host (use ${TRUSTED_HOSTS})`,
  unfetchable: "source could not be fetched",
};

export default {
  /**
   * @param {RunContext} ctx
   * @returns {{findings: [], escalations: Escalation[]}}
   */
  run(ctx) {
    const { addon } = ctx;
    const vendor = addon?.vendor ?? {};
    const escalations = [];
    // The escalations group under one entry (the instruction is item-free), so
    // each is located by the VENDOR file (its `file`) and lists the declared
    // file, source URL, and reason as its item -> "<VENDOR> - <file> - <url> -
    // <reason>". The per-file reason therefore stays on the report line.
    const vendorName = (addon.files && readVendorFile(addon)?.name) || "VENDOR";

    for (const { path, source, outcome } of vendor.results ?? []) {
      const reason = REASON[outcome];
      if (reason) {
        const item = [path, source, reason].filter(Boolean).join(" - ");
        ctx.note?.(vendorName, null, item, VERDICT.UNSURE);
        escalations.push({ file: vendorName, item });
      }
    }

    // A VENDOR file present but parsed to nothing is the vendor-unparseable check's
    // job (an error finding), not a manual escalation here.

    return { findings: [], escalations };
  },
};
