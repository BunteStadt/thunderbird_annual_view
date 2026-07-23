// The single notion of "what denotes a WebExtension API object". An add-on may
// use the API globals directly (`browser`, `messenger`, `chrome` - all three are
// valid in Thunderbird submissions) or through the common feature-detection
// aliases and namespace captures:
//   const api = messenger                                  (direct root)
//   const api = messenger || browser || chrome             (|| / ?? chain)
//   const api = typeof messenger !== 'undefined' ? messenger : browser  (ternary)
//   const m = browser.messages                             (namespace capture)
//   const m = _api && _api.messages || null                (guarded shim capture)
// Every scanner that roots a member chain at the API object resolves it HERE,
// through one per-AST index (`apiBasesOf`): a single scoped traverse maps each
// chain-base identifier that denotes an API object to {root, prefix}, where
// prefix is the captured segment path (browser.messages -> ["messages"]).
// Scanners look nodes up by identity instead of matching literal names, so an
// alias is understood the same way everywhere - and a shadowed local named
// browser/messenger/chrome (e.g. a function parameter) correctly never matches.
// The index is cached in a WeakMap keyed on the AST's File node: it is built at
// most once per parse and dies with the AST, so the extraction pass's
// one-AST-at-a-time peak-memory contract is preserved.
//
// Belongs here: the API_ROOTS seam (the value is loaded from
// assets/webext-facts.yaml, re-exported here as the single import point), alias
// resolution back to a real root (aliasTarget), the per-AST chain-base index
// (apiBasesOf), and callee-chain resolution through it (calleeApiPath). Scope:
// the WebExtension API roots ONLY - widening the root set silently changes what
// every consumer indexes, so a new root family is a deliberate design decision,
// not an in-place edit.
// Does NOT belong here: usage extraction and its limitations reporting (->
// src/parse/api-usage.js), file-path extraction (-> src/parse/loader-files.js),
// web-API receiver aliasing (navigator.* etc. -> src/parse/web-api-calls.js),
// permission/finding verdicts (-> src/checks/*). Babel access goes through
// src/parse/ast.js.

import { traverse, memberPropName, isMemberLike } from "./ast.js";
import { API_ROOTS } from "./webext-facts.js";

export { API_ROOTS };

/** @typedef {object} BabelPath A @babel/traverse NodePath object. */
/** @typedef {object} AstNode A Babel AST node. */

/**
 * @typedef {object} AliasTarget
 * @property {"browser"|"messenger"|"chrome"} root  The real API global the alias
 *   resolves back to.
 * @property {string[]} prefix  The captured segment path between the root and the
 *   alias site (browser.messages -> ["messages"]; a whole-object alias -> []).
 */

// ast File node -> Map<Identifier node, AliasTarget>. WeakMap so an index never
// outlives its AST.
const indexes = new WeakMap();

// Shared result for a null AST (parse failure), so callers need no guard.
// Read-only by contract: every consumer only .get()s an index, never writes.
const EMPTY = new Map();

/**
 * The AST's API-base index: every chain-base identifier (the `x` in `x.foo.bar`)
 * that denotes an API object, mapped to its resolved target. Built lazily by one
 * scoped traverse and cached per AST, so all scanners of the same parse share a
 * single resolution; consumers hold plain nodes (no Babel path/scope needed) and
 * look them up by identity.
 * @param {?AstNode} ast  The parsed File node (ParseResult.ast), or null.
 * @returns {Map<AstNode, AliasTarget>}
 */
export function apiBasesOf(ast) {
  if (!ast) {
    return EMPTY;
  }
  let index = indexes.get(ast);
  if (!index) {
    index = new Map();
    traverse(ast, {
      Identifier(path) {
        if (isChainBase(path)) {
          const target = aliasTarget(path.node, path.scope, new Set());
          if (target) {
            index.set(path.node, target);
          }
        }
      },
    });
    indexes.set(ast, index);
  }
  return index;
}

/**
 * Resolve a call's callee member chain through the index: the full segment path
 * from the API root ([...base.prefix, ...chain property names]), or null when any
 * link is dynamic (memberName) or the base does not denote an API object. So
 * `rt.getURL(x)` with `const rt = messenger.runtime` resolves to
 * {root: "messenger", segments: ["runtime", "getURL"]}, same as the direct call.
 * Deliberately all-or-nothing, in contrast to api-usage's upward chain climb
 * (which keeps the resolved head of a chain and flags the dynamic tail): a
 * partially-resolved callee is no use to a caller matching a method path.
 * @param {?AstNode} callee
 * @param {Map<AstNode, AliasTarget>} bases  The AST's index from apiBasesOf.
 * @returns {?{root: "browser"|"messenger"|"chrome", segments: string[]}}
 */
export function calleeApiPath(callee, bases) {
  if (!isMemberLike(callee)) {
    return null;
  }
  const segments = [];
  let cur = callee;
  while (isMemberLike(cur)) {
    const key = memberPropName(cur);
    if (key === null) {
      return null;
    }
    segments.unshift(key);
    cur = cur.object;
  }
  const target = cur?.type === "Identifier" ? bases.get(cur) : null;
  return target
    ? { root: target.root, segments: [...target.prefix, ...segments] }
    : null;
}

/**
 * True when this identifier is the base object of a member chain (e.g. the `x` in
 * `x.foo.bar`), not a property name. Says nothing about whether `x` is an API
 * object - just the syntactic position.
 * @param {BabelPath} path
 * @returns {boolean}
 */
function isChainBase(path) {
  if (path.key === "property" && isMemberLike(path.parent)) {
    return false; // it's the `.x` part of something.x
  }
  return Boolean(
    (path.parentPath?.isMemberExpression() ||
      path.parentPath?.isOptionalMemberExpression()) &&
    path.parent.object === path.node
  );
}

/**
 * The API target an initializer expression resolves to, or null. Handles the common
 * Thunderbird feature-detection alias shapes AND a namespace captured into a local
 * (the shapes in the module header). Resolution is by structure, back to a real
 * root: a member access appends its static property name to the prefix; a
 * computed/dynamic property gives up (null).
 * @param {object} node  An expression node (a VariableDeclarator init).
 * @param {object} scope  The declarator's scope, for resolving nested identifiers.
 * @param {Set<string>} seen  Binding names already being resolved (cycle guard).
 * @returns {?AliasTarget}
 */
export function aliasTarget(node, scope, seen) {
  if (!node) {
    return null;
  }
  switch (node.type) {
    case "Identifier": {
      const binding = scope?.getBinding(node.name);
      if (API_ROOTS.has(node.name) && !binding) {
        return { root: node.name, prefix: [] }; // the global API object itself
      }
      // A BOUND root name is not the global: resolve the binding like any other
      // alias, so the polyfill shim `var browser = browser || chrome` (the
      // declarator re-binds the name to an expression that resolves back to a
      // root; the seen guard breaks the self-reference) still counts, while a
      // shadowed local (e.g. a function parameter named browser - not a
      // resolvable declarator) yields null.
      return aliasedTarget(binding, scope, seen);
    }
    case "MemberExpression":
    case "OptionalMemberExpression": {
      const base = aliasTarget(node.object, scope, seen);
      if (!base) {
        return null;
      }
      const key = memberPropName(node);
      return key === null
        ? null
        : { root: base.root, prefix: [...base.prefix, key] };
    }
    case "ParenthesizedExpression":
      return aliasTarget(node.expression, scope, seen);
    case "LogicalExpression":
      // ||/?? -> either operand carries the value; && -> the RHS is the value
      // (`_api && _api.messages`), the LHS is just the presence guard.
      if (node.operator === "||" || node.operator === "??") {
        return (
          aliasTarget(node.left, scope, seen) ??
          aliasTarget(node.right, scope, seen)
        );
      }
      if (node.operator === "&&") {
        // `A && B` is B when A is truthy; A is the value only on short-circuit
        // (the API is absent), so the presence guard (LHS) is never the alias.
        return aliasTarget(node.right, scope, seen);
      }
      return null;
    case "ConditionalExpression":
      return (
        aliasTarget(node.consequent, scope, seen) ??
        aliasTarget(node.alternate, scope, seen)
      );
    default:
      return null;
  }
}

/**
 * Resolve a binding to the API target its initializer aliases, or null. Only a
 * `const/let/var x = <init>` whose id is a plain identifier counts (destructuring
 * does not - that stays a coverage-gap limitation). Recurses through multi-hop
 * captures (`_m` -> `_api.messages`, `_api` -> browser); `seen` (keyed by binding
 * name) guarantees termination - each binding is resolved at most once, and bindings
 * are finite, so a cycle bottoms out at null.
 * @param {object} binding  A Babel scope binding (or undefined).
 * @param {object} scope  Fallback scope for nested identifier lookups.
 * @param {Set<string>} seen  Binding names already being resolved.
 * @returns {?AliasTarget}
 */
function aliasedTarget(binding, scope, seen) {
  const decl = binding?.path;
  if (!decl || decl.type !== "VariableDeclarator") {
    return null;
  }
  if (decl.node.id.type !== "Identifier") {
    return null; // destructuring etc. - not a whole-object/namespace alias
  }
  const name = decl.node.id.name;
  if (seen.has(name)) {
    return null; // a cycle - each binding is resolved at most once
  }
  seen.add(name);
  return aliasTarget(decl.node.init, decl.scope ?? scope, seen);
}
