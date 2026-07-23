// Extracts add-on-internal file paths referenced by file-loading API calls - the
// single source both checks build on:
//   - bundled-files: every referenced local path must be packaged,
//   - reachability: each referenced path is an edge in the reference graph.
//
// Two extraction modes:
//   - SCHEMA-DIRECTED (the goal): for a method the schema marks as a file loader
//     (SchemaIndex.fileLoaderMethods - a parameter whose type tree reaches an
//     extension-relative-url leaf), we walk the call's arguments in lockstep
//     with the parameter type and emit a path ONLY at a rel-url leaf. Precise: a
//     non-path literal (a match glob, a property name) is never mistaken for a
//     file, so the result is safe to assert "file not bundled" on.
//   - BRIDGE (temporary): a handful of loaders the schema does not yet mark -
//     their path is typed as a plain string / generic "url" - are extracted from
//     a small hand-curated spec table (the BRIDGE + ROOT_RELATIVE_FILE_METHODS
//     data lives in assets/webext-facts.yaml). Each entry is removed once the
//     schema tags that method's path parameter with a relativeUrl format: the
//     method then falls to the schema-directed branch and the bridge entry is
//     dead. See assets/webext-facts.yaml and TODO.md.
//
// Belongs here: extracting the local file paths referenced by file-loading API
// calls, both schema-directed and via the temporary BRIDGE scaffolding.
//
// Does NOT belong here: the BRIDGE / ROOT_RELATIVE_FILE_METHODS values (->
// assets/webext-facts.yaml), the file-loader marking and rel-url type tags it
// walks - those come from the schema (src/schema/index.js). Resolving paths and
// building the reachability graph is src/lib/reachability.js. Verdicts
// (bundled, reachable) are src/checks/rules/*. A script's own import/require
// references are src/parse/local-imports.js. Babel access goes through
// src/parse/ast.js.

import { apiBasesOf, calleeApiPath } from "./api-base.js";
import { parseJs, traverse, staticPathOf, nodeLoc, isCallLike } from "./ast.js";
import { BRIDGE, ROOT_RELATIVE_FILE_METHODS } from "./webext-facts.js";
import { REL_URL_FORMATS } from "../schema/index.js";

/** @typedef {import("@babel/types").Node} AstNode */
/** @typedef {import("../schema/index.js").SchemaNode} SchemaNode */

/**
 * Scan JS for file paths passed to file-loading API calls.
 * @param {string} code  JavaScript source text.
 * @param {number} [lineOffset]  Added to reported lines (for inline scripts).
 * @param {import("../schema/index.js").SchemaIndex} [schema]  Marks and
 *   type-walks schema-derived loaders; the bridge works without it.
 * @param {?number} [manifestVersion]  The add-on's manifest_version, so a
 *   version-specific bridge entry (e.g. browserAction vs action) applies only
 *   for its version. Null leaves every bridge entry in play.
 * @param {import("./ast.js").ParseResult} [parsed]  Reuse this parse of `code`
 *   instead of re-parsing it.
 * @returns {{refs: {path: string, line: number, column: number,
 *   base: "page"|"root"}[], hasDynamic: boolean, parseError: string|null}}
 *   Each ref's `base` is the directory its path resolves against at runtime:
 *   "root" (extension-root-relative) for getURL/scripting.* (see
 *   ROOT_RELATIVE_FILE_METHODS); "page" (the calling document / host page) for
 *   every other loader.
 */
export function scanLoaderRefs(
  code,
  lineOffset = 0,
  schema = null,
  manifestVersion = null,
  parsed
) {
  const { ast, parseError } = parsed ?? parseJs(code);
  if (parseError) {
    return { refs: [], hasDynamic: false, parseError };
  }

  const bases = apiBasesOf(ast);
  const refs = [];
  const seenRef = new Set();
  const state = { hasDynamic: false };
  // The resolution base of the call currently being walked, set per
  // CallExpression before its arguments are extracted (both extraction branches
  // funnel through `take`, which has no method context of its own).
  let currentBase = "root";
  /**
   * Record a string-literal path at a file-path slot, or note a dynamic value.
   * @param {AstNode} node  The value AST node sitting at the slot.
   */
  const take = (node) => {
    // A fully-static file path (a string, or a template/concat whose computed
    // part is only a ?query/#fragment) is a reference, not a dynamic load.
    const path = staticPathOf(node);
    if (path != null) {
      const { line, column } = nodeLoc(node, lineOffset);
      const key = `${line}:${column}:${path}`;
      if (!seenRef.has(key)) {
        seenRef.add(key);
        refs.push({ path, line, column, base: currentBase });
      }
    } else if (isDynamicValue(node, bases)) {
      state.hasDynamic = true; // a runtime-built path static analysis can't follow
    }
  };

  const loaders = schema?.fileLoaderMethods;
  const canWalk = typeof schema?.resolveApi === "function";
  traverse(ast, {
    "CallExpression|OptionalCallExpression"(path) {
      const dotted = dottedApiPath(path.node.callee, bases);
      if (!dotted) {
        return;
      }
      const args = path.node.arguments;
      // Derive the resolution base from the method name, independent of which
      // extraction branch (schema-directed or bridge) handles the call. A
      // root-relative loader (getURL, scripting.*) resolves its path against the
      // extension ROOT (".." clamped), like a manifest path; EVERY other loader
      // resolves against the CALLING DOCUMENT - the host page - so a relative
      // path there is page-relative (base:"page"), which the resolver walks
      // against the script's host-page directories. (A leading-"/" path is still
      // root-relative for every loader, and a scheme URL is dropped upstream -
      // both independent of this base.)
      currentBase = ROOT_RELATIVE_FILE_METHODS.has(dotted) ? "root" : "page";
      if (loaders?.has(dotted) && canWalk) {
        const params = schema.resolveApi(dotted.split(".")).def?.parameters;
        if (Array.isArray(params)) {
          const n = Math.min(params.length, args.length);
          for (let i = 0; i < n; i++) {
            walkType(args[i], params[i], schema, take, new Set());
          }
        }
        return;
      }
      const spec = BRIDGE.get(dotted);
      if (spec && bridgeApplies(spec, manifestVersion)) {
        extractBridge(spec, args, take);
      }
    },
  });
  return { refs, hasDynamic: state.hasDynamic, parseError: null };
}

/**
 * Walk an argument AST node in lockstep with its schema type, invoking `take` at
 * each extension-relative-url leaf. Descends $ref / choices / array items /
 * object properties so a path is emitted only where the type expects one.
 * @param {AstNode} node  The argument (or sub-value) AST node.
 * @param {SchemaNode} type  The schema type for that position.
 * @param {import("../schema/index.js").SchemaIndex} schema
 * @param {(node: AstNode) => void} take  Path/dynamic sink.
 * @param {Set<string>} seen  $refs on the current path (cycle guard).
 */
function walkType(node, type, schema, take, seen) {
  if (!node || !type || typeof type !== "object") {
    return;
  }
  if (type.$ref) {
    if (!seen.has(type.$ref)) {
      const next = new Set(seen).add(type.$ref);
      walkType(node, schema.resolveRef(type.$ref), schema, take, next);
    }
    return;
  }
  if (Array.isArray(type.choices)) {
    for (const choice of type.choices) {
      walkType(node, choice, schema, take, seen);
    }
    return;
  }
  if (typeof type.format === "string" && REL_URL_FORMATS.has(type.format)) {
    take(node); // a rel-url leaf: this position holds a packaged-file path
    return;
  }
  if (type.items && node.type === "ArrayExpression") {
    for (const el of node.elements) {
      walkType(el, type.items, schema, take, seen);
    }
    return;
  }
  if (
    node.type === "ObjectExpression" &&
    (type.properties || type.additionalProperties || type.patternProperties)
  ) {
    const props = type.properties || {};
    const extra =
      type.additionalProperties && typeof type.additionalProperties === "object"
        ? type.additionalProperties
        : null;
    const patterns = Object.values(type.patternProperties || {});
    for (const member of node.properties) {
      if (member.type !== "ObjectProperty" || member.computed) {
        continue;
      }
      const key = member.key.name ?? member.key.value;
      if (Object.prototype.hasOwnProperty.call(props, key)) {
        walkType(member.value, props[key], schema, take, seen);
      } else {
        // Keys not named in the schema map through additional/pattern types
        // (e.g. setIcon's size-keyed path object: {16: "...", 32: "..."}).
        if (extra) {
          walkType(member.value, extra, schema, take, seen);
        }
        for (const pt of patterns) {
          walkType(member.value, pt, schema, take, seen);
        }
      }
    }
  }
}

/**
 * Whether a bridge entry applies under the run's manifest version. An entry
 * tagged `mv` is restricted to that version. An untagged entry applies to both.
 * With no manifest version (null), every entry applies, so the bridge stays
 * usable schema-independently.
 * @param {{mv?: number}} spec
 * @param {?number} manifestVersion
 * @returns {boolean}
 */
function bridgeApplies(spec, manifestVersion) {
  return !spec.mv || manifestVersion == null || spec.mv === manifestVersion;
}

/**
 * Extract paths for a bridge (schema-unmarked) loader per its spec: a positional
 * arg0 string, and/or string / string-array option keys scanned across every
 * object argument.
 * @param {{arg0?: boolean, stringKeys?: string[], arrayKeys?: string[]}} spec
 * @param {AstNode[]} args  The call's argument nodes.
 * @param {(node: AstNode) => void} take
 */
function extractBridge(spec, args, take) {
  if (spec.arg0 && args.length) {
    take(args[0]);
  }
  if (!spec.stringKeys && !spec.arrayKeys) {
    return;
  }
  for (const arg of args) {
    if (arg?.type !== "ObjectExpression") {
      continue;
    }
    for (const prop of arg.properties) {
      if (prop.type !== "ObjectProperty" || prop.computed) {
        continue;
      }
      const key = prop.key.name ?? prop.key.value;
      if (spec.stringKeys?.includes(key)) {
        take(prop.value);
      } else if (spec.arrayKeys?.includes(key)) {
        if (prop.value.type === "ArrayExpression") {
          for (const el of prop.value.elements) {
            take(el);
          }
        } else {
          take(prop.value); // a non-array files value is a dynamic load
        }
      }
    }
  }
}

/**
 * The dotted member path after the API root (e.g.
 * "messageDisplayScripts.register", "scripting.messageDisplay.registerScripts"),
 * or null if the callee is not such a member chain. The chain base resolves
 * through the AST's api-base index, so an aliased root (`const api = messenger ||
 * browser; api.runtime.getURL(...)`) or a captured namespace (`const rt =
 * messenger.runtime; rt.getURL(...)`) yields the same dotted path as a direct
 * call - keeping the dotted-keyed tables (BRIDGE, ROOT_RELATIVE_FILE_METHODS,
 * the schema's fileLoaderMethods) working for all shapes.
 * @param {AstNode} callee
 * @param {Map<AstNode, import("./api-base.js").AliasTarget>} bases
 * @returns {string|null}
 */
function dottedApiPath(callee, bases) {
  const resolved = calleeApiPath(callee, bases);
  return resolved ? resolved.segments.join(".") : null;
}

/**
 * True for an argument expression that yields a runtime-built value (an
 * identifier, member access, call, concatenation, ...) at a file-path slot, as
 * opposed to a static string or a structured object/array/function matching a
 * non-string choice. Drives the caller's conservative `hasDynamic` handling.
 * @param {AstNode} node
 * @param {Map<AstNode, import("./api-base.js").AliasTarget>} bases
 * @returns {boolean}
 */
function isDynamicValue(node, bases) {
  // A runtime.getURL(...) call sitting in a loader slot (e.g.
  // windows.create({url: getURL("popup.html")})) is a resolved-URL value, not a
  // runtime-built path: the getURL call is itself captured by the getURL loader,
  // where it is static if its argument is a literal and dynamic otherwise. So it
  // must not re-flag the outer slot as dynamic.
  if (
    isCallLike(node) &&
    dottedApiPath(node.callee, bases) === "runtime.getURL"
  ) {
    return false;
  }
  switch (node?.type) {
    case undefined:
    case "StringLiteral":
    case "ObjectExpression":
    case "ArrayExpression":
    case "NullLiteral":
    case "BooleanLiteral":
    case "NumericLiteral":
    case "BigIntLiteral":
    case "RegExpLiteral":
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      return false;
    default:
      return true;
  }
}
