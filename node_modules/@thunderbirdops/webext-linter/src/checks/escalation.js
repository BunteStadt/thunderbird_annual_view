// The orchestrator's escalation policy: how a case a check could not settle on
// its own becomes a finding or a manual-review note. Two lanes:
//
//   - LLM checks return a candidate set plus a `resolve` closure (run(ctx) ->
//     {findings, llm}). runLlmCheck asks the model for one verdict per candidate
//     id (or, with no token, defaults every candidate to "unsure") and hands the
//     verdicts back to the check's resolve, which maps ids to findings/manual
//     using its own id->data table. The model only ever returns verdicts keyed
//     to ids we minted, so it can never name a subject we did not ask about.
//   - Deterministic checks return `escalations` of cases a human must inspect;
//     manualEscalations routes them straight to manual review (never the model).
//
// Belongs here: runLlmCheck, manualEscalations, the ManualRef shape, and
// narrating each batch to the live feed. Does NOT belong here: judging verdicts
// or building candidates - that is a check under src/checks/rules/*. The batched
// transport (one model call per file-bounded batch) is src/checks/llm-client.js.
// Looping over checks and stamping severity is runChecks
// (src/checks/registry.js). Turning a ManualRef into user text is
// src/report/responses.js via the registry.

import { progress, feedIndent, FEED } from "../util/log.js";
import { red, green, blue } from "../util/color.js";
import { wrapText } from "../util/text.js";
import { VERDICT } from "../lib/enum.js";
import { verdictLabel } from "../report/verdict-label.js";

/** @typedef {import("./registry.js").RunContext} RunContext */
/** @typedef {import("./registry.js").LoadedCheck} LoadedCheck */

/**
 * @typedef {object} Escalation  A deterministic case a human must inspect.
 * @property {?string} item  The offending token, for the `{{item}}` slot.
 * @property {Record<string, string|number>} [data]  Extra `{{slot}}` values for
 *   the manual instructions (e.g. a reason), filled like a finding's data.
 * @property {string} [file]  Locus, listed under the manual entry (like a
 *   finding) so the reviewer sees where; the report groups by message.
 * @property {{line?: number, column?: number}} [loc]
 */

/**
 * @typedef {object} ManualRef  A pointer to a manual-review to-do (resolved to
 *   text from the registry later).
 * @property {string} ruleId  The owning check.
 * @property {?string} item  The offending token, for the `{{item}}` slot.
 * @property {?string} hint  Per-locus suffix shown after `file:line` (like a
 *   finding's hint), independent of `item`/the recheck key. Null when none.
 * @property {?string} file  Locus path, listed under the manual entry, or null.
 * @property {{line?: number, column?: number}|null} loc  Locus line, or null.
 * @property {"escalation"|"llm-error"} kind  Picks the registry message used.
 * @property {Record<string, string|number>|null} data  Extra `{{slot}}` values
 *   for the instructions template (null when the case carries none).
 * @property {?{id: string, file: string, line: ?number, token: string}[]}
 *   occurrences  For a post-summary recheck: the token sites the model judges one
 *   by one (the unused-permission recheck). Null/empty means judge the item
 *   holistically (a token-less permission).
 */

/**
 * @typedef {object} LlmStep  What an LLM check returns under `run().llm`.
 * @property {Array<{id: string, file?: string, line?: number, note?: string,
 *   corpus?: string[]}>} candidates  The sites to judge; the check owns the ids.
 * @property {(verdicts: Map<string, {verdict: import("../lib/enum.js").Verdict, reason: ?string,
 *   additionalInformation?: string}>) => {findings: object[],
 *   manual?: {item: ?string}[]}} resolve  Maps the per-id verdicts to findings +
 *   manual notes via the check's own id->data table.
 */

/**
 * Run an LLM check's candidates through the model and let the check interpret
 * the verdicts. With a token, one verdict per id (batched in llm-client). With
 * none, every candidate defaults to "unsure" so resolve routes it to manual.
 * Findings come back unstamped (runChecks stamps ruleId/severity).
 * @param {RunContext} ctx
 * @param {LoadedCheck} check
 * @param {LlmStep} step
 * @returns {Promise<{findings: object[], manualItems: ManualRef[]}>}
 */
export async function runLlmCheck(ctx, check, step) {
  const candidates = step.candidates ?? [];
  let verdicts;
  if (ctx.llm && candidates.length) {
    // Print the header BEFORE the request so the feed shows what is being
    // waited on while the (often slow, many-candidate) model call runs. The
    // verdicts follow.
    narrateBatchHeader(check, candidates);
    // ctx is the check's ROUTED context (runOneCheck), so ctx.addon is the artifact
    // this check runs over - the model reads its files/inventory, not a captured one.
    // Every check reads its routed ctx.addon (input: source | xpi | build | manifest); there
    // is no per-step artifact override.
    verdicts = await ctx.llm.evaluate({
      rubric: check.prompt,
      candidates,
      addon: ctx.addon,
    });
    narrateBatchVerdicts(candidates, verdicts);
  } else {
    verdicts = new Map(
      candidates.map((c) => [
        c.id,
        { verdict: VERDICT.UNSURE, reason: null, additionalInformation: "" },
      ])
    );
  }
  const { findings = [], manual = [] } = step.resolve(verdicts) || {};
  return {
    findings,
    manualItems: manual.map((m) => manualRef(check, m, "escalation")),
  };
}

/**
 * @param {LoadedCheck} check
 * @param {{item?: ?string, hint?: ?string, file?: ?string, loc?: object,
 *   data?: object, occurrences?: object[]}} c  The manual case: its `{{item}}`
 *   token, an optional per-locus `hint`, an optional locus (file/loc), data, and -
 *   for a recheck - the token occurrences to judge.
 * @param {"escalation"|"llm-error"} kind
 * @returns {ManualRef}
 */
function manualRef(check, c, kind) {
  return {
    ruleId: check.id,
    item: c.item ?? null,
    hint: c.hint ?? null,
    file: c.file ?? null,
    loc: c.loc ?? null,
    kind,
    data: c.data ?? null,
    occurrences: c.occurrences ?? null,
  };
}

/**
 * Route a deterministic check's escalations straight to manual review. The LLM
 * is the authority for judgment cases. A deterministic check escalates only
 * cases a human must inspect, so they never reach the model.
 * @param {LoadedCheck} check
 * @param {Escalation[]} escalations
 * @returns {{findings: object[], manualItems: ManualRef[]}}
 */
export function manualEscalations(check, escalations) {
  return {
    findings: [],
    manualItems: escalations.map((e) => manualRef(check, e, "escalation")),
  };
}

// The live activity feed. HEAD prefixes the review header; DETAIL_HANG hangs the
// verdict bullets' wrapped continuation lines under the bullet text. Both derive
// from the feed's DETAIL indent (feedIndent) so the feed has one indentation source.
const HEAD = `${feedIndent(FEED.DETAIL)}↳ `;
const DETAIL_HANG = `${feedIndent(FEED.DETAIL)}  `;
// Pass green, fail red, unsure blue - keyed by the VERDICT itself (a no-op unless
// the CLI enabled color).
const VERDICT_COLOR = new Map([
  [VERDICT.PASS, green],
  [VERDICT.FAIL, red],
  [VERDICT.UNSURE, blue],
]);

/**
 * Narrate the header of a batched LLM review (printed before the model call, so
 * the reviewer sees what the tool is waiting on while it runs).
 * @param {LoadedCheck} check
 * @param {LlmStep["candidates"]} candidates
 */
function narrateBatchHeader(check, candidates) {
  progress(
    `${HEAD}LLM review: ${check.title} (${candidates.length} candidate(s))`
  );
}

/**
 * Narrate the verdicts of a batched LLM review (printed after the model call):
 * each candidate as a bullet `<file>:<line> VERDICT - reason`, tinted by
 * verdict. The internal id is never shown - the reviewer sees the file:line site
 * it points at.
 * @param {LlmStep["candidates"]} candidates
 * @param {Map<string, {verdict: import("../lib/enum.js").Verdict,
 *   reason: ?string, additionalInformation?: string}>} verdicts
 */
function narrateBatchVerdicts(candidates, verdicts) {
  for (const c of candidates) {
    const v = verdicts.get(c.id) ?? { verdict: VERDICT.UNSURE, reason: null };
    const loc = c.line != null ? `:${c.line}` : "";
    const where = `${c.file ?? "(add-on)"}${loc}`;
    const why = v.reason ? ` - ${v.reason}` : "";
    const tint = VERDICT_COLOR.get(v.verdict) ?? ((s) => s);
    // A bullet per candidate so the verdicts read as a separated list. wrapText
    // hangs continuation lines past the marker, so the DETAIL indent is baked into
    // each line and printed at SECTION - unlike a plain DETAIL line, where emit adds
    // the indent OUTSIDE the color. Here it lands inside tint(), which is harmless:
    // leading spaces are colorless and --report-out strips color before capture.
    // verdictLabel is the one string reduction (the displayed tag text).
    wrapText(
      `• ${where} ${verdictLabel(v.verdict).toUpperCase()}${why}`,
      DETAIL_HANG
    ).forEach((line) => progress(tint(line)));
  }
}
