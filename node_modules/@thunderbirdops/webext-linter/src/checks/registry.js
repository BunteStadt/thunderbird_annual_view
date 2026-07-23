// registry.yaml is the check registry. Its check-bearing sections ARE the phases -
// `invalid-experiment-phase`, `deterministic-phase`, `llm-phase`, `post-summary-phase`
// (PHASE_SECTIONS) - so a check's phase IS the section it lives in, and no entry declares
// one. Every entry there that carries a `check:` field links to a module in ./rules/ that
// implements that test. This loader reads the yaml, imports the linked module for each
// (selected) entry, runs it, and stamps each returned finding with the entry's id (the
// check filename stem) and its severity. runChecks names the phases it runs, in order, so
// a section it never asks for is inert.
//
// A check is a pure detector: it decides verdicts and emits findings carrying
// only `file`/`loc`/`item`/`hint` - never prose. The registry entry is the
// check's declarative contract: `severity` (the source of a finding's impact,
// stamped unconditionally - UNLESS it is `auto`, which delegates the per-finding
// severity to the check), and the text shown for it (`response`, `instructions`,
// `prompt`). Neither half leaks into the other.
//
// A deterministic check returns `Finding[]`. An llm check runs a deterministic
// pre-flight and returns `{ findings, escalations }`, where each escalation is a
// case it could not settle. The orchestrator (runChecks) - the sole authority on
// manual review - resolves every escalation via escalation.js: with a token it
// asks the LLM, otherwise (or on unsure/error) it routes the case to manual
// review. So only llm checks can defer to manual, and only the orchestrator
// decides.
//
// The shared `ctx` passed to run() is the RunContext typedef below, which is the
// one description of it: what a check may read, and from where.
//
// Belongs here: the Registry class (the queried view of registry.yaml), loading
// and filtering rule modules, the RunContext type, and runChecks - the loop
// that runs checks, resolves escalations, and stamps id + severity. Does NOT
// belong here: building the ctx, which is src/checks/context.js. The per-case
// escalation policy - src/checks/escalation.js. Any check's detection logic - a
// module under src/checks/rules/* (shared analysis in src/lib/*).
// Resolving a ruleId to user text and laying out the report -
// src/report/responses.js and src/report/format.js.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";

import { finding, SEVERITY } from "../report/finding.js";
import { artifactLabel } from "../report/artifact.js";
import { progress, debug, FEED } from "../util/log.js";
import { red, green, blue } from "../util/color.js";
import { runLlmCheck, manualEscalations } from "./escalation.js";
import { resolveRecheckSummaries } from "./summaries.js";
import { buildRecheckVerdictReport } from "../lib/recheck.js";
import { VERDICT } from "../lib/enum.js";
import { verdictLabel } from "../report/verdict-label.js";
import { collapseUnusedFolders } from "../lib/unused-folders.js";

/** @typedef {import("../report/finding.js").Severity} Severity */

// The severity token a check entry may declare. error/warning/info are stamped
// onto every finding the check emits. "auto" instead delegates the per-finding
// severity to the check itself (it sets f.severity, defaulting to error if it
// sets none or an invalid value) - see runOneCheck. "auto" is a config-only
// token: a finding never carries it.
const AUTO_SEVERITY = "auto";
const CONCRETE_SEVERITIES = new Set([
  SEVERITY.ERROR,
  SEVERITY.WARNING,
  SEVERITY.INFO,
]);
const VALID_CHECK_SEVERITIES = new Set([...CONCRETE_SEVERITIES, AUTO_SEVERITY]);

// The `input` a check entry declares - which add-on artifact is ctx.addon when the
// check runs. "source" = the REVIEW TARGET, the readable submitted code (the readable
// --sca-source in an SCA review, the built XPI in an XPI review - the only artifact
// there); "xpi" = ALWAYS the built XPI (the shipped artifact), for the structure checks
// that describe what ships; "build" = the SCA build files (the archive minus the review
// source minus node_modules), for the build review; "manifest" = the shipped manifest
// ONLY, on a ctx with an EMPTY file corpus (buildManifestCtx), for pure-manifest checks
// that read ctx.manifest and no files. Required on every check EXCEPT a
// post-summary-recheck (which declares no input - it runs on the main ctx and is
// labelled by its producer's corpus): runChecks routes each check to its artifact's
// context, so the check reads one artifact and has no way to reach another (see
// buildShippedCtx / buildScaBuildCtx / buildManifestCtx).
const VALID_CHECK_INPUTS = new Set(["source", "xpi", "build", "manifest"]);

// The check-bearing yaml sections ARE the phases: a check's phase IS the section it
// lives in, so the two can never disagree and no entry declares a phase of its own.
// This is a CLOSED SET - the orchestrator (runChecks) looks up the phases it wants, in
// the order it runs them, so a section it never asks for is inert: adding an
// unrecognized section to registry.yaml changes nothing. The yaml's other top-level
// sections (permission-prompts, messages, manual-checks, ...) are exactly that - never
// asked for here, and so not phases.
const PHASE_SECTIONS = Object.freeze({
  "invalid-experiment": "invalid-experiment-phase",
  deterministic: "deterministic-phase",
  llm: "llm-phase",
  "post-summary": "post-summary-phase",
});

/**
 * Whether `s` is a concrete finding severity (error/warning/info) - i.e. a value
 * a finding may actually carry into the report. "auto"/null/anything else is
 * not.
 * @param {unknown} s @returns {boolean}
 */
function isConcreteSeverity(s) {
  return CONCRETE_SEVERITIES.has(/** @type {string} */ (s));
}

const here = path.dirname(fileURLToPath(import.meta.url));
const RULES_DIR = path.join(here, "rules");
const DEFAULT_REGISTRY = path.resolve(here, "../../assets/registry.yaml");

/**
 * @typedef {object} LoadedCheck
 * @property {string} id
 * @property {string} title
 * @property {Severity} severity  Impact stamped onto the check's findings.
 * @property {"source"|"xpi"|"build"|"manifest"|undefined} input  Which add-on artifact is
 *   ctx.addon when the check runs. "source" = the review target, the readable submitted code
 *   (the readable --sca-source in an SCA review, the built XPI in an XPI review); "xpi" = always
 *   the built XPI (the shipped artifact), for the structure checks that describe what ships;
 *   "build" = the SCA build files, for the build review; "manifest" = the shipped manifest only,
 *   on a ctx with an empty file corpus (buildManifestCtx), for pure-manifest checks. Required for
 *   a normal check - runChecks routes it to that artifact's context (see buildShippedCtx /
 *   buildScaBuildCtx / buildManifestCtx). ABSENT for a post-summary-recheck, which always
 *   runs on the main ctx and is labelled by labelInput.
 * @property {"source"|"xpi"|"build"|"manifest"} labelInput  The artifact this check's OUTPUT is
 *   labelled as ([XPI]/[SCA]) - the corpus it acts on. Equals `input` for a normal check;
 *   for a recheck consumer it is the producer's corpus (see Registry.labelInputFor).
 * @property {boolean} [diff]  Diff-mode gate: true = run only with a --diff-to
 *   baseline, false = run only WITHOUT one (new submissions), omitted = always.
 * @property {string} [prompt]  LLM rubric for an ambiguous case (llm checks).
 * @property {string} [instructions]  Manual-review message (llm checks).
 * @property {string} [postSummaryRecheck]  Id of a post-summary recheck consumer
 *   this check hands its manual items to when the add-on summary runs (see
 *   runChecks and src/lib/recheck.js).
 * @property {?{permissionPrompts: object[]}} [recheckData]
 *   The linked consumer's data for a producer that declares postSummaryRecheck:
 *   for a permission-recheck consumer, the permission-prompts token entries
 *   ({permissions, tokens, version bounds} - prompt text stripped) that feed the
 *   producer's deterministic verdicts (see recheckDataFor).
 * @property {Function} run
 */

/**
 * The shared context passed to every check's run(ctx, check). Built once per
 * review (built in runPipeline Phase 4) and read by the rule modules.
 * @typedef {object} RunContext
 * @property {object} addon  The routed artifact's INTRINSIC view (reviewView in
 *   context.js): its files plus the lazy file-derived caches (bundled, vendor,
 *   locales, ...). The manifest and experiment classification are NOT on it - they
 *   are shipped-authoritative and live on ctx.manifest / ctx.experiments below - so a
 *   check cannot pair one artifact's manifest with another's files.
 * @property {import("../schema/index.js").SchemaIndex} schema  Resolved schema.
 * @property {object[]} jsSources  Parsed JS sources (see addon/sources.js).
 * @property {object[]} apiUsages  Per-source extracted API usage.
 * @property {?import("../addon/load.js").Manifest} manifest  The authoritative,
 *   SHIPPED manifest (the built XPI's - what Thunderbird loads), resolved once like
 *   `schema`. Every manifest / permission / API check reads this; there is no
 *   ctx.addon.manifest (reviewView strips it), which in SCA would be the readable
 *   source's pre-build template - no check reviews the source manifest.
 * @property {?string} manifestError  The shipped manifest's JSON parse error, or null.
 * @property {?import("../addon/manifest-loc.js").ManifestLoc} manifestLoc  Position
 *   index for the shipped manifest (manifestPathLine reads it).
 * @property {string} manifestText  The shipped manifest.json raw text (manifestTokenLine
 *   reads it); "" when absent.
 * @property {?object} experiments  The Experiment classification (verifyExperiments),
 *   computed from the SHIPPED XPI. Shipped-authoritative and shared like the manifest,
 *   so the experiment checks read ctx.experiments, not ctx.addon.experiments. Null for
 *   a non-Experiment add-on.
 * @property {{allowExperiments?: boolean,
 *   libraryHashes?: Map<string, {name: string, version: string}>}} options  The only run
 *   options a check reads (experiment-not-allowed, the lazy bundled classifier). The LLM
 *   credentials are NOT here - a check reaches the model only through ctx.llm.
 * @property {import("../addon/load.js").Addon|null} [previous]  Diff baseline.
 * @property {import("../lib/enum.js").ReviewMode} [mode]  Review mode: "xpi" (a built add-on, default) or
 *   "sca" (a source code archive). Gates checks via scaEligible.
 *
 *   The SHIPPED artifact (the built XPI) is deliberately NOT a ctx field: a check
 *   has no way to reach the artifact it was not routed to. The orchestrator builds a
 *   separate shipped context (buildShippedCtx, src/checks/context.js) and routes each
 *   `input: xpi` check to it - see runChecks / runOneCheck.
 * @property {boolean} [isShippedView]  Set by buildShippedCtx on the shipped
 *   context (never the review target). buildReachability reads it so the SCA
 *   "all readable-source files" pureWebExtensionReachable fallback applies only to
 *   the review source, not the built XPI (whose entry points resolve).
 * @property {string} [scaExpSource]  SCA mode: the Experiment folder as a source-
 *   relative path (runPipeline re-bases it from the scaRoot-relative --sca-exp-source
 *   flag). buildReachability excludes it from pureWebExtensionReachable so the
 *   WebExtension code checks skip privileged Experiment code.
 * @property {boolean} [invalidExperiment]  The add-on uses Experiment APIs and
 *   --allow-experiments is off: the review short-circuits to the reject check
 *   only, with no LLM (see runChecks and buildRunContext).
 * @property {boolean} [scaNotRequired]  A submitted SCA (--sca-root) was downgraded to
 *   this plain XPI review because the shipped XPI is directly reviewable; the
 *   sca-not-required check reads this to report the redundant source submission.
 * @property {{evaluate: Function}} [llm]  LLM client, present only with a token.
 * @property {object[]} [recheckVerdicts]  The add-on summary's recheck verdicts
 *   (set by the pipeline after the summary runs); resolveRecheck reads them to settle
 *   the handed-over items. Review-level data, so it is a ctx field, not on ctx.addon.
 * @property {Map<string, object[]>} [recheck]  Manual items handed to each
 *   recheck consumer (keyed by its id), awaiting the summary's verdicts.
 * @property {Function} [note]  Narrate a file:line investigation note to the
 *   feed: (file, loc, item, verdict) -> void. Set by runChecks, absent in tests.
 */

/**
 * Check filename stem - the finding ruleId, also used by --checks/--skip.
 * @param {string} checkFile
 * @returns {string}
 */
function stem(checkFile) {
  return String(checkFile).replace(/\.js$/, "");
}

/**
 * The parsed registry.yaml, read once and queried many times. It is the single
 * source for the checks to run, the manual-review to-do items, the
 * severity-group headings, and the reviewer-response templates - so the file is
 * parsed once per run rather than re-read per concern.
 */
export class Registry {
  /** @param {Record<string, any>} doc  Parsed registry document. */
  constructor(doc) {
    this.doc = doc && typeof doc === "object" ? doc : {};
  }

  /**
   * Every check entry that links to a rule module, each tagged with the `phase` it
   * runs in - which IS the section it came from (PHASE_SECTIONS). An llm-phase entry
   * additionally carries a `prompt` (LLM rubric) and `instructions` (manual-review
   * message); a post-summary-phase entry carries a recheck rubric and declares no
   * `input` (it runs on the main ctx, labelled by its producer's corpus).
   * @returns {object[]}  Each: { check, title, severity, phase, prompt?,
   *   instructions?, response? }.
   */
  checkEntries() {
    /**
     * @param {object[]} [list]  Raw entries from one registry section.
     * @param {string} phase  The phase that section IS.
     * @returns {object[]}
     */
    const tag = (list, phase) =>
      (list || [])
        .filter((e) => e && typeof e.check === "string" && e.check)
        .map((e) => ({ ...e, phase }));
    return Object.entries(PHASE_SECTIONS).flatMap(([phase, section]) =>
      tag(this.doc[section], phase)
    );
  }

  /**
   * The check entry for a ruleId (the check filename stem), or undefined.
   * @param {string} ruleId
   * @returns {object|undefined}
   */
  checkEntry(ruleId) {
    return (this._byId ??= new Map(
      this.checkEntries().map((e) => [stem(e.check), e])
    )).get(ruleId);
  }

  /**
   * Ids of every linked check, across every phase section (for --checks help).
   * @returns {string[]}
   */
  checkIds() {
    return this.checkEntries().map((e) => stem(e.check));
  }

  /**
   * The artifact a check's OUTPUT is labelled as ([XPI]/[SCA]) - the corpus it
   * ACTS ON, not the ctx it runs on. For a post-summary-recheck consumer this is
   * its producer's corpus (recheckConsumersByCorpus), NOT its own `input`: `input`
   * only routes the consumer onto the main ctx so it can read ctx.recheck, but the
   * items it re-judges belong to the producer's artifact. Every other check acts on
   * the artifact it runs on, so its declared `input` is the label.
   * @param {string} ruleId
   * @returns {"xpi"|"build"|"source"|"manifest"}
   */
  labelInputFor(ruleId) {
    const { xpi, source } = this.recheckConsumersByCorpus();
    if (xpi.has(ruleId)) {
      return "xpi";
    }
    if (source.has(ruleId)) {
      return "source";
    }
    return this.checkEntry(ruleId)?.input ?? "source";
  }

  /**
   * The label artifact per ruleId (a `Map<ruleId, "xpi"|"build"|"source"|"manifest">`),
   * projected for the report layer so it can label a finding's file:line by
   * artifact ([XPI]/[SCA]) without touching the registry. Keyed off labelInputFor
   * (the corpus the check acts on), so a recheck consumer's items carry their
   * producer's artifact rather than the consumer's routing `input`.
   * @returns {Map<string, string>}
   */
  checkInputs() {
    return new Map(
      this.checkEntries().map((e) => {
        const id = stem(e.check);
        return [id, this.labelInputFor(id)];
      })
    );
  }

  /**
   * The by-hand to-do items: every `manual-checks` entry eligible in the current
   * review mode, already in the rendered {title, instructions, response} shape
   * (these carry no `{{item}}`). Entries are diff-gated like checks (see
   * diffEligible): e.g. the "Forked add-on" reminder is `diff: false`, so it
   * shows only for a new submission, not when reviewing against a --diff-to
   * baseline. An llm check that escalates with no token is surfaced by the
   * orchestrator (escalation.js), not here.
   * @param {boolean} [inDiffMode]  Reviewing against a --diff-to baseline.
   * @returns {{title: string, instructions?: string, response: ?string}[]}
   */
  manualChecks(inDiffMode = false) {
    return (this.doc["manual-checks"] || [])
      .filter((e) => e && e.title && diffEligible(e, inDiffMode))
      .map((e) => ({
        title: e.title,
        instructions: e.instructions,
        response: e.response ?? null,
      }));
  }

  /**
   * The `check:` ids of the manual-checks entries. These are id metadata only -
   * the canonical id for each manual check (matching its docs/checks/<id>.html
   * page) - NOT runnable checks: they have no rule module and are deliberately
   * excluded from checkIds()/checkEntries(), so --checks-only/--checks-skip do
   * not act on them. Used for cross-referencing (docs, consistency tests).
   * @returns {string[]}
   */
  manualCheckIds() {
    return (this.doc["manual-checks"] || [])
      .map((e) => e && e.check)
      .filter(Boolean);
  }

  /**
   * The headings shown above each severity group in the Issues section, as a
   * { error?, warning?, info? } -> string map (a missing key renders that group
   * with no heading).
   * @returns {Record<string, string>}
   */
  issueHeadings() {
    const h = this.doc["issue-headings"];
    return h && typeof h === "object" ? h : {};
  }

  /**
   * The customer-facing verdict preamble for the Issues section, as a
   * { none?, feedback?, rejected? } -> string map: `none` when there are no
   * findings, `rejected` when any finding is an error, `feedback` otherwise.
   * @returns {Record<string, string>}
   */
  verdictIntros() {
    const v = this.doc["verdict-intros"];
    return v && typeof v === "object" ? v : {};
  }

  /**
   * The Issues response template for a finding's ruleId: the owning check's
   * `response`, or a system `messages` entry for an orchestrator-emitted ruleId
   * (e.g. "check-failed"). Null if neither exists.
   * @param {string} ruleId
   * @returns {?string}
   */
  responseFor(ruleId) {
    const r = this.checkEntry(ruleId)?.response;
    return typeof r === "string" ? r : (this.message(ruleId) ?? null);
  }

  /**
   * A system-notice template (the top-level `messages` map), or null.
   * @param {string} key
   * @returns {?string}
   */
  message(key) {
    const m = this.doc.messages;
    const t = m && typeof m === "object" ? m[key] : null;
    return typeof t === "string" ? t : null;
  }

  /**
   * A named tool-defining prompt from the top-level `prompts` map (e.g.
   * "system-intro", "change-summary"), or null if absent. These are model-facing
   * strings the registry owns, like check rubrics and `messages`.
   * @param {string} name
   * @returns {?string}
   */
  prompt(name) {
    const p = this.doc.prompts;
    const t = p && typeof p === "object" ? p[name] : null;
    return typeof t === "string" ? t : null;
  }

  /**
   * The shared framing for the unused-permission recheck rubric (top-level
   * `permission-prompt-framing` map): { preamble, closing }, each "" if absent.
   * @returns {{preamble: string, closing: string}}
   */
  permissionPromptFraming() {
    const f = this.doc["permission-prompt-framing"];
    const s = (v) => (typeof v === "string" ? v : "");
    return { preamble: s(f?.preamble), closing: s(f?.closing) };
  }

  /**
   * The per-permission-group recheck prompts (top-level `permission-prompts` list),
   * with the comma-separated `permissions` parsed to an array, the optional
   * inclusive Thunderbird version bounds surfaced, and the optional usage `tokens`
   * (code-level spellings of the prompt's justifying usages; an entry without
   * tokens is deterministically undecidable - the unused-permission producer then
   * always escalates its permissions).
   * @returns {{permissions: string[], prompt: string, tokens: string[],
   *   minStrictVersion: ?string, maxStrictVersion: ?string}[]}
   */
  permissionPrompts() {
    return (this.doc["permission-prompts"] || [])
      .filter((e) => e && typeof e.prompt === "string")
      .map((e) => ({
        permissions: String(e.permissions ?? "")
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean),
        prompt: e.prompt,
        // Filter BEFORE stringifying: String(null) is the truthy "null", which
        // would match almost any code and silently disable the entry's
        // deterministic verdict.
        tokens: Array.isArray(e.tokens)
          ? e.tokens.filter((t) => t != null && t !== "").map((t) => String(t))
          : [],
        // Coerce to string so an unquoted numeric bound (min_strict_version: 154)
        // still parses - a bare YAML number would otherwise slip past parseVersion
        // and silently void the bound (see versionInBounds).
        minStrictVersion:
          e.min_strict_version != null ? String(e.min_strict_version) : null,
        maxStrictVersion:
          e.max_strict_version != null ? String(e.max_strict_version) : null,
      }));
  }

  /**
   * The permissions the unused-permission recheck can judge: the union of every
   * `permission-prompts` entry's permissions. A permission absent here has no rubric
   * grounding, so it is not worth an LLM recheck and stays manual. The registry
   * prompts are the single source of truth (there is no separate hardcoded set).
   * This is version-INDEPENDENT (a permission counts if ANY entry lists it); the
   * assembler then narrows to the entries whose version bounds fit the add-on, so a
   * permission recheckable here can still fall to manual when its only prompt is out
   * of range (see assemblePermissionPrompt's `grounded` set in lib/recheck.js).
   * @returns {Set<string>}
   */
  recheckablePermissions() {
    return (this._recheckable ??= new Set(
      this.permissionPrompts().flatMap((e) => e.permissions)
    ));
  }

  /**
   * Whether a manual item may be handed to the recheck consumer `consumerId` (asked
   * by the runChecks divert). A `permission-recheck` consumer takes only permissions
   * it has a prompt for; every other consumer takes all its items. Keeps permission
   * knowledge in the registry, not the orchestrator. This is the permissive,
   * version-independent gate: a handed permission may still fall to manual at assembly
   * if no version-matching prompt grounds it (see recheckablePermissions).
   * @param {string} consumerId
   * @param {{item: ?string}} item
   * @returns {boolean}
   */
  rechecks(consumerId, item) {
    if (!this.checkEntry(consumerId)?.["permission-recheck"]) {
      return true;
    }
    return this.recheckablePermissions().has(item.item);
  }

  /**
   * Partition the post-summary recheck CONSUMERS by the corpus their PRODUCER read, so
   * the SCA split can run one summary per corpus - each carrying only the consumers whose
   * items live in that corpus. A producer reads the review target when `input: source`
   * (the source archive in SCA) and the shipped XPI when `input: xpi`; its items are anchored
   * accordingly, so its consumer bridges only to a summary of that same artifact. Derived
   * from the producers' declared `input` - no separate tag. `input: build` producers (none
   * today) belong to no summary corpus and are omitted.
   * @returns {{source: Set<string>, xpi: Set<string>}}
   */
  recheckConsumersByCorpus() {
    return (this._recheckByCorpus ??= (() => {
      const source = new Set();
      const xpi = new Set();
      for (const e of this.checkEntries()) {
        const target = e["post-summary-recheck"];
        if (typeof target !== "string") {
          continue;
        }
        const input = e.input ?? "source";
        if (input === "xpi") {
          xpi.add(target);
        } else if (input === "source") {
          source.add(target);
        }
      }
      return { source, xpi };
    })());
  }
}

/**
 * Parse registry.yaml once into a Registry, asserting every phase section is there.
 *
 * The phase sections ARE the control flow: runChecks looks each one up BY NAME and runs
 * whatever it finds. So a renamed or misspelled section does not fail loudly - it yields an
 * empty phase, and the review silently runs without every llm check, or without every
 * recheck consumer (whose producers would still divert items into ctx.recheck, to be
 * dropped). Nothing downstream can tell that apart from "this phase has no checks". Assert
 * the closed set here instead, so a broken registry aborts the review - the same contract
 * loadChecks already applies to a `check:` that names a missing module.
 *
 * Only the SHIPPED registry is asserted (see assertRequiredPhaseSections). A caller naming
 * its own file (the unit tests) is deliberately exercising one section in isolation, and a
 * partial doc is the point there.
 * @param {string} [registryPath]
 * @returns {Registry}
 */
/**
 * Assert every phase in PHASE_SECTIONS has a non-empty section in the parsed registry `doc`.
 * A required section that is missing or empty (a yaml defect - a rename, a bad edit) would
 * leave that phase with no checks, and nothing downstream can tell "no checks" from "the
 * section vanished" - so the whole phase would be dropped from every review, silently. This
 * turns that into a loud abort. loadRegistry applies it to the SHIPPED registry only;
 * exported so the guard can be tested directly against a synthetic doc.
 * @param {Record<string, unknown>} doc  The parsed registry document.
 * @param {string} registryPath  For the error message.
 */
export function assertRequiredPhaseSections(doc, registryPath) {
  for (const section of Object.values(PHASE_SECTIONS)) {
    const list = doc[section];
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error(
        `Registry ${registryPath}: the phase section "${section}" is missing or empty. ` +
          "Every phase in PHASE_SECTIONS must declare its checks - an absent section " +
          "would silently drop that whole phase from every review."
      );
    }
  }
}

export function loadRegistry(registryPath = DEFAULT_REGISTRY) {
  const registry = new Registry(
    YAML.parse(fs.readFileSync(registryPath, "utf8")) || {}
  );
  // Only the SHIPPED registry: a unit test naming its own file deliberately declares one
  // section in isolation, so the all-phases-present rule must not apply to it.
  if (registryPath === DEFAULT_REGISTRY) {
    assertRequiredPhaseSections(registry.doc, registryPath);
  }
  // ONE rule module = ONE entry = ONE phase. A check's id IS its module's filename stem, so a
  // second entry naming the same module is not a second check - it is the same check declared
  // twice. It would run once per entry, and worse, the id -> entry index (a Map, keyed by that
  // stem, and the only way a finding - which carries just a ruleId - reaches its severity and
  // response text) would resolve to the LAST declaration: a duplicate can silently restamp a
  // real check's `error` as `info`. Applies to every registry, not just the shipped one: a
  // duplicate is a mistake in any of them.
  const seen = new Set();
  for (const entry of registry.checkEntries()) {
    const id = stem(entry.check);
    if (seen.has(id)) {
      throw new Error(
        `Registry ${registryPath}: the check "${id}" is declared more than once. One rule ` +
          "module is one entry in one phase - a second declaration runs it again, and the " +
          "id -> entry lookup that stamps every finding's severity and response would " +
          "silently resolve to the last one."
      );
    }
    seen.add(id);
  }
  return registry;
}

/**
 * Load and filter the check modules named by the registry, GROUPED BY PHASE - a check's
 * phase is which list it lands in (its registry section), so no LoadedCheck carries one.
 * Every phase in PHASE_SECTIONS gets a list (loadRegistry has already asserted that none of
 * their sections is missing or empty; a list can still come out empty here once the
 * diff/sca gates and --checks/--skip have been applied). A `check:` that names a missing
 * module, or a module without a `run` export, throws hard - a broken registry should abort
 * the review, not silently drop a check.
 * @param {Registry} registry
 * @param {object} [opts]
 * @param {string[]} [opts.only]  If set, only these ids load.
 * @param {string[]} [opts.skip]  These ids are excluded.
 * @param {boolean} [opts.eslint]  The `--eslint` flag: an `eslint: true` check (code-sanity)
 *   loads only when set (eslintEligible). Gated here, before the import, so the eslint
 *   dependency is not pulled in when the check will not run.
 * @returns {Promise<Map<string, LoadedCheck[]>>}  Phase -> its checks, in registry order.
 */
export async function loadChecks(registry, { only, skip, eslint } = {}) {
  const onlySet = only?.length ? new Set(only) : null;
  const skipSet = skip?.length ? new Set(skip) : null;
  // A `post-summary-recheck: X` producer must name a real check X that carries the
  // rubric that re-judges the handed-over items: a static `summary-prompt`, or
  // `permission-recheck` (assembled per review from the permission-prompts). A
  // dangling target would divert items into ctx.recheck to be silently dropped.
  // Validated over the whole registry - config integrity is independent of
  // --only/--skip.
  for (const e of registry.checkEntries()) {
    const target = e["post-summary-recheck"];
    if (typeof target !== "string" || !target) {
      continue;
    }
    const consumer = registry.checkEntry(target);
    if (!consumer) {
      throw new Error(
        `post-summary-recheck target "${target}" (from "${e.title}") is not a check`
      );
    }
    const hasPrompt =
      (typeof consumer["summary-prompt"] === "string" &&
        consumer["summary-prompt"]) ||
      consumer["permission-recheck"];
    if (!hasPrompt) {
      throw new Error(
        `post-summary-recheck target "${target}" (from "${e.title}") has no summary-prompt or permission-recheck`
      );
    }
    // A recheck is judged by the source OR packaging summary pass, which cover the
    // `source` and `xpi` corpora (recheckConsumersByCorpus). A `build` or `manifest`
    // producer belongs to neither, so its diverted items would silently never be
    // judged - reject it.
    const producerInput = e.input ?? "source";
    if (producerInput !== "source" && producerInput !== "xpi") {
      throw new Error(
        `"${e.title}" reads input: ${producerInput} and cannot declare a post-summary-recheck (no summary pass carries that corpus)`
      );
    }
  }
  // A recheck consumer is defined by its phase - i.e. by living in the
  // post-summary-phase section, which is also what forbids an `input` below. Keep the
  // rubric in lock-step - a check carries a recheck rubric (summary-prompt /
  // permission-recheck) IFF it is in that phase - so the phase, the divert, and
  // validation can never disagree (a rubric-bearing consumer left in another phase
  // would otherwise never be re-judged).
  for (const e of registry.checkEntries()) {
    const hasRubric = !!(e["summary-prompt"] || e["permission-recheck"]);
    const inSection = e.phase === "post-summary";
    if (hasRubric !== inSection) {
      throw new Error(
        hasRubric
          ? `"${e.title}" carries a recheck rubric (summary-prompt/permission-recheck) but is not in the post-summary-phase section`
          : `"${e.title}" is in the post-summary-phase section but carries no recheck rubric (summary-prompt/permission-recheck)`
      );
    }
  }
  // Keyed by phase, in the order PHASE_SECTIONS declares them - a check's phase is
  // WHICH LIST it is in, so nothing needs to carry one. Every phase gets a list (empty
  // when its section is absent), so the orchestrator can look any of them up blindly.
  const byPhase = new Map(Object.keys(PHASE_SECTIONS).map((p) => [p, []]));
  for (const entry of registry.checkEntries()) {
    const id = stem(entry.check);
    if (onlySet && !onlySet.has(id)) {
      continue;
    }
    if (skipSet && skipSet.has(id)) {
      continue;
    }
    // The `--eslint` opt-in gate, applied HERE (unlike diff/sca, which gate in runChecks
    // after the import): code-sanity top-level imports the eslint dependency, so skipping it
    // before the import below avoids loading eslint when it will not run.
    if (!eslintEligible(entry, Boolean(eslint))) {
      continue;
    }
    // `check:` is the check id; the module is rules/<id>.js (a stray trailing
    // ".js" in the id is tolerated by stem()).
    const file = path.join(RULES_DIR, `${id}.js`);
    if (!fs.existsSync(file)) {
      throw new Error(
        `check module not found: rules/${id}.js (referenced by "${entry.title}")`
      );
    }
    const mod = await import(pathToFileURL(file).href);
    const run = mod.default?.run ?? mod.run;
    if (typeof run !== "function") {
      throw new Error(`rules/${id}.js exports no run() function`);
    }
    const severity = entry.severity || "error";
    if (!VALID_CHECK_SEVERITIES.has(severity)) {
      throw new Error(
        `rules/${id}.js has an invalid severity "${severity}" ` +
          `(expected one of: ${[...VALID_CHECK_SEVERITIES].join(", ")})`
      );
    }
    // A post-summary-phase consumer always runs on the main ctx and is labelled by its
    // producer's corpus - so it declares no `input`, and doing so would be misleading.
    // Every OTHER check must declare a valid `input`, which drives runOneCheck's
    // artifact routing (no silent default to fall through to).
    const isRecheck = entry.phase === "post-summary";
    const input = entry.input;
    if (isRecheck && input !== undefined) {
      throw new Error(
        `rules/${id}.js is a post-summary-recheck and must not declare \`input\` ` +
          `(got ${JSON.stringify(input)}): it runs on the main ctx and is labelled ` +
          "by its producer's corpus."
      );
    }
    if (!isRecheck && !VALID_CHECK_INPUTS.has(input)) {
      throw new Error(
        `rules/${id}.js is missing a valid \`input\` (got ${JSON.stringify(input)}; ` +
          `expected one of: ${[...VALID_CHECK_INPUTS].join(", ")}). ` +
          "Every check must declare which add-on artifact it reads (source = the " +
          "review target, xpi = the built XPI, build = the SCA build files, " +
          "manifest = the shipped manifest only)."
      );
    }
    // An `input: build` check reads the SCA build corpus, which exists ONLY in an SCA review -
    // so it MUST carry `sca: true`. Without it the check also runs in an XPI review, where the
    // build sibling is undefined and routeCtx (`siblings[input] ?? ctx`) would silently route
    // it to the REVIEW TARGET - the wrong artifact, no error. The `sca: true` gate is the only
    // thing keeping every build check out of XPI mode; assert it rather than trust the yaml.
    if (input === "build" && entry.sca !== true) {
      throw new Error(
        `rules/${id}.js declares \`input: build\` but not \`sca: true\`. The build corpus ` +
          "exists only in an SCA review; without the gate it would run in an XPI review and " +
          "routeCtx would silently route it to the review target instead."
      );
    }
    byPhase.get(entry.phase).push({
      id,
      title: entry.title,
      severity,
      // undefined for a post-summary-phase consumer (routes to the main ctx); its output
      // is labelled by labelInput (the producer's corpus), not this.
      input,
      // The artifact this check's output is labelled as (the corpus it acts on) -
      // equals `input` for every check except a recheck consumer, which runs on the
      // main ctx but acts on its producer's corpus. See labelInputFor.
      labelInput: registry.labelInputFor(id),
      diff: typeof entry.diff === "boolean" ? entry.diff : undefined,
      sca: typeof entry.sca === "boolean" ? entry.sca : undefined,
      prompt: entry.prompt,
      instructions: entry.instructions,
      postSummaryRecheck:
        typeof entry["post-summary-recheck"] === "string"
          ? entry["post-summary-recheck"]
          : undefined,
      // A producer's window into its linked consumer's data - for a
      // permission-recheck consumer, the permission-prompts token entries, so
      // the producer renders deterministic verdicts from the same data that
      // grounds the LLM recheck. Generic by name (a future producer/consumer
      // pair may attach a different shape here); the producer version-filters
      // at run time (versionInBounds) with the reviewed manifest.
      recheckData: recheckDataFor(registry, entry),
      run,
    });
  }
  return byPhase;
}

/**
 * The permission-prompts token vocabulary for the PRODUCER of a permission-recheck
 * pair (the check whose post-summary-recheck target is a permission-recheck consumer),
 * or undefined otherwise. The producer both locates the token sites and renders the
 * deterministic verdicts from it (enumerateUnusedPermissions); the consumer reads the
 * prompts directly off the registry when it assembles its rubric, so it needs no copy.
 * Deliberately narrow: only the token entries, prompt text stripped - wording stays
 * the report layer's business - so the check has no window into the other end's prose
 * or severity. A static-rubric pair feeds no such data.
 * @param {Registry} registry
 * @param {object} entry  A producer registry entry.
 * @returns {?{permissionPrompts: object[]}}
 */
function recheckDataFor(registry, entry) {
  const target = entry["post-summary-recheck"];
  const isProducer =
    typeof target === "string" &&
    !!target &&
    !!registry.checkEntry(target)?.["permission-recheck"];
  if (!isProducer) {
    return undefined;
  }
  return {
    permissionPrompts: registry
      .permissionPrompts()
      .map(({ permissions, tokens, minStrictVersion, maxStrictVersion }) => ({
        permissions,
        tokens,
        minStrictVersion,
        maxStrictVersion,
      })),
  };
}

// Tag column width, sized to the widest "[label]" so the file column aligns. The
// note vocabulary is every VERDICT (fail/pass/unsure judgments + the note-only
// skipped/info); the model's answer (schema.js WIRE_VERDICTS) is only ever
// fail/pass/unsure.
const TAG_WIDTH = Math.max(
  ...Object.values(VERDICT).map((v) => verdictLabel(v).length + 2)
);

// On an interactive screen, a fail note is red, a pass note green, and an unsure
// (escalated) note blue (skipped/info stay plain), keyed by the rendered label. A
// no-op unless the CLI enabled color (color.js).
const VERDICT_COLOR = { fail: red, pass: green, unsure: blue };

/**
 * Format one investigation note for the feed (unindented - the printer applies
 * the DETAIL indent): a padded `[label]` tag then the site (`file:line` when a
 * line is known, else `file`) and the optional item.
 * @param {string} file
 * @param {?{line?: number}} loc
 * @param {?string} item
 * @param {import("../lib/enum.js").Verdict} verdict  A shared VERDICT; its
 *   verdictLabel is the tag rendered here (the one place a verdict becomes text).
 * @param {string} [label]  Artifact label ("XPI"/"SCA") prepended before the site
 *   in an SCA review, else "" (an XPI review has one artifact). See report/artifact.js.
 * @returns {string}
 */
export function formatNote(file, loc, item, verdict, label = "") {
  const status = verdictLabel(verdict); // throws if not a VERDICT
  const at = loc?.line != null ? `${file}:${loc.line}` : file;
  const site = label ? `[${label}] ${at}` : at;
  const line = `• ${`[${status}]`.padEnd(TAG_WIDTH)} ${site}${item ? ` - ${item}` : ""}`;
  return (VERDICT_COLOR[status] ?? ((s) => s))(line);
}

/**
 * Whether a registry entry runs in the current review mode, per its `diff`
 * field: `diff: true` only with a --diff-to baseline, `diff: false` only without
 * one (a new submission), an omitted `diff` in both. Shared by the check gate
 * (runChecks) and the manual-checks gate (Registry.manualChecks).
 * @param {{diff?: boolean}} entry @param {boolean} inDiffMode
 * @returns {boolean}
 */
function diffEligible(entry, inDiffMode) {
  if (entry.diff === true) {
    return inDiffMode;
  }
  if (entry.diff === false) {
    return !inDiffMode;
  }
  return true;
}

/**
 * Whether a registry entry runs in the current review REVIEW_MODE, per its `sca` field
 * (mirrors diffEligible): `sca: true` only in SCA mode (a source code archive,
 * triggered by `--sca-root`), `sca: false` only in XPI mode (reviewing a built
 * add-on), an omitted `sca` in both. The XPI bundled/vendor checks are `sca:
 * false` (they need the XPI dependency tree, absent for a source archive); the
 * `--sca-root` dependency audit is `sca: true`.
 * @param {{sca?: boolean}} entry @param {boolean} inScaMode
 * @returns {boolean}
 */
function scaEligible(entry, inScaMode) {
  if (entry.sca === true) {
    return inScaMode;
  }
  if (entry.sca === false) {
    return !inScaMode;
  }
  return true;
}

/**
 * Whether a registry entry runs given the `--eslint` flag, per its `eslint` field
 * (mirrors diffEligible): `eslint: true` is opt-in - it runs only with `--eslint` - and an
 * omitted `eslint` runs always. Unlike the diff/sca gates this is applied in loadChecks
 * (BEFORE the module import), because the sole `eslint: true` check (code-sanity) top-level
 * imports the heavy `eslint` dependency: gating it here skips that import when it will not run.
 * @param {{eslint?: boolean}} entry @param {boolean} inEslintMode
 * @returns {boolean}
 */
function eslintEligible(entry, inEslintMode) {
  if (entry.eslint === true) {
    return inEslintMode;
  }
  return true;
}

/**
 * The ctx a check runs on: the sibling for its declared `input` artifact, else the main
 * review ctx. The ONE place artifact routing is decided - shared by runChecks (the main
 * loop) and the deferred post-summary loop, so the two can never drift.
 *
 * A check declares an `input` and reads ONLY its routed ctx.addon - it has no way to
 * reach another artifact. What `input` resolves to, per review mode:
 *
 *     input \ mode | SCA (readable source + built XPI) | XPI review (one artifact)
 *     -------------+----------------------------------+--------------------------
 *     source       | ctx.addon = the readable source  | ctx.addon (the XPI)
 *     xpi          | siblings.xpi = the built XPI      | ctx.addon (the XPI)
 *     build        | siblings.build = the build files | (sca-only)
 *     manifest     | siblings.manifest                | siblings.manifest
 *
 * In an XPI review there is a single artifact, so xpi/source both collapse onto `ctx`
 * (its siblings.xpi IS ctx). The ONE exception to the table is a post-summary recheck
 * CONSUMER: the loader forbids it an `input`, so it falls through to the main ctx to
 * read ctx.recheck / ctx.recheckVerdicts - while the items it re-judges belong to its
 * PRODUCER's artifact. That producer corpus is recovered separately, by ctxForRule
 * (labelInput), NOT here - see ctxForRule.
 * @param {LoadedCheck} check
 * @param {RunContext} ctx
 * @param {Record<string, RunContext>} siblings  Keyed by input value (xpi/build/manifest).
 * @returns {RunContext}
 */
export function routeCtx(check, ctx, siblings) {
  return siblings[check.input] ?? ctx;
}

/**
 * The ctx whose artifact a RULE'S OUTPUT belongs to - the corpus its findings' file paths
 * live in. The ONE answer to that question, and NOT the same one routeCtx gives.
 *
 * routeCtx answers "which ctx does this check RUN on?" (its declared `input`). This answers
 * "which artifact does its output DESCRIBE?" - `registry.labelInputFor`, the same resolution
 * the report's [XPI]/[SCA] labelling uses, so the two can never disagree about a finding.
 * The pair differs for a post-summary recheck CONSUMER: it declares no `input` at all (the
 * loader forbids one) because `input` merely routes it onto the main ctx to read ctx.recheck,
 * while the items it re-judges belong to its PRODUCER's artifact. Route such a consumer with
 * routeCtx and you get the review target - the readable source in SCA - for items whose paths
 * are the built XPI's.
 *
 * Anything post-processing a check's OUTPUT (the pipeline's folder collapse, the report's
 * labels) must resolve its artifact through here, never through `ctx.addon`: once findings
 * come back as a flat list carrying only a ruleId, the check -> artifact binding routeCtx
 * enforced is gone, and this is the only way to recover it.
 * @param {Registry} registry
 * @param {string} ruleId
 * @param {RunContext} ctx
 * @param {Record<string, RunContext>} siblings
 * @returns {RunContext}
 */
export function ctxForRule(registry, ruleId, ctx, siblings) {
  return siblings[registry.labelInputFor(ruleId)] ?? ctx;
}

/**
 * Run the selected checks. A check returns its verdicts as findings, and may
 * also return `escalations` (cases it could not settle), which this orchestrator
 * - the sole authority on manual review - resolves an llm check's via
 * escalation.js (LLM if a token is set, else manual) and a deterministic
 * check's straight to manual review. Every finding (direct or from a confirmed
 * escalation) is stamped with the owning check's id and severity (the registry
 * entry is the only source of severity). A check that throws is reported as a
 * system finding and the rest still run.
 * @param {RunContext} ctx  The review-target check context (ctx.addon = the
 *   reviewed artifact; the XPI in an XPI review, the readable source in SCA).
 * @param {Registry} registry
 * @param {{only?: string[], skip?: string[], eslint?: boolean,
 *   budget?: import("../llm/budget.js").LlmBudget, recheckActive?: boolean}} [opts]
 *   `only`/`skip`/`eslint` thread to loadChecks (the `--eslint` opt-in gates code-sanity);
 *   `budget` is the run-wide LLM request cap, threaded to the add-on-summary interleave;
 *   `recheckActive` is whether the add-on summary will run to re-judge post-summary-recheck
 *   items (the pipeline passes `Boolean(ctx.llm)`).
 * @param {Record<string, RunContext>} [siblings]  The sibling artifact contexts, keyed by
 *   the `input` that routes to each: `xpi` = the shipped XPI, `build` = the SCA build files,
 *   `manifest` = the shipped manifest (no file corpus). Consumed via routeCtx (the matrix is
 *   documented there). Omitted = every check runs over ctx.
 * @returns {Promise<{findings: object[],
 *   manualItems: {ruleId: string, item: ?string, kind: string}[],
 *   checksRun: object[],
 *   summarizeAddon: (import("../pipeline.js").GeneratedSummary|undefined),
 *   summarize: (import("../pipeline.js").GeneratedSummary|undefined)}>}  The finished
 *   review: every finding and manual item across all four phases, the checks that ran (for
 *   meta.checksRun), and the advisory add-on / diff summaries the caller prints.
 */
export async function runChecks(ctx, registry, opts = {}, siblings = {}) {
  // Two gates pick which checks run. The `diff` gate (a registry field) keys off
  // the mode: `diff: true` (e.g. strict-max-version-bump-only) needs a --diff-to
  // baseline (ctx.previous), `diff: false` is new-submission only (the same gate
  // also applies to manual-checks entries - see diffEligible/manualChecks, used
  // by the new-submission-only "Forked add-on" reminder), an omitted `diff` runs
  // in both. A gated-out check never runs and never appears in the feed or
  // meta.checksRun.
  const byPhase = await loadChecks(registry, opts);
  const inDiffMode = Boolean(ctx.previous);
  // The `sca` gate keys off the review mode (ctx.mode): SCA mode reviews a
  // source-code submission's readable source + its declared deps, so the
  // XPI-only bundled/vendor checks (`sca: false`) are dropped and the
  // source-dependency audit (`sca: true`) is added; XPI mode (the default) is
  // the inverse. An omitted `sca` runs in both.
  const inScaMode = ctx.mode?.sca;
  // The orchestrator NAMES the phases it runs, in the order it runs them - a check's
  // phase is simply which list it is in, so a phase never asked for here does not run
  // (that is what makes an unrecognized registry section inert). An invalid Experiment
  // short-circuits the whole review to the reject phase and nothing else; a normal
  // review runs the deterministic phase, then the llm phase, then the add-on-summary
  // interleave (which fills ctx.recheckVerdicts), then the post-summary phase. The two
  // gates above apply within each phase.
  const inPhase = (phase) =>
    (byPhase.get(phase) ?? []).filter(
      (c) => diffEligible(c, inDiffMode) && scaEligible(c, inScaMode)
    );
  const checks = ctx.invalidExperiment
    ? inPhase("invalid-experiment")
    : [...inPhase("deterministic"), ...inPhase("llm")];
  const deferred = ctx.invalidExperiment ? [] : inPhase("post-summary");
  // The whole-review count, so [i/total] is continuous across the main loop AND the
  // post-summary checks below (they carry on from checks.length).
  const total = checks.length + deferred.length;
  // Whether the add-on summary will run to re-judge recheck items: a check with a
  // `post-summary-recheck` hands its manual items to that summary (below) instead of
  // straight to manual review only when this is set. The pipeline passes `Boolean(ctx.llm)`
  // (false offline / the golden harness, so those items go straight to manual review); a
  // unit test passes it directly to exercise the divert in isolation.
  const recheckActive = Boolean(opts.recheckActive);
  const findings = [];
  const manualItems = [];
  // Let checks narrate the file:line sites they investigated (network loads,
  // eval, HTML sinks) to the feed with their per-site verdict, so a reviewer has
  // a trail regardless of the finding. The format is owned here (formatNote);
  // checks emit only {file, loc, item, verdict}. Lines nest under the check's
  // [i/N] line above.
  // The ctx a note fires on IS its artifact (matching the input routing below), so
  // each sibling context gets a note bound to its input: the review target is the
  // source archive (source), the shipped context the built XPI, the build context the
  // build files. artifactLabel prepends [XPI]/[SCA] in SCA mode (and always [XPI] for
  // manifest.json - the shipped manifest); an XPI review adds no label. A caller may
  // override the label artifact (5th arg) when its output belongs to a corpus other
  // than the ctx it runs on - a recheck consumer runs on the main ctx (source) but acts
  // on its producer's corpus, so it passes its check.labelInput.
  const makeNote =
    (input) =>
    (file, loc, item, verdict, labelInput = input) => {
      try {
        const label = artifactLabel({
          file,
          input: labelInput,
          mode: ctx.mode,
        });
        progress(formatNote(file, loc, item, verdict, label), FEED.DETAIL);
      } catch (err) {
        // A cosmetic feed note must never drop a check's findings - formatNote's
        // throw still guards the contract for its unit test and direct callers.
        debug(`feed note skipped: ${err.message}`);
      }
    };
  // Each sibling ctx gets a note bound to the input that routes to it, so a feed note
  // is labelled by the artifact its check ran over (ctx.note is the review target).
  ctx.note = makeNote("source");
  for (const [input, sib] of Object.entries(siblings)) {
    if (sib && sib !== ctx) {
      sib.note = makeNote(input);
    }
  }
  // Heading for the live activity feed, matching the report's section style. A
  // no-op when progress is off (JSON, the golden harness), so goldens are
  // unaffected.
  progress("── Activity ──");
  progress("");
  for (const [i, check] of checks.entries()) {
    // Route the check to its declared input artifact - the ONE place the choice is
    // made (shared with the pipeline's deferred loop via routeCtx). The check reads
    // only its ctx.addon and has no way to reach another artifact.
    const checkCtx = routeCtx(check, ctx, siblings);
    const out = await runOneCheck(checkCtx, check, `[${i + 1}/${total}]`);
    findings.push(...out.findings);
    // A check with `post-summary-recheck: R` hands its manual items to the
    // recheck consumer R, but only when the add-on summary will actually run to
    // re-judge them (recheckActive). Otherwise they go straight to manual
    // review - as do all no-summary paths, including the golden harness. In SCA the
    // summary runs once per corpus (recheckConsumersByCorpus), so a producer's items
    // always reach the summary of the artifact they are anchored to - no hold-back.
    if (check.postSummaryRecheck && recheckActive && out.manualItems.length) {
      // The registry decides per item whether this consumer can re-judge it: a
      // permission-recheck consumer takes only the permissions it has a rubric prompt
      // for (registry.rechecks); the rest stay manual. Other rechecks take every item.
      const bucket = (ctx.recheck ??= new Map());
      const held = bucket.get(check.postSummaryRecheck) ?? [];
      for (const m of out.manualItems) {
        if (registry.rechecks(check.postSummaryRecheck, m)) {
          held.push(m);
        } else {
          manualItems.push(m);
        }
      }
      bucket.set(check.postSummaryRecheck, held);
    } else {
      manualItems.push(...out.manualItems);
    }
  }
  // Close the main-loop activity list with a blank line, so it is separated from the
  // add-on-summary interleave and post-summary checks below. A no-op when progress is off.
  progress("");

  // The add-on-summary interleave, between the llm and post-summary phases: it re-judges
  // the recheck items diverted above (ctx.recheck) and fills ctx.recheckVerdicts, which the
  // post-summary consumers read. Inert without ctx.llm. It runs now, not earlier, because it
  // excludes files the review found unreachable (unused-files), a product of the checks above.
  const { summarizeAddon, summarize } = await resolveRecheckSummaries(
    ctx,
    registry,
    opts.budget,
    siblings,
    findings
  );

  // The post-summary phase: the recheck consumers, run now that the add-on summary has
  // filled ctx.recheckVerdicts, through the SAME per-check path as the main loop (routeCtx +
  // runOneCheck stamp id/severity and route escalations to manual review). Numbering
  // continues from the main loop so the feed reads [1/total] .. [total/total]. Empty for an
  // invalid Experiment.
  const checksRun = [...checks];
  for (const [j, check] of deferred.entries()) {
    // A recheck consumer runs on the main ctx (checkCtx) to read ctx.recheck /
    // ctx.recheckVerdicts; its handed items already carry every locus they need (a
    // producer stamps them before diverting), so it reads no other artifact.
    const checkCtx = routeCtx(check, ctx, siblings);
    const out = await runOneCheck(
      checkCtx,
      check,
      `[${checks.length + j + 1}/${total}]`
    );
    findings.push(...out.findings);
    manualItems.push(...out.manualItems);
    checksRun.push(check);
  }

  // Condense the unused-files report: when every packaged file under a folder is unused,
  // collapse it to the top-most such folder. Output-only, after every check has scanned every
  // file. Applied separately to findings and manual escalations so certainty is not mixed. It
  // is handed a RESOLVER (filesOfRule), not a file list: ctxForRule is the one answer to which
  // artifact a rule's OUTPUT describes (the same resolution the report's [XPI]/[SCA] label
  // uses), so nothing here picks an artifact and none can be picked wrongly.
  const filesOfRule = (ruleId) => [
    ...ctxForRule(registry, ruleId, ctx, siblings).addon.files.keys(),
  ];
  collapseUnusedFolders(findings, filesOfRule);
  collapseUnusedFolders(manualItems, filesOfRule);

  // The per-site rows shown under the report's add-on-summary section: every candidate site handed
  // to the add-on summary (both SCA passes), resolved to its file:line + subject + source line.
  // Built here where the corpus is in scope (the report layer cannot reach ctx); ctxForRule picks
  // each consumer's own artifact, so a site's source line is read from the corpus it belongs to.
  const recheckVerdictRows = buildRecheckVerdictReport(
    ctx,
    registry,
    (ruleId) => ctxForRule(registry, ruleId, ctx, siblings).addon
  );

  return {
    findings,
    manualItems,
    checksRun,
    summarizeAddon,
    summarize,
    recheckVerdictRows,
  };
}

/**
 * Run one loaded check and return its findings + manual refs, stamping each
 * finding with the check's id and severity. This is the per-check body of
 * runChecks, extracted so a check can also be run on its own (a post-summary
 * recheck consumer runs after the add-on summary, outside the loop - see
 * runChecks below). Identical behavior either way: an LLM check's candidates go
 * through escalation.js, a deterministic check's escalations route to manual
 * review, and a thrown check becomes a single "check-failed" finding so the rest
 * still run.
 * @param {RunContext} ctx
 * @param {LoadedCheck} check
 * @param {string} label  The feed prefix before the id, e.g. "[3/12]".
 * @returns {Promise<{findings: object[], manualItems: object[]}>}
 */
export async function runOneCheck(ctx, check, label) {
  progress(`${label} ${check.id}`, FEED.STEP);
  const findings = [];
  const manualItems = [];
  try {
    // ctx is already the artifact the caller routed this check to (runChecks /
    // pipeline, keyed on check.input). The check - and its LLM adjudication below -
    // read only ctx.addon; there is no way here to reach the other artifact.
    const result = (await check.run(ctx, check)) || [];
    const direct = Array.isArray(result) ? result : (result.findings ?? []);
    const escalations = Array.isArray(result) ? [] : (result.escalations ?? []);
    const llmStep = Array.isArray(result) ? null : (result.llm ?? null);
    const produced = [...direct];
    if (llmStep) {
      // An LLM check: judge its candidates (one verdict per id, batched), then
      // let the check map those verdicts to findings / manual via its own
      // id->data table. The model never names a subject, so it cannot drift.
      const out = await runLlmCheck(ctx, check, llmStep);
      produced.push(...out.findings);
      manualItems.push(...out.manualItems);
    } else if (escalations.length) {
      // A deterministic check may escalate cases a human must inspect - these
      // go straight to manual review (never the LLM, which is for judgment).
      manualItems.push(...manualEscalations(check, escalations).manualItems);
    }
    const auto = check.severity === AUTO_SEVERITY;
    for (const f of produced) {
      f.ruleId = check.id;
      if (!auto) {
        // Fixed severity: the entry is the sole authority. Whatever the check
        // may have set on f.severity is ignored (overwritten) here.
        f.severity = check.severity;
      } else if (!isConcreteSeverity(f.severity)) {
        // The severity:auto case - the check owns each finding's severity, but
        // it must produce a concrete one. A missing/invalid value is a check
        // bug. Fail safe to error (the report consumers all assume a concrete
        // severity).
        debug(
          `[registry] ${check.id} is severity:auto but emitted ${JSON.stringify(
            f.severity
          )} - defaulting to error`
        );
        f.severity = SEVERITY.ERROR;
      }
      findings.push(f);
    }
  } catch {
    findings.push(
      finding({
        ruleId: "check-failed",
        severity: SEVERITY.ERROR,
        item: check.id,
      })
    );
  }
  return { findings, manualItems };
}
