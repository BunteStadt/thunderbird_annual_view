// Diff check (diff: true - the orchestrator runs it only with a --diff-to
// baseline): when this submission changes NOTHING but a version bump and the
// gecko strict_max_version, the developer could have raised the max version on
// the ATN admin page instead of resubmitting. Compares file contents (not the
// archive), so a re-zip with different ordering or timestamps does not register
// as a change.
//
// Belongs here: the baseline diff - confirming every non-manifest file is byte-
// identical and that the manifest differs only in version and
// strict_max_version (canonicalized to ignore key order).
//
// Does NOT belong here: reading the max version (-> strictMaxVersion in src/
// lib/util.js) or canonicalizing JSON (-> canonicalJson in src/util/
// json.js). Judging a max version on its own, with no baseline (-> non-
// experiment-strict-max-version.js and experiment-missing-strict-max-version.
// js). Authored wording (-> assets/registry.yaml). Severity (-> the
// strict-max-version-bump-only registry entry, stamped by src/checks/
// registry.js).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { strictMaxVersion, manifestTokenLine } from "../../lib/util.js";
import { canonicalJson } from "../../util/json.js";

/** @typedef {import("../registry.js").RunContext} RunContext */
/** @typedef {import("../../addon/load.js").Manifest} Manifest */

export default {
  /**
   * @param {RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    const prev = ctx.previous;
    // Registry `input: xpi`: ctx.addon is the built XPI. The diff (versions, files)
    // compares the XPI against the --diff-to baseline (also an XPI); a source
    // submission's pre-build layout would never match the baseline byte-for-byte.
    const cur = ctx.addon;
    // The orchestrator runs this check only with a --diff-to baseline (it is a
    // diff check), so one is normally present. Bail out silently only if a
    // manifest did not parse on either side.
    if (!prev?.manifest || !ctx.manifest) {
      return [];
    }
    // To fire, strict_max_version must actually have changed and the rest of the
    // manifest (everything but version + strict_max_version) be unchanged.
    if (
      !sameFilesExceptManifest(prev.files, cur.files) ||
      strictMaxVersion(prev.manifest) === strictMaxVersion(ctx.manifest) ||
      canonicalJson(withoutBump(prev.manifest)) !==
        canonicalJson(withoutBump(ctx.manifest))
    ) {
      ctx.note?.(
        "manifest.json",
        null,
        "changes beyond a strict_max_version bump",
        VERDICT.PASS
      );
      return [];
    }
    ctx.note?.(
      "manifest.json",
      null,
      "only version + strict_max_version changed",
      VERDICT.FAIL
    );
    const text = ctx.manifestText;
    const line = manifestTokenLine(text, "strict_max_version");
    return [finding({ file: "manifest.json", loc: line ? { line } : null })];
  },
};

/**
 * True when both versions hold the same file paths and every file is byte-identical.
 * The manifest is not in the corpus (the loader lifts it onto ctx), so it is compared
 * separately by the caller - this decides whether everything ELSE is unchanged.
 * @param {Map<string, Buffer>} prev
 * @param {Map<string, Buffer>} cur
 * @returns {boolean}
 */
function sameFilesExceptManifest(prev, cur) {
  if (prev.size !== cur.size) {
    return false;
  }
  for (const [path, buf] of cur) {
    const before = prev.get(path);
    if (!before || !before.equals(buf)) {
      return false;
    }
  }
  return true;
}

/**
 * A manifest clone with version and the gecko strict_max_version removed, so two
 * manifests that differ only in those compare equal.
 * @param {Manifest} manifest
 * @returns {Manifest}
 */
function withoutBump(manifest) {
  const c = structuredClone(manifest);
  delete c.version;
  for (const key of ["browser_specific_settings", "applications"]) {
    if (c[key]?.gecko) {
      delete c[key].gecko.strict_max_version;
    }
  }
  return c;
}
