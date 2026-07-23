// Finds calls to the Web/DOM APIs that consume a manifest permission the
// annotated schema cannot gate through a browser.* member - navigator.* calls
// like navigator.clipboard.readText() (clipboardRead) or
// navigator.geolocation.getCurrentPosition() (geolocation). The schema names the
// receiver + methods per permission (its `web_api` annotation); this walk reports
// which permissions actually have a matching call, so the permission grounding can
// mark them used. Matching an invocation (not a bare `if (navigator.clipboard)`
// feature-check) is deliberate - only real use grounds a permission.
//
// Belongs here: the AST walk that matches `<receiver>.<method>(...)` against the
// supplied signatures, including a simple const-alias of the receiver
// (const c = navigator.clipboard; c.readText()), mirroring network-sinks.js.
//
// Does NOT belong here: the signatures themselves (-> the schema's `web_api`
// annotation, read via SchemaIndex.permissionWebApis), the reachability scoping
// that picks which files to scan, and the unused verdict (both ->
// src/lib/permissions.js, groundWebApiPermissions). Babel -> src/parse/ast.js.

import { parseJs, traverse, memberPropName, isMemberLike } from "./ast.js";

/** @typedef {import("@babel/types").Node} AstNode */

/**
 * A Web/DOM-API signature that grounds a permission.
 * @typedef {object} WebApiSignature
 * @property {string} permission  The manifest permission it grounds.
 * @property {string} receiver  Dotted global access path, e.g. "navigator.clipboard".
 * @property {string[]} methods  Method names on the receiver that count.
 */

/**
 * Flatten the schema's per-permission web_api annotations into scanWebApiCalls
 * signatures. With `declaredNamed`, keep only permissions the manifest declares
 * (the grounding scope). Without it, every web_api permission: the extraction pass
 * scans against all of them and the consumer intersects with what is declared.
 * @param {import("../schema/index.js").SchemaIndex} [schema]
 * @param {Set<string>} [declaredNamed]  Keep only these permissions when given.
 * @returns {WebApiSignature[]}
 */
export function webApiSignatures(schema, declaredNamed) {
  const signatures = [];
  for (const [permission, apis] of schema?.permissionWebApis ?? []) {
    if (declaredNamed && !declaredNamed.has(permission)) {
      continue;
    }
    for (const { receiver, methods } of apis) {
      signatures.push({ permission, receiver, methods });
    }
  }
  return signatures;
}

/**
 * Flatten a static member/identifier chain to a dotted path (e.g.
 * `navigator.clipboard`), using only dot or string-literal property names. Any
 * dynamic/computed link makes it unresolvable (null).
 * @param {AstNode} node
 * @returns {string|null}
 */
function flatten(node) {
  if (node?.type === "Identifier") {
    return node.name;
  }
  if (isMemberLike(node)) {
    const obj = flatten(node.object);
    const prop = memberPropName(node);
    return obj && prop ? `${obj}.${prop}` : null;
  }
  return null;
}

/**
 * Scan JavaScript for calls that match any supplied Web/DOM-API signature, and
 * return the set of permissions those calls ground.
 * @param {string} code  The source to scan.
 * @param {WebApiSignature[]} signatures  Receiver+methods per permission.
 * @param {{ast: AstNode, parseError: ?Error}} [parsed]  A pre-parsed AST to
 *   reuse (re-parses when absent, e.g. non-authored files whose AST was dropped).
 * @returns {Set<string>}  Permission names with a matching call.
 */
export function scanWebApiCalls(code, signatures, parsed) {
  const found = new Set();
  if (!signatures?.length) {
    return found;
  }
  const { ast, parseError } = parsed ?? parseJs(code);
  if (parseError || !ast) {
    return found;
  }

  // "<receiver> <method>" -> permission, so a call resolves in one lookup (a space
  // never collides - receivers are dotted paths, methods are identifiers). The
  // receiver alone is ambiguous (navigator.clipboard serves both clipboardRead and
  // clipboardWrite); the method disambiguates.
  const byCall = new Map();
  for (const { permission, receiver, methods } of signatures) {
    for (const method of methods) {
      byCall.set(`${receiver} ${method}`, permission);
    }
  }

  // Pass 1: identifiers bound to a signature receiver (const c = navigator.clipboard),
  // so `c.readText()` grounds the permission like the direct call would.
  const aliases = new Map();
  traverse(ast, {
    "VariableDeclarator|AssignmentExpression"(path) {
      const id = path.isVariableDeclarator() ? path.node.id : path.node.left;
      const init = path.isVariableDeclarator()
        ? path.node.init
        : path.node.right;
      if (id?.type === "Identifier") {
        const target = flatten(init);
        if (target) {
          aliases.set(id.name, target);
        }
      }
    },
  });

  traverse(ast, {
    "CallExpression|OptionalCallExpression"(path) {
      const { callee } = path.node;
      const method = memberPropName(callee);
      if (!method) {
        return;
      }
      const obj = callee.object;
      const receiver =
        obj?.type === "Identifier" && aliases.has(obj.name)
          ? aliases.get(obj.name)
          : flatten(obj);
      if (!receiver) {
        return;
      }
      const permission = byCall.get(`${receiver} ${method}`);
      if (permission) {
        found.add(permission);
      }
    },
  });

  return found;
}
