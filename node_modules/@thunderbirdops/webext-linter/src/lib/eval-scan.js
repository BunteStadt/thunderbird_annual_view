// Every dynamic-code-execution signal in the add-on, gathered once and shared:
// the JS scan (eval / Function constructor / code-string timer / ambiguous
// fetch().then(eval) hits) over authored sources, plus the manifest CSP flags.
// The eval-call / function-constructor / string-timer / csp-unsafe-* checks and
// remote-eval all read this one result, so the AST scan runs a single time per
// review - the same "compute once, checks read it" pattern as
// addon.outboundSinks / addon.bundled.
//
// The `hits` are scoped to files OUTSIDE the pure WebExtension tree. A
// WebExtension sandbox cannot execute eval / the Function constructor /
// code-string timers / a fetched-then-eval'd payload UNLESS the manifest CSP
// allows it - and that CSP condition is reported separately by csp-unsafe-eval /
// csp-unsafe-inline. So scanning WebExtension code for these constructs is
// redundant noise: it cannot run them, and if the CSP opens the door the CSP
// check already flags it. The hits matter only in privileged Experiment /
// non-WebExtension code, which has no such CSP gate. The CSP flags below are
// independent of this scoping (they describe the manifest, not a file).
//
// Belongs here: getEvalScan - reading each authored source's precomputed
// remote-js scan (remoteJsOf) outside the pure WebExtension tree, skipping
// non-authored code, and reading the manifest CSP, memoized on the addon.
//
// Does NOT belong here: the AST walk (-> src/parse/remote-js.js), CSP parsing
// (-> src/scan/csp.js), the WebExtension vs Experiment partition (->
// src/lib/reachability.js, pureWebExtensionReachable), the verdicts (->
// src/checks/rules/{eval-call,function-constructor,string-timer,csp-unsafe-eval,
// csp-unsafe-inline,remote-eval}.js), and the non-authored skip set
// (-> bundled.js).

import { remoteJsOf } from "../checks/extract.js";
import { analyzeCsp } from "../scan/csp.js";
import { nonAuthoredJs } from "./bundled.js";
import { buildReachability } from "./reachability.js";

/** @typedef {import("../checks/registry.js").RunContext} RunContext */

/**
 * @typedef {object} EvalScan
 * @property {{file: string, type: string, line: number, column: number}[]} hits
 *   Each dynamic-execution hit (eval / function-constructor / string-timer /
 *   ambiguous-fetch-eval) found in authored JS OUTSIDE the pure WebExtension
 *   tree, tagged with its file. WebExtension code is excluded: a sandbox cannot
 *   run these without a permissive CSP, which csp-unsafe-eval/-inline report.
 * @property {boolean} unsafeEval  The manifest CSP allows 'unsafe-eval'.
 * @property {boolean} unsafeInline  The manifest CSP allows 'unsafe-inline'.
 */

/**
 * Dynamic-code-execution signals, scanned once and memoized on the addon so the
 * eval-related checks share the result.
 * @param {RunContext} ctx
 * @returns {EvalScan}
 */
export function getEvalScan(ctx) {
  return (ctx.addon.evalScan ??= scan(ctx));
}

/**
 * @param {RunContext} ctx
 * @returns {EvalScan}
 */
function scan(ctx) {
  const skip = nonAuthoredJs(ctx);
  // Only scan code OUTSIDE the pure WebExtension tree: WebExtension files cannot
  // execute these constructs without a permissive CSP (reported separately by
  // csp-unsafe-eval/-inline), so a hit there is noise. Privileged Experiment /
  // non-WebExtension code has no CSP gate, so its hits are real.
  const webext = buildReachability(ctx).pureWebExtensionReachable;
  const hits = [];
  for (const src of ctx.jsSources ?? []) {
    if (skip.has(src.file) || webext.has(src.file)) {
      continue;
    }
    const { hits: found } = remoteJsOf(src);
    for (const hit of found) {
      hits.push({
        file: src.file,
        type: hit.type,
        line: hit.line,
        column: hit.column,
      });
    }
  }
  const csp = analyzeCsp(ctx.manifest);
  return { hits, unsafeEval: csp.unsafeEval, unsafeInline: csp.unsafeInline };
}
