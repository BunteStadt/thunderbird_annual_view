// Finds synchronous-XHR call sites: a `.open(method, url, false)` member call
// whose third argument is an explicit boolean async flag. Only the explicit
// boolean shape is judged; the hit carries the flag's value so the caller can
// narrate sync (false) as a fail and async (true) as a pass.
//
// Belongs here: matching the `.open(...)` shape and reporting the async flag.
// Does NOT belong here: the non-authored skip that decides WHICH files to scan
// (-> src/lib/bundled.js), authored wording / severity (->
// assets/registry.yaml). Babel access goes through src/parse/ast.js.

import { parseJs, traverse, nodeLoc, isMemberLike } from "./ast.js";

/**
 * @param {string} code  JavaScript source text.
 * @param {number} [lineOffset]  Added to reported lines (for inline scripts).
 * @param {import("./ast.js").ParseResult} [parsed]  Reuse this parse of `code`
 *   instead of re-parsing it.
 * @returns {{hits: {line: number, column: number, async: boolean}[],
 *   parseError: string|null}}  `async` is the third-argument boolean literal's
 *   value (sync XHR is `async === false`); the loc is the `open` property.
 */
export function scanSyncXhr(code, lineOffset = 0, parsed) {
  const { ast, parseError } = parsed ?? parseJs(code);
  if (parseError || !ast) {
    return { hits: [], parseError: parseError ?? null };
  }
  const hits = [];
  traverse(ast, {
    "CallExpression|OptionalCallExpression"(path) {
      const callee = path.node.callee;
      if (
        !isMemberLike(callee) ||
        callee.computed ||
        callee.property?.name !== "open"
      ) {
        return;
      }
      const async = path.node.arguments[2];
      // Only an explicit boolean async flag is the XHR.open(...) shape this
      // scanner reports.
      if (async?.type !== "BooleanLiteral") {
        return;
      }
      hits.push({
        ...nodeLoc(callee.property, lineOffset),
        async: async.value,
      });
    },
  });
  return { hits, parseError: null };
}
