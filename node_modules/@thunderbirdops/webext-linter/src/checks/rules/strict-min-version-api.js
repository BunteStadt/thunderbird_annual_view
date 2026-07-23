// Flags functions/events whose schema version_added is newer than the add-on's
// declared strict_min_version: the add-on claims to run on Thunderbird versions
// where the API does not yet exist, so an UNCONDITIONAL call breaks those installs.
// But the same API may be used safely behind feature detection (optional chaining,
// a typeof/existence check, or a getBrowserInfo version gate) so it only runs where
// it exists. Whether a site is really guarded is a local judgement, so this is an
// LLM check with a deterministic pre-flight (like data-exfiltration):
//   - a too-new API used with no guard signal -> a deterministic finding (a hard
//     error even with no LLM token);
//   - a too-new API whose only use carries a guard signal (usage.guarded from
//     api-usage.js) -> one LLM candidate, judged with the call's file as corpus:
//     pass (safely guarded) -> drop, fail (runs unconditionally) -> finding, unsure
//     -> manual review.
// An API used unguarded ANYWHERE wins: it becomes the hard finding, not a candidate.
//
// Scope: this only ever sees REAL, schema-resolved APIs (kind function|event with a
// version_added). A hallucinated/unsupported API resolves to neither and is left to
// unknown-api (which flags a guarded unknown namespace, and skips a guarded unknown
// member/unsupported).
//
// Tuple comparison, so version_added "140.4.1" against strict_min "140.0" is caught.
// No-op when strict_min_version is absent or unparsable. Independent of
// strict-max-version-api.js (the high bound), which stays deterministic (a guard
// cannot make an API exist on a version capped below it).
//
// Belongs here: the version_added vs strict_min comparison, the guard partition, and
// per-api dedup. Does NOT belong here: resolving usage against the schema over the
// WebExtension tree (-> src/lib/api-resolution.js), extracting browser.* usage
// and its guard signal (src/parse/api-usage.js via ctx.apiUsages), reading schema
// annotations (SchemaIndex), the verdict mapping (lib/verdict-resolve.js), or the
// wording / severity (assets/registry.yaml).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { SchemaIndex } from "../../schema/index.js";
import { strictMinVersion, parseVersion, cmpVersion } from "../../lib/util.js";
import { resolveApiUsages } from "../../lib/api-resolution.js";
import { perCandidateResolve } from "../../lib/verdict-resolve.js";

export default {
  /**
   * @param {import("../registry.js").RunContext} ctx
   * @returns {{findings: object[], llm?: import("../escalation.js").LlmStep}}
   */
  run(ctx) {
    const minStr = ctx.manifest ? strictMinVersion(ctx.manifest) : undefined;
    const min = parseVersion(minStr);
    if (!min) {
      ctx.note?.(
        "manifest.json",
        null,
        "no parsable strict_min_version",
        VERDICT.SKIPPED
      );
      return { findings: [] };
    }

    // One entry per api (namespace.member), at its first site. An unconditional
    // (unguarded) site wins over a guarded one, so an api used unguarded anywhere
    // is a hard finding rather than an LLM candidate.
    const byApi = new Map();
    for (const { file, usage, res } of resolveApiUsages(ctx)) {
      if (res.kind !== "function" && res.kind !== "event") {
        continue;
      }
      const va =
        SchemaIndex.versionAdded(res.def) ||
        SchemaIndex.versionAdded(res.namespaceDef);
      // A null version means skip: boolean false (handled by unknown-api),
      // true/absent (supported), and "≤N" (pre-WebExtension, always available).
      const added = parseVersion(va);
      if (!added || cmpVersion(added, min) <= 0) {
        continue;
      }
      const key = `${res.namespace}.${res.member}`;
      const existing = byApi.get(key);
      // Keep the first hard site; only an unguarded site may replace a guarded
      // one (so the api is reported as the hard error it is).
      if (existing && (!existing.guarded || usage.guarded)) {
        continue;
      }
      byApi.set(key, {
        display:
          `${usage.root ?? "browser"}.${usage.segments.join(".")}` +
          (res.kind === "function" ? "()" : ""),
        va,
        file,
        loc: { line: usage.line, column: usage.column },
        guarded: usage.guarded,
      });
    }

    const findings = [];
    const candidates = [];
    const cases = [];
    let n = 0;
    for (const e of byApi.values()) {
      const args = {
        file: e.file,
        loc: e.loc,
        item: e.display,
        hint: `added in Thunderbird ${e.va}`,
        data: { min: String(minStr) },
      };
      if (!e.guarded) {
        ctx.note?.(
          e.file,
          e.loc,
          `${e.display} (added in TB ${e.va})`,
          VERDICT.FAIL
        );
        findings.push(finding(args));
        continue;
      }
      // Possibly feature-detected: let the LLM decide from the call's file.
      const id = `V${++n}`;
      ctx.note?.(
        e.file,
        e.loc,
        `${e.display} (added in TB ${e.va})`,
        VERDICT.UNSURE
      );
      candidates.push({
        id,
        file: e.file,
        line: e.loc.line,
        note: `${e.display} was added in Thunderbird ${e.va}, newer than the declared strict_min_version ${minStr}`,
        corpus: [e.file],
      });
      cases.push({ id, finding: args, item: e.display });
    }

    if (!candidates.length) {
      return { findings };
    }
    return {
      findings,
      llm: { candidates, resolve: perCandidateResolve(cases) },
    };
  },
};
