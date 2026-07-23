// Reports a bundled third-party library that is not declared in VENDOR.md - the
// backup for a forgotten declaration. The classifier identifies it by a content
// HASH match against the known-library database (so we know the exact library and
// version, named on the finding); a declared/vendored file is excluded before
// tagging, so everything that reaches here is undeclared. Info severity: a
// hash-identified library is a precise, byte-verified release, so "not declared"
// is advisory, not a blocker. A bundle the hash DB does not recognize is NOT a
// library here - if minified it falls to minified-code, if obfuscated to
// obfuscated-code, otherwise it is scanned as authored.
//
// Belongs here: selecting the library-tagged verdicts and emitting one finding
// (named with its libraryId) per such file.
//
// Does NOT belong here: the hash lookup and the VENDOR.md exclusion (->
// src/lib/bundled.js, classifyAddonJs; the DB itself ->
// src/lib/library-hashes.js), the minified-without-library verdict (->
// minified-code.js) and the obfuscated-without-library verdict (->
// obfuscated-code.js), authored wording (-> assets/registry.yaml), severity (->
// that registry entry, stamped by src/checks/registry.js), and report formatting
// (-> src/report/format.js).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { classifyAddonJs } from "../../lib/bundled.js";

/** @typedef {import("../registry.js").RunContext} RunContext */
export default {
  /**
   * @param {RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    const findings = [];
    for (const c of classifyAddonJs(ctx)) {
      // A hash match identifies the exact release; name it on the finding so the
      // report says which library and version was found undeclared.
      const id = c.libraryId
        ? `${c.libraryId.name} ${c.libraryId.version}`
        : null;
      // A CDN-identified library (c.cdn) is also `library`, but it has its own
      // check (find-lib-on-cdn, which suggests the jsDelivr VENDOR entry); exclude
      // it here so it is not reported twice. Only Mozilla hash-DB matches remain.
      const mozillaLib = c.library && !c.cdn;
      ctx.note?.(
        c.file,
        null,
        mozillaLib ? (id ?? "bundled library") : "not a library",
        mozillaLib ? VERDICT.FAIL : VERDICT.PASS
      );
      if (mozillaLib) {
        findings.push(finding({ file: c.file, item: id ?? undefined }));
      }
    }
    return findings;
  },
};
