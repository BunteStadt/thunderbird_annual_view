// Finds add-on-internal files loaded by a script's own static loaders -
// `import`/`export ... from`, dynamic `import()`, `require()`, and
// `importScripts()` - whose source is a local (non-remote) path. The
// reachability analysis resolves these relative to the importing file. The
// remote-resources check owns the remote/embedded sources; this is its local
// complement. A non-literal source sets `hasDynamic` (a runtime-built module
// path that can't be resolved statically).
//
// Belongs here: extracting the local module-source paths from a script's own
// ES/CommonJS loaders, as raw reference-graph input.
//
// Does NOT belong here: resolving those paths against the package or building
// the reachability graph - that lives in src/lib/reachability.js.
// File-loading API calls (executeScript, getURL, setPopup, ...) are
// src/parse/loader-files.js. Remote/embedded sources are
// src/checks/rules/remote-resources.js (fed by src/parse/remote-js.js). Babel
// access goes through src/parse/ast.js.

import { classifyUrl } from "../scan/url.js";
import { parseJs, traverse, staticPathOf, nodeLoc } from "./ast.js";

/**
 * @param {string} code  JavaScript source text.
 * @param {number} [lineOffset]  Added to reported lines (for inline scripts).
 * @param {import("./ast.js").ParseResult} [parsed]  Reuse this parse of `code`
 *   instead of re-parsing it.
 * @returns {{refs: {path: string, line: number, column: number}[],
 *   hasDynamic: boolean, parseError: string|null}}
 */
export function scanLocalImports(code, lineOffset = 0, parsed) {
  const { ast, parseError } = parsed ?? parseJs(code);
  if (parseError) {
    return { refs: [], hasDynamic: false, parseError };
  }

  const refs = [];
  const state = { hasDynamic: false };
  /** @param {any} node  The source/argument node. */
  const add = (node) => {
    // A fully-static source path (a string, or a template/concat whose computed
    // part is only a ?query/#fragment) is a reference, not a dynamic import.
    // Keep only local refs - remote/embedded sources are the remote-resources
    // check's concern, not a packaged-file edge.
    const path = staticPathOf(node);
    if (path != null) {
      if (classifyUrl(path).local) {
        refs.push({ path, ...nodeLoc(node, lineOffset) });
      }
    } else if (node != null) {
      state.hasDynamic = true; // a non-literal module path
    }
  };

  traverse(ast, {
    ImportDeclaration: (p) => add(p.node.source),
    ExportNamedDeclaration: (p) => p.node.source && add(p.node.source),
    ExportAllDeclaration: (p) => add(p.node.source),
    ImportExpression: (p) => add(p.node.source), // dynamic import()
    "CallExpression|OptionalCallExpression"(p) {
      const callee = p.node.callee;
      if (
        callee?.type === "Identifier" &&
        (callee.name === "require" || callee.name === "importScripts")
      ) {
        for (const a of p.node.arguments) {
          add(a);
        }
      }
    },
  });
  return { refs, hasDynamic: state.hasDynamic, parseError: null };
}
