// Deterministic (SCA only): flags a package.json npm install lifecycle hook
// (preinstall / install / postinstall / prepare / prepublish / prepublishOnly /
// prepack). These run when the reviewer installs the dependencies - BEFORE the build -
// so a postinstall that fetches and runs remote code is a supply-chain vector the
// dependency audit (which only reads declared package.json/lock deps) never sees.
// Legitimate uses exist (a husky `prepare`), so this is a warning per hook, not a hard
// reject - it points the reviewer at each hook to confirm it only touches local files.
//
// The setup build analysis (analyzeBuild) also reasons about hooks via the model, but only
// with a token; this is the deterministic, always-on backstop.
//
// Belongs here: reading the install-hook scripts and emitting a finding each. Does NOT
// belong here: parsing package.json for anything else (build "scripts" reachability is
// src/build/corpus.js), or the wording (-> assets/registry.yaml).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { manifestTokenLine } from "../../lib/util.js";

/** @typedef {import("../registry.js").RunContext} RunContext */

// The npm-run install/publish lifecycle hooks (not "build"/user scripts, which run only
// when invoked). https://docs.npmjs.com/cli/using-npm/scripts#life-cycle-scripts
const INSTALL_HOOKS = [
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "prepublish",
  "prepublishOnly",
  "prepack",
];

export default {
  /**
   * @param {RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    const text = ctx.addon?.files?.get("package.json")?.toString("utf8");
    if (!text) {
      return [];
    }
    let scripts;
    try {
      scripts = JSON.parse(text).scripts;
    } catch {
      return [];
    }
    if (!scripts || typeof scripts !== "object") {
      return [];
    }
    const findings = [];
    for (const hook of INSTALL_HOOKS) {
      const cmd = scripts[hook];
      if (typeof cmd !== "string" || cmd.trim() === "") {
        continue;
      }
      const line = manifestTokenLine(text, hook);
      const loc = line ? { line } : undefined;
      const item = `${hook}: ${cmd}`;
      ctx.note?.("package.json", loc, `runs a ${hook} hook`, VERDICT.FAIL);
      findings.push(finding({ file: "package.json", loc, item }));
    }
    return findings;
  },
};
