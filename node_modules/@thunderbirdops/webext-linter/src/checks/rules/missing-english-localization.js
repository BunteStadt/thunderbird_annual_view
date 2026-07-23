// Deterministic check: an add-on whose user-facing text is not English. Declared
// `input: xpi`, so ctx.addon is the built XPI (a source submission's _locales may
// be generated or live outside --sca-source). The pre-flight reads its _locales/
// <dir> set:
//   - uses _locales with an English directory (en, en-US, ...) -> pass.
//   - uses _locales but has no English directory -> a finding.
//   - no _locales at all -> language-detect the hardcoded user-facing text
//     (HTML visible text + manifest name/description) with franc: confident
//     English passes, confident non-English is a finding, and too little or
//     ambiguous text escalates to manual review (the orchestrator routes a
//     deterministic check's escalation straight to a manual note, no LLM).
//
// Belongs here: collecting the _locales set, gathering the user-facing text, and
// turning a franc verdict into pass / finding / manual escalation. Does NOT
// belong here: the visible-text extraction (-> src/scan/html-parse.js), the
// deterministic->manual routing of the escalation (-> src/checks/registry.js +
// escalation.js), authored wording (-> assets/registry.yaml), and severity
// (-> that registry entry, stamped by runChecks).

import { VERDICT } from "../../lib/enum.js";
import { francAll } from "franc-min";
import { finding } from "../../report/finding.js";
import { visibleText } from "../../scan/html-parse.js";

/** @typedef {import("../registry.js").RunContext} RunContext */
/** @typedef {import("../../addon/load.js").Addon} Addon */

const ENGLISH_DIR = /^en([-_]|$)/i;
const HTML_FILE = /\.x?html?$/i;
// The franc library is unreliable on short samples, so below this many
// characters of user-facing text we do not trust a non-English verdict and
// defer to a human.
const MIN_CONFIDENT = 40;
// The franc-all library scores the top language 1 and the rest relative to it.
// When English scores this close to a non-English top language, the call is too
// close to flag.
const NEAR_TIE = 0.9;

export default {
  /**
   * @param {RunContext} ctx
   * @returns {{findings: import("../../report/finding.js").Finding[],
   *   escalations: import("../escalation.js").Escalation[]}}
   */
  run(ctx) {
    // ctx.addon is the built XPI (`input: xpi`) - what users install: its _locales
    // and its user-facing text, like its siblings default-locale-missing / -unused.
    const { addon } = ctx;
    const files = addon?.files;
    if (!files) {
      ctx.note?.("manifest.json", null, "no files", VERDICT.SKIPPED);
      return { findings: [], escalations: [] };
    }
    const localeDirs = new Set(
      [...files.keys()]
        .filter((p) => p.startsWith("_locales/"))
        .map((p) => p.split("/")[1])
        .filter(Boolean)
    );

    // No _locales: the text is hardcoded, so detect its language directly.
    if (localeDirs.size === 0) {
      return detectHardcodedLanguage(ctx, addon);
    }

    // Uses _locales: an English locale is required - resolved deterministically.
    const english = [...localeDirs].find((d) => ENGLISH_DIR.test(d));
    if (english) {
      ctx.note?.(
        "manifest.json",
        null,
        `English locale present (_locales/${english})`,
        VERDICT.PASS
      );
      return { findings: [], escalations: [] };
    }
    ctx.note?.(
      "manifest.json",
      null,
      "_locales has no English directory",
      VERDICT.FAIL
    );
    return {
      findings: [finding({ file: "manifest.json" })],
      escalations: [],
    };
  },
};

/**
 * Language-detect the add-on's hardcoded user-facing text and map the result to
 * pass / finding / manual escalation.
 * @param {RunContext} ctx  For ctx.note (and the escalation routing).
 * @param {Addon} addon  The shipped add-on whose text is detected.
 * @returns {{findings: import("../../report/finding.js").Finding[],
 *   escalations: import("../escalation.js").Escalation[]}}
 */
function detectHardcodedLanguage(ctx, addon) {
  const text = userFacingText(ctx.manifest, addon.files);
  /**
   * Record an advisory note against manifest.json.
   * @param {string} msg  The note text.
   * @param {import("../../lib/enum.js").Verdict} verdict  The note verdict.
   * @returns {void}
   */
  const note = (msg, verdict) =>
    ctx.note?.("manifest.json", null, msg, verdict);
  if (!text) {
    note("no user-facing text to localize", VERDICT.PASS);
    return { findings: [], escalations: [] };
  }

  const ranked = francAll(text);
  const [topLang] = ranked[0] ?? ["und"];
  const engScore = ranked.find(([code]) => code === "eng")?.[1] ?? 0;

  // Too little text, or franc cannot tell - a human decides (manual review).
  if (text.length < MIN_CONFIDENT || topLang === "und") {
    note("too little user-facing text to detect a language", VERDICT.UNSURE);
    // Anchored to manifest.json (matching the confident finding below) so the
    // post-summary recheck has a stable key to re-judge with all the text in view.
    return { findings: [], escalations: [{ file: "manifest.json" }] };
  }
  if (topLang === "eng") {
    note("user-facing text is English", VERDICT.PASS);
    return { findings: [], escalations: [] };
  }
  // A non-English top language, but English nearly ties it - too close to flag.
  if (engScore >= NEAR_TIE) {
    note(
      `user-facing text language is ambiguous (${topLang} vs English)`,
      VERDICT.UNSURE
    );
    // Anchored to manifest.json (matching the confident finding below) so the
    // post-summary recheck has a stable key to re-judge with all the text in view.
    return { findings: [], escalations: [{ file: "manifest.json" }] };
  }
  note(`non-English user-facing text (${topLang})`, VERDICT.FAIL);
  return {
    findings: [finding({ file: "manifest.json" })],
    escalations: [],
  };
}

/**
 * The add-on's user-facing text: the manifest name and description plus the
 * visible text of every packaged HTML document, whitespace-collapsed. The
 * franc input - excludes JS (string literals are noise) and binary assets.
 * @param {?import("../../addon/load.js").Manifest} manifest  The shipped
 *   manifest (ctx.manifest).
 * @param {Map<string, Buffer>} files  The reviewed artifact's files.
 * @returns {string}
 */
function userFacingText(manifest, files) {
  const parts = [];
  if (typeof manifest?.name === "string") {
    parts.push(manifest.name);
  }
  if (typeof manifest?.description === "string") {
    parts.push(manifest.description);
  }
  for (const [path, buf] of files) {
    if (HTML_FILE.test(path)) {
      parts.push(visibleText(buf.toString("utf8")));
    }
  }
  // Drop __MSG_*__ i18n placeholders so they do not skew detection.
  return parts
    .join(" ")
    .replace(/__MSG_[A-Za-z0-9_@]+__/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
