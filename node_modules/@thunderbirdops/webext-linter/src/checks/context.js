// Builds the RunContext every check runs against. The checks layer owns its own
// context: deriving ctx.apiUsages from the sources the pipeline already parsed,
// loading the --diff-to baseline, attaching the LLM client when a token is set,
// and swapping the artifact-specific fields for the sibling contexts. The
// pipeline (pipeline.js) resolves the schema, parses the sources, and hands
// everything in.
//
// Belongs here: the one-time assembly of the shared per-review ctx -
// orchestrating addon/sources.js, addon/load.js and llm-client.js into the
// RunContext shape that registry.js documents.
//
// Does NOT belong here: PARSING. The extraction pass (src/checks/extract.js)
// parses each source once, up front, and its results arrive as
// preParsedJsSources - this module never reaches for an AST. Nor any individual
// review logic - that lives in a rule under src/checks/rules/*. The RunContext
// type and runChecks live in src/checks/registry.js. The verdict-to-outcome
// decision is escalation.js, the LLM transport is src/checks/llm-client.js, and
// shared analysis helpers belong in src/lib/*.

import { loadAddon } from "../addon/load.js";
import { REVIEW_MODE } from "../lib/enum.js";
import { apiUsageOf } from "./extract.js";
import { createLlmClient } from "./llm-client.js";

/** @typedef {import("./registry.js").RunContext} RunContext */

/**
 * The check-facing artifact: the routed add-on projected to only its INTRINSIC data - the
 * fields a check legitimately reads off ctx.addon. An ALLOWLIST, not a strip: a field not
 * named here CANNOT reach a check, so a new Addon field can never leak onto the check surface
 * by omission (a blocklist would leak until someone remembered to delete it - which is how
 * buildFiles once exposed the SCA build tree to input:source checks). If this list is ever
 * INCOMPLETE, a check reads undefined and the tests fail loudly - the safe failure direction.
 *
 * `files` is copied BY REFERENCE: buildShippedCtx detects the single-artifact XPI case by
 * `ctx.addon.files === xpiAddon.files`. `vendor`/`bundled` are the pipeline's pre-computed,
 * reconciled classification (the lazy fallbacks would recompute a less-complete one).
 * `nodeModules`/`archives`/`buildReview` serve the SCA build corpus (reviewView also projects
 * addon.buildFiles for the input:build checks); they are undefined on the review/manifest
 * routes, which is harmless. The lazy caches (locales/evalScan/outboundSinks/
 * permissionAnalysis/apiResolution, and the bundled fallback) attach themselves on demand via
 * `ctx.addon.X ??= …`, so they need no seeding.
 *
 * DELIBERATELY ABSENT: manifest/manifestError/manifestLoc and experiments are
 * shipped-authoritative and exposed as ctx.manifest / ctx.experiments (so a check cannot read
 * one artifact's manifest against another's files); buildFiles is the wrong artifact for a
 * review check; source/kind/skipped are read by no check.
 * @param {import("../addon/load.js").Addon} addon  The routed add-on (or the build corpus).
 * @returns {object} The intrinsic-only view.
 */
function reviewView(addon) {
  return {
    files: addon.files,
    vendor: addon.vendor,
    bundled: addon.bundled,
    nodeModules: addon.nodeModules,
    archives: addon.archives,
    buildReview: addon.buildReview,
  };
}

/**
 * Assemble the shared RunContext for one review.
 * @param {object} params
 * @param {import("../addon/load.js").Addon} params.addon
 * @param {import("../schema/index.js").SchemaIndex} params.schema
 * @param {{allowExperiments?: boolean,
 *   libraryHashes?: Map<string, {name: string, version: string}>}} params.options
 *   The ONLY run options a check reads (experiment-not-allowed, bundled). The LLM
 *   credentials are deliberately NOT here - they are params below, so the secret token never
 *   sits on the check-facing ctx; a check reaches the model only through the sanctioned
 *   ctx.llm.
 * @param {string} [params.diffTo]  Path of the previously published version,
 *   loaded as the diff baseline for the diff checks (run only with --diff-to).
 * @param {string} [params.llmModel]  Model override for the LLM client.
 * @param {string} [params.llmApiKey]  Provider token, for constructing ctx.llm only.
 * @param {string} [params.llmApiType]  Provider type, for constructing ctx.llm only.
 * @param {string} [params.llmApiUrl]  Provider base URL, for constructing ctx.llm only.
 * @param {{callVerdicts?: Function, callText?: Function, callReview?: Function}}
 *   [params.llmTransport]  Injectable model transports for the client (else the provider's
 *   own - see createLlmClient). A test seam, like the pipeline's vendorNet: the offline
 *   test harness passes deterministic fakes; production never sets it.
 * @param {string} [params.systemIntro]  The registry-owned reviewer system
 *   prompt (prompts.system-intro), passed to the LLM client when a token is set.
 * @param {boolean} [params.llmVerified]  runPipeline asked --llm-review, PROVED the
 *   config can serve a model, and confirmed this is not a rejected Experiment. The sole
 *   gate on ctx.llm: this assembler never re-derives that decision. Downstream, ctx.llm
 *   itself is the answer ("a verified client exists").
 * @param {boolean} [params.invalidExperiment]  The add-on is an Experiment and
 *   --allow-experiments is off: the review short-circuits to the reject check. Read by
 *   runChecks to pick the phase; it does NOT gate the LLM here (llmVerified already has).
 * @param {import("../llm/budget.js").LlmBudget} [params.budget]  Run-wide model
 *   request cap, shared with the rest of the run (see runPipeline).
 * @param {import("../addon/sources.js").JsSource[]} [params.preParsedJsSources]
 *   The review target's sources, ALREADY through the extraction pass - this
 *   assembler does not parse. REQUIRED for a reviewable add-on: absent, it THROWS,
 *   because silently reviewing an empty corpus would report a clean add-on whose code
 *   was never read. May only be absent for a rejected Experiment (invalidExperiment),
 *   whose one check reads no code.
 * @returns {RunContext}
 */
export function buildRunContext({
  addon,
  xpiAddon = addon,
  schema,
  options,
  diffTo,
  llmModel,
  llmApiKey,
  llmApiType,
  llmApiUrl,
  llmTransport,
  systemIntro,
  llmVerified,
  invalidExperiment,
  mode = REVIEW_MODE.XPI,
  scaExpSource,
  scaNotRequired,
  budget,
  preParsedJsSources,
}) {
  const shippedManifest = xpiAddon?.manifest ?? null;

  // The ctx every review shares, with an EMPTY code corpus. A rejected Experiment reviews with
  // exactly this: its single check judges from the manifest, the experiment classification and
  // the schema, reading no code and calling no model. The block below fills in the corpus and
  // the model client, and a rejected Experiment bypasses it wholesale.
  /** @type {RunContext} */
  const ctx = {
    // The check-facing artifact is the routed add-on's INTRINSIC view (reviewView):
    // files + self-healing derivations, with the manifest and experiments stripped
    // so they can only be read through the shipped-authoritative ctx fields below.
    addon: reviewView(addon),
    schema,
    // Filled in below for a reviewable add-on; stays empty for a rejected Experiment.
    jsSources: [],
    apiUsages: [],
    options,
    previous: diffTo ? loadAddon(diffTo) : null,
    invalidExperiment,
    // "xpi" (default - reviewing a built add-on) or "sca" (a source code
    // archive review, triggered by --sca-root). Gates checks via scaEligible.
    mode,
    // SCA mode: the Experiment folder as a source-relative path (runPipeline re-based
    // it from the scaRoot-relative --sca-exp-source flag). buildReachability excludes
    // it from the pure-WebExtension set, so the WebExtension code checks skip
    // privileged Experiment code. Undefined in XPI mode.
    scaExpSource,
    // A submitted SCA was downgraded to this XPI review because the shipped XPI is
    // directly reviewable (not minified/obfuscated); the sca-not-required check reads
    // this to report the redundant source submission. False in a normal review.
    scaNotRequired,
    // The authoritative manifest is the SHIPPED artifact's (the built XPI) - what
    // Thunderbird actually loads. It is explicit shared context, like `schema`, so
    // the manifest / permission / API checks read it - there is no ctx.addon.manifest
    // (reviewView strips it), which in SCA would be the readable source's pre-build
    // template. In XPI mode xpiAddon IS addon. See the RunContext typedef.
    manifest: shippedManifest,
    manifestError: xpiAddon?.manifestError ?? null,
    manifestLoc: xpiAddon?.manifestLoc ?? null,
    manifestText: xpiAddon?.manifestText ?? "",
    // The Experiment classification (verifyExperiments, computed from the shipped
    // XPI and attached to the review addon by the pipeline). Shipped-authoritative
    // and shared like the manifest, so the experiment checks read ctx.experiments,
    // not ctx.addon.experiments (which reviewView strips). Null for non-Experiments.
    experiments: addon?.experiments ?? null,
  };

  // Everything from here serves a REVIEWABLE add-on. A rejected Experiment bypasses it whole:
  // it reads no code (so it needs no corpus) and calls no model (so it needs no client), and it
  // reviews with the empty ctx above.
  if (!invalidExperiment) {
    // The sources MUST arrive already parsed. This assembler NEVER parses: the pipeline's
    // extraction pass (src/checks/extract.js) parses each source ONCE, extracts every per-file
    // result the checks need, and DROPS the AST - so peak memory is a single AST no matter how
    // much code the add-on ships, and the checks read a precomputed summary. It hands the
    // results over as preParsedJsSources. (The SCA shipped view is a distinct artifact, parsed
    // by its own runShippedExtractionPass in Phase 3; nothing here re-parses.)
    //
    // So their ABSENCE is a wiring bug, and it must be loud. Defaulting to the empty corpus
    // would mean "this add-on has no code": every code check would pass vacuously and the
    // review would report a CLEAN add-on whose JavaScript it never read - exit 1, no crash, no
    // warning. Only the rejected Experiment bypassing this block may have no sources.
    if (!preParsedJsSources) {
      throw new Error(
        "buildRunContext: a reviewable add-on arrived with no parsed sources " +
          "(the extraction pass must run and hand them over as preParsedJsSources)"
      );
    }
    ctx.jsSources = preParsedJsSources;
    ctx.apiUsages = ctx.jsSources.map((src) => ({
      file: src.file,
      inline: src.inline,
      ...apiUsageOf(src),
    }));

    // Attach the LLM client iff the pipeline verified one (llmVerified: --llm-review was asked
    // for and its config was proven usable - runPipeline settles that question once). This
    // assembler does not re-open it.
    //
    // ctx.llm IS the answer from here on: present means "a verified model client, safe to
    // call". The llm-phase rule modules evaluate their criterion through it; absent, they
    // escalate to manual review and the tool stays deterministic and offline. Every consumer
    // tests ctx.llm - none reconstructs the decision from --llm-review and invalidExperiment.
    if (llmVerified) {
      ctx.llm = createLlmClient({
        ctx,
        token: llmApiKey,
        systemIntro,
        type: llmApiType,
        model: llmModel,
        url: llmApiUrl,
        budget,
        // Injectable transports (else the provider's own). Undefined in production, so
        // createLlmClient falls back to the real provider; the offline test harness
        // sets them to deterministic fakes.
        callVerdicts: llmTransport?.callVerdicts,
        callText: llmTransport?.callText,
        callReview: llmTransport?.callReview,
      });
    }
  }
  return ctx;
}

/**
 * A sibling of a review context whose `addon` / `jsSources` are the SHIPPED
 * artifact's (the built XPI), for the `input: xpi` structure checks (bundled-files,
 * minimize-web-accessible-resources, ...), the diff summary, and - in SCA - the packaging
 * summary, which describe what actually ships. (The behavioral --llm-review describes the
 * review target: the source in SCA.) The orchestrator (registry.js runChecks / pipeline)
 * builds this once and routes it to those consumers; every other field is shared with
 * the review context, and `apiUsages` (per-source, source-only) is dropped so the
 * shipped view never carries the source's. It REQUIRES the built XPI as an argument,
 * so there is no way to derive the shipped artifact from a check's context alone.
 *
 * When the built XPI IS the review target (an XPI review), there is one artifact and
 * this returns ctx unchanged - so callers route unconditionally through it.
 * @param {RunContext} ctx  The review context (ctx.addon = the review target).
 * @param {import("../addon/load.js").Addon} xpiAddon  The built XPI.
 * @param {import("../addon/sources.js").JsSource[]} [shippedJsSources]  The XPI's sources,
 *   ALREADY through the shipped extraction pass (the pipeline runs it in the SCA tail).
 *   Required whenever the XPI is a SECOND artifact: its `input: xpi` checks read the load
 *   graph off these, and a check never parses. Not needed when the XPI IS the review target,
 *   where this returns ctx unchanged and its sources are the ones already parsed.
 * @returns {RunContext}
 */
export function buildShippedCtx(ctx, xpiAddon, shippedJsSources) {
  // ctx.addon is a reviewView (a shallow copy), so it is never === xpiAddon even in
  // XPI mode; the files Map, however, is copied by reference, so an identical files
  // Map means the review target IS the built XPI (one artifact) - return ctx unchanged.
  if (ctx.addon.files === xpiAddon.files) {
    return ctx;
  }
  if (!shippedJsSources) {
    throw new Error(
      "buildShippedCtx: the built XPI is a second artifact here, and its sources have not " +
        "been through the extraction pass - its input:xpi checks would have to parse it"
    );
  }
  return {
    ...ctx,
    addon: reviewView(xpiAddon),
    jsSources: shippedJsSources,
    apiUsages: undefined,
    // Marks the shipped view for reachability: the built XPI's manifest entry points
    // resolve against its OWN files, so pureWebExtensionReachable takes the closure
    // branch - not the SCA "all readable-source files" fallback, which exists only
    // for the review source, whose pre-build layout the manifest's built paths miss.
    isShippedView: true,
  };
}

/**
 * A sibling review context whose `addon` is the SCA BUILD files - the tooling that
 * builds the add-on (scripts, configs, package.json/lock: everything in --sca-root
 * outside the review source, with node_modules and dotfiles excluded, from
 * selectScaBuildFiles; in a flat layout, where the review source IS the root, the whole
 * root, narrowed by selectBuildCorpus's package.json trace), plus the setup build
 * classification (buildReview) and the
 * recorded archives/nodeModules. The `input: build` checks are routed here, so each reads
 * off ctx.addon like any other check reads its artifact - keeping artifact selection the
 * single `input` seam, no separate ctx field. SCA mode only.
 * The build corpus is projected through reviewView (like every other ctx.addon), so a
 * build check can never read ctx.addon.manifest/experiments against another artifact's
 * files; the shipped manifest stays on ctx.manifest for the shared LLM framing.
 * @param {RunContext} ctx  The review context.
 * @param {{files: Map<string, Buffer>, nodeModules?: string[], archives?: string[]}}
 *   buildAddon  The build-file corpus (nodeModules / archives ride along, via reviewView's
 *   spread, for the committed-node-modules / committed-build-artifact checks).
 * @returns {RunContext}
 */
export function buildScaBuildCtx(ctx, buildAddon) {
  return buildCorpusCtx(ctx, buildAddon);
}

/**
 * A sibling review context with NO file corpus - `addon` is an empty reviewView, so
 * `ctx.addon.files` is empty and its lazy caches derive from nothing. The shipped
 * manifest / schema / manifestLoc are inherited from `ctx` (they are shipped-authoritative
 * and read from the XPI regardless of the files map). The `input: manifest` checks are
 * routed here: they read ONLY the shipped manifest, and there is no artifact's files for
 * them to reach - ctx.addon.files is empty, so a stray file lookup finds nothing rather
 * than another artifact's bytes. Not mode-gated - the shipped manifest exists in both
 * XPI and SCA reviews.
 * @param {RunContext} ctx  The review context.
 * @returns {RunContext}
 */
export function buildManifestCtx(ctx) {
  return buildCorpusCtx(ctx, { files: new Map() });
}

/**
 * A sibling review context over an arbitrary CORPUS: `addon` is that corpus projected
 * through reviewView (so no artifact's manifest/experiments leak against another's
 * files), with the source-only `jsSources`/`apiUsages` emptied; the shipped manifest /
 * schema stay on `ctx`. Shared by buildScaBuildCtx (the SCA build files) and
 * buildManifestCtx (an empty corpus) - the two sibling ctxs that differ only in the
 * corpus they carry (buildShippedCtx differs: a real corpus with re-collected sources).
 * @param {RunContext} ctx
 * @param {{files: Map<string, Buffer>, nodeModules?: string[], archives?: string[]}} corpusAddon
 * @returns {RunContext}
 */
function buildCorpusCtx(ctx, corpusAddon) {
  return {
    ...ctx,
    addon: reviewView(corpusAddon),
    jsSources: [],
    apiUsages: undefined,
  };
}
