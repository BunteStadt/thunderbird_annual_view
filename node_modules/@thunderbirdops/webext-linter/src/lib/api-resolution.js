// The one place browser.* API usage is resolved against the schema. Five checks
// (unknown-api, deprecated-api, strict-min/strict-max-version-api, and the
// permissions analysis) all ask the same question of every reachable API call -
// "what does the schema say about this?" - so the resolution is done ONCE here and
// shared, rather than each check re-walking ctx.apiUsages and re-calling resolveApi.
//
// Belongs here: iterating ctx.apiUsages, restricting to the pure-WebExtension tree
// (experiment/core and dead code are out), skipping bare `browser` references, and
// resolving each usage. Does NOT belong here: any verdict - deprecation, version
// bounds, unknown/unsupported, required permissions - those stay in the consuming
// checks, which read the shared `res`. Extracting the usage itself is
// src/parse/api-usage.js; the schema walk is src/schema/index.js.

import { buildReachability } from "./reachability.js";
import { SchemaIndex } from "../schema/index.js";

/** @typedef {import("../checks/registry.js").RunContext} RunContext */

/**
 * @typedef {object} ResolvedUsage
 * @property {string} file   The packaged file the call sits in.
 * @property {object} usage  The parsed usage (root, segments, line, column, guarded).
 * @property {object} res    The schema.resolveApi result (kind, namespace, member,
 *   def, namespaceDef) each consumer inspects.
 */

/**
 * Every reachable WebExtension API usage, resolved against the schema - memoized per
 * ctx (mirrors getEvalScan / getPermissionAnalysis) so the five API validators share
 * one resolution. Only usages in the pure-WebExtension tree are included, and bare
 * `browser` references (no segments) are dropped.
 * @param {RunContext} ctx
 * @returns {ResolvedUsage[]}
 */
export function resolveApiUsages(ctx) {
  return (ctx.addon.apiResolution ??= resolve(ctx));
}

/**
 * @param {RunContext} ctx
 * @returns {ResolvedUsage[]}
 */
function resolve(ctx) {
  const webext = buildReachability(ctx).pureWebExtensionReachable;
  const out = [];
  for (const src of ctx.apiUsages || []) {
    if (!webext.has(src.file)) {
      continue;
    }
    for (const usage of src.usages) {
      if (usage.segments.length === 0) {
        continue; // bare `browser` reference
      }
      out.push({
        file: src.file,
        usage,
        res: ctx.schema.resolveApi(usage.segments),
      });
    }
  }
  return out;
}

/**
 * The resolved usages that DON'T exist in the schema: an unknown namespace, an
 * unknown member of a known namespace, or a member the schema marks unsupported -
 * i.e. exactly what unknown-api flags. Shared with experiment-unknown-api, which
 * gates a manual review on whether an Experiment has any.
 * @param {RunContext} ctx
 * @returns {ResolvedUsage[]}
 */
export function unknownApis(ctx) {
  return resolveApiUsages(ctx).filter(
    ({ res }) =>
      res.kind === "unknown-namespace" ||
      res.kind === "unknown-member" ||
      SchemaIndex.isUnsupported(res.def) ||
      SchemaIndex.isUnsupported(res.namespaceDef)
  );
}
