// Deterministic (SCA only): mission 1 of the build review - the build must NOT load or fetch
// remote resources. Everything must ship in the source; the only allowed copy-in is installed
// libraries via `npm ci` (from node_modules). A curl/wget/git-clone/CDN fetch is a reject.
//
// The classification is produced ONCE in the setup phase (analyzeBuild -> addon.buildFiles
// .buildReview, the vendor pattern); this check just reads it. `classification === "remote-fetch"`
// is the error finding (its {{explanation}} is the model's reason). This check also owns the
// FALLBACK lane: when the build could not be classified with confidence - offline / no token
// (analyzed === false), or a build step the linter could not statically bound (unresolved: an
// opaque orchestrator or a network fetch) - the whole build routes to extended manual review,
// so a human reproduces it. The "not-from-source" classification is owned by its own check;
// "ok"/"none" produce nothing.
//
// Belongs here: mapping the stored classification to a finding / manual escalation. Does NOT
// belong here: the analysis (-> src/build/analyze.js), the corpus policy
// (-> build-corpus.js), or the wording (-> assets/registry.yaml).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";

/** @typedef {import("../registry.js").RunContext} RunContext */
/** @typedef {import("../escalation.js").Escalation} Escalation */

// Classifications each owned by their own check - not this check's fallback lane.
const OWNED_ELSEWHERE = new Set(["not-from-source"]);

export default {
  /**
   * @param {RunContext} ctx
   * @returns {{findings: import("../../report/finding.js").Finding[], escalations?: Escalation[]}}
   */
  run(ctx) {
    const review = ctx.addon?.buildReview;
    if (!review) {
      return { findings: [] };
    }
    const { classification, reason, buildInstructions, unresolved, analyzed } =
      review;
    const anchor = review.anchor ?? "package.json";
    const explanation = typeof reason === "string" ? reason : "";

    // Mission 1: the build fetches from an undeclared/remote source.
    if (classification === "remote-fetch") {
      ctx.note?.(
        anchor,
        null,
        "the build fetches from a remote source",
        VERDICT.FAIL
      );
      return { findings: [finding({ file: anchor, data: { explanation } })] };
    }

    // Fallback lane: a build that exists (not "none") but could not be classified with
    // confidence - offline, or with a step the linter could not statically bound - and is
    // not already a reject another check owns -> extended manual review.
    const anotherRejectOwnsIt = OWNED_ELSEWHERE.has(classification);
    const couldNotVerify = !analyzed || (unresolved?.length ?? 0) > 0;
    if (classification !== "none" && !anotherRejectOwnsIt && couldNotVerify) {
      ctx.note?.(anchor, null, "the build configuration", VERDICT.UNSURE);
      return {
        findings: [],
        escalations: [
          {
            file: anchor,
            data: {
              explanation,
              buildInstructions:
                typeof buildInstructions === "string" ? buildInstructions : "",
              unresolvedBuildSteps: formatUnresolved(unresolved),
            },
          },
        ],
      };
    }

    return { findings: [] };
  },
};

/**
 * One sentence naming the build steps the linter could not statically bound, or "" when there
 * are none (the registry template is authored to read with the slot empty).
 * @param {{kind: string, detail: string}[]} [unresolved]
 * @returns {string}
 */
function formatUnresolved(unresolved) {
  if (!unresolved?.length) {
    return "";
  }
  const parts = unresolved.map((u) =>
    u.kind === "tool"
      ? `an unrecognized build tool (\`${u.detail}\`)`
      : u.kind === "network"
        ? `a network fetch in ${u.detail}`
        : u.detail
  );
  return `The linter could not statically analyze part of the build (${parts.join("; ")}), so the build corpus may be incomplete - reproduce the build by hand.`;
}
