// The per-finding artifact label shown before a `file:line` in a source code
// archive (SCA) review, so a reviewer knows WHICH submitted artifact a path lives in:
//   [XPI] = a file in the submitted built XPI
//   [SCA] = a file in the submitted source code archive
// A submission has both, and the same relative path (background.js, manifest.json)
// can exist in each, so the label disambiguates. In an XPI review there is one
// artifact, so there is no label.
//
// The rule keys off the check's routed `input` (the ONE place artifact selection is
// made - see runChecks), with a single cross-over: the shipped manifest is exposed to
// EVERY check regardless of input (ctx.manifest is the built XPI's), so a
// manifest.json finding is always about the XPI even from an `input: source` check.
//
// Belongs here: the label strings and the pure determination rule. Does NOT belong
// here: threading `mode`/the ruleId->input map to the renderers (-> src/pipeline.js +
// src/checks/registry.js checkInputs), or prepending the label to a rendered line
// (-> src/report/format.js locationLine, src/checks/registry.js formatNote).

export const ARTIFACT_XPI = "XPI";
export const ARTIFACT_SCA = "SCA";

/**
 * The artifact label for a finding's file, or "" when none applies.
 * @param {{file?: string, input?: string, mode?: string}} params
 *   file: the finding's file; input: the owning check's registry `input`
 *   ("xpi" | "build" | "source" | "manifest"); mode: the review mode ("sca" | "xpi").
 * @returns {string} "XPI", "SCA", or "" (XPI review - a single artifact).
 */
export function artifactLabel({ file, input, mode }) {
  if (!mode?.sca) {
    return ""; // an XPI review has one artifact - nothing to disambiguate.
  }
  if (file === "manifest.json") {
    return ARTIFACT_XPI; // the shipped manifest is authoritative for every check.
  }
  if (input === "xpi" || input === "manifest") {
    // xpi = bundled-files, unused-files, minimize-WAR, locales, ...; manifest = the
    // pure-manifest checks (the manifest IS the shipped XPI's). Their manifest.json
    // findings already take the branch above; this covers their fileless findings/notes.
    return ARTIFACT_XPI;
  }
  return ARTIFACT_SCA; // input source/build -> the readable source + build files.
}
