// Deterministic (SCA only): mission 2 of the build review - the shipped XPI must be BUILT from
// the reviewed source. This rejects a "build" that does not build: it just copies or zips files
// already present in the submission into the XPI, so the shipped add-on is assembled from phantom
// artifacts, not derived from the source the reviewer reads. Either an oversight (the dev thinks
// zipping is the required build) or an attempt to have reviewers vet a source the XPI does not
// come from.
//
// The classification is produced once in setup (analyzeBuild -> addon.buildFiles.buildReview);
// this check reads it. `classification === "not-from-source"` -> error (its {{explanation}} is the
// model's reason).
//
// Belongs here: mapping the stored classification to a finding. Does NOT belong here: the analysis
// (-> src/build/analyze.js) or the wording (-> assets/registry.yaml).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";

/** @typedef {import("../registry.js").RunContext} RunContext */

export default {
  /**
   * @param {RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    const review = ctx.addon?.buildReview;
    if (review?.classification !== "not-from-source") {
      return [];
    }
    const anchor = review.anchor ?? "package.json";
    const explanation = typeof review.reason === "string" ? review.reason : "";
    ctx.note?.(
      anchor,
      null,
      "the build does not build from source",
      VERDICT.FAIL
    );
    return [finding({ file: anchor, data: { explanation } })];
  },
};
