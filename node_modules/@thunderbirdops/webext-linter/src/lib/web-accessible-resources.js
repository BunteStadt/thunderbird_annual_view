// web_accessible_resources manifest semantics: normalizing the MV2/MV3 entry
// shapes, expanding a resource pattern to concrete packaged files, and spotting
// patterns that expose the whole package. Shared by the minimize-web-
// accessible-resources check and the reachability graph (exposed resources are
// seeds).
//
// Belongs here: warResourceList (normalize MV2/MV3 entries),
// expandResourcePattern (glob a pattern to packaged files), and
// isOverBroadResource. The glob-to-regexp matcher these need.
//
// Does NOT belong here: the minimize-web-accessible-resources verdict and its
// text - the rule under src/checks/rules/* and assets/registry.yaml. Walking
// reachability from the exposed seeds - reachability.js. The lexical path
// normalizer - normalizeRef in manifest-refs.js. Generic shape guards -
// lib/util.js.

import { asArray } from "./util.js";
import { normalizeRef } from "./manifest-refs.js";

/** @typedef {import("../addon/load.js").Manifest} Manifest */

/**
 * web_accessible_resources as {resources, matches} entries (MV3 objects and MV2
 * bare-string arrays normalized to one shape).
 * @param {Manifest} manifest
 * @returns {{resources: string[], matches: string[]}[]}
 */
export function warResourceList(manifest) {
  const out = [];
  for (const entry of asArray(manifest.web_accessible_resources)) {
    if (typeof entry === "string") {
      // MV2: bare strings, exposed to all origins inherently (no `matches` to
      // scope), so there is no over-broad-matches concern to flag.
      out.push({ resources: [entry], matches: [] });
    } else if (entry && typeof entry === "object") {
      out.push({
        resources: asArray(entry.resources),
        matches: asArray(entry.matches),
      });
    }
  }
  return out;
}

/**
 * Concrete packaged files matching a web_accessible_resources resource pattern.
 * @param {Map<string, Buffer>} files
 * @param {string} pattern
 * @returns {string[]}
 */
export function expandResourcePattern(files, pattern) {
  const pat = normalizeRef(pattern);
  if (pat === "") {
    return [];
  }
  if (!/[*?]/.test(pat)) {
    return files.has(pat) ? [pat] : [];
  }
  const re = globToRegExp(pat);
  return [...files.keys()].filter((f) => re.test(f));
}

/**
 * True for a resource pattern that exposes essentially the whole package.
 * @param {string} pattern
 * @returns {boolean}
 */
export function isOverBroadResource(pattern) {
  const p = normalizeRef(pattern);
  return p === "*" || p === "**" || p === "**/*" || p === "*.*";
}

/** @param {string} glob @returns {RegExp} */
function globToRegExp(glob) {
  let re = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`${re}$`);
}
