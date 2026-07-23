// A background script that uses ES module syntax (static import/export) only
// loads when the manifest declares the background "type": "module". Without it
// Thunderbird loads the script as a classic script and the module syntax fails.
// Errors on each background script that has module syntax while the background
// is not declared a module.
//
// Scoped to the manifest's background scripts (background.scripts /
// service_worker). A background page (HTML) declares module-ness on its own
// <script type="module"> tag instead - that case is the sibling check
// background-page-module.js. Content scripts cannot be modules at all. Dynamic
// import() is a call, not module syntax.
//
// Belongs here: matching background scripts to their sources and emitting the
// finding. Does NOT belong here: the AST module-syntax query (-> shared
// lib/module-syntax.js, firstModuleSyntax), the parse (-> the extraction pass, read
// via the moduleSyntaxOf accessor in src/checks/extract.js), path normalization
// (-> normalizeRef in src/lib/manifest-refs.js), authored wording
// (-> assets/registry.yaml), and severity (-> that entry).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { moduleSyntaxOf } from "../extract.js";
import { normalizeRef } from "../../lib/manifest-refs.js";
import { asArray } from "../../lib/util.js";

/** @typedef {import("../registry.js").RunContext} RunContext */

export default {
  /**
   * @param {RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    // Registry `input: xpi`: ctx.addon is the built XPI. Module-ness is a runtime-
    // loading property of what ships - Thunderbird loads the XPI's background script
    // against the XPI's manifest, and the build can transform it (an ESM source
    // bundled to a classic script needs no "type": "module"). So this reads the XPI's
    // manifest and its background scripts, not a source submission's readable source.
    const bg = ctx.manifest?.background;
    if (!bg || typeof bg !== "object") {
      return [];
    }
    const scripts = new Set(
      [...asArray(bg.scripts), bg.service_worker]
        .filter((s) => typeof s === "string")
        .map(normalizeRef)
    );
    if (scripts.size === 0) {
      return [];
    }
    const isModule = bg.type === "module";

    const out = [];
    for (const src of ctx.jsSources) {
      if (!scripts.has(src.file)) {
        continue;
      }
      const loc = moduleSyntaxOf(src);
      if (!loc) {
        continue; // a classic background script - fine without "type": "module"
      }
      if (isModule) {
        ctx.note?.(src.file, loc, "module syntax (type: module)", VERDICT.PASS);
        continue;
      }
      ctx.note?.(
        src.file,
        loc,
        "module syntax without type: module",
        VERDICT.FAIL
      );
      out.push(finding({ file: src.file, loc }));
    }
    return out;
  },
};
