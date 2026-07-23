// LLM check: normal data transmission (fetch, XMLHttpRequest, WebSocket,
// EventSource, navigator.sendBeacon) to a remote host is allowed only if the
// user actively enabled it - by entering the destination URL/credentials on an
// options page that lists what is transmitted, or via an explicit
// off-by-default opt-in for a hard-coded URL. Thunderbird has no built-in
// data-collection prompt. Whether a valid opt-in exists needs judgement, so each
// overt sink to a remote/dynamic destination is one LLM candidate; its corpus is
// the transmitting file plus the options page (where an opt-in would live). The
// orchestrator gathers a verdict per sink and this check maps it 1:1 (fail ->
// finding, unsure -> manual, pass -> drop).
//
// Disguising transmission as a resource load is a separate, always-error
// concern (-> the disguised-* checks); this check is only the overt channels.
//
// Belongs here: the candidate per overt remote sink (file:line + the consent
// corpus) and the 1:1 verdict mapping. Does NOT belong here: the sink scan (->
// src/parse/network-sinks.js, aggregated by src/lib/outbound-sinks.js),
// the model transport (-> src/checks/llm-client.js), the resolve pattern (->
// src/lib/verdict-resolve.js), and authored wording (-> registry).

import { VERDICT } from "../../lib/enum.js";
import { getOutboundSinks } from "../../lib/outbound-sinks.js";
import { normalizeRef } from "../../lib/manifest-refs.js";
import { perCandidateResolve } from "../../lib/verdict-resolve.js";

/** @typedef {import("../registry.js").RunContext} RunContext */

// Human name of each outbound method (network-sinks.js mints the short codes), shown
// on the locus line so the reviewer sees the channel used, not the file repeated.
const METHOD = {
  fetch: "fetch()",
  beacon: "navigator.sendBeacon()",
  xhr: "XMLHttpRequest",
  websocket: "WebSocket",
  eventsource: "EventSource",
  "form-submit": "an HTML form submission",
};

export default {
  /**
   * @param {RunContext} ctx
   * @returns {{findings: [], llm?: import("../escalation.js").LlmStep}}
   */
  run(ctx) {
    const optionsPath = optionsPagePath(ctx);
    const candidates = [];
    const cases = [];
    const seen = new Set();
    let n = 0;
    for (const sink of getOutboundSinks(ctx)) {
      const remote = sink.destClass.remote || sink.destClass.dynamic;
      const key = `${sink.file}:${sink.line}`;
      if (!sink.channel.overt || !remote || seen.has(key)) {
        continue;
      }
      seen.add(key);
      const loc = { line: sink.line, column: sink.column };
      const id = `X${++n}`;
      const method = METHOD[sink.type] ?? sink.type;
      candidates.push({
        id,
        file: sink.file,
        line: sink.line,
        note: `transmits to a remote host via ${method}`,
        corpus: optionsPath ? [sink.file, optionsPath] : [sink.file],
      });
      // The finding lists file:line via its location; `hint` (the transmission
      // method) rides along so it survives the unsure->manual->recheck hand-off and
      // is shown on the locus. `item` stays absent so the recheck key is file:line.
      cases.push({ id, finding: { file: sink.file, loc, hint: method } });
      ctx.note?.(sink.file, loc, method, VERDICT.UNSURE);
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

/**
 * The add-on's packaged options page path (where an opt-in would live), or null
 * when none is declared or packaged. options_ui.page is current, options_page
 * legacy.
 * @param {RunContext} ctx
 * @returns {string|null}
 */
function optionsPagePath(ctx) {
  const manifest = ctx.manifest ?? {};
  const ref = manifest.options_ui?.page ?? manifest.options_page;
  if (!ref) {
    return null;
  }
  const path = normalizeRef(ref);
  return ctx.addon?.files?.has(path) ? path : null;
}
