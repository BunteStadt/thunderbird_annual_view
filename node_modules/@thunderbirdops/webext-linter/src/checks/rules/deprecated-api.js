// Warns about deprecated APIs. Reads the shared resolution and reports a
// deprecated function/event/property once. Unlike unknown-api / strict-min-version-api,
// it deliberately does NOT honor usage.guarded: a deprecated API still EXISTS and still
// runs, so feature-detecting it does not make the migration note moot - a guarded
// deprecated call is flagged like any other. (Contrast an absent/too-new API, whose
// guard determines whether the code runs at all.)
//
// Belongs here: deciding that a resolved function/event/property is deprecated,
// and dedup of repeated hits. A deprecated finding carries the schema's own
// deprecation message as its hint (the actionable migration note), not a link
// to the deprecated item. Does NOT belong here: resolving usage against the
// schema over the WebExtension tree (-> src/lib/api-resolution.js),
// extracting browser.* usage (-> src/parse/api-usage.js), reading schema
// annotations (deprecation -> src/schema/index.js). Flagging an API added after
// the supported version range - the strict-min/strict-max-version-api checks; an
// API absent or marked unsupported (version_added: false) - unknown-api. Authored
// wording -> assets/registry.yaml. Severity -> that registry entry, stamped by
// runChecks (src/checks/registry.js). Report formatting -> src/report/format.js.

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { SchemaIndex } from "../../schema/index.js";
import { resolveApiUsages } from "../../lib/api-resolution.js";

export default {
  run(ctx) {
    const findings = [];
    const seen = new Set(); // report each deprecated api once

    for (const { file, usage, res } of resolveApiUsages(ctx)) {
      if (
        res.kind !== "function" &&
        res.kind !== "event" &&
        res.kind !== "property"
      ) {
        continue;
      }
      const full = `${res.namespace}.${res.member}`;
      const loc = { line: usage.line, column: usage.column };

      const dep =
        SchemaIndex.deprecation(res.def) ||
        SchemaIndex.deprecation(res.namespaceDef);

      // Narrate every resolved API site (the unit this check examines), with
      // its verdict - so the feed shows what was vetted, not only the hits.
      ctx.note?.(
        file,
        loc,
        dep ? `${full} (deprecated)` : full,
        dep ? VERDICT.FAIL : VERDICT.PASS
      );

      if (dep && add(seen, full)) {
        findings.push(
          finding({
            file,
            loc,
            // The schema's deprecation message (a migration note) when it has
            // one. A bare `deprecated: true` carries no text, so no hint.
            hint: typeof dep === "string" ? dep : null,
            item: full,
          })
        );
      }
    }
    return findings;
  },
};

/**
 * Add key to set if absent, returning whether it was newly added.
 * @param {Set<string>} set
 * @param {string} key
 * @returns {boolean}
 */
function add(set, key) {
  if (set.has(key)) {
    return false;
  }
  set.add(key);
  return true;
}
