// Rejects a package.json dependency that names a version range with no lock file
// to pin it (e.g. "^3.10.0" and no package-lock.json / pnpm-lock.yaml /
// yarn.lock). Such a declaration does not identify one exact release, so the
// bundled copy cannot be verified against upstream - the developer must pin the
// version or commit a lock file. resolveVendor already settled which deps are
// unpinned (src/vendor/resolve.js -> addon.vendor.unpinned); this check only
// reads that and emits a finding per entry. Deterministic, no network.
//
// Belongs here: turning each unpinned dependency into a finding (+ a feed note).
// Does NOT belong here: parsing package.json / locks (-> src/vendor/resolve.js +
// src/vendor/locks.js) and the registry wording.

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { manifestTokenLine } from "../../lib/util.js";

/** @typedef {import("../registry.js").RunContext} RunContext */

export default {
  /**
   * @param {RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    const { addon } = ctx;
    const unpinned = addon?.vendor?.unpinned ?? [];
    const text = addon.files.get("package.json")?.toString("utf8") ?? "";
    const findings = [];
    for (const { name, spec } of unpinned) {
      const line = manifestTokenLine(text, name);
      const loc = line ? { line } : undefined;
      ctx.note?.(
        "package.json",
        loc,
        `${name} ("${spec}") is not pinned`,
        VERDICT.FAIL
      );
      // Collapsed response (no {{item}}): the subject renders on the location line
      // as `name (spec)`, matching the other dependency rejects.
      findings.push(
        finding({ file: "package.json", loc, item: `${name} (${spec})` })
      );
    }
    return findings;
  },
};
