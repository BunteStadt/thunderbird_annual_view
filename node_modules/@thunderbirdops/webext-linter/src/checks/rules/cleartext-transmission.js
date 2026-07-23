// Deterministic check: data transmitted to a remote host over an unencrypted
// connection (an http://, ws:// or ftp:// URL - the non-TLS schemes). Any data
// sent in cleartext can be read or tampered with in transit, so it is an error
// regardless of what is sent (no payload gate).
//
// Scoped to overt transmission APIs (fetch and friends). Covert resource loads
// that smuggle data through a URL are already a hard error in the disguised-*
// checks; flagging them here too would double-report the same line.
//
// Belongs here: turning each overt cleartext remote sink into a finding. Does
// NOT belong here: the sink scan (-> src/parse/network-sinks.js, aggregated once
// by src/lib/outbound-sinks.js), and authored wording (-> the response in
// assets/registry.yaml), severity (-> that registry entry).

import { VERDICT } from "../../lib/enum.js";
import { getOutboundSinks } from "../../lib/outbound-sinks.js";
import { finding } from "../../report/finding.js";

/** @typedef {import("../registry.js").RunContext} RunContext */

export default {
  /**
   * @param {RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    const out = [];
    for (const sink of getOutboundSinks(ctx)) {
      if (!sink.channel.overt || !sink.destClass.remote) {
        continue;
      }
      if (!sink.cleartext) {
        continue; // an encrypted (https/wss/ftps) remote transmission is fine
      }
      const loc = { line: sink.line, column: sink.column };
      out.push(finding({ file: sink.file, loc, item: sink.host }));
      ctx.note?.(
        sink.file,
        loc,
        `cleartext send to ${sink.host}`,
        VERDICT.FAIL
      );
    }
    return out;
  },
};
