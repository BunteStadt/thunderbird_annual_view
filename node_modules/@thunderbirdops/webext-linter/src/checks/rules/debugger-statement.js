// Unconditional `debugger` statements left in shipped code. A `debugger` gated
// by an `if` (a config flag) is allowed, and only ones that always execute are
// flagged. Since `debugger` is a statement, an enclosing `if` is the only way
// to make it conditional.
//
// Belongs here: skipping non-authored code, then narrating each debugger site
// (guarded = pass, unconditional = fail) and emitting a finding for the rest.
//
// Does NOT belong here: locating DebuggerStatement nodes and the guard test (->
// src/parse/debugger-statement.js), the non-authored skip-list (->
// src/lib/bundled.js), authored wording (-> assets/registry.yaml),
// severity (-> that registry entry, stamped by src/checks/registry.js), and
// report formatting (-> src/report/format.js).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { debuggerStmtOf } from "../extract.js";
import { nonAuthoredJs } from "../../lib/bundled.js";

export default {
  run(ctx) {
    const out = [];
    const skip = nonAuthoredJs(ctx); // a debugger left in a library is not the dev's
    for (const src of ctx.jsSources) {
      if (skip.has(src.file)) {
        continue;
      }
      const { hits } = debuggerStmtOf(src);
      for (const hit of hits) {
        const loc = { line: hit.line, column: hit.column };
        ctx.note?.(
          src.file,
          loc,
          hit.guarded ? "debugger (guarded by if)" : "debugger",
          hit.guarded ? VERDICT.PASS : VERDICT.FAIL
        );
        if (!hit.guarded) {
          out.push(finding({ file: src.file, loc }));
        }
      }
    }
    return out;
  },
};
