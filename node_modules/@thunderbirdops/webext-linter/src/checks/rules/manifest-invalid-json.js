// manifest.json is present but is not valid JSON, so the submission is invalid.
// The other manifest checks need a parsed manifest, so they stay silent in this
// case (this is the only finding).
//
// Belongs here: the unparsable-JSON verdict. Does NOT belong here: parsing the
// manifest (-> src/addon/load.js records the parse error, surfaced as
// ctx.manifestError - the SHIPPED manifest's), authored wording
// (-> assets/registry.yaml), and severity (-> that registry entry).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";

export default {
  run(ctx) {
    if (!ctx.manifestError) {
      return [];
    }
    ctx.note?.("manifest.json", null, "unparsable JSON", VERDICT.FAIL);
    return [finding({ file: "manifest.json" })];
  },
};
