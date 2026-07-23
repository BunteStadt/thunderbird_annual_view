// Deterministic: a submitted source-code archive (--sca-root) was not needed, because the
// shipped XPI is directly reviewable (its code is not minified or obfuscated). The pipeline
// decides this from the built XPI's OWN classification (hasUnreviewableCode over
// xpiAddon.bundled) and downgrades to a plain XPI review, setting ctx.scaNotRequired; this
// check reports it so the developer submits only the XPI next time. When the shipped XPI IS
// minified/obfuscated the SCA is kept and this never fires.
//
// Belongs here: mapping the pipeline's ctx.scaNotRequired flag to a finding. Does NOT belong
// here: the reviewability decision (-> src/pipeline.js + src/lib/bundled.js
// hasUnreviewableCode) or the wording (-> assets/registry.yaml).

import { finding } from "../../report/finding.js";

/** @typedef {import("../registry.js").RunContext} RunContext */
export default {
  /**
   * @param {RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    if (!ctx.scaNotRequired) {
      return [];
    }
    return [finding({ file: "manifest.json" })];
  },
};
