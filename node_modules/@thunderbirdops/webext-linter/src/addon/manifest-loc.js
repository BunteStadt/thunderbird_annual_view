// Position-aware lookup of a manifest.json value's source line, by its JSON
// path (e.g. ["host_permissions", 0]). The parsed manifest object has no source
// positions, and a substring search of the raw text is fragile (a character may be
// \uXXXX-escaped, e.g. "<all_urls>") and ambiguous (the same value can appear more
// than once), so this parses the raw text WITH positions to resolve the exact line
// for a specific occurrence.
//
// Belongs here: building the position index from the raw manifest text and
// resolving a JSON path to its 1-based line. Does NOT belong here: deciding which
// path a finding refers to (that is each check's job, via manifestPathLine in
// src/lib/util.js), or the substring fallback for unique keys
// (manifestTokenLine).

import { parseTree, findNodeAtLocation } from "jsonc-parser";

/**
 * @typedef {object} ManifestLoc
 * @property {(path: (string|number)[]) => (number|null)} lineAt  1-based source
 *   line of the value at the given JSON path, or null if absent/unresolvable.
 */

/**
 * Build a position index over the manifest source. Tolerant of comments and
 * trailing commas (JSONC); on text it cannot parse into a tree (a rare
 * JSON5-only manifest) every lookup returns null, so callers degrade gracefully.
 * @param {string} text  The manifest source (BOM already stripped).
 * @returns {ManifestLoc}
 */
export function buildManifestLoc(text) {
  let tree = null;
  try {
    tree = parseTree(text, [], { allowTrailingComma: true });
  } catch {
    tree = null;
  }
  // 1-based line for any offset, via the sorted offsets of each line start.
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      lineStarts.push(i + 1);
    }
  }
  const offsetToLine = (offset) => {
    // Largest lineStarts index whose value is <= offset, +1.
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo + 1;
  };

  return {
    lineAt(path) {
      if (!tree || !Array.isArray(path)) {
        return null;
      }
      const node = findNodeAtLocation(tree, path);
      return node ? offsetToLine(node.offset) : null;
    },
  };
}
