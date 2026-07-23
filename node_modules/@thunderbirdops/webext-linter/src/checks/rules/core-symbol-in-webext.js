// Flags privileged Thunderbird/Firefox "core" globals (Services, ChromeUtils, the
// Components/Cc/Ci/Cu family, ...) used in PURE WebExtension code. A WebExtension
// sandbox - background, content, options and popup scripts - has no chrome
// privileges and does not expose these symbols, so a global reference to one is
// either a bug or privileged code mis-packaged as a WebExtension file. So the check
// runs ONLY on the pure WebExtension dependency tree (pureWebExtensionReachable):
// files reached from a WebExtension entry point without crossing into an Experiment
// API. This positively excludes experiment implementation code and dead code, so an
// untraceable privileged loader cannot cause a false positive.
//
// Belongs here: restricting to the pure WebExtension tree and emitting one finding
// per core-symbol hit. Does NOT belong here: the core-symbol list and the global-
// reference AST match (-> src/parse/core-symbols.js), the WebExtension vs Experiment
// partition (-> src/lib/reachability.js, pureWebExtensionReachable), the
// non-authored skip-list (-> src/lib/bundled.js), authored wording / severity
// (-> assets/registry.yaml), report formatting (-> src/report/format.js).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { coreSymbolsOf } from "../extract.js";
import { nonAuthoredJs } from "../../lib/bundled.js";
import { buildReachability } from "../../lib/reachability.js";

export default {
  run(ctx) {
    const out = [];
    const skip = nonAuthoredJs(ctx); // a core symbol in a bundled library is not the dev's
    // Only check files in the pure WebExtension dependency tree: reachable from a
    // WebExtension entry point without crossing into an Experiment API. This excludes
    // privileged Experiment/core code (and the mixed/"unsure" files), which
    // legitimately uses these symbols, and dead code that never runs - positively,
    // without depending on how completely the Experiment tree was traced.
    const webext = buildReachability(ctx).pureWebExtensionReachable;
    for (const src of ctx.jsSources) {
      if (skip.has(src.file) || !webext.has(src.file)) {
        continue;
      }
      const { hits } = coreSymbolsOf(src);
      for (const hit of hits) {
        const loc = { line: hit.line, column: hit.column };
        ctx.note?.(src.file, loc, hit.name, VERDICT.FAIL);
        // The registry response carries no {{item}}, so the resolver collapses
        // these into one grouped entry and surfaces `item` (the symbol) on each
        // locus line ("file:line - Services") - see report/responses.js + format.js.
        out.push(finding({ file: src.file, loc, item: hit.name }));
      }
    }
    return out;
  },
};
