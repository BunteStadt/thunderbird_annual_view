// Escalates a manual review when an EXPERIMENT add-on calls a WebExtension API the
// schema does not recognize. On an Experiment this is usually a typo in the add-on's
// OWN experiment schema (the schema's `namespace` is the sole authority, so if it
// does not match the API the code calls the API is effectively undefined) - which
// reads like a false-positive unsupported-API finding but is a real schema bug. Fires
// only when isExperiment AND there is unrecognized API usage; unknown-api already
// lists the specific APIs, so this adds one locus-less reminder (no re-listing).
//
// Belongs here: the isExperiment && has-unknown-APIs gate and the single escalation.
// Does NOT belong here: resolving/listing the unknown APIs (-> lib/api-resolution.js
// via unknownApis, rendered by unknown-api.js), the authored instructions/response
// (-> assets/registry.yaml), or the deterministic->manual routing (registry.js +
// escalation.js).

import { VERDICT } from "../../lib/enum.js";
import { isExperiment } from "../../lib/util.js";
import { unknownApis } from "../../lib/api-resolution.js";

/** @typedef {import("../registry.js").RunContext} RunContext */
/** @typedef {import("../escalation.js").Escalation} Escalation */

export default {
  /**
   * @param {RunContext} ctx
   * @returns {{findings: [], escalations: Escalation[]}}
   */
  run(ctx) {
    const m = ctx.manifest;
    if (!m || !isExperiment(m)) {
      ctx.note?.("manifest.json", null, "not an Experiment", VERDICT.SKIPPED);
      return { findings: [], escalations: [] };
    }
    if (unknownApis(ctx).length === 0) {
      ctx.note?.(
        "manifest.json",
        null,
        "no unrecognized API usage",
        VERDICT.SKIPPED
      );
      return { findings: [], escalations: [] };
    }
    ctx.note?.(
      "manifest.json",
      null,
      "Experiment with unrecognized API usage - manual review",
      VERDICT.UNSURE
    );
    // A whole-add-on reminder: no locus, so it renders as the instruction +
    // suggested response alone under Extended manual review (unknown-api lists the
    // specific APIs).
    return { findings: [], escalations: [{}] };
  },
};
