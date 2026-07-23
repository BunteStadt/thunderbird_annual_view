// Static analysis of a JS source for remote-code signals. Returns categorized
// "hits" that the remote-code check turns into findings. Best-effort and
// conservative: a hit's `type` records exactly what was matched, so the check
// can pick severity. Statically-undecidable cases (dynamic URLs, fetch to eval)
// are reported as `ambiguous-*` types rather than asserted as remote.
//
// Belongs here: pattern detection for dynamic/remote code execution - eval, the
// Function constructor, code-string timers, remote imports/importScripts, a
// script element's remote src, and fetch -> eval/wasm - each tagged with a
// `type`.
//
// Does NOT belong here: the verdict, severity, and any LLM escalation - those
// live in the eval checks (via src/lib/eval-scan.js) and
// src/checks/rules/remote-resources.js with src/checks/escalation.js. User-facing
// wording lives in assets/registry.yaml. Babel access goes through
// src/parse/ast.js.

import { classifyUrl } from "../scan/url.js";
import { eachElement } from "../scan/html-parse.js";
import { parseJs, traverse, nodeLoc, isCallLike, isMemberLike } from "./ast.js";

// Identifiers that denote the global object, where window.eval / self.eval /
// globalThis.eval etc. are the same sinks as the bare forms.
const GLOBAL_OBJECTS = new Set([
  "window",
  "self",
  "globalThis",
  "top",
  "parent",
  "frames",
]);

/** @typedef {import("@babel/types").Node} AstNode */

/**
 * @typedef {object} RemoteJsHit
 * @property {string} type
 * @property {string|null} url
 * @property {number} line
 * @property {number} column
 */

/**
 * @typedef {object} RemoteJsScanResult
 * @property {RemoteJsHit[]} hits
 * @property {string|null} parseError
 */

/**
 * @param {string} code
 * @param {number} [lineOffset]  Added to reported lines (for inline scripts).
 * @param {import("./ast.js").ParseResult} [parsed]  Reuse this parse of `code`
 *   instead of re-parsing it.
 * @returns {RemoteJsScanResult}
 */
export function scanRemoteJs(code, lineOffset = 0, parsed) {
  const { ast, parseError } = parsed ?? parseJs(code);
  if (parseError) {
    return { hits: [], parseError };
  }

  const hits = [];
  /** @param {AstNode} node @returns {{line:number, column:number}} */
  const at = (node) => nodeLoc(node, lineOffset);
  /**
   * @param {string} type
   * @param {AstNode} node
   * @param {string|null} [url]
   */
  const push = (type, node, url = null) =>
    hits.push({ type, url, ...at(node) });

  // Pass 1: collect identifiers bound to document.createElement("script").
  const scriptVars = new Set();
  traverse(ast, {
    "VariableDeclarator|AssignmentExpression"(path) {
      const id = path.isVariableDeclarator() ? path.node.id : path.node.left;
      const init = path.isVariableDeclarator()
        ? path.node.init
        : path.node.right;
      if (id?.type === "Identifier" && isCreateElementScript(init)) {
        scriptVars.add(id.name);
      }
    },
  });

  // Pass 2: classify the remote-code signals.
  traverse(ast, {
    ImportDeclaration(path) {
      classifyModuleSource(path.node.source, path.node, push);
    },
    ExportNamedDeclaration(path) {
      classifyModuleSource(path.node.source, path.node, push);
    },
    ExportAllDeclaration(path) {
      classifyModuleSource(path.node.source, path.node, push);
    },
    NewExpression(path) {
      const callee = path.node.callee;
      // new Function(...) and new window.Function(...).
      if (isIdent(callee, "Function") || isGlobalMember(callee, "Function")) {
        push("function-constructor", path.node);
      }
    },
    AssignmentExpression(path) {
      const { left, right } = path.node;
      // scriptEl.src = "…"
      if (
        isMemberProp(left, "src") &&
        isTrackedScriptObj(left.object, scriptVars)
      ) {
        pushSrc(right, path.node, push);
      }
      // el.innerHTML / el.outerHTML = "<script src=REMOTE>"
      if (isMemberProp(left, "innerHTML") || isMemberProp(left, "outerHTML")) {
        const url = remoteScriptInString(right);
        if (url) {
          push("remote-script-html", path.node, url);
        }
      }
    },
    // Dynamic import() parses as its own ImportExpression node (not a
    // CallExpression), so it gets its own visitor.
    ImportExpression(path) {
      classifyDynamicRef("import", path.node.source, path.node, push);
    },
    "CallExpression|OptionalCallExpression"(path) {
      const { callee, arguments: args } = path.node;

      // eval(...) / Function(...) (Function() without `new`), and the same
      // sinks via a global object (window.eval, self.importScripts, etc.).
      if (isIdent(callee, "eval") || isGlobalMember(callee, "eval")) {
        push("eval", path.node);
        return;
      }
      if (isIdent(callee, "Function") || isGlobalMember(callee, "Function")) {
        push("function-constructor", path.node);
        return;
      }
      // importScripts("…") / self.importScripts("…")
      if (
        isIdent(callee, "importScripts") ||
        isGlobalMember(callee, "importScripts")
      ) {
        classifyDynamicRef("importscripts", args[0], path.node, push);
        return;
      }
      // setTimeout/setInterval("code string", …), bare or on a global object.
      if (
        (isIdent(callee, "setTimeout") ||
          isIdent(callee, "setInterval") ||
          isGlobalMember(callee, "setTimeout") ||
          isGlobalMember(callee, "setInterval")) &&
        isStringish(args[0])
      ) {
        push("string-timer", path.node);
        return;
      }
      // document.write / writeln("<script src=REMOTE>")
      if (isMemberProp(callee, "write") || isMemberProp(callee, "writeln")) {
        const url = remoteScriptInString(args[0]);
        if (url) {
          push("remote-script-html", path.node, url);
        }
        return;
      }
      // el.insertAdjacentHTML(pos, "<script src=REMOTE>")
      if (isMemberProp(callee, "insertAdjacentHTML")) {
        const url = remoteScriptInString(args[1]);
        if (url) {
          push("remote-script-html", path.node, url);
        }
        return;
      }
      // scriptEl.setAttribute("src", "…")
      if (
        isMemberProp(callee, "setAttribute") &&
        isTrackedScriptObj(callee.object, scriptVars) &&
        isStringLiteral(args[0]) &&
        args[0].value.toLowerCase() === "src"
      ) {
        pushSrc(args[1], path.node, push);
        return;
      }
      // WebAssembly.instantiateStreaming/compileStreaming(fetch("REMOTE"))
      if (
        isMemberLike(callee) &&
        isIdent(callee.object, "WebAssembly") &&
        isMemberProp(callee, "instantiateStreaming", "compileStreaming")
      ) {
        const fetchArg = args[0];
        if (isCallLike(fetchArg) && isIdent(fetchArg.callee, "fetch")) {
          const url = literalString(fetchArg.arguments[0]);
          if (url && classifyUrl(url).remote) {
            push("remote-wasm", path.node, url);
          }
        }
        return;
      }
      // promise.then(eval) / .then(Function) - dynamic code from a
      // (possibly remote) fetch.
      if (isMemberProp(callee, "then")) {
        for (const a of args) {
          if (isIdent(a, "eval") || isIdent(a, "Function")) {
            push("ambiguous-fetch-eval", path.node);
            break;
          }
        }
      }
    },
  });

  return { hits, parseError: null };
}

/**
 * Classifies a module source string (static import/export).
 * @param {AstNode} source
 * @param {AstNode} node
 * @param {Function} push
 */
function classifyModuleSource(source, node, push) {
  const url = literalString(source);
  if (url && classifyUrl(url).remote) {
    push("remote-import", node, url);
  }
}

/**
 * Classifies a dynamic import() or importScripts() call argument.
 * @param {string} which
 * @param {AstNode} arg
 * @param {AstNode} node
 * @param {Function} push
 */
function classifyDynamicRef(which, arg, node, push) {
  const url = literalString(arg);
  if (url == null) {
    push(`ambiguous-${which}`, node); // non-literal - can't resolve the host
    return;
  }
  if (classifyUrl(url).remote) {
    push(`remote-${which}`, node, url);
  }
}

/**
 * Pushes a hit for a script element's src or setAttribute value.
 * @param {AstNode} valueNode
 * @param {AstNode} node
 * @param {Function} push
 */
function pushSrc(valueNode, node, push) {
  const url = literalString(valueNode);
  if (url == null) {
    push("ambiguous-script-src", node);
    return;
  }
  const klass = classifyUrl(url);
  if (klass.remote) {
    push("remote-script-src", node, url);
  } else if (klass.embedded) {
    push("embedded-script-src", node, url);
  }
}

// Node helpers.
/**
 * @param {AstNode} node
 * @param {string} name
 * @returns {boolean}
 */
function isIdent(node, name) {
  return node?.type === "Identifier" && node.name === name;
}
/**
 * @param {AstNode} node
 * @returns {boolean}
 */
function isStringLiteral(node) {
  return node?.type === "StringLiteral";
}
/**
 * @param {AstNode} node
 * @param {...string} names
 * @returns {boolean}
 */
function isMemberProp(node, ...names) {
  return (
    isMemberLike(node) &&
    !node.computed &&
    node.property?.type === "Identifier" &&
    names.includes(node.property.name)
  );
}
/**
 * @param {AstNode} obj
 * @param {Set<string>} scriptVars
 * @returns {boolean}
 */
function isTrackedScriptObj(obj, scriptVars) {
  return obj?.type === "Identifier" && scriptVars.has(obj.name);
}
/**
 * True for a member access on a global object whose property is `name`, dotted
 * (window.eval) OR bracketed with a string literal (globalThis["eval"]) - the
 * latter a common way to hide the sink. Gating on a known global keeps
 * `someObj.eval()` / `someObj["eval"]()` (a method on a non-global) untouched.
 * @param {AstNode} node
 * @param {string} name
 * @returns {boolean}
 */
function isGlobalMember(node, name) {
  if (
    !isMemberLike(node) ||
    node.object?.type !== "Identifier" ||
    !GLOBAL_OBJECTS.has(node.object.name)
  ) {
    return false;
  }
  const p = node.property;
  return node.computed
    ? p?.type === "StringLiteral" && p.value === name
    : p?.type === "Identifier" && p.name === name;
}
/**
 * True for a string literal or a template literal with no interpolations.
 * @param {AstNode} node
 * @returns {boolean}
 */
function isStringish(node) {
  return (
    isStringLiteral(node) ||
    (node?.type === "TemplateLiteral" && node.expressions.length === 0)
  );
}
/**
 * @param {AstNode} node
 * @returns {string|null}
 */
function literalString(node) {
  if (isStringLiteral(node)) {
    return node.value;
  }
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null;
  }
  return null;
}
/**
 * @param {AstNode} node
 * @returns {boolean}
 */
function isCreateElementScript(node) {
  return (
    isCallLike(node) &&
    isMemberProp(node.callee, "createElement") &&
    literalString(node.arguments[0])?.toLowerCase() === "script"
  );
}
/**
 * Returns the remote URL if a string node holds HTML containing a
 * `<script src="REMOTE">` tag, else null. The string is parsed as an HTML
 * fragment (parse5) rather than regex-matched, so attribute values containing
 * ">" and the like are handled correctly.
 * @param {AstNode} node
 * @returns {string|null}
 */
function remoteScriptInString(node) {
  const s = literalString(node);
  // Cheap guard: only parse strings that could contain a <script> tag.
  if (!s || !/<script/i.test(s)) {
    return null;
  }
  let found = null;
  eachElement(s, (el) => {
    if (found) {
      return;
    }
    const src = el.tag === "script" ? el.attr("src") : null;
    if (src && classifyUrl(src).remote) {
      found = src;
    }
  });
  return found;
}
