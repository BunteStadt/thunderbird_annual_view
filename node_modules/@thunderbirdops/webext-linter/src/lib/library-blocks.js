// Curated Mozilla add-on POLICY blocklist for bundled third-party libraries: the
// versions addons-linter disallows (banned) or discourages (unadvised). Unlike the
// identification hash DB (Mozilla dispensary's hashes.txt, fetched at runtime),
// Mozilla publishes no machine-readable block DB - the policy lives in the
// addons-linter source - so it is hand-curated in assets/library-blocks.yaml and kept
// in sync manually. This module loads that shipped file and matches a
// (name, version) against it.
//
// The vendor audit (src/vendor/verify.js auditNpm) consults matchLibraryBlock BEFORE
// each OSV query: a banned version is recorded and SKIPS the OSV request (it is
// rejected regardless); an unadvised one is recorded but still audited (a live CVE on
// an allowed library still matters). The hits land on addon.vendor.blocked, read by
// the banned-library check.
//
// Belongs here: loading + parsing the policy file, and matching (name, version) ->
// verdict. Does NOT belong here: the finding wording/severity (-> the banned-library
// rule + assets/registry.yaml), the OSV audit (-> src/vendor/verify.js), and the
// dispensary->npm name aliasing (-> npmNameForLibrary in library-hashes.js).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import YAML from "yaml";

import { parseVersion, cmpVersion, asArray } from "./util.js";
import { npmNameForLibrary } from "./library-hashes.js";

/**
 * @typedef {object} LibraryBlock  One library's policy thresholds.
 * @property {?string} bannedBelow  Versions strictly below this are banned (error).
 * @property {?string} unadvisedBelow  Versions strictly below this are unadvised
 *   (warning). A version below BOTH is banned (banned is checked first).
 * @property {string} reason  Human explanation shown in the finding.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
// The shipped default, resolved like registry.js resolves assets/registry.yaml.
const DEFAULT_LIBRARY_BLOCKS = path.resolve(
  here,
  "../../assets/library-blocks.yaml"
);

/**
 * Read the block-policy file to text: the shipped assets/library-blocks.yaml. No
 * network/cache: it is a versioned asset read straight from disk.
 * @returns {Promise<{text: string, source: string}>}
 */
export async function resolveLibraryBlocks() {
  return {
    text: fs.readFileSync(DEFAULT_LIBRARY_BLOCKS, "utf8"),
    source: "default",
  };
}

/**
 * Parse the block-policy YAML (a list of {name, banned_below?, unadvised_below?,
 * reason?}) into a `npmName -> LibraryBlock` map, keyed by the lower-cased npm name
 * (npmNameForLibrary), the same key matchLibraryBlock looks up.
 * @param {string} text
 * @returns {Map<string, LibraryBlock>}
 */
export function parseLibraryBlocks(text) {
  const map = new Map();
  const entries = YAML.parse(String(text));
  for (const e of asArray(entries)) {
    if (!e || typeof e.name !== "string") {
      continue;
    }
    map.set(npmNameForLibrary(e.name).toLowerCase(), {
      bannedBelow: e.banned_below != null ? String(e.banned_below) : null,
      unadvisedBelow:
        e.unadvised_below != null ? String(e.unadvised_below) : null,
      reason: typeof e.reason === "string" ? e.reason : "",
    });
  }
  return map;
}

/**
 * Whether a (name, version) is disallowed by the policy: banned when the version is
 * strictly below `banned_below`, else unadvised when below `unadvised_below`, else
 * null. The name is normalised to its npm package (so a dispensary "angularjs"
 * matches an "angular" entry); an unparseable version or threshold never matches.
 * @param {?Map<string, LibraryBlock>} blocks
 * @param {string} name  Library name (dispensary or npm).
 * @param {string} version  The bundled/pinned version.
 * @returns {?{status: "banned"|"unadvised", reason: string}}
 */
export function matchLibraryBlock(blocks, name, version) {
  if (!blocks || !blocks.size) {
    return null;
  }
  const entry = blocks.get(npmNameForLibrary(name).toLowerCase());
  if (!entry) {
    return null;
  }
  const v = parseVersion(String(version).replace(/^v/i, ""));
  if (!v) {
    return null;
  }
  const banned = entry.bannedBelow ? parseVersion(entry.bannedBelow) : null;
  if (banned && cmpVersion(v, banned) < 0) {
    return { status: "banned", reason: entry.reason };
  }
  const unadvised = entry.unadvisedBelow
    ? parseVersion(entry.unadvisedBelow)
    : null;
  if (unadvised && cmpVersion(v, unadvised) < 0) {
    return { status: "unadvised", reason: entry.reason };
  }
  return null;
}
