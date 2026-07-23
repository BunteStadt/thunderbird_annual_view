// Flags functions/events whose schema version_added is newer than the add-on's
// declared strict_max_version: the add-on caps support below the Thunderbird
// where the API first appeared, so no supported install has it. Independent of
// strict-min-version-api.js (the low bound). Each too-new API is reported once.
//
// Major granularity: strict_max is conventionally "N.*", so any 140.x is within
// 140.* and only a higher major is unavailable - also the safe reading for an
// error check. No-op when strict_max_version is absent (a schema never contains
// an API newer than its own version, so without a declared cap there is no
// ceiling below the schema to violate).
//
// Belongs here: the version_added vs strict_max_version comparison and per-api
// dedup. Does NOT belong here: resolving usage against the schema over the
// WebExtension tree (-> src/lib/api-resolution.js), extracting browser.* usage
// (src/parse/api-usage.js via ctx.apiUsages), reading schema annotations
// (SchemaIndex.versionAdded), the wording (assets/registry.yaml) or severity (its
// registry entry, stamped by runChecks).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { SchemaIndex } from "../../schema/index.js";
import { strictMaxVersion } from "../../lib/util.js";
import { resolveApiUsages } from "../../lib/api-resolution.js";

export default {
  /**
   * @param {import("../registry.js").RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    const maxStr = ctx.manifest ? strictMaxVersion(ctx.manifest) : undefined;
    const maxMajor = maxStr ? parseInt(maxStr, 10) : NaN;
    if (!Number.isInteger(maxMajor)) {
      ctx.note?.(
        "manifest.json",
        null,
        "no strict_max_version",
        VERDICT.SKIPPED
      );
      return [];
    }

    const findings = [];
    const seen = new Set(); // report each api once, at its first call site

    for (const { file, usage, res } of resolveApiUsages(ctx)) {
      if (res.kind !== "function" && res.kind !== "event") {
        continue;
      }
      const va =
        SchemaIndex.versionAdded(res.def) ||
        SchemaIndex.versionAdded(res.namespaceDef);
      // "≤59" -> NaN -> skipped: such entries predate WebExtension support
      // (Thunderbird 60+), so the API is always available.
      const vaMajor = va ? parseInt(va, 10) : null;
      if (!vaMajor || vaMajor <= maxMajor) {
        continue;
      }
      const key = `${res.namespace}.${res.member}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const display =
        `${usage.root ?? "browser"}.${usage.segments.join(".")}` +
        (res.kind === "function" ? "()" : "");
      const loc = { line: usage.line, column: usage.column };
      ctx.note?.(file, loc, `${display} (added in TB ${va})`, VERDICT.FAIL);
      findings.push(
        finding({
          file,
          loc,
          item: display,
          hint: `added in Thunderbird ${va}`,
          data: { max: String(maxStr) },
        })
      );
    }
    return findings;
  },
};
