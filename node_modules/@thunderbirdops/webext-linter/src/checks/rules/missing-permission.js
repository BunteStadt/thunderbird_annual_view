// A permission required but not declared in the manifest - required by a called
// API, or implied by a script-injection manifest key (compose_scripts -> compose,
// message_display_scripts -> messagesModify).
//
// Belongs here: selecting the `missingPermissions` slice of the shared
// permission analysis and emitting it as this check's findings. The "API needs a
// manifest key" case is missing-manifest-key.js (a different remedy).
//
// Does NOT belong here: the analysis itself - matching API usages to required
// permissions and manifest keys (-> getPermissionAnalysis in
// src/lib/permissions.js, shared with missing-manifest-key.js). The
// required-permission schema data it consumes (-> src/schema/index.js). Authored
// wording (-> assets/registry.yaml). Severity (-> the missing-permission
// registry entry, stamped by src/checks/registry.js).

import { getPermissionAnalysis } from "../../lib/permissions.js";

export default {
  run(ctx) {
    const { missingPermissions, notes } = getPermissionAnalysis(ctx);
    for (const n of notes.requirements) {
      ctx.note?.(n.file, n.loc, n.item, n.verdict);
    }
    return missingPermissions;
  },
};
