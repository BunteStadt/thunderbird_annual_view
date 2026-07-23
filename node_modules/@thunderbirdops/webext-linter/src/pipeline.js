// The review pipeline: opts in, a structured Review out. This is the tool's
// core, independent of the CLI front-end (cli.js) - the test harness drives it
// directly. It loads the add-on, resolves and verifies its vendored
// declarations, classifies bundled code, runs the schema review, and fills each
// finding's display text from the registry. It returns the Review. Formatting
// and I/O are the front-end's job. The tool is read-only: it never modifies or
// repacks the submission.
//
// Belongs here: the stage orchestration (runPipeline) and the
// pipeline-level schema-selection helpers (resolveReviewSchema,
// selectSchemaChannel, detectManifestVersion).
//
// Does NOT belong here: the cache/model defaults and behavior toggles -
// src/config.js. The schema channel set + branch names - src/schema/fetch.js.
// Argv parse, validation, and printing (src/cli.js and
// src/report/format.js); each stage's own work - add-on load
// (src/addon/load.js), vendor resolution/verification (src/vendor/*), schema
// fetch/load/index (src/schema/*), check orchestration and run context
// (src/checks/registry.js and src/checks/context.js), and all user-facing text
// (src/checks/registry.js plus src/report/responses.js).

import {
  resolveSchemaZip,
  refreshAllSchemas,
  hasAllCachedSchemas,
  cachedZipPath,
  schemaBranch as branchName,
  SCHEMA_CHANNELS,
} from "./schema/fetch.js";
import { loadSchemaFiles, peekApplicationVersion } from "./schema/load.js";
import { buildSchemaIndex } from "./schema/index.js";
import { REVIEW_MODE } from "./lib/enum.js";
import {
  loadSchemaAnnotations,
  applySchemaAnnotations,
} from "./schema/annotate.js";
import {
  loadAddon,
  loadScaAddon,
  selectScaBuildFiles,
  scaExpSourceRelative,
} from "./addon/load.js";
import { runChecks, loadRegistry } from "./checks/registry.js";
import { analyzeBuild } from "./build/analyze.js";
import {
  buildRunContext,
  buildShippedCtx,
  buildScaBuildCtx,
  buildManifestCtx,
} from "./checks/context.js";
import { renderFindings, renderManualItems } from "./report/responses.js";
import { headerLines } from "./report/format.js";
import { resolveVendor } from "./vendor/resolve.js";
import {
  verifyVendor,
  verifyScaDependencies,
  auditIdentifiedLibraries,
} from "./vendor/verify.js";
import { validateLlmConfig, checkModelAvailable } from "./llm/provider.js";
import {
  classifyFiles,
  classifyBundled,
  assembleBundled,
  applyNotPopularVendor,
  hasUnreviewableCode,
} from "./lib/bundled.js";
import { collectJsSources } from "./addon/sources.js";
import {
  runExtractionPass,
  runShippedExtractionPass,
} from "./checks/extract.js";
import { resolveCdnLibraries } from "./lib/cdn-lookup.js";
import {
  resolveLibraryHashes,
  parseLibraryHashes,
} from "./lib/library-hashes.js";
import {
  resolveLibraryBlocks,
  parseLibraryBlocks,
} from "./lib/library-blocks.js";
import { isExperiment, parseVersion, strictMaxVersion } from "./lib/util.js";
import { experimentApiNamespaces } from "./lib/experiments.js";
import { verifyExperiments } from "./experiments/verify.js";
import { createLlmBudget } from "./llm/budget.js";
import { modelSettings } from "./llm/settings.js";
import { debug, progress, warn, FEED } from "./util/log.js";
import { DEFAULT_CACHE } from "./config.js";

/** @typedef {import("./report/finding.js").Finding} Finding */
/** @typedef {import("./report/format.js").ReviewMeta} ReviewMeta */
/**
 * An advisory summary already generated during the activity feed: the
 * transmitted byte size and the model's prose (null if the call failed), plus a
 * one-line `error` reason when it failed (shown in the report's summary
 * section). The caller prints the prose after the report.
 * @typedef {{bytes: number, text: ?string, error?: string}} GeneratedSummary
 */

/**
 * @typedef {object} PipelineOpts
 * @property {string} addonPath
 * @property {string} [schemaCache]
 * @property {string} [experimentsCache]  Where to cache the fetched experiments
 *   zip.
 * @property {string[]} [checksOnly]
 * @property {string[]} [checksSkip]
 * @property {boolean} [eslint]  Run the opt-in ESLint code-sanity check (off by
 *   default); when unset, the code-sanity check is skipped entirely.
 * @property {boolean} [allowExperiments]
 * @property {string} [scaRoot]  SCA mode: path to the source
 *   archive root (folder or zip) holding package.json/lock. Setting it switches the
 *   review to SCA mode - the readable source (scaSource) is reviewed and its declared
 *   dependencies are audited; the positional XPI is the shipped artifact against which
 *   the manifest, experiments, file-completeness (`input: xpi`) checks, the --diff-to
 *   comparison, and the packaging summary all run (a separate shipped context the
 *   orchestrator routes them to - see buildShippedCtx in src/checks/context.js). The
 *   behavioral --llm-review reviews the readable source instead.
 * @property {string} [scaSource]  The add-on code root, relative to scaRoot or an
 *   absolute path (e.g. "src" or "addon"). Optional; defaults to "." (the whole scaRoot
 *   reviewed as the source - a flat layout with manifest.json at the root).
 * @property {string} [scaExpSource]  SCA mode: the Experiment implementation folder,
 *   relative to scaRoot (or absolute) and within scaSource (e.g. "addon/experiment-api");
 *   runPipeline re-bases it to a source-relative ctx.scaExpSource. Its privileged, non-WebExtension
 *   files are excluded from the WebExtension code checks (which review all of the
 *   readable source, having no reachability tree there). Optional in general, but
 *   REQUIRED when allowExperiments is set in SCA mode (the CLI enforces this) -
 *   without it, Experiment code cannot be told apart from WebExtension code.
 * @property {string} [libraryHashesCache]  Where to cache the fetched hashes.
 * @property {boolean} [cdnLookup]  Identify an unrecognized bundled library (minified,
 *   or a large readable file) by a jsDelivr content-hash lookup (on by default;
 *   --cdn-lib-lookup false disables). Set false to skip the per-file CDN request
 *   (offline/privacy).
 * @property {string} [cdnLookupCache]  Where to cache the CDN hash-lookup results.
 * @property {string} [diffTo]  Path to the previous published version.
 * @property {boolean} [llmReview]  The sole LLM on-switch (--llm-review).
 * @property {string} [llmApiKey]  Real API key, or undefined (a keyless
 *   provider).
 * @property {string} [llmModel]
 * @property {string} [llmApiUrl]  Override the LLM API base URL (LLM_API_URL).
 * @property {string} [llmApiType]  LLM_API_TYPE (claude | chatgpt | ollama).
 * @property {import("./vendor/verify.js").VendorNet} [vendorNet]  Injectable
 *   network transport for vendor verification (the test harness injects an
 *   offline one); defaults to the real fetch.
 * @property {{callVerdicts?: Function, callText?: Function, callReview?: Function}}
 *   [llmTransport]  Injectable model transports (else the provider's own), threaded to
 *   the review client and the setup-time model calls (resolveVendor / verifyVendor /
 *   analyzeBuild). The LLM counterpart of vendorNet: the offline test harness injects
 *   deterministic fakes so an --llm-review run makes no network request; production
 *   never sets it, so every site defaults to the real provider.
 * @property {import("./addon/load.js").Addon} [addon]  Pre-loaded add-on (the
 *   test harness injects one to drop its expected.json sidecar).
 * @property {import("./checks/registry.js").Registry} [registry]  Parsed
 *   registry threaded from the caller, parsed once here otherwise.
 * @property {(used: number, step: number) => boolean | Promise<boolean>}
 *   [confirmMore]  Asked when the run hits the LLM request cap (the model's
 *   `maxRequests` in assets/llm): truthy runs that many more, falsy stops. The CLI
 *   supplies an interactive prompt only at a terminal. Omitted means hard-stop at
 *   the cap (see src/llm/budget.js).
 */

/**
 * @typedef {object} PipelineResult
 * @property {Finding[]} findings
 * @property {ReviewMeta} meta
 * @property {Record<string, string>} [issueHeadings]
 * @property {Record<string, string>} [verdictIntros]
 * @property {GeneratedSummary} [summarize]
 * @property {GeneratedSummary} [summarizeAddon]
 * @property {{check: string, label: string, file: ?string, line: ?number,
 *   subject: ?string, verdict: import("./lib/enum.js").Verdict, content: ?string}[]} [recheckVerdictRows]  The
 *   per-site recheck rows shown under the add-on summary in the text report.
 */

/**
 * Run the review pipeline and return the structured result.
 *
 * @param {PipelineOpts} opts
 * @returns {Promise<PipelineResult>}
 */
export async function runPipeline(opts) {
  const { addonPath } = opts;
  // SCA (source code archive) mode is on when --sca-root is set (--sca-source is
  // optional, defaulting to "."). It splits the review across TWO add-on artifacts
  // with a fixed ROLE each, resolved here ONCE so nothing downstream re-branches on the mode:
  //
  //   xpiAddon - the built XPI (the positional addonPath). The SHIPPED artifact,
  //     authoritative in BOTH modes for the manifest, the experiments, and the
  //     behavioral LLM summary (what actually runs on a user's machine).
  //   addon    - the deterministic review target (becomes ctx.addon): the readable
  //     code the source-level checks scan. In XPI mode it simply IS xpiAddon; in
  //     SCA mode it is the readable source at scaSource - a synthetic addon whose
  //     files are the source but whose manifest is the XPI's (loadScaAddon), so the
  //     checks stay mode-agnostic.
  //
  // So downstream: read `addon` for the code under review, `xpiAddon` for the
  // shipped artifact - no further mode checks. The only other mode forks are the
  // dependency resolution (--sca-root vs the XPI's VENDOR/package.json) and the
  // check gate (ctx.mode -> scaEligible). Minified code is non-authored (and rejected)
  // in both modes: a source-code submission's promise is readable source, so a minified
  // file in --sca-source is rejected like one in an XPI, not scanned as authored.
  // --sca-source may name a nested subfolder OR the archive root itself (a flat
  // layout: manifest.json at the root, with the build tooling intermingled). The root
  // case (scaRootRelative resolves ".", an absolute root, or a literal match all to "")
  // is handled throughout: loadScaAddon reviews every file, and selectScaBuildFiles still
  // traces the build off the root package.json (there is no source subtree to exclude).
  // --sca-root alone switches to SCA mode; --sca-source is optional and defaults to "."
  // (the whole root reviewed as the source - the common flat-layout case).
  //
  // `preliminaryMode` sizes the Setup feed only (the counter is fixed before the first
  // step). The EFFECTIVE mode is resolved below (resolveReviewMode) once the XPI is
  // classified: a false SCA - one whose shipped XPI is directly reviewable - downgrades to
  // a plain XPI review. Everything mode-dependent (the source load, scaSource, scaExpSource,
  // meta) is then DERIVED from the resolved mode, so nothing is mutated/patched afterward.
  const preliminaryMode = opts.scaRoot ? "sca" : "xpi";
  // The parsed registry, threaded from main() (or loaded once here when a caller
  // such as the test harness invokes the pipeline directly).
  const registry = opts.registry ?? loadRegistry();

  // 1. Load the .xpi archive (a fast in-memory unzip). Read before the "Setup" banner
  // because it sizes the feed - it gives the mode and whether the add-on is an
  // Experiment. Every slow NETWORK step below (the experiment fetch, schema fetch, vendor
  // verification, CDN lookups) plus the AST parse is narrated as a Setup step. The add-on
  // reads are fast local unzips (this .xpi, and in a kept SCA the source archive loaded in
  // Phase 2) marked by the "Reading add-on" step. A caller may inject a pre-loaded XPI
  // add-on (the test harness does, to drop its expected.json).
  const xpiAddon = opts.addon ?? loadAddon(addonPath);
  const isExp = isExperiment(xpiAddon.manifest);

  // The "Setup" feed: one numbered [i/total] line per slow pre-review step, matching
  // the Activity check loop, so the otherwise-silent pre-review pause shows what is
  // running (a no-op when progress is off - JSON, the golden harness). The total is
  // sized from what the fast .xpi read already gives us: mode (SCA skips the XPI-only
  // CDN + identified-library-audit steps, so is shorter), --llm-review, and whether
  // it is an Experiment (which adds a classification step). Exact for every path EXCEPT
  // a REJECTED Experiment (an experiment add-on run WITHOUT --allow-experiments whose
  // bundled draft is unrecognised): it skips the whole vendor block, so its counter
  // stops MID-count (e.g. [4/8]) rather than completing. Sizing the total for that short
  // path would need `invalidExperiment`, known only AFTER the narrated experiment fetch
  // - i.e. a second classification pass before the banner, which we deliberately avoid;
  // the accepted path (the reviewer's --allow-experiments flow) is exact. A false SCA that
  // is downgraded to an XPI review (below) likewise under-runs the SCA-sized total by the
  // few SCA-only steps it then skips - the same accepted inexactness, no re-sizing.
  const setupTotal =
    (preliminaryMode === "sca" ? 11 : 7) +
    (opts.llmReview ? 1 : 0) +
    (isExp ? 1 : 0);
  let setupDone = 0;
  /**
   * Emit the next numbered "Setup" feed line.
   * @param {string} label  Names the step shown after the [done/total] counter.
   */
  const setupStep = (label) =>
    progress(`[${++setupDone}/${setupTotal}] ${label}`, FEED.STEP);
  progress("── Setup ──");
  progress("");

  // 1a. Mark the start of the review. The .xpi was already read pre-banner (above); the SCA
  // source archive is loaded later, in Phase 2, and ONLY when the effective mode stays SCA -
  // a downgraded false SCA never reads it. The review target (`addon`) and the derived
  // `scaSource`/`scaExpSource` are set there, from the resolved mode. Narrate the .xpi
  // loader's skip notices (a non-node_modules symlink, an unsafe archive path) here; the
  // source loader's notices are narrated in Phase 2.
  setupStep("Reading add-on");
  for (const notice of xpiAddon.skipped ?? []) {
    warn(notice);
  }
  // Resolved in Phase 2 from the effective mode (below).
  let addon;
  let scaArchive;
  let scaSource;
  let scaExpSource;

  // 1b. The review schema: fetched, annotated, indexed. It is resolved from the SHIPPED
  // XPI's manifest alone (manifest_version + strict_max_version pick the channel), so it
  // depends on neither the Experiment classification nor the review mode - which is why it
  // runs before both, as the one piece of setup EVERY path needs. The extraction pass reads
  // its web_api / loader signatures and the review runs against it; a rejected Experiment
  // needs it too - the reject check resolves Experiment API paths through it (to spot one
  // shadowing a built-in) and meta reads schema.applicationVersion.
  const {
    zipPath: schemaZipPath,
    source: schemaSource,
    branch: schemaBranch,
    channel: schemaChannel,
  } = await resolveReviewSchema({
    cacheDir: opts.schemaCache ?? DEFAULT_CACHE,
    manifest: xpiAddon.manifest,
    setupStep,
  });
  const schemaFiles = loadSchemaFiles(schemaZipPath);
  applySchemaAnnotations(schemaFiles.files, loadSchemaAnnotations());
  const schema = buildSchemaIndex(schemaFiles);

  // Classify every Experiment add-on against the upstream drafts
  // (github.com/thunderbird/webext-experiments), regardless of
  // --allow-experiments: a bundled experiment whose name matches a known draft
  // MUST be the unmodified upstream copy, which experiment-modified enforces.
  // verifyExperiments fetches the allow-list only when a group actually bundles
  // files (a bare experiment_apis declaration stays offline -> unsupported), and
  // a fetch failure throws so the run hard-exits (2) rather than letting a
  // missing allow-list masquerade as a verdict - we cannot verify identity
  // without it.
  //
  // The flag governs only rejection, not classification. Without
  // --allow-experiments an Experiment add-on is rejected outright (the review
  // short-circuits to the single experiment-not-allowed check, no other checks,
  // no LLM, no manual reminders, and the vendor pre-processing below is skipped)
  // UNLESS every bundled experiment is a recognised upstream draft - a
  // recognised-but-modified one does NOT abort, so the full review runs and
  // experiment-modified flags it. With --allow-experiments the reviewer accepts
  // them, so the full review always runs.
  // Experiments are reviewed from the XPI (its shipped-artifact role; xpiAddon ===
  // addon in XPI mode). They are privileged, non-bundled, readable code, and the
  // manifest's experiment paths resolve against the XPI's own files (no
  // source-layout mismatch). The classification is the XPI's, so it is stored on
  // xpiAddon here (its bundled classification seeds the trusted experiment files) and
  // mirrored onto the review addon in Phase 2 (the experiment checks read
  // ctx.experiments from it); in XPI mode the two are one addon.
  let invalidExperiment = false;
  if (isExp) {
    // The upstream-drafts allow-list fetch (network) - narrated, since it is one of
    // the slow pre-review steps; it stays silent+offline for a bare experiment_apis
    // declaration that bundles nothing.
    setupStep("Verifying bundled experiments");
    xpiAddon.experiments = await verifyExperiments(xpiAddon, opts);
    invalidExperiment =
      !opts.allowExperiments &&
      xpiAddon.experiments.groups.some((g) => g.status === "unsupported");
  }

  const findings = [];

  // Run-wide model-request cap, shared by every LLM site this run: the vendor parse,
  // the LLM checks (each candidate batch is one request), and the summaries. Built
  // by the LLM pre-flight below, from the chosen model's own `maxRequests`
  // (assets/llm) - a slower or dearer model is worth fewer calls. It stays null for
  // a run that calls no model, and every site that consumes it is reached only when
  // the model IS called (`enabled: llmVerified` / `ctx.llm`), so a null one is never
  // consumed rather than quietly permitting requests. See src/llm/budget.js.
  let llmBudget = null;

  // The review target: the SHIPPED XPI unless an SCA survives the downgrade below. Pinned to
  // `xpi` for a rejected Experiment, whose rejection is decided entirely from the shipped XPI's
  // bundled experiments - reviewing the readable source would be pointless, so Phase 2 never
  // reads the source archive at all.
  let mode = REVIEW_MODE.XPI;
  // Set below when a submitted SCA is downgraded to a plain XPI review because the shipped XPI
  // is directly reviewable. Read by the sca-not-required check via ctx.
  let scaNotRequired = false;
  // The known-library hash DB the bundled classifier matches files against. An empty Map
  // recognizes nothing.
  let libraryHashes = new Map();
  // The parse-first review sources: extractReview (Phase 3) runs the extraction pass and
  // returns them for Phase 4 to hand to buildRunContext, which never parses for itself.
  // Stays unset for a rejected Experiment (Phase 3 is skipped), whose one check reads no code -
  // so it reviews with an empty ctx.jsSources.
  let preParsedJsSources;
  // The SHIPPED XPI's sources, parsed as a LOAD GRAPH in the SCA tail below. Only SCA needs
  // them: in an XPI review the built add-on IS the review target, so buildShippedCtx returns
  // the review ctx unchanged and its already-parsed sources with it.
  let shippedJsSources;
  // The XPI's Experiment API namespaces (null for a non-Experiment). Computed ONCE when
  // registered below, then reused by the shipped extraction pass - it reads/parses each bundled
  // experiment schema.json, so it is not free to recompute.
  let xpiExperimentNamespaces = null;
  // MAY THIS RUN CALL THE MODEL? Asked exactly once, here, because this is the only place that
  // can answer it: --llm-review requests the model, the pre-flight below proves the config can
  // actually serve one, and a rejected Experiment calls none at all (this is set inside that
  // gate). Phase 4 turns it into ctx.llm - the verified client - and everything downstream reads
  // THAT. Nothing re-derives the answer from --llm-review and invalidExperiment again.
  let llmVerified = false;

  // The rest of setup serves a REVIEWABLE add-on, and is skipped WHOLESALE for a rejected
  // Experiment: it runs only the invalid-experiment phase against the shipped XPI - no model
  // call, no libraries to recognize, no mode to resolve - so none of this would be read.
  if (!invalidExperiment) {
    // The LLM pre-flight: shown in the Setup feed with the chosen type + model, and a HARD FAIL
    // on a bad config - a review that WILL call the model must not get halfway in and then
    // discover the token is wrong. A throw here is surfaced by main()'s catch as a stderr
    // message + exit 2. It sits inside the gate because a rejected Experiment calls no model
    // at all, so its config is never used and a bad one must not sink the rejection.
    if (opts.llmReview) {
      setupStep(`Checking the LLM (${opts.llmApiType}, ${opts.llmModel})`);
      const configError = validateLlmConfig(opts.llmApiType, {
        apiKey: opts.llmApiKey,
      });
      if (configError) {
        throw new Error(configError);
      }
      const availabilityError = await checkModelAvailable(opts.llmApiType, {
        model: opts.llmModel,
        token: opts.llmApiKey,
        baseURL: opts.llmApiUrl,
      });
      if (availabilityError) {
        throw new Error(availabilityError);
      }
      // Requested, and proven usable. The request budget is the chosen model's, and
      // is read only now - the config it is read for has just been validated, so a
      // bogus type or an unlistable model is reported as itself rather than as a
      // failure to find a model table.
      llmBudget = createLlmBudget({
        step: modelSettings(opts.llmApiType, opts.llmApiUrl, opts.llmModel)
          .maxRequests,
        confirmMore: opts.confirmMore,
      });
      llmVerified = true;
    }

    // A valid Experiment's declared APIs are part of its platform: register their base
    // namespaces so the developer's calls into them (e.g. browser.calendar.*) resolve
    // instead of tripping unknown-api. Registered from the XPI (in SCA the experiment
    // schema/scripts live in the built XPI, so the manifest's paths resolve there).
    if (isExp) {
      xpiExperimentNamespaces = experimentApiNamespaces(
        xpiAddon.manifest,
        xpiAddon.files
      );
      schema.registerExperimentNamespaces(xpiExperimentNamespaces);
    }

    // The known-library hash DB the classifier matches bytes against (fetched and cached; a
    // pre-seeded cache keeps offline runs deterministic). Both modes classify.
    setupStep("Fetching library hashes");
    const { text: libraryHashesText } = await resolveLibraryHashes({
      cacheDir: opts.libraryHashesCache,
    });
    libraryHashes = parseLibraryHashes(libraryHashesText);

    // A source-code archive is only needed when the shipped XPI cannot be reviewed
    // directly. Classify the built XPI and decide purely from ITS OWN code - whether it
    // ships minified/obfuscated first-party code - so the SCA source content is irrelevant.
    // A directly-reviewable XPI downgrades to a plain XPI review (which still runs
    // minified-code and the rest against the XPI); sca-not-required reports it.
    mode = preliminaryMode;
    if (opts.scaRoot) {
      setupStep("Classifying the built add-on");
      const bundled = classifyBundled(xpiAddon, { libraryHashes });
      ({ mode, scaNotRequired } = resolveReviewMode(opts, bundled));
      // Persist the classification ONLY for a kept SCA: there the packaging / input:xpi
      // checks read xpiAddon.bundled, the XPI carries no vendor store, and resolveCdnLibraries
      // refines it - so this pre-resolveVendor classification is final. On a DOWNGRADE the XPI
      // becomes the review target and is re-classified vendor-aware in Phase 3; reusing this
      // pre-vendor bundle would scan VENDOR-declared readable files as authored, unlike a
      // native XPI review of the same artifact.
      if (mode?.sca) {
        xpiAddon.bundled = bundled;
      }
    }
  }

  // Phase 2: everything mode-dependent, DERIVED from the resolved mode - no mutation. The
  // SCA source archive is read HERE, and only when the mode stays SCA (a downgrade never
  // touches it). The review target `addon`, `scaSource`, `scaExpSource`, the experiment
  // mirror, and `meta` all follow the resolved mode.
  if (mode?.sca) {
    // Read the whole --sca-root archive ONCE (shared with selectScaBuildFiles below); the
    // review addon is the source subtree carrying the XPI's manifest.
    scaSource = opts.scaSource || ".";
    scaArchive = loadAddon(opts.scaRoot);
    addon = loadScaAddon(scaArchive, scaSource, opts.scaRoot);
    for (const notice of scaArchive.skipped ?? []) {
      warn(notice);
    }
    // Mirror the XPI's experiment classification onto the review addon (the experiment
    // checks read ctx.experiments from it; in XPI mode the two are one addon anyway).
    addon.experiments = xpiAddon.experiments;
    // --sca-exp-source is relative to --sca-root (or absolute); re-base it into the
    // review-source keyspace so the WebExtension-code checks can exclude the Experiment
    // subtree. Warn when it matches nothing - a mis-typed path would silently exclude
    // nothing and flood the report with false positives on the privileged Experiment code.
    scaExpSource = scaExpSourceRelative(
      opts.scaExpSource,
      scaSource,
      opts.scaRoot
    );
    if (
      scaExpSource &&
      ![...addon.files.keys()].some(
        (f) => f === scaExpSource || f.startsWith(`${scaExpSource}/`)
      )
    ) {
      warn(
        `--sca-exp-source "${opts.scaExpSource}" matched no files under --sca-source; ` +
          "nothing will be excluded from the WebExtension code checks."
      );
    }
  } else {
    // XPI review (native, or a downgraded false SCA): the review target IS the .xpi.
    addon = xpiAddon;
    scaExpSource = undefined;
  }
  const meta = {
    action: "review",
    addon: addon.source,
    addonKind: addon.kind,
    reviewed: true,
  };
  if (scaNotRequired) {
    // Surfaced twice on purpose: this live feed notice explains the mode switch as it
    // happens; the sca-not-required check emits the formal finding in the report.
    warn(
      "Shipped XPI is directly reviewable; source archive not required - reviewing the XPI."
    );
  }

  // Phase 3: the vendor / library / build setup. Three steps run on the REVIEW TARGET, in
  // this order: check its DECLARED dependencies, classify + extract it, then identify its
  // UNDECLARED libraries. Only the first is mode-specific, because a source archive and an
  // XPI declare dependencies differently. A submitted SCA then adds a tail for the two
  // artifacts that are NOT the review target: the shipped XPI (whose bundled store the
  // input:xpi checks read) and the build corpus.
  // Skipped for a rejected Experiment (only the reject check runs).
  if (!invalidExperiment) {
    // 1c. Resolve the dependency manifest ONCE (package.json deps + any VENDOR
    // declarations), so the review's checks share one immutable store.
    addon.vendor = await resolveVendor({
      addon,
      parsePrompt: registry.prompt("vendor-parse"),
      enabled: llmVerified,
      token: opts.llmApiKey,
      model: opts.llmModel,
      url: opts.llmApiUrl,
      type: opts.llmApiType,
      callText: opts.llmTransport?.callText,
      budget: llmBudget,
    });

    // The Mozilla add-on policy blocklist (curated assets/library-blocks.yaml): a
    // shipped asset read from disk (fast, no network, so no Setup feed line). Passed
    // to the vendor audit, which consults it before each OSV query (auditNpm) - a
    // banned library is recorded and skips the request. Not applied to SCA
    // devDependencies (never shipped).
    const { text: libraryBlocksText } = await resolveLibraryBlocks();
    const libraryBlocks = parseLibraryBlocks(libraryBlocksText);

    // 1d. Check the DECLARED dependencies of the review target. Both modes ask about the
    // same artifact, but the two declare differently, so the question is not the same one.
    if (mode?.sca) {
      // SCA: the source archive's package.json declares the dependencies - audit each for
      // popularity (non-popular -> reject) and OSV. The readable source may ALSO vendor a
      // library as a committed copy, so full identification (Mozilla-hash + CDN + OSV,
      // deduped against the declared audit) runs on it below. An unrecognized minified file
      // the source vendors stays non-authored and is rejected.
      setupStep("Auditing source dependencies");
      await verifyScaDependencies(addon, opts.vendorNet, libraryBlocks);
    } else {
      // XPI: no package.json - the add-on ships COMMITTED COPIES, declared in VENDOR.md.
      // Verify the resolved declarations over the network ONCE - fetch, compare
      // (EOL-tolerant), popularity, and the package.json<->file matching. An offline
      // transport (the golden harness) makes no request. The LLM params drive the
      // github->npm resolution fallback; the run-wide budget is shared.
      setupStep("Verifying vendored libraries");
      await verifyVendor(
        addon,
        opts.vendorNet,
        {
          enabled: llmVerified,
          resolvePrompt: registry.prompt("vendor-npm-resolve"),
          token: opts.llmApiKey,
          model: opts.llmModel,
          url: opts.llmApiUrl,
          type: opts.llmApiType,
          callText: opts.llmTransport?.callText,
          budget: llmBudget,
        },
        libraryBlocks
      );
    }

    // 1e. Classify the REVIEW TARGET's files (library hash, minified geometry, obfuscation),
    // seeding addon.bundled and its non-authored set. The review target is whatever Phase 2
    // resolved, so this is one step in both modes. It runs AFTER the declaration check above,
    // so the declared vendored set is final (verifyVendor DISCOVERS further vendored files by
    // hash and adds them to vendor.set, which classifyFiles reads).
    classifyReview(addon, { libraryHashes });

    // 1f. Identify + OSV-audit the UNDECLARED third-party libraries the declaration check
    // cannot see: a committed copy the Mozilla hash DB missed, matched by jsDelivr content
    // hash, then reconciled against the declared audit above. One step in both modes - it runs
    // on the review target, and `scope` only names it in the Setup feed.
    //
    // This FINALIZES the authored / non-authored split: it adds to the skip set (an identified
    // library) and removes from it (applyNotPopularVendor: a readable vendored library whose
    // package is not popular is reviewed as the developer's own code). So it must precede the
    // parse below, which gates content extraction on that set.
    await identifyBundledLibraries(addon, {
      net: opts.vendorNet,
      cacheDir: opts.cdnLookupCache,
      cdnEnabled: opts.cdnLookup !== false,
      blocks: libraryBlocks,
      setupStep,
      scope: mode?.sca ? "source" : "bundled",
    });

    // 1g. Parse the REVIEW TARGET - once, with the FINAL skip set (see extractReview).
    preParsedJsSources = extractReview(addon, { schema, xpiAddon, setupStep });

    // 1h. SCA only: cover the two artifacts that are NOT the review target. In XPI mode the
    // review target IS the shipped XPI (1f already identified it) and there is no build
    // corpus, so both of these collapse away.
    if (mode?.sca) {
      // The BUILT XPI was already classified above (the sca-not-required decision) into
      // xpiAddon.bundled - the packaging summary + the input:xpi checks read it, and their
      // skip set is that classification's non-authored set, so the XPI's minified/library
      // bundles are excluded exactly as in an XPI review. Its trusted upstream experiment
      // files (verifyExperiments) seeded the non-authored set there too.
      // Second-tier identification for the shipped XPI too: a readable/minified library the
      // Mozilla DB missed, matched on jsDelivr, so the XPI's non-authored set (read by the
      // input:xpi checks) is correct. No OSV audit here - the XPI carries no vendor store,
      // and an undeclared library the BUILD bundled is the build review's concern.
      setupStep("Identifying built-add-on libraries on a CDN");
      await resolveCdnLibraries(xpiAddon, {
        net: opts.vendorNet,
        cacheDir: opts.cdnLookupCache,
        enabled: opts.cdnLookup !== false,
      });
      // Parse the SHIPPED XPI. In an XPI review the built add-on IS the review target, and
      // the pass above already parsed it. Here it is a SECOND artifact that nothing had
      // parsed - so each of its `input: xpi` checks (unused-files,
      // minimize-web-accessible-resources, bundled-files, the two background-module ones)
      // would have had to parse it itself, at check time. A check is a pure reader, so setup
      // parses it once, here.
      //
      // The LIGHT pass: in SCA the code under review is the readable SOURCE, so the built
      // add-on is only ever walked as a LOAD GRAPH. No content scanner and no api-usage
      // consumer reads this artifact, so none is run over it.
      setupStep("Parsing the built add-on");
      shippedJsSources = collectJsSources(xpiAddon);
      runShippedExtractionPass(shippedJsSources, {
        schema,
        // Reuse the set registered in Phase 1 (same manifest + files); null for a non-Experiment.
        experimentNamespaces: xpiExperimentNamespaces,
      });
      // The BUILD files (archive minus the review source + Experiment source) - the
      // build scripts/config the review otherwise drops. buildScaBuildCtx wraps these
      // as the `input: build` check's ctx.addon; they never merge into the review addon.
      addon.buildFiles = selectScaBuildFiles(
        scaArchive,
        scaSource,
        opts.scaRoot,
        opts.scaExpSource
      );
      // Classify the build ONCE here (the vendor pattern): one model request over the
      // build corpus, stored on addon.buildFiles.buildReview for the input:build checks to
      // read deterministically. Offline / no token -> analyzed:false (routed to manual review).
      setupStep("Analyzing the build");
      addon.buildFiles.buildReview = await analyzeBuild({
        build: addon.buildFiles,
        analysisPrompt: registry.prompt("build-analysis"),
        enabled: llmVerified,
        token: opts.llmApiKey,
        model: opts.llmModel,
        url: opts.llmApiUrl,
        type: opts.llmApiType,
        callText: opts.llmTransport?.callText,
        budget: llmBudget,
      });
    }
  }

  // 2. Schema review. runChecks (called inline below, Phase 5) also generates the advisory
  // AI summaries at the tail of the activity feed (the add-on summary's recheck verdicts feed
  // the post-summary recheck consumers, which run there too).
  // Phase 4: build the RunContext the checks read - the last step of setup. The checks
  // layer assembles its own context (sources, API usage, diff baseline, LLM client); the
  // pipeline only resolves the inputs. Its sibling contexts are built here too, so every
  // artifact a check may be routed to exists before the first check runs.
  //
  // Nothing is parsed here: a reviewable add-on had its sources parsed in Phase 3 and hands
  // them over as preParsedJsSources, and a rejected Experiment parses none at all - its one
  // check reads no code.
  const ctx = buildRunContext({
    addon,
    // The built XPI - authoritative for the manifest (ctx.manifest). xpiAddon === addon
    // in XPI mode; in SCA it is the shipped artifact while addon is the readable source.
    xpiAddon,
    schema,
    // Only what a check reads. The LLM credentials go as params (below), not on the
    // check-facing options - the secret token must not sit on ctx.options.
    options: {
      allowExperiments: opts.allowExperiments,
      libraryHashes,
    },
    diffTo: opts.diffTo,
    llmModel: opts.llmModel,
    llmApiKey: opts.llmApiKey,
    llmApiType: opts.llmApiType,
    llmApiUrl: opts.llmApiUrl,
    llmTransport: opts.llmTransport,
    systemIntro: registry.prompt("system-intro"),
    // Phase 1's verdict on whether this run may call the model. The SOLE gate on attaching
    // ctx.llm - buildRunContext does not re-ask --llm-review, and does not consult
    // invalidExperiment for it.
    llmVerified,
    invalidExperiment,
    mode,
    // SCA: the Experiment folder as a source-relative path (runPipeline re-based it
    // from the scaRoot-relative --sca-exp-source flag), excluded from the WebExtension
    // code checks. Undefined in XPI mode.
    scaExpSource,
    // A submitted SCA was downgraded to this XPI review because the shipped XPI is
    // directly reviewable; the sca-not-required check reads this to report it.
    scaNotRequired,
    budget: llmBudget,
    // Phase 3 parsed the review sources (parse-first); buildRunContext assembles from them
    // and never parses. Absent for a rejected Experiment, whose one check reads no code, so
    // it gets an empty ctx.jsSources.
    preParsedJsSources,
  });

  // The orchestrator holds the review-target `ctx` plus its sibling contexts (below,
  // gathered into `siblings`): shippedCtx (the built XPI - the `input: xpi` checks
  // resolve declared paths against it, the diff + packaging summaries describe it),
  // buildCtx (the SCA build files), and manifestCtx (the shipped manifest, no file
  // corpus). Each check is routed to exactly one by its `input` (see routeCtx); a check
  // cannot derive one from another, so it only ever sees the artifact it was routed to.
  // In an XPI review shippedCtx IS ctx (buildShippedCtx returns it unchanged when the
  // XPI is the review target).
  const shippedCtx = buildShippedCtx(ctx, xpiAddon, shippedJsSources);
  // SCA: a sibling context whose addon is the build files (the archive minus the
  // review source minus node_modules), so the `input: build` check
  // (undeclared-build-source) reads them off ctx.addon via the same one-place
  // `input` routing - no separate ctx field. Undefined in XPI mode, where no such check
  // runs. `mode?.sca` implies Phase 3 ran (a rejected Experiment is pinned to xpi),
  // so addon.buildFiles is always loaded by here.
  const buildCtx = mode?.sca
    ? buildScaBuildCtx(ctx, addon.buildFiles)
    : undefined;
  // A sibling context with NO file corpus (empty ctx.addon.files), for `input: manifest`
  // checks - they read only the shipped manifest (on ctx.manifest), so there is no
  // artifact's files for them to reach. Both modes (the manifest exists in each).
  const manifestCtx = buildManifestCtx(ctx);
  // The sibling ctxs keyed by the `input` value that routes to each (see routeCtx). A
  // check's `input` selects its ctx; anything else runs over the review-target ctx.
  const siblings = { xpi: shippedCtx, build: buildCtx, manifest: manifestCtx };

  // Phase 5: run the review, then finalize. runChecks orchestrates all four phases -
  // deterministic, llm, the add-on-summary interleave (which fills ctx.recheckVerdicts), and
  // post-summary - and returns the finished findings, manual items, the checks that ran, and
  // the advisory summaries. Each throwing check is isolated so one failure can't abort all.
  // The `--eslint` opt-in gates code-sanity inside loadChecks (eslintEligible).
  progress(""); // close the Setup section before runChecks prints "── Activity ──"
  const {
    findings: reviewFindings,
    manualItems,
    checksRun,
    summarizeAddon,
    summarize,
    recheckVerdictRows,
  } = await runChecks(
    ctx,
    registry,
    {
      only: opts.checksOnly,
      skip: opts.checksSkip,
      eslint: opts.eslint,
      budget: llmBudget,
      // Whether the add-on summary will run to re-judge post-summary-recheck items:
      // the summary runs only with an LLM client attached.
      recheckActive: Boolean(ctx.llm),
    },
    siblings
  );
  findings.push(...reviewFindings);

  // The review-derived half of meta (the base half - action/addon/... - was set in Phase 1):
  // the schema stamps, the checks that ran, the LLM-review flag, and the manual-review to-do
  // list. Its `extended` items are the orchestrator's escalations (resolved to their registry
  // text); the rest are the by-hand manual-checks entries, diff-gated like the checks (e.g.
  // the new-submission-only "Forked add-on" reminder). An Experiment reject carries none.
  Object.assign(meta, {
    schemaSource,
    schemaBranch,
    schemaChannel,
    applicationVersion: ctx.schema.applicationVersion,
    manifestVersion: ctx.manifest?.manifest_version ?? null,
    checksRun: checksRun.map((c) => c.id),
    llmReviewed: Boolean(ctx.llm),
    manualReview: invalidExperiment
      ? []
      : [
          ...renderManualItems(manualItems, registry).map((m) => ({
            ...m,
            extended: true,
          })),
          ...registry
            .manualChecks(Boolean(ctx.previous))
            .map((m) => ({ ...m, extended: false })),
        ],
  });

  // Surface the review header now - before the ATN review-page lookup below, a
  // network call that can stall the feed for seconds - so the reviewer sees what
  // was reviewed the moment the Activity feed ends, instead of staring at a
  // frozen screen. It is removed from the report body (src/report/format.js) so
  // it is not printed twice. A no-op when progress is off (JSON, the golden
  // harness).
  progress("");
  for (const line of headerLines(meta)) {
    progress(line);
  }
  progress("");

  // Fill each finding's display message from its registry response (with the
  // {{item}} placeholder), so the Issues section reports the ready-to-send
  // wording. The registry is the only source of this text.
  renderFindings(findings, registry);

  return {
    findings,
    meta,
    // The review mode + the per-ruleId input artifact, so the text report can label
    // each finding's file:line by artifact ([XPI]/[SCA]) in an SCA review (a no-op in
    // XPI mode). See src/report/artifact.js.
    mode,
    ruleInputs: registry.checkInputs(),
    // Severity-group headings + the verdict preamble for the text Issues
    // section.
    issueHeadings: registry.issueHeadings(),
    verdictIntros: registry.verdictIntros(),
    // AI summaries generated above (each undefined unless its flag + a token
    // warrant it). The caller prints the prose after the report - see
    // src/cli.js.
    summarize,
    summarizeAddon,
    // The per-site recheck rows (both SCA passes), shown under the add-on summary in the
    // text report. Empty unless candidates were handed to the summary; a handed site with
    // no returned verdict still appears, defaulting to unsure.
    recheckVerdictRows,
  };
}

/**
 * Per-file classification of the REVIEW TARGET (library hash / minified geometry /
 * obfuscation, plus the vendored + experiment-trusted non-authored seed) -> addon.bundled.
 * It runs before identifyBundledLibraries, which reads its tags (tag.obfuscation) and refines
 * the result.
 * @param {import("./addon/load.js").Addon} addon
 * @param {{libraryHashes: Map<string, {name: string, version: string}>}} deps
 */
function classifyReview(addon, { libraryHashes }) {
  // Reuse the classification when the caller already has one (the SHIPPED XPI carries its own,
  // computed in Phase 1 to resolve the mode); otherwise classify now.
  addon.bundled =
    addon.bundled ?? assembleBundled(classifyFiles(addon, { libraryHashes }));
}

/**
 * The single extraction pass over the REVIEW TARGET: parse each source ONCE, extract every
 * per-file result the checks read, drop the AST. Returns the parsed sources for Phase 4.
 *
 * It runs AFTER identifyBundledLibraries, and that ORDER IS THE POINT: that step FINALIZES
 * addon.bundled.nonAuthored - the skip set this pass gates content extraction on - and it moves
 * the line in BOTH directions. The CDN lookup ADDS a file (a library the Mozilla hash DB
 * missed), and applyNotPopularVendor REMOVES one: a READABLE vendored library whose package
 * turns out not to be popular is reviewed as the developer's OWN code.
 *
 * That removal is what forces the order. A file dropped from the skip set after the pass would
 * be authored but never content-scanned - and since a check is a pure reader, it would find
 * nothing there. The library's network sinks, eval and unsafe-HTML would all be invisible.
 * @param {import("./addon/load.js").Addon} addon  The review target, already classified.
 * @param {{schema: object,
 *   xpiAddon: import("./addon/load.js").Addon,
 *   setupStep: (label: string) => void}} deps
 * @returns {import("./addon/sources.js").JsSource[]}  The parsed review sources.
 */
function extractReview(addon, { schema, xpiAddon, setupStep }) {
  const jsSources = collectJsSources(addon);
  const experimentNamespaces = isExperiment(xpiAddon.manifest)
    ? experimentApiNamespaces(xpiAddon.manifest, addon.files)
    : null;
  setupStep("Parsing add-on sources");
  runExtractionPass(jsSources, {
    schema,
    nonAuthored: addon.bundled.nonAuthored,
    experimentNamespaces,
  });
  return jsSources;
}

/**
 * Second-tier library identification over an already-classified add-on: reconcile the
 * not-popular declared (VENDOR/package) results into the untrusted family, match still-
 * unrecognized bundles against jsDelivr by content hash, then OSV-audit every identified
 * (undeclared) library - both Mozilla-hash and CDN matches. Reads/writes addon.bundled and
 * addon.vendor; every step is best-effort and skips silently offline. Runs AFTER
 * classification (so the Mozilla-hash matches and tag.obfuscation are final) and after the
 * declared-dependency audit (so auditIdentifiedLibraries dedups against it). Requires
 * addon.vendor for the OSV audit; the shipped XPI in SCA has none, so it gets only the CDN
 * pass (resolveCdnLibraries directly), not this routine.
 * @param {import("./addon/load.js").Addon} addon
 * @param {{net?: object, cacheDir?: string, cdnEnabled?: boolean,
 *   blocks?: Map<string, object>, setupStep?: (label: string) => void,
 *   scope?: string}} opts  `scope` names the artifact in the Setup feed ("source"/"bundled"); both call sites pass it.
 */
async function identifyBundledLibraries(
  addon,
  { net, cacheDir, cdnEnabled = true, blocks, setupStep = () => {}, scope }
) {
  applyNotPopularVendor(addon);
  setupStep(`Identifying ${scope} libraries on a CDN`);
  await resolveCdnLibraries(addon, { net, cacheDir, enabled: cdnEnabled });
  setupStep(`Auditing ${scope} libraries`);
  await auditIdentifiedLibraries(addon, net, blocks);
}

/**
 * The Thunderbird major a cached branch targets (its applicationVersion stamp), or
 * null when the zip is missing, unreadable, corrupt, or carries no parseable stamp
 * - a null excludes the channel from the candidates, which resolveReviewSchema
 * reads as a corrupt/incomplete cache and self-heals. Never throws.
 * @param {string} cacheDir @param {string} branch
 * @returns {number|null}
 */
export function peekBranchMajor(cacheDir, branch) {
  try {
    return (
      parseVersion(
        peekApplicationVersion(cachedZipPath(cacheDir, branch))
      )?.[0] ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Resolve which schema to review against, downloading if needed. The channel is
 * auto-detected from the add-on's version range (see selectSchemaChannel): the
 * cache is first brought to the full canonical set (all channels × both manifest
 * versions, re-downloading a missing OR corrupt branch), then the add-on's
 * manifest_version + strict_max_version pick the branch to load.
 *
 * @param {object} params
 * @param {string} params.cacheDir      Schema cache directory.
 * @param {import("./addon/load.js").Manifest} params.manifest  Shipped manifest.
 * @param {(label: string) => void} [params.setupStep]  Setup-feed narrator.
 * @returns {Promise<{zipPath: string, source: string, branch: string, channel: string}>}
 */
export async function resolveReviewSchema({
  cacheDir,
  manifest,
  setupStep = () => {},
}) {
  const mv = detectManifestVersion(manifest);
  // The detected manifest version's channel anchors. A channel is a candidate only
  // if its cached zip is present AND carries a readable version stamp - a
  // present-but-corrupt zip yields null (peekBranchMajor) and counts as absent, so
  // it triggers a re-download below instead of being silently selected around.
  const readAnchors = () =>
    SCHEMA_CHANNELS.map((channel) => {
      const branch = branchName(channel, mv.version);
      return { channel, branch, major: peekBranchMajor(cacheDir, branch) };
    }).filter((c) => c.major != null);

  // Schema resolution is ONE numbered setup step (the counter is pre-sized), so
  // fire setupStep exactly once on every path. The cache must be COMPLETE and
  // READABLE: a missing branch or a corrupt anchor (fewer readable candidates than
  // channels) re-downloads all six together so they share one train - the slow,
  // narrated step. Refreshing on corruption self-heals rather than silently
  // reviewing against the wrong channel. With the cache already complete and
  // readable, the step is nominal and names the chosen branch.
  let stepped = false;
  let candidates = readAnchors();
  if (
    !hasAllCachedSchemas(cacheDir) ||
    candidates.length < SCHEMA_CHANNELS.length
  ) {
    setupStep("Fetching review schemas (all channels)");
    stepped = true;
    await refreshAllSchemas({ cacheDir });
    candidates = readAnchors();
  }

  // Still short after a full re-download means the schema set itself is unusable -
  // fail loudly rather than review against a wrong or partial schema.
  if (candidates.length < SCHEMA_CHANNELS.length) {
    const bad = SCHEMA_CHANNELS.filter(
      (c) => !candidates.some((x) => x.channel === c)
    ).map((c) => branchName(c, mv.version));
    throw new Error(
      `Schema cache unusable: no readable version stamp for ${bad.join(", ")} even after refresh. ` +
        "Re-run with --cache-clear (and check network access to the schema source)."
    );
  }

  const { channel, branch, reason } = selectSchemaChannel({
    candidates,
    strictMax: strictMaxVersion(manifest),
  });
  debug(
    `manifest_version ${mv.detected ? mv.version : `? (defaulting to ${mv.version})`}; ${reason}` +
      ` → schema branch "${branch}".`
  );
  if (!stepped) {
    setupStep(`Fetching review schemas (${branch})`);
  }
  const { zipPath, source } = await resolveSchemaZip({ branch, cacheDir });
  return { zipPath, source, branch, channel };
}

/**
 * Pick the schema channel for an add-on from its supported version range. Driven
 * by the UPPER bound (strict_max_version): an add-on capped at a channel's own
 * major targets that train, so its schema (with the backported version_added
 * entries for that train) is authoritative. With no exact-major match - a gap, a
 * range below/above every cached train, or no cap at all - fall back to release
 * (the version_added checks still flag genuinely unsupported APIs). Never rejects
 * on version grounds. `candidates` are in channel priority (release > esr > beta),
 * so an exact-major tie resolves to the earlier (more stable) channel.
 *
 * @param {object} params
 * @param {{channel: string, branch: string, major: number}[]} params.candidates
 * @param {string|null|undefined} params.strictMax  The add-on's strict_max_version.
 * @returns {{channel: string, branch: string, reason: string}}
 */
export function selectSchemaChannel({ candidates, strictMax }) {
  if (candidates.length === 0) {
    throw new Error("No schema candidates available to choose from.");
  }
  const cap = parseVersion(strictMax)?.[0] ?? null;
  if (cap != null) {
    const hit = candidates.find((c) => c.major === cap);
    if (hit) {
      return {
        channel: hit.channel,
        branch: hit.branch,
        reason: `strict_max ${strictMax} targets the ${hit.channel} train (Thunderbird ${hit.major})`,
      };
    }
  }
  // Default: release if present, else the newest-major candidate available.
  const def =
    candidates.find((c) => c.channel === "release") ??
    candidates.reduce((a, b) => (b.major > a.major ? b : a));
  const why =
    cap == null
      ? "no strict_max cap"
      : `strict_max ${strictMax} matches no cached train`;
  return {
    channel: def.channel,
    branch: def.branch,
    reason: `${why} → ${def.channel} (Thunderbird ${def.major})`,
  };
}

/**
 * Resolve the effective review mode from the submission. A source-code archive
 * (--sca-root) is only needed when the shipped XPI cannot be reviewed directly; if
 * its first-party code is not minified/obfuscated (hasUnreviewableCode false), the
 * source archive adds nothing, so the review is downgraded to a plain XPI review and
 * sca-not-required reports it. The decision reads ONLY the built XPI's own
 * classification - the source content is irrelevant. Not called for a rejected
 * Experiment (which is never downgraded).
 *
 * @param {object} opts  Pipeline opts; only `opts.scaRoot` is read here.
 * @param {?import("./lib/bundled.js").Bundled} bundled  classifyBundled(xpiAddon).
 * @returns {{mode: REVIEW_MODE.XPI|"sca", scaNotRequired: boolean}}
 */
export function resolveReviewMode(opts, bundled) {
  if (!opts.scaRoot) {
    return { mode: REVIEW_MODE.XPI, scaNotRequired: false };
  }
  if (hasUnreviewableCode(bundled)) {
    return { mode: REVIEW_MODE.SCA, scaNotRequired: false };
  }
  return { mode: REVIEW_MODE.XPI, scaNotRequired: true };
}

/**
 * Detect the manifest_version from the add-on manifest. A missing or invalid
 * manifest_version defaults to 2 (an add-on that omits it is Manifest V2).
 *
 * @param {object|null|undefined} manifest
 * @returns {{version: number, detected: boolean}}
 */
export function detectManifestVersion(manifest) {
  const v = manifest?.manifest_version;
  if (v === 2 || v === 3) {
    return { version: v, detected: true };
  }
  return { version: 2, detected: false };
}
