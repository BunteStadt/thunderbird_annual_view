// Minimal logger for the tool's narration - the live "what is going on" feed
// (setup notices, progress, LLM activity). This is standard output: the feed is
// one of the run's phases and goes to stdout, alongside the report. Only REAL
// tool errors go to stderr, and those are written directly by the CLI (not
// here). In quiet mode (--report-format json) nothing is emitted, so stdout
// carries only the JSON document. When capture is on (the CLI turns it on for a
// text --report-out), every emitted line is also recorded so the file is a
// carbon copy of the screen.
//
// Belongs here: the narration feed - info, debug (verbose), warn, progress, and
// the verbose/progress/quiet/capture toggles.
//
// Does NOT belong here: user-facing report content (findings, summaries), which
// is built and emitted by src/report/*. Real tool errors (CLI writes those to
// stderr directly). The capture buffer is only the activity feed - it is not the
// report itself.

let verbose = false;
let progressOn = false;
let quiet = false;
/** @type {string[]|null} Recorded lines while capturing, else null. */
let captured = null;

/**
 * Enable or disable verbose logging.
 *
 * @param {boolean|undefined} v
 */
export function setVerbose(v) {
  verbose = Boolean(v);
}

/**
 * Enable or disable the live progress feed (which check is running, LLM
 * escalations). The CLI turns it on for text runs. JSON and test runs leave it
 * off so they stay quiet.
 *
 * @param {boolean|undefined} v
 */
export function setProgress(v) {
  progressOn = Boolean(v);
}

/**
 * Enable or disable quiet mode. When quiet, nothing is narrated or recorded -
 * the CLI turns this on for --report-format json so stdout carries only the JSON
 * document (real tool errors still go to stderr, written by the CLI directly).
 *
 * @param {boolean|undefined} v
 */
export function setQuiet(v) {
  quiet = Boolean(v);
}

/**
 * Begin (or stop) recording emitted lines, for inclusion in a --report-out
 * file. Enabling resets the buffer.
 *
 * @param {boolean|undefined} v
 */
export function setCapture(v) {
  captured = v ? [] : null;
}

/**
 * The recorded lines as text, each terminated by a newline, or "" when capture
 * is off.
 *
 * @returns {string}
 */
export function getCapture() {
  return captured ? captured.map((line) => `${line}\n`).join("") : "";
}

/**
 * The feed's indentation levels, applied by emit() so callers narrate at a
 * semantic level and never hand-code spaces. SECTION headings sit at column 0
 * (── Setup ──, blank separators); STEP is one feed step ([i/total], the
 * per-check line, an LLM-generating line); DETAIL is a line nested under its
 * step (an investigation note, a skipped-file notice, an LLM verdict). The
 * 6-space DETAIL width matches the `• [verdict]` findings the checks emit.
 *
 * @readonly
 * @enum {number}
 */
export const FEED = { SECTION: 0, STEP: 1, DETAIL: 2 };

// Indentation for each FEED level, indexed by its value. Owned here so the feed's
// shape lives in one place; callers pass a level, emit() maps it to spaces.
const PREFIX = ["", "  ", "      "];

/**
 * The indent string for a feed level, for a caller that must build the prefix
 * into a wrapText() call so wrapped continuation lines hang-align (the LLM
 * verdict list, the escalation header). A plain line passes the level to
 * progress()/warn() instead of prefixing by hand.
 *
 * @param {number} level  A FEED value.
 * @returns {string}
 */
export function feedIndent(level) {
  return PREFIX[level] ?? "";
}

/**
 * Narrate to stdout when `show`, indented for its feed level, and record the
 * line whenever capture is on (independent of `show`). Quiet mode (JSON) emits
 * and records nothing. The level's indent is prepended to the first argument so
 * it sits OUTSIDE any color the caller wrapped the text in (spaces are colorless).
 *
 * @param {unknown[]} args
 * @param {boolean} show
 * @param {number} [level]  A FEED value; defaults to SECTION (column 0).
 */
function emit(args, show, level = FEED.SECTION) {
  if (quiet) {
    return;
  }
  const prefix = PREFIX[level] ?? "";
  const out =
    prefix && args.length ? [prefix + String(args[0]), ...args.slice(1)] : args;
  if (show) {
    console.log(...out);
  }
  if (captured) {
    captured.push(out.map(String).join(" "));
  }
}

/**
 * Narrate an informational line to the feed (stdout) - always shown (unless
 * quiet), at SECTION (column 0). Used for the run banner, which is not part of
 * the progress-gated feed.
 *
 * @param {...unknown} args
 */
export function info(...args) {
  emit(args, true);
}

/**
 * Narrate a debug line to the feed (stdout, only when verbose is enabled).
 * Recorded for capture only when verbose, so a non-verbose run does not bloat
 * the file.
 *
 * @param {...unknown} args
 */
export function debug(...args) {
  if (verbose) {
    emit(args, true);
  }
}

/**
 * Narrate a warning notice to the feed - a line nested under its step (DETAIL),
 * shown when progress is enabled (a text run) and recorded for capture. These
 * are feed narration, not errors; real tool errors go to stderr, written by the
 * CLI.
 *
 * @param {...unknown} args
 */
export function warn(...args) {
  emit(args, progressOn, FEED.DETAIL);
}

/**
 * Narrate a live progress line to the feed (stdout, only when progress is
 * enabled), at its indentation level. Recorded for capture regardless, so a
 * --report-out file gets the activity feed.
 *
 * @param {string} text  One formatted feed line.
 * @param {number} [level]  A FEED value; defaults to SECTION (column 0).
 */
export function progress(text, level = FEED.SECTION) {
  emit([text], progressOn, level);
}

/**
 * A concise one-line reason from a thrown LLM/SDK error, for narrating a failed
 * LLM step in the feed (and the summary's report notice). Includes the HTTP
 * status when the provider SDK attached one (e.g. 400 for an over-long prompt -
 * whose message carries the model's token limit).
 *
 * @param {unknown} err
 * @returns {string}
 */
export function llmErrorText(err) {
  const status = err?.status ?? err?.statusCode;
  const msg = err?.message ?? String(err);
  return status ? `HTTP ${status}: ${msg}` : msg;
}
