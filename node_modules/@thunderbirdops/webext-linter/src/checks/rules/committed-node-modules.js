// Rejects a source-code submission that ships a committed node_modules folder. Installed
// dependencies are build output - the reviewer installs them from the declared
// package.json/lock at build time - so a node_modules folder anywhere in --sca-root is
// useless bloat AND a decoy vector (the committed bytes can differ from the declared
// dependencies, smuggling in code from an undeclared source). It is a hard fail.
//
// node_modules is NEVER read: loadAddon skips it at load and records only the directory
// paths (addon.nodeModules), which selectScaBuildFiles passes onto the input: build addon.
// This check turns each recorded directory into an error finding.
//
// Belongs here: mapping a recorded node_modules directory to a finding. Does NOT belong
// here: detecting/skipping node_modules (-> src/addon/load.js) or the wording
// (-> the registry).

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
    for (const dir of ctx.addon?.nodeModules ?? []) {
      ctx.note?.(dir, null, "committed node_modules", VERDICT.FAIL);
      findings.push(finding({ file: dir, item: dir }));
    }
    return findings;
  },
};
