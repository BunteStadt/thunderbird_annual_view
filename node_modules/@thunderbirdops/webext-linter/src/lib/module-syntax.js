// Shared ES module-syntax detection: the location of the first static import /
// export in a parsed JS AST. Run by the extraction pass and stored as each source's
// moduleSyntaxLoc (read via moduleSyntaxOf); background-module and background-page-module
// use it to know whether a script needs declaring as a module to load (manifest
// "type": "module" for the former, <script type="module"> for the latter).
//
// Belongs here: the AST-level module-syntax query only. Does NOT belong here:
// Babel parse/traverse (-> src/parse/ast.js), or the load-failure verdicts and
// wording (-> the rules under src/checks/rules/* and assets/registry.yaml).

import { traverse, nodeLoc } from "../parse/ast.js";

/** @typedef {import("@babel/types").Node} AstNode */

/**
 * The location of the first static ES module statement (import/export) in an
 * AST, or null if there is none.
 * @param {AstNode} ast  Parsed program.
 * @param {number} lineOffset  Added to the reported line.
 * @returns {?{line: number, column: number}}
 */
export function firstModuleSyntax(ast, lineOffset) {
  let loc = null;
  traverse(ast, {
    "ImportDeclaration|ExportNamedDeclaration|ExportDefaultDeclaration|ExportAllDeclaration"(
      path
    ) {
      loc = nodeLoc(path.node, lineOffset);
      path.stop();
    },
  });
  return loc;
}
