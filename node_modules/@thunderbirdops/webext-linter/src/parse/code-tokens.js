// The code-text atoms of a source: every identifier name, string-literal value,
// template-literal text and regex pattern, each with its 1-based source line. A
// token scan - "does token T occur in the CODE, and where?" - reads these instead
// of the raw source, so it sees code and never comments: the atoms come from AST
// nodes, which carry no comment text, exactly the way every other analysis scanner
// ignores comments by walking the parse tree rather than the source string. Each
// atom carries its line so the unused-permission recheck can POINT the model at a
// token occurrence, not only test presence.
//
// Belongs here: collecting the code-text atoms (value + line) from a parsed AST.
// Does NOT belong here: deciding what to search for - that is the consumer's (e.g.
// the unused-permission token scan in src/lib/permissions.js). Babel access
// goes through src/parse/ast.js.

import { parseJs, traverse, nodeLoc } from "./ast.js";

/**
 * @param {string} code  JavaScript source text.
 * @param {number} [lineOffset]  Added to each atom's line (for inline scripts).
 * @param {import("./ast.js").ParseResult} [parsed]  Reuse this parse of `code`
 *   instead of re-parsing it.
 * @returns {{atoms: {value: string, line: number}[], parseError: string|null}}
 *   `atoms` pairs each value with its source line (empty on a fatal parse).
 */
export function scanCodeText(code, lineOffset = 0, parsed) {
  const { ast, parseError } = parsed ?? parseJs(code);
  if (parseError || !ast) {
    return { atoms: [], parseError: parseError ?? null };
  }
  const atoms = [];
  const push = (node, value) => {
    if (value) {
      atoms.push({ value, line: nodeLoc(node, lineOffset).line });
    }
  };
  traverse(ast, {
    Identifier(path) {
      push(path.node, path.node.name);
    },
    StringLiteral(path) {
      push(path.node, path.node.value);
    },
    TemplateElement(path) {
      push(path.node, path.node.value?.cooked ?? path.node.value?.raw);
    },
    RegExpLiteral(path) {
      push(path.node, path.node.pattern);
    },
  });
  return { atoms, parseError: null };
}
