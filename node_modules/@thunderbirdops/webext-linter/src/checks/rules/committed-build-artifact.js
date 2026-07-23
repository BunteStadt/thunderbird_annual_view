// Rejects a source-code submission that ships a committed binary archive (.zip/.xpi/.crx/
// .7z/.rar/.tar/.tgz/.gz). A built archive is build OUTPUT - the reviewer produces it from
// the readable source - so a committed one is useless bloat AND a decoy vector: its bytes
// can differ from what the build actually produces, presenting a clean-looking source next
// to a tampered artifact. It is a hard fail, exactly like a committed node_modules folder.
//
// The archive paths are recorded at load (addon.archives): loadAddon walks the WHOLE
// --sca-root before the source/build split, so an archive is caught wherever it sits - in
// the review source, the build tree, anywhere. selectScaBuildFiles passes the list onto the
// input: build addon (like nodeModules). This check turns each recorded path into a finding.
//
// Belongs here: mapping a recorded archive path to a finding. Does NOT belong here:
// detecting archives (-> src/addon/load.js, using ARCHIVE_EXTENSIONS from src/util/files.js)
// or the wording (-> the registry).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";

/** @typedef {import("../registry.js").RunContext} RunContext */

export default {
  /**
   * @param {RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    const findings = [];
    for (const file of ctx.addon?.archives ?? []) {
      ctx.note?.(file, null, "committed build artifact", VERDICT.FAIL);
      findings.push(finding({ file, item: file }));
    }
    return findings;
  },
};
