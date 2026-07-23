// Finds GLOBAL references to privileged Thunderbird/Firefox "core" globals
// (Services, ChromeUtils, the Components/Cc/Ci/Cu family, ...) in a script - a
// name shadowed by a local binding or import is the developer's own symbol, not
// ours, so only unbound references count. One hit per distinct symbol name.
//
// Belongs here: extracting the core-symbol global references from an AST, as raw
// per-file input for the core-symbol-in-webext check. The symbol list itself is a
// hand-curated Thunderbird fact loaded from assets/webext-facts.yaml (re-exported
// here as the single import point).
//
// Does NOT belong here: the core-symbol list values (-> assets/webext-facts.yaml),
// the WebExtension vs Experiment partition or the non-authored skip that decides
// WHICH files to scan (-> the check + src/lib/reachability.js / bundled.js),
// authored wording / severity (-> assets/registry.yaml). Babel access goes through
// src/parse/ast.js.

import { parseJs, traverse, nodeLoc } from "./ast.js";
import { CORE_SYMBOLS } from "./webext-facts.js";

export { CORE_SYMBOLS };

/**
 * @param {string} code  JavaScript source text.
 * @param {number} [lineOffset]  Added to reported lines (for inline scripts).
 * @param {import("./ast.js").ParseResult} [parsed]  Reuse this parse of `code`
 *   instead of re-parsing it.
 * @returns {{hits: {name: string, line: number, column: number}[],
 *   parseError: string|null}}  At most one hit per distinct core symbol.
 */
export function scanCoreSymbols(code, lineOffset = 0, parsed) {
  const { ast, parseError } = parsed ?? parseJs(code);
  if (parseError || !ast) {
    return { hits: [], parseError: parseError ?? null };
  }
  const hits = [];
  const seen = new Set(); // one hit per symbol name
  traverse(ast, {
    ReferencedIdentifier(path) {
      const name = path.node.name;
      // A core global: in CORE_SYMBOLS, an actual reference (not a property name /
      // object key / declaration - ReferencedIdentifier guarantees that), and NOT
      // shadowed by a local binding or import.
      if (
        !CORE_SYMBOLS.has(name) ||
        seen.has(name) ||
        path.scope.hasBinding(name)
      ) {
        return;
      }
      seen.add(name);
      hits.push({ name, ...nodeLoc(path.node, lineOffset) });
    },
  });
  return { hits, parseError: null };
}
