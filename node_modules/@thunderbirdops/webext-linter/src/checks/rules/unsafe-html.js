// HTML-sink insertion. Flags every write to an HTML sink (innerHTML / outerHTML
// / srcdoc / insertAdjacentHTML) - the only sanctioned way to insert markup is
// the Sanitizer API (Element.setHTML()), so a sink write is flagged regardless of
// where the content comes from or whether it is sanitized; only an empty/null
// clear (el.innerHTML = "") is exempt. Advisory (info): sink writes are no longer
// permitted after ESR 153 and migrating to setHTML() needs Thunderbird 148+, so it
// points the reviewer at each site ahead of the deadline.
//
// Belongs here: skipping non-authored code, then emitting one finding per sink
// hit with the sink name as the item so the reviewer knows what to inspect.
// Does NOT belong here: the AST scan that finds sink writes and the empty-clear
// filter (-> src/parse/unsafe-html.js), the non-authored skip-list
// (-> src/lib/bundled.js), authored wording (-> assets/registry.yaml),
// severity (-> that registry entry, stamped by src/checks/registry.js), and
// report formatting (-> src/report/format.js).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { unsafeHtmlOf } from "../extract.js";
import { nonAuthoredJs } from "../../lib/bundled.js";

export default {
  run(ctx) {
    const out = [];
    const skip = nonAuthoredJs(ctx); // skip non-authored bundles (see nonAuthoredJs)
    for (const src of ctx.jsSources) {
      if (skip.has(src.file)) {
        continue;
      }
      const { hits } = unsafeHtmlOf(src);
      for (const hit of hits) {
        const how =
          hit.sink === "insertAdjacentHTML"
            ? "insertAdjacentHTML()"
            : `.${hit.sink}`;
        const loc = { line: hit.line, column: hit.column };
        out.push(finding({ file: src.file, loc, item: how }));
        ctx.note?.(src.file, loc, how, VERDICT.FAIL);
      }
    }
    return out;
  },
};
