// A required top-level manifest key (manifest_version, name, version) is absent,
// so the submission is invalid. Runs only on a parsed manifest.
//
// Belongs here: checking the required keys are present. Does NOT belong here:
// unknown permissions / mv mismatch (-> manifest-unknown-permission.js /
// manifest-version-mismatch.js), authored wording (-> assets/registry.yaml), and
// severity (-> that registry entry).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";

const REQUIRED_KEYS = ["manifest_version", "name", "version"];

export default {
  run(ctx) {
    const m = ctx.manifest;
    if (!m) {
      return [];
    }
    const out = [];
    for (const key of REQUIRED_KEYS) {
      if (m[key] === undefined) {
        ctx.note?.(
          "manifest.json",
          null,
          `missing required key "${key}"`,
          VERDICT.FAIL
        );
        // No file/line: the key is absent, so it has no location. The item (the
        // missing key) is listed on its own, and the message names
        // manifest.json.
        out.push(finding({ item: key }));
      }
    }
    return out;
  },
};
