// A `new Function(...)` (the Function constructor) in authored JavaScript -
// dynamic code execution, not allowed.
//
// Belongs here: a finding per Function-constructor hit. Does NOT belong here:
// the scan (-> getEvalScan in src/lib/eval-scan.js, shared with the other
// dynamic-execution checks), authored wording (-> assets/registry.yaml), and
// severity (-> that registry entry).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { dedupe } from "../../lib/util.js";
import { getEvalScan } from "../../lib/eval-scan.js";

export default {
  run(ctx) {
    const out = [];
    for (const hit of getEvalScan(ctx).hits) {
      if (hit.type !== "function-constructor") {
        continue;
      }
      const loc = { line: hit.line, column: hit.column };
      out.push(finding({ file: hit.file, loc }));
      ctx.note?.(hit.file, loc, "new Function()", VERDICT.FAIL);
    }
    return dedupe(out);
  },
};
