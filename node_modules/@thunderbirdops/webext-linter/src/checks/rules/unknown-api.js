// Flags usage of WebExtension APIs not in Thunderbird's annotated schema:
// unknown namespaces, unknown members of a known namespace, and members that
// exist but are explicitly marked `unsupported`. Reads the shared, reachability-
// filtered resolution (lib/api-resolution.js) and emits a verdict per usage. A
// FEATURE-DETECTED (guarded) reference to an unknown MEMBER or an unsupported API is
// skipped, not a finding: the add-on's fallback runs where the API is missing, so
// nothing breaks (usage.guarded from api-usage.js, which is alias-aware - a
// `typeof _api.foo` probe through a captured namespace counts too). An unknown
// NAMESPACE stays a finding even when guarded - a whole missing namespace is far more
// likely a hallucination/typo than a compat probe.
//
// Belongs here: deciding which resolveApi outcomes (unknown-namespace,
// unknown-member, unsupported def) count as a finding (a guarded member/unsupported
// does not; a guarded unknown namespace still does), and picking the item string
// (root.first-segment for an unknown namespace, else the full path).
// Does NOT belong here: resolving usage against the schema over the WebExtension
// tree - that is the shared src/lib/api-resolution.js (resolveApiUsages).
// Extracting browser.* usage from source - src/parse/api-usage.js. Walking the
// schema (isUnsupported, docUrl) - src/schema/index.js. Authored wording ->
// assets/registry.yaml. Severity -> that registry entry, stamped by runChecks
// (src/checks/registry.js). Report formatting -> src/report/format.js.

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { SchemaIndex } from "../../schema/index.js";
import { resolveApiUsages } from "../../lib/api-resolution.js";

export default {
  run(ctx) {
    const findings = [];
    for (const { file, usage, res } of resolveApiUsages(ctx)) {
      const full = `${usage.root}.${usage.segments.join(".")}`;
      const loc = { line: usage.line, column: usage.column };

      // Classify: what (if anything) makes this API unavailable, and the finding it
      // would produce. reason === null means the API is available (a pass).
      let reason = null;
      let args = null;
      if (res.kind === "unknown-namespace") {
        reason = "unknown namespace";
        args = { file, loc, item: `${usage.root}.${usage.segments[0]}` };
      } else if (res.kind === "unknown-member") {
        reason = "unknown member";
        args = { file, loc, item: full };
      } else if (
        SchemaIndex.isUnsupported(res.def) ||
        SchemaIndex.isUnsupported(res.namespaceDef)
      ) {
        reason = "unsupported";
        args = { file, loc, item: full, hint: SchemaIndex.docUrl(res.def) };
      }

      if (!reason) {
        ctx.note?.(file, loc, full, VERDICT.PASS);
        continue;
      }

      // A feature-detected (guarded) reference to an unknown MEMBER or an unsupported
      // API is safe - the fallback runs where the API is missing - so it is skipped,
      // not a finding. An unknown NAMESPACE is exempt: a whole missing namespace behind
      // a guard is far more likely a hallucination/typo than a compat probe, so it is
      // still flagged even when guarded.
      if (usage.guarded && res.kind !== "unknown-namespace") {
        ctx.note?.(
          file,
          loc,
          `${full} (${reason}, feature-detected)`,
          VERDICT.SKIPPED
        );
        continue;
      }

      ctx.note?.(file, loc, `${full} (${reason})`, VERDICT.FAIL);
      findings.push(finding(args));
    }
    return findings;
  },
};
