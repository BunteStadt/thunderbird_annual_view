// A top-level manifest key the schema does not define - Thunderbird ignores it.
// A warning, since the manifest still loads (unlike the manifest-* errors).
//
// Belongs here: detecting unknown top-level keys against schema.validManifestKeys,
// plus the exception for experiment-owned keys: a key that names an experiment_apis
// entry (e.g. calendar_provider), OR one an experiment's bundled schema declares via
// a `manifest` $extend block (e.g. the calendar experiment's calendar_item_action) -
// both are config the add-on's own experiment defines and reads, so the developer
// owns them. Does NOT belong here: deep value-type validation (->
// mistyped-manifest-value.js), defects that invalidate the manifest (-> the
// manifest-* error checks), authored wording (-> assets/registry.yaml), and
// severity (-> that registry entry).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { asObject, manifestTokenLine } from "../../lib/util.js";
import { experimentManifestKeys } from "../../lib/experiments.js";

export default {
  run(ctx) {
    const { addon, schema } = ctx;
    if (ctx.manifestError || !ctx.manifest) {
      return []; // a missing/unparsable manifest is the manifest-* checks' job
    }
    if (schema.validManifestKeys.size === 0) {
      return [];
    }
    const text = ctx.manifestText;
    // Experiment-owned keys are not unknown: a key that NAMES an experiment_apis
    // entry, or one an experiment's bundled schema DECLARES via a `manifest`
    // $extend block (e.g. calendar_item_action). Both are the developer's own.
    const expKeys = new Set(
      Object.keys(asObject(ctx.manifest.experiment_apis))
    );
    const expManifestKeys = experimentManifestKeys(ctx.manifest, addon.files);
    const out = [];
    for (const key of Object.keys(ctx.manifest)) {
      const known =
        schema.validManifestKeys.has(key) ||
        expKeys.has(key) ||
        expManifestKeys.has(key);
      ctx.note?.(
        "manifest.json",
        null,
        key,
        known ? VERDICT.PASS : VERDICT.FAIL
      );
      if (!known) {
        const line = manifestTokenLine(text, key);
        out.push(
          finding({
            file: "manifest.json",
            loc: line ? { line } : null,
            item: key,
          })
        );
      }
    }
    return out;
  },
};
