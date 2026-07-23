// Deterministic preflight -> manual review: an add-on that declares the
// nativeMessaging permission can exchange messages with a native application
// outside Thunderbird. The native host is not part of the package, so a reviewer
// must confirm the listing discloses what is exchanged (the No Surprises
// policy). The permission is the identity - runtime.connectNative /
// sendNativeMessage do not work without it - so the check keys purely off
// whether it is declared (in permissions or optional_permissions), with no JS
// scan needed.
//
// Belongs here: escalating one manual-review case when the permission is
// declared. Does NOT belong here: the permission parsing (-> declaredPermissions
// in src/lib/permissions.js), the deterministic->manual routing (->
// src/checks/registry.js + escalation.js), and the authored instructions (->
// assets/registry.yaml).

import { VERDICT } from "../../lib/enum.js";
import { declaredPermissions } from "../../lib/permissions.js";

/** @typedef {import("../registry.js").RunContext} RunContext */
/** @typedef {import("../escalation.js").Escalation} Escalation */

const NATIVE_MESSAGING = "nativeMessaging";

export default {
  /**
   * @param {RunContext} ctx
   * @returns {{findings: [], escalations: Escalation[]}}
   */
  run(ctx) {
    const manifest = ctx.manifest;
    if (
      !manifest ||
      !declaredPermissions(manifest).named.has(NATIVE_MESSAGING)
    ) {
      return { findings: [], escalations: [] };
    }
    ctx.note?.(
      "manifest.json",
      null,
      `'${NATIVE_MESSAGING}' permission`,
      VERDICT.UNSURE
    );
    // A single whole-add-on reminder: no item/locus to list (the instructions
    // name the permission), so it renders as the wrapped message alone.
    return { findings: [], escalations: [{}] };
  },
};
