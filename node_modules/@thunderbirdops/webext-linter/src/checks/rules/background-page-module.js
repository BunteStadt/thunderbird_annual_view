// A background PAGE (manifest background.page, an HTML file) loads its scripts
// via <script> tags. A <script src="x.js"> whose target uses ES module syntax
// (static import/export) only works when the tag is declared type="module";
// without it Thunderbird loads x.js as a classic script and the module syntax
// fails. Errors on each such <script src> tag in the background page.
//
// The sibling check background-module.js covers the background.scripts /
// service_worker forms (module-ness declared by the manifest "type": "module").
// Inline <script> blocks are out of scope here - only external <script src>.
//
// Belongs here: reading background.page, walking its <script src> tags, and
// emitting the finding at the tag. Does NOT belong here: the AST module-syntax
// query (-> lib/module-syntax.js), HTML parsing (-> src/scan/html-parse.js),
// ref resolution (-> resolveRef in lib/manifest-refs.js), authored wording
// (-> assets/registry.yaml), and severity (-> that registry entry).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { moduleSyntaxOf } from "../extract.js";
import { eachElement } from "../../scan/html-parse.js";
import { normalizeRef, resolveRef } from "../../lib/manifest-refs.js";

/** @typedef {import("../registry.js").RunContext} RunContext */

export default {
  /**
   * @param {RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    // Registry `input: xpi`: ctx.addon is the built XPI. Module-ness is a runtime-
    // loading property of what ships (Thunderbird loads the XPI's page and its
    // scripts), and the build can transform it. So the page, its <script src>
    // targets, and their bytes all come from the XPI, not a source submission's
    // readable source.
    const { addon } = ctx;
    const page = ctx.manifest?.background?.page;
    if (typeof page !== "string") {
      return [];
    }
    const pageFile = normalizeRef(page);
    const buf = addon.files.get(pageFile);
    if (!buf) {
      return []; // a declared-but-absent page is bundled-files' concern
    }

    // The page's external scripts are .js files the pass already parsed; read the
    // precomputed module-syntax verdict (moduleSyntaxOf). A CHECK NEVER PARSES: a <script src>
    // target NOT in the corpus is a non-JS suffix executed as code - unrecognized-file-type
    // reports that (more usefully than a module-syntax nuance), so here it is simply not a
    // classic .js script to flag.
    const sources = new Map((ctx.jsSources ?? []).map((s) => [s.file, s]));
    const out = [];
    eachElement(buf.toString("utf8"), (el) => {
      if (el.tag !== "script") {
        return;
      }
      const src = el.attr("src");
      if (!src) {
        return; // inline <script> - out of scope
      }
      if (el.attr("type")?.trim().toLowerCase() === "module") {
        return; // correctly declared a module
      }
      const target = resolveRef(addon.files, pageFile, src);
      if (!target) {
        return; // remote or unresolved src - not our concern
      }
      if (!targetUsesModuleSyntax(sources, target)) {
        return; // a classic script - fine without type="module"
      }
      const loc = { line: el.line };
      ctx.note?.(pageFile, loc, `${src} needs type="module"`, VERDICT.FAIL);
      out.push(finding({ file: pageFile, loc }));
    });
    return out;
  },
};

/**
 * Does a packaged JS file use ES module syntax? Read the precomputed moduleSyntaxOf verdict
 * for a source the extraction pass saw (every JS-corpus file). A target NOT in the corpus is
 * not JS-parseable (a non-JS suffix) - it is not a classic .js script this check governs, and
 * unrecognized-file-type reports it instead; the check never parses to answer here.
 * @param {Map<string, object>} sources  ctx.jsSources keyed by file.
 * @param {string} file  Add-on-relative path.
 * @returns {boolean}
 */
function targetUsesModuleSyntax(sources, file) {
  const src = sources.get(file);
  return src ? Boolean(moduleSyntaxOf(src)) : false;
}
