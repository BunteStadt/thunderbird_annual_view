// Finds `debugger` statements, tagging each with whether an enclosing `if`
// guards it. Since `debugger` is a statement, an enclosing `if` (a config flag)
// is the only way to make it conditional, so a guarded one is allowed and an
// unconditional one is flagged - the caller uses the `guarded` flag to decide.
//
// Belongs here: locating DebuggerStatement nodes and the guarded test. Does NOT
// belong here: the non-authored skip that decides WHICH files to scan (->
// src/lib/bundled.js), authored wording / severity (->
// assets/registry.yaml). Babel access goes through src/parse/ast.js.

import { parseJs, traverse, nodeLoc } from "./ast.js";

/**
 * @param {string} code  JavaScript source text.
 * @param {number} [lineOffset]  Added to reported lines (for inline scripts).
 * @param {import("./ast.js").ParseResult} [parsed]  Reuse this parse of `code`
 *   instead of re-parsing it.
 * @returns {{hits: {line: number, column: number, guarded: boolean}[],
 *   parseError: string|null}}  `guarded` is true when an enclosing `if` makes the
 *   statement conditional (allowed).
 */
export function scanDebugger(code, lineOffset = 0, parsed) {
  const { ast, parseError } = parsed ?? parseJs(code);
  if (parseError || !ast) {
    return { hits: [], parseError: parseError ?? null };
  }
  const hits = [];
  traverse(ast, {
    DebuggerStatement(path) {
      hits.push({
        ...nodeLoc(path.node, lineOffset),
        guarded: Boolean(path.findParent((p) => p.isIfStatement())),
      });
    },
  });
  return { hits, parseError: null };
}
