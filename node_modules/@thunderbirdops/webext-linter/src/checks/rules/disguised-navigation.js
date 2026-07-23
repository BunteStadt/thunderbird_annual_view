// Data smuggled out through a page navigation (location.assign/replace, and
// location.href which network-sinks.js routes here) that carries a user-data API
// call - the strong covert-exfil case, a hard error regardless of consent. The
// weaker appended-runtime-value case goes to the disguised-transmission LLM check.
//
// Belongs here: turning navigation covert sinks into findings. Does NOT belong
// here: the sink scan and the shared exfil gate (-> getOutboundSinks/
// isStrongCovertExfil in src/lib/outbound-sinks.js), authored wording (->
// assets/registry.yaml), and severity (-> that registry entry).

import { VERDICT } from "../../lib/enum.js";
import {
  getOutboundSinks,
  isStrongCovertExfil,
} from "../../lib/outbound-sinks.js";
import { finding } from "../../report/finding.js";

export default {
  run(ctx) {
    const out = [];
    for (const sink of getOutboundSinks(ctx)) {
      if (sink.type !== "navigation" || !isStrongCovertExfil(sink)) {
        continue;
      }
      const loc = { line: sink.line, column: sink.column };
      out.push(finding({ file: sink.file, loc }));
      ctx.note?.(
        sink.file,
        loc,
        "disguised data send (navigation)",
        VERDICT.FAIL
      );
    }
    return out;
  },
};
