// LLM check: a covert channel (a resource/stylesheet src/href, a CSS url(), a
// window.open, or a page navigation) whose URL is built with a runtime value but
// carries NO user-data API call. Smuggling data through such a channel is
// disguised exfiltration, but "a remote URL with a dynamic piece" on its own is a
// weak signal - extremely common in legitimate code (navigating to `host/${id}`,
// loading `cdn/${name}.png`). The STRONG case (a messages/contacts/... call sits
// in the URL) is the hard-error disguised-* checks; this check takes the weak
// residue and asks whether it is really an undisclosed data send. One LLM
// candidate per site; the orchestrator maps each verdict 1:1 (fail -> finding,
// unsure -> manual, pass -> drop).
//
// Belongs here: the candidate per weak covert sink and the verdict mapping. Does
// NOT belong here: the sink scan (-> src/parse/network-sinks.js, aggregated by
// getOutboundSinks/isWeakCovertExfil in src/lib/outbound-sinks.js), the
// hard-error strong case (-> the disguised-*.js checks), the model transport (->
// src/checks/llm-client.js), the resolve pattern (-> src/lib/
// verdict-resolve.js), and authored wording (-> assets/registry.yaml).

import { VERDICT } from "../../lib/enum.js";
import {
  getOutboundSinks,
  isWeakCovertExfil,
} from "../../lib/outbound-sinks.js";
import { perCandidateResolve } from "../../lib/verdict-resolve.js";

/** @typedef {import("../registry.js").RunContext} RunContext */

// Human name of each covert channel (network-sinks.js mints the short codes),
// shown on the locus line so the reviewer sees the channel used.
const CHANNEL = {
  "element-src": "a resource URL (src/href)",
  "set-attribute": "a resource URL (setAttribute)",
  "style-url": "a stylesheet url()",
  "window-open": "window.open()",
  navigation: "a page navigation",
};

export default {
  /**
   * @param {RunContext} ctx
   * @returns {{findings: [], llm?: import("../escalation.js").LlmStep}}
   */
  run(ctx) {
    const candidates = [];
    const cases = [];
    const seen = new Set();
    let n = 0;
    for (const sink of getOutboundSinks(ctx)) {
      if (!isWeakCovertExfil(sink)) {
        continue;
      }
      const key = `${sink.file}:${sink.line}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const loc = { line: sink.line, column: sink.column };
      const id = `D${++n}`;
      const channel = CHANNEL[sink.type] ?? sink.type;
      candidates.push({
        id,
        file: sink.file,
        line: sink.line,
        note: `builds ${channel} to a remote host with a runtime value`,
        corpus: [sink.file],
      });
      // file:line via the location; `hint` (the channel) rides along so it
      // survives the unsure->manual->recheck hand-off. `item` stays absent so the
      // recheck key is file:line.
      cases.push({ id, finding: { file: sink.file, loc, hint: channel } });
      ctx.note?.(sink.file, loc, channel, VERDICT.UNSURE);
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
