// Async listener passed to runtime.onMessage.addListener(). An async listener
// always returns a Promise, which signals "I will respond" for every message
// and breaks other listeners. It is error-prone and must be avoided.
//
// Belongs here: skipping non-authored code, then narrating each
// onMessage.addListener site (async = fail, non-async = pass) and emitting a
// finding for the async ones.
//
// Does NOT belong here: matching the onMessage.addListener call shape and the
// async check (-> src/parse/async-onmessage.js), the non-authored skip-list (->
// src/lib/bundled.js), authored wording (-> assets/registry.yaml),
// severity (-> that registry entry, stamped by src/checks/registry.js), and
// report formatting (-> src/report/format.js).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { asyncOnMessageOf } from "../extract.js";
import { nonAuthoredJs } from "../../lib/bundled.js";

export default {
  run(ctx) {
    const out = [];
    const skip = nonAuthoredJs(ctx); // a library's own onMessage use is not the dev's
    for (const src of ctx.jsSources) {
      if (skip.has(src.file)) {
        continue;
      }
      const { hits } = asyncOnMessageOf(src);
      for (const hit of hits) {
        const loc = { line: hit.line, column: hit.column };
        ctx.note?.(
          src.file,
          loc,
          hit.async
            ? "runtime.onMessage.addListener (async)"
            : "runtime.onMessage.addListener",
          hit.async ? VERDICT.FAIL : VERDICT.PASS
        );
        if (hit.async) {
          out.push(finding({ file: src.file, loc }));
        }
      }
    }
    return out;
  },
};
