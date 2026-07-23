// The LLM-authored advisory summaries (post-review, text-only, gated on an
// LLM provider is configured). Each reduces the add-on to a self-contained prompt and
// returns a DEFERRED { bytes, run } so the orchestrator can show the review
// report first, print a status line with the transmitted size, then run the LLM
// call. Neither is a check - they emit no finding and never affect the verdict.
// buildSummarizer is the "Summary of changes" (ctx.previous vs ctx.addon as a
// changed-files diff, --diff-to). buildAddonSummarizer is the "Summary of
// add-on" (the almost-full current authored add-on, minus vendored and unused
// files, --llm-review).
//
// The diff summary is free-form prose; the add-on summary is structured (prose
// plus the machine-readable recheck verdicts, via the forced report_addon_review
// tool), since the post-summary recheck consumers map those verdicts to Issues.
//
// Belongs here: buildDiffText / buildAddonText (the deterministic payloads), the two
// summarizer builders, AND the runner half that drives them - generateSummary /
// generateAddonSummary (one model call each, budget-capped, narrated to the feed) and
// resolveRecheckSummaries, the whole --llm-review summary interleave the orchestrator
// (runChecks) invokes between the llm and post-summary phases: the XPI single-pass /
// SCA two-pass add-on review that populates ctx.recheckVerdicts, plus the diff summary.
// Does NOT belong here: the prompt text -> assets/registry.yaml (via registry.prompt).
// The transport -> the provider adapters (callText / callReview, selected by
// src/llm/provider.js) through src/checks/llm-client.js (summarize / reviewAddon).
// Displaying the summaries -> src/cli.js. Composing the recheck sections and mapping
// verdicts to Issues -> src/lib/recheck.js. File classification ->
// src/lib/bundled.js and src/util/files.js.

import { extname, JS_EXTENSIONS, HTML_EXTENSIONS } from "../util/files.js";
import { canonicalJson } from "../util/json.js";
import { progress, FEED, llmErrorText } from "../util/log.js";
import { red } from "../util/color.js";
import { humanSize } from "../util/text.js";
import { nonAuthoredJs } from "../lib/bundled.js";
import { buildRecheckSections } from "../lib/recheck.js";
import {
  nonceFor,
  wrap,
  wrapFile,
  numberLines,
  framing,
} from "../lib/untrusted.js";

/** @typedef {import("./registry.js").RunContext} RunContext */
/** @typedef {import("./registry.js").Registry} Registry */
/** @typedef {import("../llm/schema.js").AddonReview} AddonReview */
/** @typedef {{bytes: number, run: () => Promise<?string>}} DeferredSummary */
/**
 * @typedef {{bytes: number, run: () => Promise<?AddonReview>}} DeferredReview
 */

// Authored text file types whose full contents are worth quoting to the model.
const TEXT_EXTS = new Set([
  ...JS_EXTENSIONS,
  ...HTML_EXTENSIONS,
  ".json",
  ".css",
  ".txt",
  ".md",
  ".yaml",
  ".yml",
]);

/**
 * Whether a file's contents are worth quoting to the model: an authored text file
 * that is not a non-authored bundle (library / minified / obfuscated / vendored) and
 * not a `_locales/` translation. Locale message catalogs carry no behavioral or
 * security signal - they are UI strings, already covered by the deterministic locale
 * checks (default-locale-*, missing-english-localization, trademark-violation) - and a
 * heavily-localized add-on ships megabytes of them, which would blow the summary's
 * context window for no review value.
 * @param {string} file
 * @param {Set<string>} skip  The nonAuthoredJs set for the current add-on.
 * @returns {boolean}
 */
function isAuthoredText(file, skip) {
  return (
    TEXT_EXTS.has(extname(file)) &&
    !skip.has(file) &&
    !file.startsWith("_locales/")
  );
}

/**
 * The utf8 text of a file in a files map, or "".
 * @param {string} file
 * @param {Map<string, Buffer>} files
 * @returns {string}
 */
function fileText(file, files) {
  return files.get(file)?.toString("utf8") ?? "";
}

/**
 * Push a header line then `s` between ``` fences onto `out`.
 * @param {string[]} out
 * @param {string} h
 * @param {string} s
 */
function fenced(out, h, s) {
  out.push(h, "```", s, "```");
}

/**
 * Wrap a self-contained prompt message as a deferred summary: its UTF-8 size
 * (for the status line) plus a run() that performs the LLM call and yields the
 * prose. run() may THROW on an LLM error; the caller (the pipeline) catches it,
 * narrates the failure at the step, and keeps the review going - an advisory
 * summary must never abort the review.
 * @param {RunContext} ctx
 * @param {string} message  The full text sent to the model.
 * @returns {DeferredSummary}
 */
// The UTF-8 byte size of a { system, user } model payload (narrated in the feed).
function payloadBytes(system, user) {
  return Buffer.byteLength(system, "utf8") + Buffer.byteLength(user, "utf8");
}

function deferredSummary(ctx, { system, user }) {
  return {
    bytes: payloadBytes(system, user),
    run: () => ctx.llm.summarize({ system, user }),
  };
}

/**
 * Like deferredSummary, but for the add-on review: run() yields the structured
 * { summary, recheck } via ctx.llm.reviewAddon (the forced report_addon_review
 * tool) rather than free-form prose, since the add-on summary also returns the
 * machine-readable recheck verdicts. run() may THROW on an LLM error; the pipeline
 * catches it and narrates the failure - an advisory summary must never abort the
 * review.
 * @param {RunContext} ctx
 * @param {{system: string, user: string}} msg  The trusted system text and the
 *   untrusted, nonce-wrapped user data sent to the model.
 * @returns {DeferredReview}
 */
function deferredReview(ctx, { system, user }) {
  return {
    bytes: payloadBytes(system, user),
    run: () => ctx.llm.reviewAddon({ system, user }),
  };
}

/**
 * The deterministic diff fed to the model: which files were added/removed/
 * changed, the before+after of changed authored text files (binaries and
 * bundles are named with byte sizes only), and the manifest's canonical diff.
 * Returns null when nothing changed or there is no baseline.
 * @param {RunContext} ctx
 * @param {RunContext} [shippedCtx]  The shipped-artifact context (the built XPI);
 *   defaults to ctx (an XPI review, where they are one).
 * @returns {?string}
 */
export function buildDiffText(ctx, shippedCtx = ctx) {
  // The diff describes the SHIPPED add-on: in SCA mode the --diff-to baseline (an
  // XPI) is compared against the built XPI, not the readable source whose pre-build
  // layout would never match it. shippedCtx IS ctx in an XPI review, so the file set
  // and the non-authored skip both come from the shipped artifact in both modes.
  const cur = shippedCtx.addon?.files;
  const prev = ctx.previous?.files;
  if (!cur || !prev) {
    return null;
  }
  const skip = nonAuthoredJs(shippedCtx);

  const added = [];
  const removed = [];
  const changed = [];
  for (const [file, buf] of cur) {
    const before = prev.get(file);
    if (!before) {
      added.push(file);
    } else if (!before.equals(buf)) {
      changed.push(file);
    }
  }
  for (const file of prev.keys()) {
    if (!cur.has(file)) {
      removed.push(file);
    }
  }
  const manifestDiffers =
    canonicalJson(ctx.previous.manifest ?? null) !==
    canonicalJson(shippedCtx.manifest ?? null);
  if (!added.length && !removed.length && !changed.length && !manifestDiffers) {
    return null;
  }
  added.sort();
  removed.sort();
  changed.sort();

  const out = [];
  if (manifestDiffers) {
    out.push("manifest.json changed:");
    fenced(
      out,
      "--- previous manifest ---",
      canonicalJson(ctx.previous.manifest ?? null)
    );
    fenced(
      out,
      "--- current manifest ---",
      canonicalJson(shippedCtx.manifest ?? null)
    );
    out.push("");
  }
  out.push(`Added files: ${added.join(", ") || "(none)"}`);
  out.push(`Removed files: ${removed.join(", ") || "(none)"}`);
  out.push(`Changed files: ${changed.join(", ") || "(none)"}`, "");

  for (const file of added) {
    if (isAuthoredText(file, skip)) {
      fenced(out, `=== ${file} (added) ===`, fileText(file, cur));
    }
  }
  for (const file of changed) {
    if (isAuthoredText(file, skip)) {
      out.push(`=== ${file} (changed) ===`);
      fenced(out, "--- previous ---", fileText(file, prev));
      fenced(out, "--- current ---", fileText(file, cur));
    } else {
      const a = prev.get(file)?.length ?? 0;
      const b = cur.get(file)?.length ?? 0;
      out.push(`${file}: changed (${a} -> ${b} bytes)`);
    }
  }
  return out.join("\n");
}

/**
 * The (almost) full current add-on for the add-on summary: the canonical
 * manifest plus every authored text file (isAuthoredText - i.e. not a
 * vendored/minified/obfuscated bundle nor a _locales translation) that is not in
 * `unused`, each fenced under "=== file ===". No byte cap - a large
 * (non-localized) add-on may still approach the context window. Permission usage
 * is deliberately NOT summarized here: it is settled by the deterministic checks
 * and, for genuinely-unsure permissions, the recheck sections (buildRecheckSections).
 * @param {RunContext} ctx
 * @param {{unused?: Set<string>}} [opts]  unused = files the review found
 *   unreachable.
 * @returns {?string}
 */
export function buildAddonText(
  ctx,
  nonce,
  { unused = new Set(), summaryAddon = ctx.addon } = {}
) {
  const files = summaryAddon?.files;
  if (!files) {
    return null;
  }
  // The skip set comes from the SUMMARIZED add-on's classification: libraries,
  // minified and obfuscated bundles, and vendored/trusted files are excluded, so the
  // summary quotes only reviewable authored code. For the review target (the default)
  // this is nonAuthoredJs(ctx). For a DIFFERENT summaryAddon (SCA mode: the built XPI)
  // the pipeline classifies it in setup (xpiAddon.bundled), so its non-authored set is
  // read directly - the same exclusion an XPI review applies to its own target, so both
  // modes summarize the shipped XPI identically (and its multi-MB minified bundles are
  // never quoted). The `?? new Set()` is defensive: only a direct caller that never ran
  // the setup classification (a unit ctx) reaches it - the pipeline always classifies.
  const skip =
    summaryAddon === ctx.addon
      ? nonAuthoredJs(ctx)
      : (summaryAddon.bundled?.nonAuthored ?? new Set());
  // Every block is untrusted add-on content, wrapped in nonce markers so the model
  // treats it as data. File bodies are line-numbered (numberLines) so the model can
  // locate the file:line token sites the permission recheck points it at. Each pass
  // numbers ITS OWN corpus (this summaryAddon - the source, or in SCA the shipped XPI
  // for the packaging pass), the same corpus its producer located those sites in.
  const out = [wrap(nonce, "MANIFEST", canonicalJson(ctx.manifest ?? null))];
  for (const file of [...files.keys()].sort()) {
    if (unused.has(file) || !isAuthoredText(file, skip)) {
      continue;
    }
    out.push(wrapFile(nonce, file, numberLines(fileText(file, files))));
  }
  return out.join("\n");
}

/**
 * Prepare the deferred "Summary of changes" (--diff-to): the diff text handed to
 * the LLM with the registry "change-summary" prompt. Returns null when there is
 * no baseline, no token, nothing changed, or no prompt.
 * @param {RunContext} ctx
 * @param {Registry} registry
 * @param {RunContext} [shippedCtx]  The shipped-artifact context; defaults to ctx.
 * @returns {?DeferredSummary}
 */
export function buildSummarizer(ctx, registry, shippedCtx = ctx) {
  if (!ctx?.previous || !ctx?.llm) {
    return null;
  }
  const diff = buildDiffText(ctx, shippedCtx);
  const prompt = registry.prompt("change-summary");
  if (!diff || !prompt) {
    return null;
  }
  // Trusted instructions (framing + prompt) in system; the untrusted diff, wrapped
  // in nonce markers, in user.
  const nonce = nonceFor(ctx);
  return deferredSummary(ctx, {
    system: `${framing(nonce)}\n\n${prompt}`,
    user: wrap(nonce, "DIFF", diff),
  });
}

/**
 * Prepare the deferred "Summary of add-on" (--llm-review): the (almost) full
 * current add-on handed to the LLM with the registry "add-on-summary" prompt,
 * plus a recheck section for any items earlier checks handed over (ctx.recheck).
 * The model returns prose plus the structured recheck verdicts (the post-summary
 * recheck consumers map those to Issues). Returns null when there is no token or
 * no prompt.
 * The corpus and its recheck consumers are chosen by the caller: an XPI review runs one
 * all-in-one summary over ctx.addon; an SCA review runs two - a behavioral pass over the
 * readable source (ctx.addon) and a packaging pass over the built XPI (shippedCtx.addon),
 * each carrying only the recheck consumers anchored to its corpus (opts.consumers) and its
 * own framing prompt (opts.promptId).
 * @param {RunContext} ctx
 * @param {Registry} registry
 * @param {{unused?: Set<string>, summaryAddon?: object, promptId?: string,
 *   consumers?: ?Set<string>}} [opts]  unused = files the review found unreachable;
 *   summaryAddon = the artifact to quote (defaults to the review target); promptId = the
 *   registry framing prompt; consumers = the recheck consumers this pass carries (all when
 *   unset).
 * @returns {?DeferredReview}
 */
export function buildAddonSummarizer(
  ctx,
  registry,
  {
    unused = new Set(),
    summaryAddon = ctx.addon,
    promptId = "add-on-summary",
    consumers,
  } = {}
) {
  if (!ctx?.llm) {
    return null;
  }
  const prompt = registry.prompt(promptId);
  if (!prompt) {
    return null;
  }
  const nonce = nonceFor(ctx);
  const text = buildAddonText(ctx, nonce, { unused, summaryAddon });
  if (!text) {
    return null;
  }
  // Items earlier checks handed to a post-summary recheck consumer (ctx.recheck):
  // the trusted RUBRICS join the system prompt; the untrusted ITEM lists are wrapped
  // into the user data. Restricted to this pass's consumers; empty when none carry items.
  const { rubric, items } = buildRecheckSections(
    ctx,
    registry,
    nonce,
    consumers
  );
  return deferredReview(ctx, {
    system: `${framing(nonce)}\n\n${prompt}${rubric ? `\n\n${rubric}` : ""}`,
    user: items ? `${text}\n\n${items}` : text,
  });
}

/** @typedef {import("../pipeline.js").GeneratedSummary} GeneratedSummary */

/**
 * Generate one advisory prose summary at the tail of the activity feed: narrate
 * `LLM: Generating <label> (<size>) ...` so the reviewer sees what is being
 * waited on, then run the deferred model call. Returns { bytes, text } (text
 * null on an LLM error), or undefined when there is nothing to summarize (no
 * token, no diff, ...). The caller prints the prose after the report.
 * @param {DeferredSummary|null} deferred
 * @param {string} label  Names the summary in the feed, e.g. "diff summary".
 * @param {import("../llm/budget.js").LlmBudget} [budget]  Run-wide request cap.
 * @returns {Promise<GeneratedSummary|undefined>}
 */
async function generateSummary(deferred, label, budget) {
  if (!deferred) {
    return undefined;
  }
  if (budget && !(await budget.consume())) {
    return undefined; // run-wide request cap reached
  }
  progress(
    `LLM: Generating ${label} (${humanSize(deferred.bytes)}) ...`,
    FEED.STEP
  );
  try {
    return { bytes: deferred.bytes, text: await deferred.run() };
  } catch (err) {
    // An advisory summary must never abort the review. Report the failure at
    // this step (visible without --verbose) and carry the reason to the report.
    const reason = llmErrorText(err);
    progress(red(`LLM: ${label} failed - ${reason}`), FEED.STEP);
    return { bytes: deferred.bytes, text: null, error: reason };
  }
}

/** The recheck verdicts from a summary pass that belong to `allowed` consumers. */
const keepVerdicts = (verdicts, allowed) =>
  (verdicts ?? []).filter((v) => v && allowed.has(v.check));

/**
 * Generate one --llm-review add-on review pass over a chosen corpus and return its
 * prose plus its recheck verdicts (resolveRecheckSummaries merges the verdicts onto
 * ctx.recheckVerdicts for the post-summary consumers). In SCA it runs twice - a
 * behavioral pass over the source and a packaging pass over the built XPI - each
 * carrying only its corpus's recheck consumers (opts.consumers) and its own framing
 * (opts.promptId). Undefined when there is nothing to summarize (no token / no prompt /
 * budget spent); `{ text: null, error }` on an LLM failure; otherwise `{ bytes, text,
 * verdicts }` where a defined `verdicts` (possibly empty) means the model returned a
 * review - the clean signal that analysis happened.
 * @param {RunContext} ctx
 * @param {Registry} registry
 * @param {import("../llm/budget.js").LlmBudget} [budget]  Run-wide request cap.
 * @param {{unused?: Set<string>, summaryAddon?: object, promptId?: string,
 *   consumers?: ?Set<string>, label?: string}} [opts]
 * @returns {Promise<(GeneratedSummary & {verdicts?: object[]})|undefined>}
 */
async function generateAddonSummary(ctx, registry, budget, opts = {}) {
  const { label = "add-on", ...summarizerOpts } = opts;
  const deferred = buildAddonSummarizer(ctx, registry, summarizerOpts);
  if (!deferred) {
    return undefined;
  }
  if (budget && !(await budget.consume())) {
    return undefined; // run-wide request cap reached
  }
  progress(
    `LLM: Generating ${label} summary (${humanSize(deferred.bytes)}) ...`,
    FEED.STEP
  );
  let review;
  try {
    review = await deferred.run();
  } catch (err) {
    const reason = llmErrorText(err);
    progress(red(`LLM: ${label} summary failed - ${reason}`), FEED.STEP);
    return { bytes: deferred.bytes, text: null, error: reason };
  }
  return {
    bytes: deferred.bytes,
    text: review?.summary ?? null,
    verdicts: review?.recheck,
  };
}

/**
 * The --llm-review summary interleave, run by the orchestrator (runChecks) between the
 * llm and post-summary phases: the add-on review that RE-JUDGES the recheck items handed
 * to it (ctx.recheck) - merging the verdicts onto ctx.recheckVerdicts for the post-summary
 * consumers that run next - plus the advisory diff summary. It runs after the checks because
 * it excludes files the review found unreachable (unused-files), a product of reachability
 * that exists only now. Inert without ctx.llm (and so for an invalid Experiment, which has
 * none). The prose results are printed after the report by src/cli.js.
 * @param {RunContext} ctx
 * @param {Registry} registry
 * @param {import("../llm/budget.js").LlmBudget} [budget]  Run-wide request cap.
 * @param {Record<string, RunContext>} siblings  Per-artifact contexts; siblings.xpi is the
 *   SHIPPED view (the packaging pass's corpus and the diff baseline comparison).
 * @param {object[]} findings  The issues so far (for the unused-files exclusion set).
 * @returns {Promise<{summarizeAddon: (GeneratedSummary|undefined),
 *   summarize: (GeneratedSummary|undefined)}>}
 */
export async function resolveRecheckSummaries(
  ctx,
  registry,
  budget,
  siblings,
  findings
) {
  const shippedCtx = siblings.xpi;
  let summarizeAddon;
  if (ctx.llm) {
    // unused-files runs over the built XPI (input: xpi), so its paths are the XPI's.
    const unusedFiles = new Set(
      findings.filter((f) => f.ruleId === "unused-files").map((f) => f.file)
    );
    if (ctx.mode?.sca) {
      // SCA: one summary per corpus. The behavioral pass over the readable SOURCE is the
      // displayed "Summary of add-on" and re-judges the source-anchored rechecks; the
      // packaging pass over the built XPI is recheck-only (its prose is discarded). Each
      // pass carries only its corpus's consumers, and its verdicts are filtered to those
      // consumers before they merge, so neither can resolve the other's items. The source
      // pass excludes no `unused` files - those XPI paths do not apply to the source corpus.
      const { source, xpi } = registry.recheckConsumersByCorpus();
      summarizeAddon = await generateAddonSummary(ctx, registry, budget, {
        summaryAddon: ctx.addon,
        consumers: source,
        label: "source",
      });
      const verdicts = [];
      let ran = false;
      if (summarizeAddon && !summarizeAddon.error) {
        ran = true;
        verdicts.push(...keepVerdicts(summarizeAddon.verdicts, source));
      }
      // The packaging pass runs only when an XPI-anchored recheck actually escalated -
      // otherwise it has nothing to judge over the (often near-empty) built corpus.
      const hasXpiItems = [...(ctx.recheck ?? new Map()).keys()].some((id) =>
        xpi.has(id)
      );
      if (hasXpiItems) {
        const packaging = await generateAddonSummary(ctx, registry, budget, {
          unused: unusedFiles,
          summaryAddon: shippedCtx.addon,
          consumers: xpi,
          promptId: "shipped-package-summary",
          label: "packaging",
        });
        if (packaging && !packaging.error) {
          ran = true;
          verdicts.push(...keepVerdicts(packaging.verdicts, xpi));
        }
      }
      if (ran) {
        ctx.recheckVerdicts = verdicts;
      }
    } else {
      // XPI review: one all-in-one summary over the single artifact (the review target),
      // carrying every recheck consumer.
      summarizeAddon = await generateAddonSummary(ctx, registry, budget, {
        unused: unusedFiles,
        summaryAddon: ctx.addon,
      });
      if (summarizeAddon && !summarizeAddon.error) {
        ctx.recheckVerdicts = summarizeAddon.verdicts;
      }
    }
  }
  let summarize;
  // ctx.previous is the loaded --diff-to baseline (null without it).
  if (ctx.llm && ctx.previous) {
    summarize = await generateSummary(
      buildSummarizer(ctx, registry, shippedCtx),
      "diff summary",
      budget
    );
  }
  return { summarizeAddon, summarize };
}
