// The one place a VERDICT becomes display text. A verdict is opaque (src/lib/enum.js)
// - it has no string form of its own - so a consumer that must show one to a human
// switches over it here for its lowercase word. Kept off the enum (the value stays
// opaque) and off the wire (that is schema.js). The switch is exhaustive: a value
// that is not a VERDICT throws rather than rendering as nothing.

import { VERDICT } from "../lib/enum.js";

/**
 * The lowercase display word for a VERDICT ("fail"/"pass"/"unsure"/"skipped"/"info").
 * @param {import("../lib/enum.js").Verdict} verdict
 * @returns {string}
 */
export function verdictLabel(verdict) {
  switch (verdict) {
    case VERDICT.FAIL:
      return "fail";
    case VERDICT.PASS:
      return "pass";
    case VERDICT.UNSURE:
      return "unsure";
    case VERDICT.SKIPPED:
      return "skipped";
    case VERDICT.INFO:
      return "info";
    default:
      throw new Error("verdictLabel: not a VERDICT");
  }
}
