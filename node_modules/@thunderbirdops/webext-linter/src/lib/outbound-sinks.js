// Every outbound network sink in the add-on's authored JavaScript, scanned once
// and shared. The disguised-* and cleartext-transmission (deterministic),
// privacy-policy, and data-exfiltration (LLM) checks read this one list, so the
// AST scan runs a single time per review - the same "compute once, checks read
// it" pattern as addon.bundled / addon.vendor.
//
// Belongs here: getOutboundSinks - reading each authored source's precomputed
// network-sinks scan (networkSinksOf), skipping non-authored code, and
// memoizing the result on the addon.
//
// Does NOT belong here: the sink AST walk itself (-> src/parse/
// network-sinks.js), the verdicts (-> src/checks/rules/disguised-*.js,
// cleartext-transmission.js, privacy-policy.js, data-exfiltration.js), and the
// non-authored skip set (-> bundled.js).

import { networkSinksOf } from "../checks/extract.js";
import { nonAuthoredJs } from "./bundled.js";

/** @typedef {import("../checks/registry.js").RunContext} RunContext */
/** @typedef {import("../parse/network-sinks.js").SinkHit} SinkHit */
/** @typedef {SinkHit & {file: string}} FileSink */

/**
 * The add-on's outbound network sinks, scanned once and memoized on the addon
 * so every check shares the result.
 * @param {RunContext} ctx
 * @returns {FileSink[]}
 */
export function getOutboundSinks(ctx) {
  return (ctx.addon.outboundSinks ??= scanAll(ctx));
}

// A covert channel (resource/stylesheet/window/navigation) to a non-local
// destination - the precondition for both gates below.
const isCovertRemote = (sink) => sink.channel.covert && !sink.destClass.local;

/**
 * STRONG disguised exfiltration: a covert remote channel with a user-data API
 * call in its argument (messages/contacts/... - the payload is provably user
 * data). The deterministic gate for the hard-error disguised-* checks.
 * @param {FileSink} sink
 * @returns {boolean}
 */
export function isStrongCovertExfil(sink) {
  return isCovertRemote(sink) && sink.carriesData;
}

/**
 * WEAK disguised exfiltration: a covert remote channel that merely builds the URL
 * with a runtime value (dataAppended) and carries no user-data API call. Common
 * in legitimate code (e.g. navigating to `host/${id}`), so it is not a hard error
 * but an LLM/manual candidate - the gate for the disguised-transmission check.
 * @param {FileSink} sink
 * @returns {boolean}
 */
export function isWeakCovertExfil(sink) {
  return isCovertRemote(sink) && sink.dataAppended && !sink.carriesData;
}

/**
 * @param {RunContext} ctx
 * @returns {FileSink[]}
 */
function scanAll(ctx) {
  const skip = nonAuthoredJs(ctx);
  const out = [];
  for (const src of ctx.jsSources ?? []) {
    if (skip.has(src.file)) {
      continue;
    }
    const { hits } = networkSinksOf(src);
    for (const hit of hits) {
      out.push({ ...hit, file: src.file });
    }
  }
  return out;
}
