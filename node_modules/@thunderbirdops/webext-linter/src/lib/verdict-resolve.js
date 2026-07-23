// Shared resolve closures for LLM checks: how a check turns the per-id verdicts
// (gathered by runLlmCheck via the batched transport) into findings + manual
// notes. Two shapes cover all five LLM checks. Identity always comes from the
// check, which passes the finding args and the manual `{{item}}` token, never
// from the model.
//
// - perCandidateResolve: each candidate maps 1:1 to an outcome (the site IS the
//   thing flagged). fail -> its finding, unsure -> a manual note, pass -> drop.
// - aggregateGroups: several candidate sites decide one subject F (does any site
//   load F?). any pass -> F is used, drop; all fail -> one finding on F;
//   otherwise -> one manual note on F.
//
// Belongs here: the two reusable resolve patterns. Does NOT belong here:
// building the candidate list (-> the check) or the verdict transport (->
// src/checks/llm-client.js).

import { finding } from "../report/finding.js";
import { VERDICT } from "./enum.js";

/** @typedef {Map<string, {verdict: import("./enum.js").Verdict, reason: ?string,
 *   additionalInformation?: string}>} VerdictMap */

/**
 * One candidate, one outcome.
 * @param {Array<{id: string, finding: object, item: ?string}>} cases  Per
 *   candidate: its finding args (used on `fail`) and the manual `{{item}}`
 *   token.
 * @returns {(verdicts: VerdictMap) =>
 *   {findings: object[], manual: {item: ?string}[]}}
 */
export function perCandidateResolve(cases) {
  return (verdicts) => {
    const findings = [];
    const manual = [];
    for (const c of cases) {
      const v = verdicts.get(c.id)?.verdict ?? VERDICT.UNSURE;
      if (v.fail) {
        findings.push(finding(c.finding));
      } else if (v.unsure) {
        // Carry the finding's locus so the manual entry can list file:line/item.
        manual.push({ ...c.finding });
      }
    }
    return { findings, manual };
  };
}

/**
 * Several candidate sites decide one subject F.
 * @param {Array<{ids: string[], finding: object, item: ?string}>} groups  Per
 *   subject F: the candidate ids that decide it, F's finding args (used when no
 *   site loads it), and F's manual `{{item}}` token.
 * @returns {(verdicts: VerdictMap) =>
 *   {findings: object[], manual: {item: ?string}[]}}
 */
export function aggregateGroups(groups) {
  return (verdicts) => {
    const findings = [];
    const manual = [];
    for (const g of groups) {
      const vs = g.ids.map((id) => verdicts.get(id)?.verdict ?? VERDICT.UNSURE);
      if (vs.some((v) => v.pass)) {
        continue; // a site loads F -> F is used
      }
      if (vs.length && vs.every((v) => v.fail)) {
        findings.push(finding(g.finding));
      } else {
        // Carry the finding's locus so the manual entry can list file:line/item.
        manual.push({ ...g.finding });
      }
    }
    return { findings, manual };
  };
}
