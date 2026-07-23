// A called API needs a manifest key (e.g. "action" / "browser_action") that the
// manifest does not declare. Distinct from missing-permission (a missing
// permission string) because the remedy is a manifest key, not a permission.
//
// Belongs here: selecting the `missingManifestKeys` slice of the shared
// permission analysis and emitting it as this check's findings.
//
// Does NOT belong here: the analysis itself (-> getPermissionAnalysis in
// src/lib/permissions.js, shared with missing-permission.js). Authored
// wording (-> assets/registry.yaml). Severity (-> the missing-manifest-key
// registry entry, stamped by src/checks/registry.js).

import { getPermissionAnalysis } from "../../lib/permissions.js";

export default {
  run(ctx) {
    const { missingManifestKeys, notes } = getPermissionAnalysis(ctx);
    for (const n of notes.manifestKeys) {
      ctx.note?.(n.file, n.loc, n.item, n.verdict);
    }
    return missingManifestKeys;
  },
};
