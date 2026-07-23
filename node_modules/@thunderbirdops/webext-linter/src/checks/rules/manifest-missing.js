// No manifest.json at the add-on root, so the submission is invalid. Fires only
// when the manifest is genuinely absent (not when it is present but unparsable -
// that is manifest-invalid-json).
//
// Belongs here: the absent-manifest verdict. Does NOT belong here: loading the
// add-on (-> src/addon/load.js), authored wording (-> assets/registry.yaml), and
// severity (-> that registry entry).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";

export default {
  run(ctx) {
    if (ctx.manifestError || ctx.manifest) {
      return [];
    }
    ctx.note?.("manifest.json", null, "no manifest.json", VERDICT.FAIL);
    return [finding({})];
  },
};
