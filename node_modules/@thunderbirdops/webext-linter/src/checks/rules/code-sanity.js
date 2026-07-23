// JavaScript code-sanity check, powered by ESLint's own rules (run in-memory
// via the Linter API - no config-file resolution). Only high-signal,
// false-positive-free single-file correctness rules are enabled (redeclare,
// shadow, dupe/unreachable/self-* etc.). Style/fixable rules are deliberately
// excluded - the tool is read-only, so a "rewrite this" suggestion is not a
// review concern. `no-undef` is also NOT enabled: WebExtension scripts share a
// global scope at runtime, so per-file undefined-symbol detection would
// false-positive heavily.
//
// Belongs here: owning the enabled ESLint rule set and globals, running the
// in-memory Linter per authored source, and emitting a finding per message.
// Does NOT belong here: the non-authored skip-list this relies on to avoid
// linting vendored/minified code (-> src/lib/bundled.js), library and
// minified/obfuscated detection (-> bundled-files.js, minified-code.js and
// obfuscated-code.js),
// authored wording (-> assets/registry.yaml - here the lint ruleId and message
// are the item, not authored prose), severity (-> that registry entry, stamped
// by src/checks/registry.js), and report formatting (-> src/report/format.js).

import { VERDICT } from "../../lib/enum.js";
import { Linter } from "eslint";
import { finding } from "../../report/finding.js";
import { nonAuthoredJs } from "../../lib/bundled.js";

const linter = new Linter({ configType: "flat" });

// Seeded for completeness/future use. With no-undef disabled these are inert
// (the enabled rules use builtinGlobals: false), but they document the runtime.
const GLOBAL_NAMES = [
  "browser",
  "messenger",
  "chrome",
  "globalThis",
  "self",
  "window",
  "document",
  "navigator",
  "location",
  "console",
  "fetch",
  "XMLHttpRequest",
  "URL",
  "URLSearchParams",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "queueMicrotask",
  "structuredClone",
  "atob",
  "btoa",
  "crypto",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "TextEncoder",
  "TextDecoder",
  "Blob",
  "FileReader",
  "FormData",
  "Headers",
  "Request",
  "Response",
  "WebSocket",
  "performance",
];
const GLOBALS = Object.fromEntries(GLOBAL_NAMES.map((g) => [g, "readonly"]));

const RULES = {
  "no-redeclare": "warn",
  "no-shadow": "warn",
  "no-const-assign": "warn",
  "no-dupe-keys": "warn",
  "no-dupe-args": "warn",
  "no-dupe-else-if": "warn",
  "no-empty": "warn",
  "no-unreachable": "warn",
  "no-self-assign": "warn",
  "no-self-compare": "warn",
  "no-unsafe-negation": "warn",
  "no-compare-neg-zero": "warn",
  "no-cond-assign": "warn",
  "valid-typeof": "warn",
};

/**
 * Build a flat config for a given source type.
 * @param {"module"|"script"} sourceType
 * @param {Record<string, string>} rules
 * @returns {import("eslint").Linter.Config}
 */
function configFor(sourceType, rules) {
  return {
    languageOptions: { ecmaVersion: "latest", sourceType, globals: GLOBALS },
    rules,
  };
}

export default {
  run(ctx) {
    // Don't lint third-party / minified / obfuscated / VENDOR.md-declared code:
    // it is not the developer's authored source, so its (often thousands of)
    // quality findings are noise. missing-library / obfuscated-code flag those
    // files and request the original sources, which are reviewed when provided.
    const skip = nonAuthoredJs(ctx);
    const out = [];
    for (const src of ctx.jsSources) {
      if (skip.has(src.file)) {
        continue;
      }
      const messages = lint(src.code, src.file, RULES);
      for (const m of messages) {
        const loc = { line: m.line + src.lineOffset, column: m.column };
        const item = `${m.ruleId || "syntax"}: ${m.message}`;
        out.push(finding({ file: src.file, loc, item }));
        ctx.note?.(src.file, loc, item, VERDICT.FAIL);
      }
      if (!messages.length) {
        ctx.note?.(src.file, null, "no lint issues", VERDICT.PASS);
      }
    }
    return out;
  },
};

/**
 * Lint a source, trying module then script parsing. Returns non-fatal messages.
 * A file unparseable under both is skipped (the parse failure is surfaced as an
 * api-coverage finding elsewhere).
 * @param {string} code
 * @param {string} filename
 * @param {Record<string, string>} rules
 * @returns {object[]}
 */
function lint(code, filename, rules) {
  for (const sourceType of ["module", "script"]) {
    let messages;
    try {
      messages = linter.verify(code, configFor(sourceType, rules), {
        filename,
      });
    } catch {
      return [];
    }
    if (!messages.some((m) => m.fatal)) {
      return messages;
    }
  }
  return [];
}
