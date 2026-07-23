// CLI front-end for the review tool: parse argv, validate, drive the pipeline,
// and route the report + exit code. The pipeline core lives in pipeline.js (the
// test harness calls runPipeline there directly).
//
// Review runs directly as `node verify.js <xpi|folder>`, forwarding to
// main(argv) below. `npm run help` is an alias for `verify.js --help`.
//
// Belongs here: the front-end only - the OPTIONS table, usage/help text, argv
// parse and flag validation, --llm-list-models, the values -> PipelineOpts
// mapping, stream/capture routing, and exit codes.
//
// Does NOT belong here: running the stages (opts -> Review is pipeline.js
// runPipeline); report layout and rendering (src/report/format.js formatReview
// and src/report/responses.js); the model listing call (src/llm/provider.js);
// the check ids and registry text (src/checks/registry.js).

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { parseArgs } from "node:util";

import { runPipeline } from "./pipeline.js";
import { loadRegistry } from "./checks/registry.js";
import {
  getProvider,
  defaultModelFor,
  defaultBaseUrlFor,
  validateLlmConfig,
  DEFAULT_LLM_TYPE,
} from "./llm/provider.js";
import { hasErrors } from "./report/finding.js";
import { formatReview } from "./report/format.js";
import {
  DEFAULT_CACHE,
  EXPERIMENTS_CACHE,
  LIBRARY_HASHES_CACHE,
  CDN_LOOKUP_CACHE,
  LLM_MODEL_CACHE,
} from "./config.js";
import {
  info,
  setVerbose,
  setProgress,
  setQuiet,
  setCapture,
  getCapture,
} from "./util/log.js";
import { setColor, stripColor, red } from "./util/color.js";
import { wrapText } from "./util/text.js";

/** @typedef {import("./pipeline.js").PipelineOpts} PipelineOpts */

// Package identity for the run banner (read once at load).
const { name: PKG_NAME, version: PKG_VERSION } = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")
);

/**
 * The two-line run banner in npm's style: a `> name@version review` line, then
 * the `node verify.js <args>` command, so a direct run opens with the same
 * identifying lines npm itself would print for the same command.
 * @param {string[]} [argv]  The args this run was invoked with, echoed after
 *   `node verify.js` (as npm does) so the banner states what ran.
 * @returns {string}
 */
export function runBanner(argv = []) {
  const args = argv.length ? ` ${argv.join(" ")}` : "";
  return `> ${PKG_NAME}@${PKG_VERSION} review\n> node verify.js${args}`;
}

/**
 * True when npm already printed its own run header for this process - i.e. we
 * were launched by `npm run verify` (whose script command invokes verify.js),
 * so runBanner() would only duplicate it. A direct `node verify.js` run, or a
 * launch under an unrelated npm script (e.g. `npm test`), prints the banner.
 * @returns {boolean}
 */
function npmPrintedRunHeader() {
  return (process.env.npm_lifecycle_script ?? "").includes("verify.js");
}

/**
 * Emit the run banner once, at the top of a direct run, unless npm already
 * printed an equivalent header (npmPrintedRunHeader). Goes through the feed
 * (info), so it is suppressed in JSON mode (quiet) and captured into a text
 * --report-out file. The leading and trailing blank lines match npm's spacing.
 * @param {string[]} argv  The args this run was invoked with.
 */
function emitBanner(argv) {
  if (npmPrintedRunHeader()) {
    return;
  }
  info(`\n${runBanner(argv)}\n`);
}

/**
 * A parse-error message with node:util's misleading positional-argument hint
 * removed. parseArgs appends a "To specify a positional argument starting with
 * a '-' ..." sentence to unknown-option errors. It does not apply here - the
 * only positional is the add-on path, and a stray dashed argument is a typo.
 * @param {unknown} err
 * @returns {string}
 */
function cleanParseError(err) {
  return String(err?.message ?? err).replace(
    / To specify a positional argument starting with a '-'[\s\S]*$/,
    ""
  );
}

// Two-column help layout: the flag in a fixed left column, its description
// wrapped to 80 columns, continuations hanging under the description column.
const HELP_COL = 32;

/**
 * Format one option row for the help screen: the flag left-aligned in the fixed
 * column, its description wrapped to 80 columns with continuation lines hanging
 * under the description.
 * @param {string} flag  The flag and its argument, e.g. "--cache-schema-dir <dir>".
 * @param {string} desc  The description prose.
 * @returns {string}
 */
function optionLine(flag, desc) {
  const lines = wrapText(desc, " ".repeat(HELP_COL), 80);
  const lead = `  ${flag}`;
  if (lead.length >= HELP_COL) {
    // Flag wider than the column: description hangs on the next lines.
    return [lead, ...lines].join("\n");
  }
  lines[0] = lead.padEnd(HELP_COL) + lines[0].slice(HELP_COL);
  return lines.join("\n");
}

/**
 * Resolve the LLM config for this run. `--llm-review` is the SOLE enabler
 * (`wants`) of the LLM CHECKS. The LLM_API_* env vars only configure the client
 * and never turn the checks on. The config is forwarded only when `wants`, and
 * validated later, hard-failing at the pipeline's Setup pre-flight if it is
 * unusable. LLM_API_TYPE picks the provider (claude | chatgpt | ollama, default
 * claude) and hence the default model (LLM_API_MODEL override) and default base
 * URL. LLM_API_URL overrides that base URL, and Ollama defaults to its localhost
 * endpoint. The key is the real LLM_API_KEY or undefined - a keyless provider
 * (Ollama) needs none, so it is never a fabricated placeholder here.
 * @param {Record<string, string|boolean|string[]>} values
 * @returns {{wants: boolean, apiKey?: string, apiUrl?: string, apiType?: string,
 *   model?: string}}
 */
function resolveLlm(values) {
  const wants = values["llm-review"] === true;
  if (!wants) {
    // Nothing is resolved for a run that will not call a model: reading the model
    // table (defaultModelFor) would make a hand-editing typo in assets/llm sink a
    // deterministic review that never wanted an LLM at all.
    return { wants };
  }
  const apiType = (process.env.LLM_API_TYPE || DEFAULT_LLM_TYPE).toLowerCase();
  return {
    wants,
    apiType,
    apiKey: process.env.LLM_API_KEY || undefined,
    apiUrl: process.env.LLM_API_URL || defaultBaseUrlFor(apiType),
    model: process.env.LLM_API_MODEL || defaultModelFor(apiType),
  };
}

/**
 * The central help screen: a one-line command summary and the shared options,
 * printed by `npm run help` and as the --help / usage screen (see main).
 * @returns {string}
 */
export function helpText() {
  const cache = [
    [
      "--cache-clear",
      "Delete every cache directory before the review, so all fetched sources (schema, library-hash DB, CDN lookups, allowed-experiments) are re-downloaded from scratch - as on a first run.",
    ],
    [
      "--cache-schema-dir <dir>",
      `Where the downloaded schema zips are cached (default: ${DEFAULT_CACHE}).`,
    ],
    [
      "--cache-hash-db-dir <dir>",
      `Where the fetched library-hash database is cached (default: ${LIBRARY_HASHES_CACHE}).`,
    ],
    [
      "--cache-cdn-lookup-dir <dir>",
      `Where the CDN hash-lookup results are cached - best-effort, backing the optional --cdn-lib-lookup (default: ${CDN_LOOKUP_CACHE}).`,
    ],
    [
      "--cache-experiments-dir <dir>",
      `Where the fetched allowed-experiments zip is cached (default: ${EXPERIMENTS_CACHE}).`,
    ],
  ];

  const checks = [
    [
      "--checks-only <ids>",
      `Only run these checks (comma-separated). Available: ${loadRegistry().checkIds().join(", ")}.`,
    ],
    ["--checks-skip <ids>", "Skip these checks (comma-separated)."],
  ];

  const report = [
    ["--report-format <text|json>", "Report output format (default: text)."],
    [
      "--report-out <file>",
      "Write the report to a file in addition to stdout.",
    ],
  ];

  const llmFlags = [
    [
      "--llm-review",
      "Run the AI review (off by default): the model re-judges escalated 'unsure' items, and a Summary of add-on (plus a Summary of changes with --diff-to) is added. Cloud (Claude/ChatGPT) or a local model (Ollama), configured via the LLM_API_* environment variables; see the README.",
    ],
    ["--llm-list-models", "List the models your token can use, then exit."],
  ];

  const llmEnv = [
    ["LLM_API_TYPE", "Provider: claude (default), chatgpt, or ollama (local)."],
    [
      "LLM_API_KEY",
      "Provider API key. Required for claude/chatgpt, unused by ollama.",
    ],
    [
      "LLM_API_MODEL",
      "Model for the LLM checks (default: the one named in assets/llm/<type>.yaml, which also holds each model's request settings).",
    ],
    [
      "LLM_API_URL",
      "Override the provider's API base URL (proxy, or a remote Ollama host).",
    ],
  ];

  const sca = [
    [
      "--sca-root <folder|zip>",
      "The source archive root (holds package.json/lock). Switches to SCA mode - the readable source is reviewed for code defects (and is the subject of the behavioral --llm-review), its declared dependencies are audited for popularity + vulnerabilities, and the built XPI (the positional path) is the shipped artifact: authoritative for the manifest, experiments, file-completeness (bundled/web-accessible/unused), the --diff-to baseline comparison, and the packaging summary.",
    ],
    [
      "--sca-source <path>",
      "The add-on code root, relative to --sca-root or an absolute path (e.g. src or addon). Optional; defaults to . (the whole --sca-root reviewed as the source - a flat layout where manifest.json sits at the root). Needs --sca-root.",
    ],
    [
      "--sca-exp-source <path>",
      "The Experiment implementation folder, relative to --sca-root or an absolute path, and within --sca-source (e.g. addon/experiment-api). Its files are privileged, non-WebExtension code, so they are excluded from the WebExtension API/permission/eval checks (which would otherwise false-positive on Services/ChromeUtils). Needs --sca-root; REQUIRED when --allow-experiments is used in SCA mode.",
    ],
  ];

  const other = [
    [
      "--allow-experiments",
      "Accept add-ons that use Experiment APIs (off by default).",
    ],
    [
      "--cdn-lib-lookup <true|false>",
      "Identify an unrecognized bundled library (minified or readable) by a jsDelivr content-hash lookup (default: true). Results are cached; an offline run simply finds no match.",
    ],
    [
      "--diff-to <xpi|folder>",
      "Previously published version, to diff against. With --llm-review, adds an AI Summary of the changes.",
    ],
    [
      "--eslint",
      "Run the ESLint code-sanity checks on authored JS (off by default).",
    ],
    ["--help", "Show this help."],
    ["--verbose", "Verbose logging (text mode only)."],
  ];

  const commands = [
    [
      "node verify.js <xpi|folder> [options]",
      "verify an .xpi or source folder against the Thunderbird schema and review policies",
    ],
  ];

  return [
    "webext-linter - verify Thunderbird WebExtensions",
    "",
    "Usage:",
    ...commands.map(([cmd, desc]) => optionLine(cmd, desc)),
    "",
    "Cache:",
    ...cache.map(([flag, desc]) => optionLine(flag, desc)),
    "",
    "Check selection:",
    ...checks.map(([flag, desc]) => optionLine(flag, desc)),
    "",
    "Report output:",
    ...report.map(([flag, desc]) => optionLine(flag, desc)),
    "",
    "LLM checks:",
    ...llmFlags.map(([flag, desc]) => optionLine(flag, desc)),
    "",
    "Environment (LLM checks):",
    ...llmEnv.map(([flag, desc]) => optionLine(flag, desc)),
    "",
    "Source code archive (SCA):",
    ...sca.map(([flag, desc]) => optionLine(flag, desc)),
    "",
    "Other:",
    ...other.map(([flag, desc]) => optionLine(flag, desc)),
    "",
    "Exit codes: 0 = no errors, 1 = one or more error-severity findings,",
    "            2 = tool failure.",
    "",
  ].join("\n");
}

const OPTIONS = {
  "cache-clear": { type: "boolean" },
  "cache-schema-dir": { type: "string" },
  "cache-hash-db-dir": { type: "string" },
  "cache-cdn-lookup-dir": { type: "string" },
  "cache-experiments-dir": { type: "string" },
  "cdn-lib-lookup": { type: "string" },
  "checks-only": { type: "string" },
  "checks-skip": { type: "string" },
  eslint: { type: "boolean" },
  "allow-experiments": { type: "boolean" },
  "sca-root": { type: "string" },
  "sca-source": { type: "string" },
  "sca-exp-source": { type: "string" },
  "diff-to": { type: "string" },
  "report-format": { type: "string" },
  "report-out": { type: "string" },
  "llm-list-models": { type: "boolean" },
  "llm-review": { type: "boolean" },
  verbose: { type: "boolean" },
  help: { type: "boolean" },
};

/**
 * The interactive "the LLM request cap was reached - run more?" prompt, handed
 * to the pipeline's request budget (src/llm/budget.js). Reads stdin and writes
 * the question to stderr so it never mixes into the stdout report. Only wired up
 * for an interactive text run. A non-"y" answer (or EOF) stops, and the run's
 * remaining LLM work escalates to manual review.
 * @param {number} used  Requests already made this run.
 * @param {number} step  How many more a yes grants (the model's maxRequests).
 * @returns {Promise<boolean>}  Whether to allow `step` more.
 */
async function confirmMoreLlmRequests(used, step) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    const answer = await rl.question(
      `\nReached the LLM request limit (${used} requests this run). ` +
        `Run ${step} more? [y/N] `
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>} process exit code
 */
export async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: OPTIONS,
      allowPositionals: true,
    });
  } catch (err) {
    emitBanner(argv);
    process.stderr.write(`${cleanParseError(err)}\n\n${helpText()}`);
    return 2;
  }
  const { values, positionals } = parsed;

  // Output routing by format. Everything the tool narrates (the what-is-going-on
  // feed) is standard output, alongside the report - only real tool errors go to
  // stderr. JSON is a machine contract: quiet silences the feed so stdout
  // carries only the document. A text --report-out records the feed so the file
  // is a carbon copy of the screen.
  const format = values["report-format"] || "text";
  setQuiet(format === "json");
  setVerbose(values.verbose);
  setProgress(format === "text");
  setCapture(format === "text" && Boolean(values["report-out"]));
  // Color only on an interactive text screen. Piped/redirected runs and JSON
  // stay plain, and the --report-out copy is stripped below either way.
  setColor(format === "text" && Boolean(process.stdout.isTTY));

  // Open every direct run with the npm-style banner (suppressed for npm runs,
  // which print their own, and for JSON via quiet). Emitted before the branches
  // below so --help, list-models, and validation errors all carry it too.
  emitBanner(argv);

  if (values["llm-list-models"]) {
    return runListModels();
  }

  if (values.help || positionals.length === 0) {
    process.stdout.write(helpText());
    return values.help ? 0 : 2;
  }

  if (format !== "text" && format !== "json") {
    process.stderr.write(
      `Invalid --report-format "${format}" (expected text or json).\n`
    );
    return 2;
  }

  // --sca-root is the SCA-mode switch. --sca-source and --sca-exp-source name locations
  // INSIDE it, so they are meaningless on their own. --sca-root alone is fine:
  // --sca-source defaults to "." (the whole root reviewed as the source).
  if (
    (values["sca-source"] || values["sca-exp-source"]) &&
    !values["sca-root"]
  ) {
    process.stderr.write(
      "--sca-source and --sca-exp-source require --sca-root (SCA mode).\n"
    );
    return 2;
  }
  // In SCA mode there is no manifest trace to separate Experiment code from
  // WebExtension code (the readable source is reviewed whole), so allowing
  // Experiments REQUIRES naming their folder via --sca-exp-source. Without it the
  // privileged Experiment code would be reviewed as WebExtension code and flood the
  // report with false positives.
  if (
    values["sca-root"] &&
    values["allow-experiments"] &&
    !values["sca-exp-source"]
  ) {
    process.stderr.write(
      "--sca-exp-source is required with --allow-experiments in source code " +
        "archive (SCA) mode (it locates the Experiment code so it is not reviewed " +
        "as WebExtension code).\n"
    );
    return 2;
  }

  const only = splitList(values["checks-only"]);
  const skip = splitList(values["checks-skip"]);
  // Parse the registry once and thread it into the pipeline, so the yaml is read
  // a single time per run rather than re-parsed per concern.
  const registry = loadRegistry();
  const ids = registry.checkIds();
  const badCheck = unknownId([...(only ?? []), ...(skip ?? [])], ids);
  if (badCheck) {
    process.stderr.write(
      `Unknown check "${badCheck}" (--checks-only/--checks-skip). Available: ${ids.join(", ")}.\n`
    );
    return 2;
  }

  // The LLM is opt-in (--llm-review). Its config (key requirement, an unknown
  // type, a missing/unreachable local model) is validated at the pipeline's
  // Setup pre-flight, which hard-fails there - so there is nothing to check
  // here.

  // The run-wide LLM request cap prompts to continue only at an interactive text
  // terminal. JSON/piped/CI runs have no one to ask, so they hard-stop at the
  // cap (remaining LLM work escalates to manual review).
  const interactive =
    format === "text" && Boolean(process.stdin.isTTY && process.stdout.isTTY);

  let result;
  try {
    // Reading the options can fail the same way the review can - an LLM_API_MODEL
    // whose model table does not parse is a bad config, not a bad add-on - so it is
    // inside the catch below and reported like one, rather than as a stack trace
    // from verify.js's last-resort handler.
    const opts = pipelineOptsFromValues(values);
    // --cache-clear: wipe every cache dir up front so the resolvers re-fetch each
    // source from scratch during this review, exactly as on a first run. Lists every
    // cache dir opt - a new cache added to pipelineOptsFromValues must be added here
    // too, or --cache-clear would silently skip it. LLM_MODEL_CACHE is named
    // directly: it is the one cache with no --cache-*-dir flag (see src/config.js).
    if (values["cache-clear"]) {
      clearCaches([
        opts.schemaCache,
        opts.libraryHashesCache,
        opts.cdnLookupCache,
        opts.experimentsCache,
        LLM_MODEL_CACHE,
      ]);
    }
    result = await runPipeline({
      addonPath: positionals[0],
      ...opts,
      confirmMore: interactive ? confirmMoreLlmRequests : undefined,
      registry,
    });
  } catch (err) {
    // A pipeline throw is a tool failure the review could not run through (an
    // unreachable/unusable schema, a bad LLM config, an unreadable add-on): state
    // it plainly and exit 2, distinct from a completed review that found errors.
    process.stderr.write(`${err.message}\n${red("verify failed")}\n`);
    return 2;
  }

  // The full report comes from the report layer: formatReview assembles the body, the advisory
  // LLM summaries (text only), and the verdict tally LAST, in the shipped order. The CLI just
  // writes it.
  const rendered = formatReview(result, format);
  process.stdout.write(rendered + "\n");

  // --report-out saves a carbon copy of stdout: the captured feed and the full report. Color
  // codes are stripped so the saved file is plain even when the screen was colored.
  const reportOut = values["report-out"];
  if (reportOut) {
    const copy = stripColor(getCapture() + rendered + "\n");
    fs.writeFileSync(path.resolve(reportOut), copy);
  }

  return hasErrors(result.findings) ? 1 : 0;
}

/**
 * Delete cache directories so the next review re-fetches every source from
 * scratch (--cache-clear). `force:true` makes an already-absent dir a no-op.
 * @param {string[]} dirs
 * @returns {void}
 */
function clearCaches(dirs) {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Map parsed CLI `values` (from parseArgs with OPTIONS) to runPipeline opts.
 * Shared by main() and the test harness so both honor the real flag names.
 * Does not include `action`/`addonPath` (those come from the command/path).
 * @param {Record<string, string|boolean|string[]>} values
 * @returns {Partial<PipelineOpts>}
 */
function pipelineOptsFromValues(values) {
  const llm = resolveLlm(values);
  return {
    schemaCache: values["cache-schema-dir"] || DEFAULT_CACHE,
    libraryHashesCache: values["cache-hash-db-dir"] || LIBRARY_HASHES_CACHE,
    cdnLookupCache: values["cache-cdn-lookup-dir"] || CDN_LOOKUP_CACHE,
    experimentsCache: values["cache-experiments-dir"] || EXPERIMENTS_CACHE,
    // --cdn-lib-lookup true|false (default true); only an explicit "false" disables.
    cdnLookup: values["cdn-lib-lookup"] !== "false",
    checksOnly: splitList(values["checks-only"]),
    checksSkip: splitList(values["checks-skip"]),
    eslint: values.eslint,
    allowExperiments: values["allow-experiments"],
    scaRoot: values["sca-root"],
    scaSource: values["sca-source"],
    scaExpSource: values["sca-exp-source"],
    diffTo: values["diff-to"],
    llmReview: llm.wants,
    llmApiKey: llm.apiKey,
    llmModel: llm.model,
    llmApiUrl: llm.apiUrl,
    llmApiType: llm.apiType,
  };
}

/**
 * Parse CLI flag args into runPipeline opts (no validation). Lets the test
 * harness drive runPipeline with real flag names (e.g. ["--allow-experiments"]).
 * @param {string[]} argv
 * @returns {Partial<PipelineOpts>}
 */
export function pipelineOptsFromArgv(argv) {
  const { values } = parseArgs({
    args: argv,
    options: OPTIONS,
    allowPositionals: true,
  });
  return pipelineOptsFromValues(values);
}

/**
 * Print the models the configured provider's token can use, then exit (the
 * --llm-list-models command). Needs a token, but no add-on path. The provider is
 * LLM_API_TYPE (default claude). LLM_API_URL overrides the endpoint.
 *
 * @returns {Promise<number>} process exit code
 */
async function runListModels() {
  const type = (process.env.LLM_API_TYPE || DEFAULT_LLM_TYPE).toLowerCase();
  const token = process.env.LLM_API_KEY || undefined;
  // The provider owns the requirements: an unknown type, or a key required but
  // missing (Ollama is keyless, so it lists without one).
  const configError = validateLlmConfig(type, { apiKey: token });
  if (configError) {
    process.stderr.write(`${configError}\n`);
    return 2;
  }
  const baseURL = process.env.LLM_API_URL || defaultBaseUrlFor(type);
  let models;
  try {
    models = await getProvider(type).listModels({ token, baseURL });
  } catch (err) {
    process.stderr.write(`Could not list models: ${err.message}\n`);
    return 2;
  }
  const defaultModel = defaultModelFor(type);
  const lines = models.map((m) => {
    const name = m.displayName ? `  (${m.displayName})` : "";
    const def = m.id === defaultModel ? "  [default]" : "";
    return `  ${m.id}${name}${def}`;
  });
  process.stdout.write(
    `Available ${type} models (default: ${defaultModel}):\n${lines.join("\n")}\n`
  );
  return 0;
}

/**
 * Return the first id not in `valid`, or undefined when all are known.
 *
 * @param {string[]} ids
 * @param {string[]} valid
 * @returns {string|undefined}
 */
function unknownId(ids, valid) {
  return ids.find((id) => !valid.includes(id));
}

/**
 * Split a comma-separated string into a trimmed array, or return undefined.
 *
 * @param {string|undefined} value
 * @returns {string[]|undefined}
 */
function splitList(value) {
  if (!value) {
    return undefined;
  }
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
