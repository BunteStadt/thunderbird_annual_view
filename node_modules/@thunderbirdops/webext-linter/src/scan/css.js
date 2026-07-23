// Scans a CSS file for external references: @import (a CSS *source*, must be
// bundled) and url() (fonts/images - resources). Uses the postcss parser plus
// postcss-value-parser rather than regexes, so url() inside comments is ignored
// and quoting / parentheses inside data URIs are handled correctly. The
// remote-code check flags the remote ones.
//
// Belongs here: CSS parsing and extraction of @import and url() references with
// their kind, line, and URL classification.
//
// Does NOT belong here: deciding which references are violations and the
// reviewer-facing wording - that lives in the checks (src/checks/rules/*) and
// the registry (assets/registry.yaml). URL remote/local classification belongs
// to src/scan/url.js. HTML markup scanning is src/scan/html.js.

import postcss from "postcss";
import valueParser from "postcss-value-parser";
import { classifyUrl } from "./url.js";
import { REF_KIND } from "../lib/enum.js";

/**
 * @typedef {object} CssRef
 * @property {import("../lib/enum.js").RefKind} kind  Reference kind.
 * @property {string} url  The referenced URL.
 * @property {import("../lib/enum.js").UrlClass} klass  URL classification.
 * @property {number} line  1-based source line.
 */

/**
 * @param {string} css  CSS source text to scan.
 * @returns {CssRef[]}
 */
export function scanCssRemoteRefs(css) {
  const refs = [];
  let root;
  try {
    root = postcss.parse(css);
  } catch {
    return refs; // tolerate malformed CSS rather than throwing
  }

  // @import "<url>" | @import url("<url>") [media...]; (comments are separate
  // nodes, so a url() inside a comment is never seen here).
  root.walkAtRules("import", (rule) => {
    const url = firstRef(rule.params);
    if (url != null) {
      refs.push({
        kind: REF_KIND.IMPORT,
        url,
        klass: classifyUrl(url),
        line: rule.source?.start?.line ?? 1,
      });
    }
  });

  // url(...) in declaration values (background, @font-face src, etc.).
  root.walkDecls((decl) => {
    for (const url of urlsIn(decl.value)) {
      refs.push({
        kind: REF_KIND.URL,
        url,
        klass: classifyUrl(url),
        line: decl.source?.start?.line ?? 1,
      });
    }
  });

  return refs;
}

/**
 * First URL in an @import's params: the argument of `url(...)`, or a bare
 * string token (`@import "x"`).
 * @param {string} params  The raw @import parameter text.
 * @returns {string|null}
 */
function firstRef(params) {
  let found = null;
  valueParser(params).walk((node) => {
    if (found != null) {
      return false;
    }
    if (node.type === "function" && node.value.toLowerCase() === "url") {
      found = urlArg(node);
      return false;
    }
    if (node.type === "string") {
      found = node.value;
      return false;
    }
    return undefined;
  });
  return found;
}

/**
 * All url(...) arguments in a declaration value.
 * @param {string} value  The raw declaration value text.
 * @returns {string[]}
 */
function urlsIn(value) {
  const out = [];
  valueParser(value).walk((node) => {
    if (node.type === "function" && node.value.toLowerCase() === "url") {
      const u = urlArg(node);
      if (u != null) {
        out.push(u);
      }
      return false; // do not descend into the url() argument
    }
    return undefined;
  });
  return out;
}

/**
 * The string/word argument of a parsed `url()` function node.
 * @param {{nodes: {value: string}[]}} fnNode  A value-parser function node.
 * @returns {string|null}
 */
function urlArg(fnNode) {
  const arg = fnNode.nodes[0];
  return arg ? arg.value : null;
}
