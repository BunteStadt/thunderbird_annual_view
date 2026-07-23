// The manifest_version disagrees with the schema set being reviewed against (an
// MV2 add-on reviewed against the MV3 schema, or vice versa), so the submission
// is invalid. Runs only on a parsed manifest.
//
// Belongs here: comparing manifest_version against schema.manifestVersionMajor.
// Does NOT belong here: the schema query (-> src/schema/index.js), authored
// wording (-> assets/registry.yaml), and severity (-> that registry entry).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";

export default {
  run(ctx) {
    const m = ctx.manifest;
    const major = ctx.schema?.manifestVersionMajor;
    if (!m || typeof m.manifest_version !== "number" || !major) {
      return [];
    }
    if (m.manifest_version === major) {
      return [];
    }
    ctx.note?.(
      "manifest.json",
      null,
      `manifest_version ${m.manifest_version} (schema set is ${major})`,
      VERDICT.FAIL
    );
    return [
      finding({
        file: "manifest.json",
        item: String(m.manifest_version),
        data: { schema: major },
      }),
    ];
  },
};
