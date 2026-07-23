// The provider-agnostic LLM contract: the two forced structured-output schemas
// (RESULT_SCHEMA / ADDON_REVIEW_SCHEMA) and the defensive coercion of the
// model's answer into typed results. Both providers (anthropic.js, openai.js)
// drive the model to return JSON matching these schemas - Anthropic via a forced
// tool_use, OpenAI via a forced function call - and run the raw JSON through the
// same coercers, so the rest of the tool sees one shape regardless of provider.
//
// Belongs here: the schemas, the tool/function names, the allowed enum sets, the
// coercers, and the result typedefs. Does NOT belong here: the HTTP calls (->
// anthropic.js / openai.js), the per-review add-on context and transport (->
// src/checks/llm-client.js), or any prose prompt (-> the registry).

import { VERDICT } from "../lib/enum.js";

export const RESULT_TOOL = "report_verdicts";
export const REVIEW_TOOL = "report_addon_review";

// The verdict strings the model may answer with on the wire - the enum the two
// schemas below force it into. The model returns `verdict` as a raw JSON string;
// wireVerdict is the ONE string -> VERDICT boundary in the codebase: once the
// string is a known wire value it is VERDICT[NAME], and anything off-protocol (or
// absent) defaults to the safe UNSURE. The model never returns the note-only
// statuses (skipped/info).
export const WIRE_VERDICTS = ["fail", "pass", "unsure"];

/**
 * The VERDICT for a raw wire verdict string, defaulting off-protocol input to
 * UNSURE (so a hostile/garbled response never throws or slips a bad verdict past).
 * @param {unknown} s  The model's raw `verdict` value.
 * @returns {import("../lib/enum.js").Verdict}
 */
export function wireVerdict(s) {
  return WIRE_VERDICTS.includes(s) ? VERDICT[s.toUpperCase()] : VERDICT.UNSURE;
}

// The structured result every LLM check must return. The orchestrator gives the
// model a list of CANDIDATES, each with an id. The model returns one verdict per
// id. It has no field in which to name a file or subject, so it cannot redirect an
// outcome to something it was not asked about - the identity of every finding/note
// is owned by the orchestrator. The verdict is three-way so an unsure model defers
// to a human instead of silently passing. The reason is a short justification; a
// check may surface it (or the optional additionalInformation, extra detail it
// asked for in its rubric) to the developer, or keep it feed-only.
export const RESULT_SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      description: "One entry per candidate id you were given.",
      items: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The exact candidate id from the CANDIDATES list.",
          },
          verdict: {
            type: "string",
            enum: WIRE_VERDICTS,
            description:
              "fail = confident the issue this check looks for is present at " +
              "this candidate; pass = confident it is absent; unsure = not " +
              "confident either way (a human reviews). Only use fail/pass when " +
              "genuinely confident.",
          },
          reason: {
            type: "string",
            description:
              "A short reason for this verdict. Shown in the activity feed; a " +
              "check may also surface it to the developer as the finding " +
              "explanation.",
          },
          additionalInformation: {
            type: "string",
            description:
              "Optional. Extra structured detail a check explicitly asks for " +
              "beyond the verdict + reason. Leave empty unless the rubric asks.",
          },
        },
        required: ["id", "verdict"],
      },
    },
  },
  required: ["verdicts"],
};

// The --llm-review structured result: the prose summary the reviewer reads,
// plus `recheck` - one verdict per item handed to a post-summary recheck consumer
// (unused permissions, unused files, ...) so it can be re-judged with whole-add-on
// context. Each consumer maps its own verdicts to Issues / manual-review notes -
// see src/lib/recheck.js. `recheck` is omitted when nothing was handed
// over, so it is not required.
export const ADDON_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description:
        "The prose add-on summary for the reviewer: what the add-on does, " +
        "notable APIs, network/data use, and security notes.",
    },
    recheck: {
      type: "array",
      description:
        "Your verdict for each item listed in a 'recheck:' section below. " +
        "Judge only the listed items; never add others.",
      items: {
        type: "object",
        properties: {
          check: {
            type: "string",
            description:
              "The check id from the recheck section header the item is under.",
          },
          item: {
            type: "string",
            description: "The exact item text, as listed in that section.",
          },
          verdict: {
            type: "string",
            enum: WIRE_VERDICTS,
            description:
              "Apply that section's rubric: fail = the issue it looks for is " +
              "present; pass = it is absent; unsure = you cannot tell.",
          },
          reason: {
            type: "string",
            description: "One short sentence supporting the verdict.",
          },
        },
        required: ["check", "item", "verdict"],
      },
    },
  },
  required: ["summary"],
};

/**
 * @typedef {object} LlmVerdict  One verdict, keyed to a candidate id.
 * @property {string} id  The candidate id this verdict is for.
 * @property {import("../lib/enum.js").Verdict} verdict
 * @property {string|null} reason  Short reason (feed, or surfaced by the check), or null.
 * @property {string} additionalInformation  Optional extra detail a check asked for
 *   in its rubric (e.g. build instructions), else "".
 */

/**
 * @typedef {object} LlmResult
 * @property {LlmVerdict[]} verdicts  One entry per candidate id (others
 *   dropped).
 */

/**
 * @typedef {object} RecheckVerdict  One re-judged item from the add-on summary.
 * @property {string} check  Id of the recheck consumer the item belongs to.
 * @property {string} item  The exact item text it was listed under (a permission
 *   recheck's item is a token-occurrence id, or the permission for a holistic one).
 * @property {import("../lib/enum.js").Verdict} verdict  fail = issue present
 *   (finding), pass = absent (drop), unsure = a human reviews.
 * @property {string} reason  Short developer-facing why (may be "").
 */

/**
 * @typedef {object} AddonReview  The --llm-review structured result.
 * @property {string} summary  The prose add-on summary.
 * @property {RecheckVerdict[]} recheck  One verdict per re-judged item.
 */

/**
 * Defensively normalize a structured verdict result into a typed LlmResult.
 * @param {unknown} input
 * @returns {LlmResult}
 */
export function coerceResult(input) {
  const obj = input && typeof input === "object" ? input : {};
  const verdicts = (Array.isArray(obj.verdicts) ? obj.verdicts : [])
    .filter((v) => v && typeof v === "object" && typeof v.id === "string")
    .map((v) => ({
      id: v.id,
      verdict: wireVerdict(v.verdict),
      reason: typeof v.reason === "string" ? v.reason : null,
      additionalInformation:
        typeof v.additionalInformation === "string"
          ? v.additionalInformation
          : "",
    }));
  return { verdicts };
}

/**
 * Defensively normalize a structured add-on-review result into an AddonReview: a
 * string summary (else ""), and a recheck list keeping each entry's check + item
 * verbatim, an unknown verdict coerced to the safe "unsure", and a string reason
 * (else ""). Entries missing a check or item string are dropped.
 * @param {unknown} input
 * @returns {AddonReview}
 */
export function coerceReview(input) {
  const obj = input && typeof input === "object" ? input : {};
  const summary = typeof obj.summary === "string" ? obj.summary : "";
  const recheck = (Array.isArray(obj.recheck) ? obj.recheck : [])
    .filter(
      (r) =>
        r &&
        typeof r === "object" &&
        typeof r.check === "string" &&
        r.check &&
        typeof r.item === "string"
    )
    .map((r) => ({
      check: r.check,
      item: r.item,
      verdict: wireVerdict(r.verdict),
      reason: typeof r.reason === "string" ? r.reason : "",
    }));
  return { summary, recheck };
}
