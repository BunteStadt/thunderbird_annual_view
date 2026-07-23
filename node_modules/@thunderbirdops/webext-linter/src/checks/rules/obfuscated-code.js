// The developer's own code shipped obfuscated - deliberately hidden behavior that
// cannot be reviewed as-is. Flags such a JS file - that is NOT a recognized
// third-party library (those are missing-library's job) - so the reviewer can
// require the original source. Obfuscation is recognized structurally, by the AST
// shape of a known obfuscator family (see src/lib/obfuscation.js); it cannot
// catch every obfuscator (high precision, partial recall). A STRONG family is a
// deterministic finding. A WEAK-family-only match (a structure that ordinary
// readable code also has) is the UNSURE verdict: the file becomes one LLM candidate,
// judged from its own content alone (fail -> finding, unsure -> manual review,
// pass -> drop; with no LLM token every candidate falls to manual review).
// Deliberately, neither the model nor the manual-review text is told what the
// detector matched - a hint could anchor the judgment, and the file's content
// must speak for itself. The families appear only in the --debug log. A file that
// is merely minified (not obfuscated) is minified-code's job; a file that is both
// is reported here, since obfuscation is the stronger signal.
//
// Belongs here: selecting the classifier verdicts that are obfuscated AND not a
// library, emitting one finding per such file, and the weak-only LLM candidates
// with their 1:1 verdict mapping.
//
// Does NOT belong here: the classification heuristics themselves (->
// src/checks/ lib/bundled.js, classifyAddonJs), the library-signal verdict and
// its finding (-> missing-library.js), the minified-only verdict (->
// minified-code.js), the model transport (-> src/checks/llm-client.js), the
// resolve pattern (-> src/lib/verdict-resolve.js), authored wording (->
// assets/registry.yaml), severity (-> that registry entry, stamped by
// src/checks/registry.js), and report formatting (-> src/report/format.js).

import { finding } from "../../report/finding.js";
import { classifyAddonJs } from "../../lib/bundled.js";
import { perCandidateResolve } from "../../lib/verdict-resolve.js";

/** @typedef {import("../registry.js").RunContext} RunContext */
export default {
  /**
   * @param {RunContext} ctx
   * @returns {{findings: import("../../report/finding.js").Finding[],
   *   llm?: import("../escalation.js").LlmStep}}
   */
  run(ctx) {
    const findings = [];
    const candidates = [];
    const cases = [];
    let n = 0;
    for (const c of classifyAddonJs(ctx)) {
      if (c.library || c.untrusted) {
        // a recognized library is missing-library's concern; an untrusted (not-popular)
        // identified match is untrusted-library / untrusted-minified-library's.
        continue;
      }
      // An "unsure" verdict (a weak-family-only match - the detector's families stay
      // inside src/lib/obfuscation.js): one LLM candidate, judged from the file's own
      // content, which carries no hint of what the detector matched.
      if (c.obfuscation.unsure) {
        const id = `V${++n}`;
        candidates.push({ id, file: c.file, corpus: [c.file] });
        cases.push({ id, finding: { file: c.file }, item: c.file });
        ctx.note?.(c.file, null, "possible obfuscation", c.obfuscation);
        continue;
      }
      // A merely-minified (not obfuscated) file is minified-code's finding; here
      // it notes a pass. Only an obfuscated file is flagged.
      ctx.note?.(
        c.file,
        null,
        c.obfuscation.fail ? "obfuscated" : "readable",
        c.obfuscation
      );
      if (c.obfuscation.fail) {
        findings.push(finding({ file: c.file }));
      }
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
