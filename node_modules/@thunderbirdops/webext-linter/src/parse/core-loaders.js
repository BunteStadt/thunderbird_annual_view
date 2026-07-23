// Finds the packaged files an add-on hands to an Experiment API as parameters, from
// the add-on's own WebExtension code. reachability.js uses this to bridge a plain
// `.html` parameter (a content page) into the WebExtension tree.
//
// Belongs here: extracting those raw references (scanExperimentInjectedRefs). Does NOT
// belong here: deciding which files exist / building the graph (->
// src/lib/reachability.js), or the WebExtension loaders (->
// src/parse/local-imports.js, loader-files.js). Babel access goes through ast.js.

import { classifyUrl } from "../scan/url.js";
import { parseJs, traverse, nodeLoc } from "./ast.js";
import { basename } from "../util/files.js";
import { apiBasesOf, calleeApiPath } from "./api-base.js";
import { SCHEME_RE } from "../lib/util.js";

// A scheme-bearing parameter (resource:, chrome:, moz-extension:, ...) is matched by
// name (SCHEME_RE); a relative path is resolved root-relative.

/**
 * Classify a string passed to an Experiment API as a packaged-file reference: a
 * relative path is root-relative (WebExtension code passes add-on-relative paths),
 * a scheme URL (chrome://, resource://) is matched by name, anything else (a remote
 * URL, a window URL, a non-path string) is not a file ref.
 * @param {string} value
 * @returns {?{kind: "path"|"basename", value: string}}
 */
function classifyInjectedArg(value) {
  if (typeof value !== "string" || !classifyUrl(value).local) {
    return null;
  }
  return SCHEME_RE.test(value)
    ? { kind: "basename", value: basename(value) }
    : { kind: "path", value };
}

/**
 * Find the packaged-file paths an add-on hands to an Experiment API: string
 * arguments (top level, and one level inside an array argument) of any call
 * `<api root>.<ns>.…(args)` whose `<ns>` is in `namespaces` - the root resolved
 * through the api-base index, so aliases and captured namespaces count. Each ref
 * is tagged with its namespace.
 * @param {string} code
 * @param {Set<string>} namespaces  The add-on's Experiment namespaces.
 * @param {number} [lineOffset]
 * @param {import("./ast.js").ParseResult} [parsed]  Reuse this parse of `code`
 *   instead of re-parsing it.
 * @returns {{refs: {ns: string, kind: "path"|"basename", value: string,
 *   line: number, column: number}[], parseError: string|null}}
 */
export function scanExperimentInjectedRefs(
  code,
  namespaces,
  lineOffset = 0,
  parsed
) {
  const { ast, parseError } = parsed ?? parseJs(code);
  if (parseError || !ast || !namespaces?.size) {
    return { refs: [], parseError: parseError ?? null };
  }
  const refs = [];
  const addArg = (node, ns) => {
    if (node?.type !== "StringLiteral") {
      return;
    }
    const c = classifyInjectedArg(node.value);
    if (c) {
      refs.push({ ns, ...c, ...nodeLoc(node, lineOffset) });
    }
  };
  const bases = apiBasesOf(ast);
  traverse(ast, {
    "CallExpression|OptionalCallExpression"(p) {
      // The callee resolves through the api-base index, so an aliased root or a
      // captured Experiment namespace (`const wl = messenger.WindowListener;
      // wl.registerWindow(...)`) matches like a direct call. The namespace is
      // the first resolved segment after the (implicit) root.
      const resolved = calleeApiPath(p.node.callee, bases);
      const ns = resolved?.segments[0];
      if (!ns || !namespaces.has(ns)) {
        return;
      }
      for (const arg of p.node.arguments) {
        if (arg?.type === "ArrayExpression") {
          for (const el of arg.elements) {
            addArg(el, ns);
          }
        } else {
          addArg(arg, ns);
        }
      }
    },
  });
  return { refs, parseError: null };
}
