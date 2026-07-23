// Scans an HTML document for elements that reference an external URL
// (script/link/iframe/object/embed/media). The remote-code check turns the
// remote ones into findings. Parsing is done with a real HTML parser (parse5,
// via html-parse.js), so attribute values containing ">" and the like are
// handled correctly and line numbers come from the parser.
//
// Belongs here: higher-level HTML scanning - walking elements and extracting
// their external references with kind, line, and URL classification, plus the
// CSS references that live inline in HTML (<style> blocks and style=
// attributes), routed through the same css.js scanner the .css files use.
//
// Does NOT belong here: the low-level parse5 wrapper and element walking, which
// is src/scan/html-parse.js. The CSS @import/url() scan itself is
// src/scan/css.js (reused here). Extracting inline <script> bodies for the JS
// layer is src/addon/sources.js. URL remote/local classification is
// src/scan/url.js. Verdicts and wording live in the checks (src/checks/rules/*)
// and the registry (assets/registry.yaml).

import { classifyUrl } from "./url.js";
import { REF_KIND } from "../lib/enum.js";
import { eachElement } from "./html-parse.js";
import { scanCssRemoteRefs } from "./css.js";

// Tags (other than <link>) whose external reference we scan.
const URL_TAGS = new Set([
  "script",
  "iframe",
  "frame",
  "object",
  "embed",
  "img",
  "audio",
  "video",
  "source",
]);
// Tags that embed external content (as opposed to a passive resource).
const CONTENT_TAGS = new Set(["iframe", "frame", "object", "embed"]);
// Which attribute holds the URL. Everything else uses "src". <link> is special.
const URL_ATTR = { object: "data" };

/**
 * @typedef {object} HtmlRef
 * @property {string} tag  Lowercased tag name.
 * @property {import("../lib/enum.js").RefKind} kind  Reference kind.
 * @property {string} url  The referenced URL.
 * @property {import("../lib/enum.js").UrlClass} klass  URL classification.
 * @property {number} line  1-based source line.
 */

/**
 * @param {string} html  HTML source text.
 * @returns {HtmlRef[]}
 */
export function scanHtmlRemoteRefs(html) {
  const refs = [];
  eachElement(html, (el) => {
    let url;
    let kind;
    if (el.tag === "link") {
      // A <link> loads a source when it is a stylesheet or preloads a
      // script/stylesheet. Other rels (icons, preconnect, ...) are not. `rel`
      // is a set of whitespace-separated tokens, so match by membership.
      const rels = tokenSet(el.attr("rel"));
      const as = (el.attr("as") || "").toLowerCase();
      url = el.attr("href");
      if (rels.has("stylesheet")) {
        kind = REF_KIND.CSS;
      } else if (
        rels.has("modulepreload") ||
        (rels.has("preload") && as === "script")
      ) {
        kind = REF_KIND.SCRIPT;
      } else if (rels.has("preload") && as === "style") {
        kind = REF_KIND.CSS;
      } else {
        return;
      }
    } else if (URL_TAGS.has(el.tag)) {
      url = el.attr(URL_ATTR[el.tag] || "src");
      kind =
        el.tag === "script"
          ? REF_KIND.SCRIPT
          : CONTENT_TAGS.has(el.tag)
            ? REF_KIND.CONTENT
            : REF_KIND.RESOURCE;
    } else {
      return;
    }
    if (url == null) {
      return;
    }
    refs.push({
      tag: el.tag,
      kind,
      url,
      klass: classifyUrl(url),
      line: el.line,
    });
  });
  return refs;
}

/**
 * Scan the CSS that lives INSIDE an HTML document - `<style>` blocks and
 * `style=` attributes - for the same `@import`/`url()` references
 * scanCssRemoteRefs finds in a .css file, with line numbers offset to the HTML
 * file. Lets the remote-resources check treat inline CSS exactly like a stylesheet,
 * so a remote `@import` in a `<style>` block or a remote `url()` in a style
 * attribute is not missed. Returns the same CssRef shape as scanCssRemoteRefs.
 * @param {string} html  HTML source text.
 * @returns {import("./css.js").CssRef[]}
 */
export function scanHtmlInlineCssRefs(html) {
  const refs = [];
  eachElement(html, (el) => {
    // A <style> block: its rawtext is a CSS stylesheet. The body begins at
    // rawText.startLine, so a ref's CSS line maps to the file by that offset.
    if (el.tag === "style" && el.rawText && el.rawText.value.trim() !== "") {
      const offset = el.rawText.startLine - 1;
      for (const ref of scanCssRemoteRefs(el.rawText.value)) {
        refs.push({ ...ref, line: ref.line + offset });
      }
    }
    // A style= attribute: a bare declaration list. Wrap it in a rule so postcss
    // parses the declarations (`@import` is invalid here, so only url() arises);
    // the refs are attributed to the element's own line.
    const styleAttr = el.attr("style");
    if (styleAttr) {
      for (const ref of scanCssRemoteRefs(`*{${styleAttr}}`)) {
        refs.push({ ...ref, line: el.line });
      }
    }
  });
  return refs;
}

/**
 * Parse an attribute value as a set of lowercased, whitespace-separated tokens
 * (DOMTokenList semantics, as used by `rel`).
 * @param {string|null} value  Raw attribute value.
 * @returns {Set<string>}
 */
function tokenSet(value) {
  return new Set((value || "").toLowerCase().split(/\s+/).filter(Boolean));
}
