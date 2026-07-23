// Rejects (and short-circuits the review for) an Experiment add-on whose
// experiment is NOT a recognised published Thunderbird API draft - i.e. an
// `unsupported` experiment (an unknown API name, which includes one that shadows
// a built-in). Recognised-but-modified experiments do NOT reach this check: the
// pipeline keeps them on the normal review path, where experiment-modified flags
// them. Silent when experiments are allowed (--allow-experiments) or the add-on
// is not an Experiment.
//
// Belongs here: turning the per-experiment classification
// (ctx.experiments, computed by src/experiments/verify.js) into one
// finding per unsupported experiment, and refining the reason to "shadows a
// built-in" when its declared path resolves to a real API
// (ctx.schema.resolveApi). Does NOT belong here: detecting Experiment status
// (isExperiment), classifying the files (src/experiments/verify.js), authored
// heading wording (assets/registry.yaml), or severity (that registry entry,
// stamped by src/checks/registry.js).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { isExperiment, manifestTokenLine } from "../../lib/util.js";

/** @typedef {import("../registry.js").RunContext} RunContext */
export default {
  /**
   * @param {RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    const m = ctx.manifest;
    if (!m) {
      ctx.note?.(
        "manifest.json",
        null,
        "manifest did not parse",
        VERDICT.SKIPPED
      );
      return [];
    }
    if (!isExperiment(m)) {
      ctx.note?.("manifest.json", null, "not an Experiment", VERDICT.PASS);
      return [];
    }
    if (ctx.options?.allowExperiments) {
      ctx.note?.(
        "manifest.json",
        null,
        "experiments allowed (--allow-experiments)",
        VERDICT.SKIPPED
      );
      return [];
    }

    const text = ctx.manifestText ?? "";
    const groups = ctx.experiments?.groups;
    if (!Array.isArray(groups) || groups.length === 0) {
      // Defensive: the pipeline populates groups before short-circuiting here.
      const line = manifestTokenLine(text, "experiment_apis");
      const loc = line ? { line, column: 0 } : null;
      ctx.note?.(
        "manifest.json",
        loc,
        "experiment_apis declared",
        VERDICT.FAIL
      );
      return [finding({ file: "manifest.json", loc })];
    }

    const findings = [];
    for (const g of groups) {
      if (g.status !== "unsupported") {
        continue; // pristine / modified don't abort the review
      }
      const loc = g.line ? { line: g.line, column: 0 } : null;
      const shadow = firstShadow(ctx.schema, g.apiPaths);
      const reason = shadow
        ? `the ${shadow.path} API shadows the built-in ${shadow.builtin} API`
        : `the ${g.name} API is not a published Thunderbird API draft`;
      ctx.note?.(
        "manifest.json",
        loc,
        `${g.name} (${shadow ? "shadows built-in" : "unsupported"})`,
        VERDICT.FAIL
      );
      findings.push(finding({ file: "manifest.json", loc, hint: reason }));
    }
    return findings;
  },
};

/**
 * The first declared path that grafts onto a built-in, with the built-in
 * namespace it collides with, or null. A path resolving to anything other than a
 * genuinely-new API (unknown-namespace) or a registered experiment means it
 * overrides/extends a built-in.
 * @param {import("../../schema/index.js").SchemaIndex} schema
 * @param {string[]} [apiPaths]
 * @returns {?{path: string, builtin: string}}
 */
function firstShadow(schema, apiPaths) {
  for (const p of apiPaths || []) {
    const res = schema.resolveApi(p.split("."));
    if (res.kind !== "unknown-namespace" && res.kind !== "experiment") {
      return { path: p, builtin: res.namespace ?? p.split(".")[0] };
    }
  }
  return null;
}
