// Finds `<root>.runtime.onMessage.addListener(...)` call sites, tagging each with
// whether its first argument is an async function. An async listener always
// returns a Promise, signalling "I will respond" for every message and breaking
// other listeners, so the caller flags the async ones - the hit carries the flag.
//
// Belongs here: matching the onMessage.addListener call shape and reporting
// whether the listener is async. Does NOT belong here: API-root and alias
// resolution (-> src/parse/api-base.js), the non-authored skip that decides
// WHICH files to scan (-> src/lib/bundled.js), authored wording /
// severity (-> assets/registry.yaml). Babel access goes through
// src/parse/ast.js.

import { parseJs, traverse, nodeLoc } from "./ast.js";
import { apiBasesOf, calleeApiPath } from "./api-base.js";

/**
 * @param {string} code  JavaScript source text.
 * @param {number} [lineOffset]  Added to reported lines (for inline scripts).
 * @param {import("./ast.js").ParseResult} [parsed]  Reuse this parse of `code`
 *   instead of re-parsing it.
 * @returns {{hits: {line: number, column: number, async: boolean}[],
 *   parseError: string|null}}  One hit per addListener call; `async` is true when
 *   the listener is an async function (the flagged shape).
 */
export function scanAsyncOnMessage(code, lineOffset = 0, parsed) {
  const { ast, parseError } = parsed ?? parseJs(code);
  if (parseError || !ast) {
    return { hits: [], parseError: parseError ?? null };
  }
  const hits = [];
  const bases = apiBasesOf(ast);
  traverse(ast, {
    "CallExpression|OptionalCallExpression"(path) {
      // The callee resolves through the api-base index (aliases and captured
      // namespaces included) and must be exactly the runtime.onMessage.addListener
      // path from the root - full-path equality, so an unrelated chain that merely
      // ends in those names never matches.
      const resolved = calleeApiPath(path.node.callee, bases);
      if (resolved?.segments.join(".") !== "runtime.onMessage.addListener") {
        return;
      }
      const cb = path.node.arguments[0];
      const isFn =
        cb?.type === "FunctionExpression" ||
        cb?.type === "ArrowFunctionExpression";
      hits.push({
        ...nodeLoc(path.node, lineOffset),
        async: Boolean(isFn && cb.async),
      });
    },
  });
  return { hits, parseError: null };
}
