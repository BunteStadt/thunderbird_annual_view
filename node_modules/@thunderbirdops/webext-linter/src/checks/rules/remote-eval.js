// LLM check: code whose source may be remote is executed dynamically - the
// statically-undecidable fetch().then(eval) pattern. Each occurrence is one LLM
// candidate (a file:line site); the orchestrator gathers a verdict per site and
// this check maps it (fail -> finding, unsure -> manual, pass -> drop). The
// definite dynamic-execution cases are separate deterministic checks (eval-call,
// function-constructor, string-timer, csp-unsafe-eval, csp-unsafe-inline).
//
// Belongs here: the candidate per ambiguous fetch().then(eval) hit and the 1:1
// verdict mapping. Does NOT belong here: the scan (-> getEvalScan in
// src/lib/eval-scan.js), the model transport (->
// src/checks/llm-client.js), the resolve pattern (->
// src/lib/verdict-resolve.js), and authored wording (->
// assets/registry.yaml).

import { VERDICT } from "../../lib/enum.js";
import { getEvalScan } from "../../lib/eval-scan.js";
import { perCandidateResolve } from "../../lib/verdict-resolve.js";

/** @typedef {import("../registry.js").RunContext} RunContext */

export default {
  /**
   * @param {RunContext} ctx
   * @returns {{findings: [], llm?: import("../escalation.js").LlmStep}}
   */
  run(ctx) {
    const candidates = [];
    const cases = [];
    let n = 0;
    for (const hit of getEvalScan(ctx).hits) {
      if (hit.type !== "ambiguous-fetch-eval") {
        continue;
      }
      const loc = { line: hit.line, column: hit.column };
      const id = `V${++n}`;
      const item = `${hit.file}:${hit.line}`;
      candidates.push({
        id,
        file: hit.file,
        line: hit.line,
        note: "executes the result of a promise (e.g. fetch().then(eval))",
        corpus: [hit.file],
      });
      cases.push({ id, finding: { file: hit.file, loc, item }, item });
      ctx.note?.(hit.file, loc, "fetch().then(eval)", VERDICT.UNSURE);
    }
    if (!candidates.length) {
      return { findings: [] };
    }
    return {
      findings: [],
      llm: { candidates, resolve: perCandidateResolve(cases) },
    };
  },
};
