// Finds writes to HTML-string sinks - the innerHTML-and-friends pattern. Policy:
// the only sanctioned way to insert markup is the Sanitizer API
// (Element.setHTML()), so EVERY write to a sink is flagged - regardless of where
// the content comes from, whether it is a static literal, or whether it was run
// through a sanitizer (a sanitizer is not a pass). The sole exception is an
// empty-string or null clear (el.innerHTML = ""), which writes no content.
//
// Sinks: assignment to .innerHTML / .outerHTML / .srcdoc, and
// .insertAdjacentHTML(pos, x).
//
// Belongs here: detecting those JS sinks and the static-vs-dynamic value test,
// emitting one hit per unsafe write.
//
// Does NOT belong here: the verdict and wording - those live in
// src/checks/rules/unsafe-html.js and assets/registry.yaml. Parsing markup in
// .html files is a different subsystem (src/scan/html.js and
// src/scan/html-parse.js). Babel access goes through src/parse/ast.js.

import { parseJs, traverse, nodeLoc, memberPropName } from "./ast.js";

/** @typedef {import("@babel/types").Node} AstNode */

const PROPERTY_SINKS = new Set(["innerHTML", "outerHTML", "srcdoc"]);

/**
 * @typedef {object} UnsafeHtmlHit
 * @property {"innerHTML"|"outerHTML"|"srcdoc"|"insertAdjacentHTML"} sink
 * @property {number} line
 * @property {number} column
 */

/**
 * @param {string} code  JavaScript source text.
 * @param {number} [lineOffset]  Added to reported lines (for inline scripts).
 * @param {import("./ast.js").ParseResult} [parsed]  Reuse this parse of `code`
 *   instead of re-parsing it.
 * @returns {{hits: UnsafeHtmlHit[], parseError: string|null}}
 */
export function scanUnsafeHtml(code, lineOffset = 0, parsed) {
  const { ast, parseError } = parsed ?? parseJs(code);
  if (parseError) {
    return { hits: [], parseError };
  }

  const hits = [];
  /** @param {AstNode} node @returns {{line:number, column:number}} */
  const at = (node) => nodeLoc(node, lineOffset);

  traverse(ast, {
    AssignmentExpression(path) {
      const { left, right } = path.node;
      const sink = memberPropName(left);
      if (sink && PROPERTY_SINKS.has(sink) && !isEmptyClear(right)) {
        hits.push({ sink, ...at(path.node) });
      }
    },
    "CallExpression|OptionalCallExpression"(path) {
      const { callee, arguments: args } = path.node;
      if (
        memberPropName(callee) === "insertAdjacentHTML" &&
        !isEmptyClear(args[1])
      ) {
        hits.push({ sink: "insertAdjacentHTML", ...at(path.node) });
      }
    },
  });
  return { hits, parseError: null };
}

/**
 * True only when a write carries NO content, so it merely clears the sink and is
 * not flagged: an empty string literal (""), an empty template literal (no
 * interpolation and only-empty quasis), a null literal, or a missing argument.
 * Any other value - including a non-empty static string - is content and IS
 * flagged (the only sanctioned insertion method is Element.setHTML()).
 * @param {AstNode} node
 * @returns {boolean}
 */
function isEmptyClear(node) {
  if (!node) {
    return true; // no argument - nothing is written
  }
  switch (node.type) {
    case "NullLiteral":
      return true;
    case "StringLiteral":
      return node.value === "";
    case "TemplateLiteral":
      return (
        node.expressions.length === 0 &&
        node.quasis.every((q) => (q.value.cooked ?? q.value.raw) === "")
      );
    default:
      return false;
  }
}
