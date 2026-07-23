// Extracts WebExtension API usage from JavaScript by walking the AST for
// member-expression chains rooted at the API object. For
// `browser.messages.tags.list(...)` it yields segments
// ["messages","tags","list"]. Chain bases are resolved through the shared
// per-AST index (apiBasesOf in src/parse/api-base.js), so an alias of the API
// object or a captured namespace (`const api = messenger || browser`,
// `const m = browser.messages`) yields the same full path as a direct call
// (`m.archive()` -> messages.archive). This is deliberately best-effort:
// dynamic/computed access and destructured aliases (const { messages } =
// browser) can't always be resolved statically, so we surface those as
// "limitations" rather than silently dropping them.
//
// Belongs here: usage extraction (segments, line/column, dynamic-tail and alias
// limitations) and the feature-detection guard signal (whether a call sits
// behind `if (typeof _m.foo === "function") _m.foo()`).
//
// Does NOT belong here: what denotes an API object - the API_ROOTS set, alias
// resolution, and the per-AST base index (-> src/parse/api-base.js). Deciding
// whether a usage needs a permission, is covered by the manifest, or is
// otherwise allowed - those verdicts live in the checks (src/checks/rules/* and
// src/lib/permissions.js). User-facing wording lives in
// assets/registry.yaml. Babel access goes through src/parse/ast.js.

import { parseJs, traverse, nodeLoc } from "./ast.js";
import { API_ROOTS, aliasTarget, apiBasesOf } from "./api-base.js";

/** @typedef {object} BabelPath A @babel/traverse NodePath object. */

/**
 * @typedef {object} ApiUsage
 * @property {"browser"|"messenger"|"chrome"} root
 * @property {string[]} segments       Property names after the root.
 * @property {number} line             1-based line in the original file.
 * @property {number} column           0-based column.
 * @property {boolean} dynamicTail     True if the chain ended at a computed
 *   access.
 * @property {boolean} optional        True if any link in the member chain uses
 *   optional chaining (`messenger.foo?.bar`), so the access short-circuits to
 *   undefined where the member is missing.
 * @property {boolean} guarded         True if `optional`, OR the access sits in a
 *   local guard (an enclosing if/?:/while test or `&&`/`||` referencing an API object
 *   - a root or an alias/captured namespace - or getBrowserInfo, or a `typeof` probe)
 *   - a coarse "might be feature-detected" signal a consumer can hand to the LLM.
 */

/**
 * @typedef {object} ApiUsageResult
 * @property {ApiUsage[]} usages
 * @property {{line:number, column:number, reason:string}[]} limitations
 * @property {string|null} parseError
 */

/**
 * @param {string} code
 * @param {number} [lineOffset]  Added to reported lines (for inline scripts).
 * @param {import("./ast.js").ParseResult} [parsed]  Reuse this parse of `code`
 *   instead of re-parsing it.
 * @returns {ApiUsageResult}
 */
export function parseApiUsage(code, lineOffset = 0, parsed) {
  const { ast, parseError } = parsed ?? parseJs(code);
  if (parseError) {
    return { usages: [], limitations: [], parseError };
  }

  const usages = [];
  const limitations = [];
  const loc = (node) => nodeLoc(node, lineOffset);

  const bases = apiBasesOf(ast);
  traverse(ast, {
    Identifier(path) {
      const name = path.node.name;
      // A chain-base identifier that denotes an API object: a literal root, a
      // whole-object alias (const api = messenger || browser), or a captured namespace
      // (const m = browser.messages; _m = _api && _api.messages || null). The shared
      // index resolves it to {root, prefix}, where prefix is the captured segment
      // path (browser.messages -> ["messages"]), prepended to the chain.
      const target = bases.get(path.node) ?? null;

      if (!target) {
        // A direct alias/destructuring of the API object we could NOT resolve to
        // usages (e.g. const { messages } = browser) stays a coverage gap.
        if (
          API_ROOTS.has(name) &&
          isAliasOrigin(path) &&
          !aliasIsResolved(path)
        ) {
          limitations.push({
            ...loc(path.node),
            reason: `API object "${name}" is aliased/destructured; usage via the alias is not statically resolved`,
          });
        }
        return;
      }

      const climbed = climbChain(path);
      const segments = [...target.prefix, ...climbed.segments];
      const { dynamicTail, dynamicAt, optional } = climbed;
      const guarded = optional || isGuarded(path);
      usages.push({
        root: target.root,
        segments,
        dynamicTail,
        optional,
        guarded,
        ...loc(path.node),
      });
      if (dynamicTail && dynamicAt) {
        limitations.push({
          ...loc(dynamicAt),
          reason: `computed/dynamic member access on "${target.root}.${segments.join(".")}" not fully resolved`,
        });
      }
    },
  });

  return { usages, limitations, parseError: null };
}

/**
 * True when an alias-origin identifier (the `browser` in `const x = browser`) is
 * a whole-object alias we DO resolve (its declarator id is a plain identifier),
 * so it need not be reported as a coverage-gap limitation.
 * @param {BabelPath} path
 * @returns {boolean}
 */
function aliasIsResolved(path) {
  return (
    path.parent.type === "VariableDeclarator" &&
    path.parent.id.type === "Identifier"
  );
}

/**
 * True when the identifier is the source of an alias, e.g.
 * `const x = browser` or `const { messages } = browser`.
 * @param {BabelPath} path
 * @returns {boolean}
 */
function isAliasOrigin(path) {
  const parent = path.parent;
  if (parent.type === "VariableDeclarator" && parent.init === path.node) {
    return !path.scope.hasBinding(path.node.name);
  }
  return false;
}

/**
 * True when the path is a member access (plain or optional-chained), so a chain
 * like `messenger.foo?.bar` is climbed in full rather than cut at the `?.`.
 * @param {BabelPath} [path]
 * @returns {boolean}
 */
function isMemberish(path) {
  return Boolean(
    path && (path.isMemberExpression() || path.isOptionalMemberExpression())
  );
}

/**
 * From a root identifier, walk up the chain of member expressions collecting
 * property names. Stops at the first computed/non-literal access (marked as a
 * dynamic tail). Optional-chained links (`?.`) are traversed and flagged.
 * @param {BabelPath} rootPath
 * @returns {{segments:string[], dynamicTail:boolean, dynamicAt:object|null,
 *   optional:boolean}}
 */
function climbChain(rootPath) {
  const segments = [];
  let current = rootPath;
  let dynamicTail = false;
  let dynamicAt = null;
  let optional = false;

  while (
    isMemberish(current.parentPath) &&
    current.parent.object === current.node
  ) {
    const member = current.parent;
    if (member.optional) {
      optional = true;
    }
    if (member.computed) {
      if (member.property.type === "StringLiteral") {
        segments.push(member.property.value);
      } else {
        dynamicTail = true;
        dynamicAt = member.property;
        break;
      }
    } else if (member.property.type === "Identifier") {
      segments.push(member.property.name);
    } else {
      dynamicTail = true;
      dynamicAt = member.property;
      break;
    }
    current = current.parentPath;
  }
  return { segments, dynamicTail, dynamicAt, optional };
}

// Statement/expression kinds whose `.test` is a guard condition.
const GUARD_TEST_TYPES = new Set([
  "IfStatement",
  "ConditionalExpression",
  "WhileStatement",
  "DoWhileStatement",
]);

/**
 * Coarse: does this AST subtree reference an API object - a literal root, OR a local
 * that aliases a root/namespace (resolved via aliasTarget, the same primitive usage
 * extraction uses) - or the getBrowserInfo version-gate helper? Such a reference in a
 * guard test marks the guarded code as possibly feature-detected; the precise call is
 * left to the LLM. Scope-aware: a shadowed local named browser/messenger/chrome does
 * NOT resolve, so it is not a false signal. Only VALUE-position identifiers count - a
 * property name (`flag.something`) is a name, not a reference, so it is never resolved.
 * @param {object} node
 * @param {object} scope  Scope of the guarded access, for resolving aliases.
 * @returns {boolean}
 */
function refsGuardSignal(node, scope) {
  let found = false;
  const visit = (n) => {
    if (found || !n || typeof n.type !== "string") {
      return;
    }
    if (
      n.type === "Identifier" &&
      (n.name === "getBrowserInfo" || aliasTarget(n, scope, new Set()) !== null)
    ) {
      found = true;
      return;
    }
    // A non-computed member's `property` is a name, not a value - skip it so a plain
    // `flag.something` never resolves `something` as an alias (only `x[expr]` computed
    // keys and value-position operands are real references).
    const skipProperty =
      (n.type === "MemberExpression" ||
        n.type === "OptionalMemberExpression") &&
      !n.computed;
    for (const key of Object.keys(n)) {
      if (key === "loc" || key === "start" || key === "end") {
        continue;
      }
      if (skipProperty && key === "property") {
        continue;
      }
      const v = n[key];
      if (Array.isArray(v)) {
        for (const c of v) {
          visit(c);
        }
      } else {
        visit(v);
      }
    }
  };
  visit(node);
  return found;
}

/**
 * Whether the access sits in a LOCAL guard - an enclosing if/?:/while test or a
 * `&&`/`||` referencing an API object (root or alias) or getBrowserInfo, or a
 * `typeof` probe. The walk stops at the nearest function boundary, so a guard never
 * leaks across a function definition (a deliberately conservative, coarse signal).
 * @param {BabelPath} rootPath
 * @returns {boolean}
 */
function isGuarded(rootPath) {
  let p = rootPath;
  while (p) {
    const parent = p.parentPath;
    if (!parent || parent.isFunction()) {
      return false;
    }
    const node = parent.node;
    // An optional CALL on this chain (`messenger.foo.bar?.()`) short-circuits to
    // undefined when the member is missing - a guard, like optional chaining on
    // the member path (which climbChain already flags as `optional`).
    if (node.type === "OptionalCallExpression" && p.key === "callee") {
      return true;
    }
    if (node.type === "UnaryExpression" && node.operator === "typeof") {
      return true;
    }
    if (
      GUARD_TEST_TYPES.has(node.type) &&
      refsGuardSignal(node.test, rootPath.scope)
    ) {
      return true;
    }
    if (
      node.type === "LogicalExpression" &&
      (node.operator === "&&" || node.operator === "||") &&
      refsGuardSignal(node, rootPath.scope)
    ) {
      return true;
    }
    p = parent;
  }
  return false;
}
