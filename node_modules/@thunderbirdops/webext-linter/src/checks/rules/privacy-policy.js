// Deterministic preflight -> manual review: when the add-on transmits data to a
// hardcoded remote server, a reviewer must confirm the ATN listing carries a
// privacy policy that discloses the collection. The trigger is deterministic (a
// literal remote transmission), but the privacy policy lives in the ATN listing
// field, not the package, so it cannot be verified automatically - hence a
// manual-review escalation rather than a finding.
//
// Overt transmissions to a literal remote host only: a pure-dynamic destination
// is left to the data-exfiltration LLM check (it asks about consent), and a
// covert disguised channel is already a hard error (the disguised-* checks).
// This is the disclosure angle, and it needs no token. The two run independently
// and may both fire on one fetch (disclosure vs consent).
//
// Belongs here: collecting the remote hosts and escalating one manual-review
// case naming them. Does NOT belong here: the sink scan (-> src/parse/
// network-sinks.js, aggregated by src/lib/outbound-sinks.js), the
// deterministic->manual routing (-> src/checks/registry.js + escalation.js), and
// the authored instructions (-> assets/registry.yaml).

import { VERDICT } from "../../lib/enum.js";
import { getOutboundSinks } from "../../lib/outbound-sinks.js";

/** @typedef {import("../registry.js").RunContext} RunContext */
/** @typedef {import("../escalation.js").Escalation} Escalation */

export default {
  /**
   * @param {RunContext} ctx
   * @returns {{findings: [], escalations: Escalation[]}}
   */
  run(ctx) {
    const hosts = new Set();
    let any = false;
    for (const sink of getOutboundSinks(ctx)) {
      if (!sink.channel.overt || !sink.destClass.remote) {
        continue;
      }
      any = true;
      if (sink.host) {
        hosts.add(sink.host);
      }
      ctx.note?.(
        sink.file,
        { line: sink.line, column: sink.column },
        `transmits to ${sink.host ?? "a remote server"}`,
        VERDICT.UNSURE
      );
    }
    if (!any) {
      return { findings: [], escalations: [] };
    }
    // One escalation per distinct remote host: the instruction is item-free, so
    // the hosts group under one entry and list as the "where" - a plain list of
    // remote hosts the reviewer must confirm a privacy policy covers.
    const sorted = [...hosts].sort();
    const escalations = (sorted.length ? sorted : ["a remote server"]).map(
      (host) => ({ item: host })
    );
    return { findings: [], escalations };
  },
};
