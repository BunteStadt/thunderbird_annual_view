// The post-summary recheck consumer for declared permissions. The producer
// (unused-permission) hands over every declared named permission it could neither
// prove used nor deterministically prove unused, each carrying the located sites of
// its usage tokens; the divert (registry.rechecks) keeps only the ones the registry
// has a rubric prompt for and the rest stay manual. When --llm-review runs, the kept
// items are appended to the add-on summary under a rubric the assembler builds from
// the permission-prompt-framing + permission-prompts sections (choosing the tabs
// variant by the add-on's strict_min_version). A permission with located token sites
// is judged PER SITE (the model verdicts each occurrence while seeing the full add-on);
// a permission with no located site (token-less, or none present in the reviewed
// corpus) is judged holistically. This check AGGREGATES those verdicts per permission:
// any site exercised -> justified (drop), every site definitively not -> a warning
// finding, anything else or no summary -> manual review.
//
// It makes no decision of its own: the aggregation is the shared
// resolvePermissionRecheck (src/lib/recheck.js), driven by ctx.recheck (the
// handed-over items, with their occurrence ids) and ctx.recheckVerdicts (the
// summary's per-site verdicts). It runs in the post-summary phase because it is named
// as unused-permission's post-summary-recheck target (the orchestrator infers the
// phase from that reference). With no summary nothing is handed over, so it emits
// nothing and the producer's reminder stands.
//
// Belongs here: only the delegation. Does NOT belong here: enumerating the
// permissions, locating their token sites, and the deterministic token verdicts
// (-> unused-permission / src/lib/permissions.js), the wording and tokens
// (-> assets/registry.yaml), or the verdict aggregation (-> src/lib/recheck.js).

import { resolvePermissionRecheck } from "../../lib/recheck.js";

/** @typedef {import("../registry.js").RunContext} RunContext */
/** @typedef {import("../registry.js").LoadedCheck} LoadedCheck */

export default {
  /**
   * @param {RunContext} ctx
   * @param {LoadedCheck} check
   * @returns {{findings: object[], escalations: object[]}}
   */
  run(ctx, check) {
    return resolvePermissionRecheck(ctx, check);
  },
};
