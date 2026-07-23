// The single seam deciding whether a file is MINIFIED - machine-packed code a human
// cannot review, as opposed to readable source. The signal is structural, not
// geometric: minification packs many STATEMENTS onto one line, whereas a data literal
// (a `data:` URI, a base64 blob, an i18n string array, a JSON-as-JS config), however
// long its line, is a single EXPRESSION. So a file is minified when one source line
// carries MINIFIED_LINE_STMTS or more statement starts - not merely because it has a
// long line, which a data-dominated but perfectly readable file also has.
//
// Counting statements on the packed line (rather than statements per TOTAL line) is
// deliberate: a preserved `/** @preserve */` license header would otherwise dilute the
// average and let a genuinely minified file slip (imurmurhash.min packs 33 statements on
// one line under 11 comment lines - 2.75 per total line, 33 on the line).
//
// Belongs here: the parse and the statement-density verdict (JS), the payload strip
// (CSS), and the long-line parse-gate. Does NOT belong here: the per-file
// library/minified/obfuscated tagging and the non-authored skip set (src/lib/
// bundled.js), the minified-code finding (src/checks/rules/minified-code.js), or
// obfuscation, which is a separate structural signal (src/lib/obfuscation.js).

import { extname, JS_EXTENSIONS } from "../util/files.js";
import { parseJs, traverse } from "../parse/ast.js";
import { debug } from "../util/log.js";

// A line this long is what "packed" looks like: real minification emits lines of
// thousands of characters. Below it a file cannot be minified, so it is not parsed.
const LONG_LINE = 500;

// Statement starts on a single line at or above which the line is packed code, not a
// data literal. Measured over real files: data blobs and the false-positive shapes
// (data: URI, i18n array, JSON-as-JS) top out at 4 statements on their busiest line;
// the smallest real minified library (imurmurhash.min) packs 33; typical bundles pack
// hundreds. 10 sits in that gap with margin on both sides.
const MINIFIED_LINE_STMTS = 10;

/**
 * Whether `text` is minified code (packed, unreviewable) rather than readable source.
 * @param {string} text  JS or CSS source.
 * @param {string} [file]  The file path (decides JS vs CSS, and labels the debug log).
 * @returns {boolean}
 */
export function isMinified(text, file) {
  // Parse-gate for both languages: no long line -> not minified, and no parse.
  if (longestLine(text) <= LONG_LINE) {
    return false;
  }
  if (JS_EXTENSIONS.has(extname(file ?? ""))) {
    return maxLineStatements(text, file) >= MINIFIED_LINE_STMTS;
  }
  // CSS has no statements. A long line is minification ONLY if it survives stripping
  // the one thing that makes readable CSS long: a payload (a `data:` font in url(), a
  // quoted string) or a comment. A real minified stylesheet stays long (packed rules);
  // a stylesheet whose only long line is one data URI collapses below the gate.
  return longestLine(stripCssPayloads(text)) > LONG_LINE;
}

/**
 * The length of the longest line, without allocating the whole split array.
 * @param {string} text @returns {number}
 */
function longestLine(text) {
  let max = 0;
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === "\n") {
      if (i - start > max) {
        max = i - start;
      }
      start = i + 1;
    }
  }
  return max;
}

/**
 * The most statement starts on any single line of `text`. Fail-open: source we cannot
 * parse (already past the long-line gate) stays minified, so unparseable packed code is
 * not waved through - errorRecovery makes this rare.
 * @param {string} text @param {string} [file] @returns {number}
 */
function maxLineStatements(text, file) {
  const { ast, parseError } = parseJs(text, file);
  if (!ast) {
    debug(`minified: could not parse ${file ?? "source"}: ${parseError}`);
    return Infinity;
  }
  const perLine = new Map();
  let max = 0;
  traverse(ast, {
    enter(path) {
      if (!path.isStatement()) {
        return;
      }
      const line = path.node.loc?.start.line;
      if (line == null) {
        return;
      }
      const n = (perLine.get(line) ?? 0) + 1;
      perLine.set(line, n);
      if (n > max) {
        max = n;
      }
    },
  });
  return max;
}

/**
 * CSS with comments, url(...) payloads and quoted strings collapsed, so what is left is
 * the rule structure alone - long only when the stylesheet is genuinely packed.
 * @param {string} text @returns {string}
 */
function stripCssPayloads(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/url\([^)]*\)/gi, "url()")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}
