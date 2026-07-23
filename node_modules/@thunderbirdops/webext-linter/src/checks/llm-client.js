// The LLM client placed on `ctx.llm` when an LLM provider is configured - the
// per-review half of the LLM stack, and pure transport. It builds the
// prompt-cached add-on context shared across the review's calls and exposes
// `evaluate(criterion)`, which returns the structured three-way verdict for one
// case. It does NOT decide outcomes: mapping verdict -> finding / manual review
// is the orchestrator's job (escalation.js). The wire protocol (the forced
// structured output, coercion) is the provider adapters via src/llm/provider.js.
// It never reads the registry yaml - the system intro and each criterion are
// passed in by the caller as strings.
//
// Belongs here: creating the per-review client, building the cached add-on
// metadata block once, forwarding each criterion to the transport via
// evaluate(), the free-form change summary via summarize(), and the structured
// --llm-review add-on review via reviewAddon().
// Does NOT belong here: the wire protocol - the forced structured output and
// coercion - which lives in the provider adapters (src/llm/{anthropic,openai}.js
// + schema.js), selected by src/llm/provider.js. The system intro and criterion
// text - the registry owns those (the caller passes them in). Deciding what a
// verdict means - src/checks/escalation.js. Attaching the client to ctx -
// src/checks/context.js.

import { getProvider, defaultModelFor } from "../llm/provider.js";
import { MAX_FILES_PER_BATCH } from "../config.js";
import { debug, progress, FEED, llmErrorText } from "../util/log.js";
import { red } from "../util/color.js";
import { sortKeys } from "../util/json.js";
import { nonceFor, wrap, wrapFile, framing } from "../lib/untrusted.js";
import { VERDICT } from "../lib/enum.js";
import { verdictLabel } from "../report/verdict-label.js";

// The safe fallback verdict for a candidate the model did not settle: a batch that
// errored, or an id missing from the response. A fresh object per call, so a consumer
// that mutates a verdict record cannot bleed into another.
const unsureVerdict = () => ({
  verdict: VERDICT.UNSURE,
  reason: null,
  additionalInformation: "",
});

// A review result for the debug dump: a verdict is a VERDICT (not serializable -
// JSON.stringify probes `.toJSON` and throws), so reduce each recheck verdict to
// its label first. The only place the debug log touches a verdict.
const reviewForLog = (result) => ({
  ...result,
  recheck: (result.recheck ?? []).map((r) => ({
    ...r,
    verdict: verdictLabel(r.verdict),
  })),
});

/** @typedef {import("./registry.js").RunContext} RunContext */
/** @typedef {import("../llm/schema.js").LlmResult} LlmResult */

/**
 * Build the LLM client for a review. The shared system context is built once
 * and reused across `evaluate()` calls, so the large add-on block is a cached
 * prefix billed cheaply after the first call.
 * @param {object} opts
 * @param {RunContext} opts.ctx  The shared check context (add-on metadata).
 * @param {string} opts.token  LLM API token.
 * @param {string} opts.systemIntro  The reviewer role prompt (registry-owned,
 *   resolved by the caller from prompts.system-intro) - the first system block.
 * @param {string} [opts.type]  LLM_API_TYPE (claude | chatgpt); picks the
 *   provider.
 * @param {string} [opts.model]
 * @param {string} [opts.url]  Override the LLM API base URL (LLM_API_URL).
 * @param {Function} [opts.callVerdicts]  Injectable verdict transport (tests).
 * @param {Function} [opts.callText]  Injectable free-form transport (tests).
 * @param {Function} [opts.callReview]  Injectable add-on-review transport
 *   (tests).
 * @returns {{evaluate: (req: {rubric: string, candidates: object[],
 *   addon: object}) =>
 *   Promise<Map<string, {verdict: import("../lib/enum.js").Verdict, reason: ?string,
 *   additionalInformation?: string}>>, summarize: (msg:
 *   {system: string, user: string}) => Promise<string>, reviewAddon: (msg:
 *   {system: string, user: string}) =>
 *     Promise<import("../llm/schema.js").AddonReview>}}
 */
export function createLlmClient({
  ctx,
  token,
  systemIntro,
  type,
  model = defaultModelFor(type),
  url,
  budget,
  callVerdicts,
  callText,
  callReview,
}) {
  if (!systemIntro) {
    throw new Error(
      "createLlmClient: missing systemIntro (prompts.system-intro)"
    );
  }
  const provider = getProvider(type);
  const verdicts = callVerdicts ?? provider.callVerdicts;
  const text = callText ?? provider.callText;
  const review = callReview ?? provider.callReview;
  // The per-review nonce delimits untrusted add-on content; the framing tells the
  // model that marked content is data, never instructions (see lib/untrusted.js).
  const nonce = nonceFor(ctx);
  // The intro + framing block is artifact-independent. The add-on context (the file
  // inventory) describes ONE artifact, so it is built for whichever add-on the
  // orchestrator adjudicates a check against - the review target for `input: source`
  // checks, the built XPI for `input: xpi` - and memoized per addon so its cached
  // prefix is reused within an artifact.
  const introBlock = {
    type: "text",
    text: `${systemIntro}\n\n${framing(nonce)}`,
  };
  /** @type {WeakMap<object, object[]>} */
  const systemByAddon = new WeakMap();
  const systemFor = (addon) => {
    let sys = systemByAddon.get(addon);
    if (!sys) {
      sys = [
        introBlock,
        {
          type: "text",
          text: buildAddonContext(addon, ctx.manifest, ctx.manifestText, nonce),
          cache_control: { type: "ephemeral" },
        },
      ];
      systemByAddon.set(addon, sys);
      // Verbose: show each artifact's system context once (prompt-cached across this
      // review's calls for that artifact). Each call then logs its criterion + result.
      debug(`[llm] system context:\n${sys.map((b) => b.text).join("\n\n")}`);
    }
    return sys;
  };

  return {
    /**
     * Judge a batch of candidates and return one verdict per id. The
     * orchestrator mints the ids and owns what each means. The model only
     * verdicts them. The candidates are split into batches bounded by distinct
     * corpus file count (MAX_FILES_PER_BATCH), one model call each, over the
     * shared cached system context. Returned ids outside the batch are ignored.
     * Any candidate the model omits (or a whole batch that errored) defaults to
     * "unsure", so the caller can route it to manual review. Never throws.
     * @param {object} req
     * @param {string} req.rubric  The check's rubric (registry prompt).
     * @param {Array<{id: string, file?: string, line?: number, note?: string,
     *   corpus?: string[]}>} req.candidates  Each id points at a file:line site.
     *   `corpus` lists the add-on files the model needs for it (default:
     *   `file`).
     * @param {object} req.addon  The routed add-on artifact whose file bytes +
     *   inventory the model reads (the review target, or the built XPI for an
     *   `input: xpi` check).
     * @returns {Promise<Map<string, {verdict: import("../lib/enum.js").Verdict,
     *   reason: string|null, additionalInformation: string}>>}
     */
    async evaluate({ rubric, candidates, addon }) {
      const out = new Map();
      const list = (candidates ?? []).filter((c) => c && c.id);
      // Corpus + inventory come from the add-on the orchestrator routed this check
      // to (see runOneCheck), never a captured one - so an `input: xpi` check judges
      // its XPI-path candidates against the XPI's files, not the review source's.
      const system = systemFor(addon);
      for (const batch of batchByFiles(list)) {
        // Run-wide request cap: once the budget is spent (and not extended) stop
        // calling the model. The fill below defaults the rest to "unsure", so
        // they escalate to manual review like a token-less run.
        if (budget && !(await budget.consume())) {
          break;
        }
        const paths = corpusPaths(batch);
        const criterion = buildCriterion(rubric, batch, paths, addon, nonce);
        debug(`[llm] criterion (${batch.length} candidate(s)):\n${criterion}`);
        let result;
        try {
          result = await verdicts({
            token,
            model,
            baseURL: url,
            system,
            criterion,
          });
        } catch (err) {
          // Report the failed batch at this step (visible without --verbose).
          // Its candidates fall back to "unsure" -> manual review, as without a
          // token. The review itself never aborts on an LLM error.
          progress(
            red(`↳ LLM review failed - ${llmErrorText(err)}`),
            FEED.DETAIL
          );
          for (const c of batch) {
            out.set(c.id, unsureVerdict());
          }
          continue;
        }
        const ids = new Set(batch.map((c) => c.id));
        for (const v of result.verdicts) {
          if (ids.has(v.id)) {
            out.set(v.id, {
              verdict: v.verdict,
              reason: v.reason,
              additionalInformation: v.additionalInformation ?? "",
            });
          }
        }
      }
      for (const c of list) {
        if (!out.has(c.id)) {
          out.set(c.id, unsureVerdict());
        }
      }
      return out;
    },

    /**
     * Free-form prose completion (no forced verdict tool). Used for the advisory
     * change summary. The trusted instructions go in `system`; the untrusted,
     * nonce-wrapped diff goes in `user`. Throws on a transport/API error.
     * @param {{system: string, user: string}} msg
     * @returns {Promise<string>}
     */
    async summarize({ system: sys, user }) {
      debug(`[llm] summarize system:\n${sys}\n[llm] summarize user:\n${user}`);
      const out = await text({
        token,
        model,
        baseURL: url,
        system: sys,
        prompt: user,
      });
      debug(`[llm] summary:\n${out}`);
      return out;
    },

    /**
     * Structured --llm-review review (forced report_addon_review tool). The
     * trusted rubric + framing go in `system`; the untrusted, nonce-wrapped add-on
     * corpus + recheck items go in `user`. Returns the prose summary plus the
     * recheck verdicts. Throws on a transport/API error (the caller treats that as
     * no summary).
     * @param {{system: string, user: string}} msg
     * @returns {Promise<import("../llm/schema.js").AddonReview>}
     */
    async reviewAddon({ system: sys, user }) {
      debug(
        `[llm] reviewAddon system:\n${sys}\n[llm] reviewAddon user:\n${user}`
      );
      const result = await review({
        token,
        model,
        baseURL: url,
        system: sys,
        prompt: user,
      });
      debug(
        `[llm] reviewAddon result:\n${JSON.stringify(reviewForLog(result), null, 2)}`
      );
      return result;
    },
  };
}

/**
 * The add-on files one candidate needs the model to read: its explicit `corpus`
 * if given, else just its own `file`. Deduped.
 * @param {{file?: string, corpus?: string[]}} c
 * @returns {string[]}
 */
function candidateCorpus(c) {
  const paths = c.corpus?.length ? c.corpus : c.file ? [c.file] : [];
  return [...new Set(paths)];
}

/**
 * The union of corpus paths across a batch, in first-seen order.
 * @param {Array<{file?: string, corpus?: string[]}>} batch
 * @returns {string[]}
 */
function corpusPaths(batch) {
  const seen = new Set();
  const out = [];
  for (const c of batch) {
    for (const p of candidateCorpus(c)) {
      if (!seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
  }
  return out;
}

/**
 * Greedily split candidates so each batch's distinct corpus files stay within
 * MAX_FILES_PER_BATCH. A single candidate whose own corpus exceeds the cap gets
 * its own batch (it cannot be split further).
 * @param {Array<{file?: string, corpus?: string[]}>} candidates
 * @returns {Array<object[]>}
 */
function batchByFiles(candidates) {
  const batches = [];
  let cur = [];
  let curFiles = new Set();
  for (const c of candidates) {
    const need = candidateCorpus(c);
    const union = new Set([...curFiles, ...need]);
    if (cur.length && union.size > MAX_FILES_PER_BATCH) {
      batches.push(cur);
      cur = [];
      curFiles = new Set();
    }
    cur.push(c);
    for (const p of need) {
      curFiles.add(p);
    }
  }
  if (cur.length) {
    batches.push(cur);
  }
  return batches;
}

/**
 * Assemble one batch's user message: the rubric, the CANDIDATES list (id ->
 * file:line plus an optional note), and a FILES section with the batch's corpus
 * bodies. File contents come from the add-on, not the model.
 * @param {string} rubric
 * @param {Array<{id: string, file?: string, line?: number,
 *   note?: string}>} batch
 * @param {string[]} paths  The batch's deduped corpus paths.
 * @param {object} addon  The add-on artifact whose file bytes the model reads.
 * @param {string} nonce  The per-review untrusted-content delimiter.
 * @returns {string}
 */
function buildCriterion(rubric, batch, paths, addon, nonce) {
  const lines = [rubric ?? "", "", "CANDIDATES:"];
  for (const c of batch) {
    const loc = c.line != null ? `:${c.line}` : "";
    const note = c.note ? ` (${c.note})` : "";
    lines.push(`${c.id}: ${c.file ?? "(add-on)"}${loc}${note}`);
  }
  // Each file body is untrusted data, wrapped in nonce markers (its real newlines
  // kept for line citation); the count is stated on this trusted side so a
  // "the files ended, now do X" injection inside a body is contradicted.
  lines.push("", `FILES (${paths.length} untrusted data block(s)):`);
  for (const p of paths) {
    const body = addon?.files?.get(p)?.toString("utf8") ?? "";
    lines.push(wrapFile(nonce, p, body));
  }
  return lines.join("\n");
}

/**
 * Build the compact, deterministic add-on context shared by every LLM check.
 * Identical bytes across checks (one nonce per review) so the cached prefix is
 * reused. Metadata only - no file bodies. The untrusted manifest is wrapped in
 * nonce markers so the model treats it as data, not instructions.
 * @param {object} addon  The add-on artifact to describe (review target or XPI):
 *   its file inventory. The routed artifact per the check's `input`.
 * @param {?import("../addon/load.js").Manifest} manifest  The SHIPPED manifest
 *   (ctx.manifest) - what Thunderbird loads - so the model judges declarations
 *   against what ships, uniformly for both artifacts.
 * @param {string} manifestText  The shipped manifest's raw text (ctx.manifestText).
 *   The manifest is not in addon.files (the loader lifts it off the corpus), so its
 *   inventory entry is sized from here, consistent with the shipped manifest shown above.
 * @param {string} nonce
 * @returns {string}
 */
function buildAddonContext(addon, manifest, manifestText, nonce) {
  const manifestJson = manifest
    ? JSON.stringify(sortKeys(manifest), null, 2)
    : "(no valid manifest.json)";
  const sizeOf = (p) =>
    p === "manifest.json"
      ? Buffer.byteLength(manifestText, "utf8")
      : addon.files.get(p).length;
  const paths = [
    ...addon.files.keys(),
    ...(manifestText ? ["manifest.json"] : []),
  ].sort();
  const fileList =
    paths.map((p) => `  ${p} (${sizeOf(p)} bytes)`).join("\n") || "  (none)";
  const localeDirs = [
    ...new Set(
      paths
        .filter((p) => p.startsWith("_locales/"))
        .map((p) => p.split("/")[1])
        .filter(Boolean)
    ),
  ];
  const war = manifest?.web_accessible_resources;

  return [
    "ADD-ON UNDER REVIEW",
    "",
    "manifest.json (untrusted data):",
    wrap(nonce, "MANIFEST", manifestJson),
    "",
    `default_locale: ${manifest?.default_locale ?? "(none)"}`,
    `_locales directories: ${localeDirs.length ? localeDirs.join(", ") : "(none)"}`,
    `web_accessible_resources: ${war ? wrap(nonce, "WAR", JSON.stringify(war)) : "(none)"}`,
    "",
    "Files:",
    fileList,
  ].join("\n");
}
