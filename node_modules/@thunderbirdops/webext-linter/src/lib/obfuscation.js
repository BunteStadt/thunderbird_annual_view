// The single seam for JavaScript-obfuscation detection: whether a file's source is
// the output of a known obfuscator. Wraps the `obfuscation-detector` library
// (HumanSecurity), which classifies source by the AST STRUCTURE of seven obfuscator
// families (obfuscator.io, array/function replacements, caesar-plus) and returns an
// empty list for anything it does not recognize. Structural recognition is precise by
// construction for the STRONG families: readable third-party code and plain-minified
// libraries match none of them, so they are never called obfuscated - the failure mode
// of a token-presence heuristic. One family is the exception (WEAK_FAMILIES below):
// its structure also matches ordinary readable code, so it never decides the verdict
// on its own - a weak-only match is only a trigger for the obfuscated-code check's
// LLM/manual adjudication, which the classification carries as the "unsure" verdict.
//
// Minification is a SEPARATE, geometric signal (src/lib/bundled.js classify) and
// is deliberately not decided here: a minified-but-clean library is allowed with source,
// only obfuscation is forbidden outright.
//
// Belongs here: the library import, the family list + weak/strong split, and the
// obfuscation verdict. The family names never leave this module - callers branch on the
// verdict, not the families. Does NOT belong here: the per-file library/minified tagging and the
// non-authored skip set (src/lib/bundled.js), the obfuscated-code finding and its LLM
// step (src/checks/rules/obfuscated-code.js), or the library's own AST parse (it
// parses internally, offline and pure - no network).

import { detectObfuscation } from "obfuscation-detector";
import { debug } from "../util/log.js";
import { VERDICT } from "./enum.js";

// Families whose structure also matches ordinary readable code, so a match is not a
// verdict. `function_to_array_replacements` fires on ANY variable initialized from an
// IIFE whose every reference is a member-expression object - i.e. the common revealing
// module pattern `const X = (() => {...})(); X.init();` - and, unlike the library's
// other detectors, applies no reference-density thresholds. On the library's own
// true-positive fixtures it never fires alone (always alongside a strong family), so
// demoting it costs no known recall.
const WEAK_FAMILIES = new Set(["function_to_array_replacements"]);

/**
 * The obfuscator families `text` matches, weak ones included (empty for anything the
 * library does not recognize). Logged under --debug so a surprising verdict - either
 * way - is diagnosable.
 * @param {string} text  JavaScript source.
 * @param {string} [file]  The file path, for the debug log.
 * @returns {string[]}  The matched family names.
 */
function detectFamilies(text, file) {
  try {
    const families = detectObfuscation(text);
    if (families.length) {
      debug(
        `obfuscation-detector families for ${file ?? "source"}: ${families.join(", ")}`
      );
    }
    return families;
  } catch (err) {
    // The detector parses internally; source it cannot parse is not a recognized
    // obfuscation (a genuinely obfuscated file that also fails to parse is the
    // minified-code check's concern, not a false obfuscation finding). Logged so a
    // silent skip is diagnosable under --debug.
    debug(
      `obfuscation-detector could not parse ${file ?? "source"}: ${err.message}`
    );
    return [];
  }
}

/**
 * Whether a detectFamilies result decides obfuscation on its own: at least one strong
 * family matched. A weak-only result returns false - it marks a candidate for the
 * obfuscated-code check's LLM/manual adjudication, never a verdict. Pure, so callers
 * derive both the families and the verdict from one parse.
 * @param {string[]} families  A detectFamilies result.
 * @returns {boolean}
 */
function hasStrongFamily(families) {
  return families.some((f) => !WEAK_FAMILIES.has(f));
}

/**
 * The obfuscation verdict for one JavaScript file, a shared VERDICT: FAIL (a strong-family
 * structural match; a deterministic finding), UNSURE (a weak-family-only match, whose
 * structure ordinary readable code also has - judged by the obfuscated-code check's
 * LLM/manual adjudication, never a verdict on its own), or PASS (no family matched, or
 * source the detector could not parse). The family list stays inside this module - callers
 * branch on the verdict, not the families.
 * @param {string} text  JavaScript source.
 * @param {string} [file]  The file path, for the debug log.
 * @returns {import("./enum.js").Verdict}
 */
export function obfuscationVerdict(text, file) {
  const families = detectFamilies(text, file);
  if (hasStrongFamily(families)) {
    return VERDICT.FAIL;
  }
  return families.length ? VERDICT.UNSURE : VERDICT.PASS;
}
