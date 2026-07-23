// A small wrapper around the parse5 HTML parser, shared by the inline-script
// extractor, the Vue SFC extractor (src/scan/vue-sfc.js) and the
// remote-reference scanner. Using a real (spec-compliant)
// parser instead of regexes means attribute values that contain ">", quoting,
// comments and CDATA are handled correctly, and element/line positions come
// from parse5's source-location info rather than newline counting.
//
// Belongs here: the parse5 front door - low-level HTML parsing primitives
// (element walking, attribute access, raw-text/line positions). Any code
// needing parse5 goes through here, analogous to how src/parse/ast.js is the
// Babel front door.
//
// Does NOT belong here: deciding what markup facts matter - higher-level HTML
// scanning is src/scan/html.js and inline-script extraction is
// src/addon/sources.js. JavaScript AST parsing is a different subsystem
// (src/parse/ast.js).

import { parse } from "parse5";

/**
 * A parse5 tree location (the subset we read).
 * @typedef {object} Parse5Location
 * @property {number} [startLine]  1-based start line.
 * @property {{startLine?: number}} [startTag]  Start-tag location.
 * @property {Object<string, {startLine?: number}>} [attrs]  Per-attribute
 *   locations, keyed by attribute name.
 */

/**
 * A raw parse5 tree node (the subset this wrapper reads). parse5's own node
 * types are a generic adapter map, so this names just the fields we touch.
 * @typedef {object} Parse5Node
 * @property {string} [tagName]  Tag name (element nodes).
 * @property {string} [nodeName]  Node name ("#text" for text nodes).
 * @property {string} [value]  Text content (text nodes).
 * @property {{name: string, value: string}[]} [attrs]  Element attributes.
 * @property {Parse5Node[]} [childNodes]  Child nodes.
 * @property {Parse5Node} [content]  Fragment holding a <template>'s children.
 * @property {Parse5Location} [sourceCodeLocation]  Source position.
 */

/**
 * @typedef {object} HtmlElement
 * @property {string} tag  Lowercased tag name.
 * @property {(name: string) => (string|null)} attr  Attribute value, or null.
 * @property {{name: string, value: string, line: number}[]} attrList  Every
 *   attribute (lowercased name) with its value and 1-based start line. Used to
 *   scan directive attributes whose name is not known ahead of time (Vue `:x`,
 *   `@x`, `v-x`).
 * @property {number} line  1-based line of the element's start tag.
 * @property {{value: string, startLine: number}|null} rawText  The raw text
 *   child for rawtext elements (script/style): its content and the 1-based line
 *   where it begins. Null when the element has no text child.
 */

/**
 * Invoke `callback` for every element in an HTML document, in document order.
 * @param {string} html  HTML source text.
 * @param {(el: HtmlElement) => void} callback
 * @param {object} [opts]
 * @param {boolean} [opts.intoTemplates]  Also descend into a <template>'s content
 *   fragment (parse5 keeps it off `childNodes`). Off by default so the HTML path
 *   is unchanged; the Vue SFC extractor turns it on to reach template markup.
 */
export function eachElement(html, callback, { intoTemplates = false } = {}) {
  const doc = parse(html, { sourceCodeLocationInfo: true });
  /** @param {Parse5Node} node  parse5 node whose children to visit. */
  const walk = (node) => {
    for (const child of node.childNodes || []) {
      if (child.tagName) {
        callback(toElement(child));
      }
      walk(child);
    }
    if (intoTemplates && node.content) {
      walk(node.content);
    }
  };
  walk(doc);
}

/**
 * Collect the visible text of an HTML document: every `#text` node's content,
 * skipping the rawtext children of `script`/`style` (code, not user-facing
 * copy). Whitespace is preserved as-is. The caller collapses it. Used by the
 * language check to extract user-facing strings.
 * @param {string} html  HTML source text.
 * @returns {string}  Text fragments joined by single spaces.
 */
export function visibleText(html) {
  const doc = parse(html);
  const parts = [];
  /** @param {Parse5Node} node  parse5 node whose children to visit. */
  const walk = (node) => {
    for (const child of node.childNodes || []) {
      const tag = child.tagName?.toLowerCase();
      if (tag === "script" || tag === "style") {
        continue; // rawtext element - its text is code, not user-facing copy
      }
      if (child.nodeName === "#text" && typeof child.value === "string") {
        parts.push(child.value);
      }
      walk(child);
    }
  };
  walk(doc);
  return parts.join(" ");
}

/**
 * Adapt a parse5 element node to the HtmlElement shape.
 * @param {Parse5Node} node  A parse5 element node.
 * @returns {HtmlElement}
 */
function toElement(node) {
  const rawAttrs = node.attrs || [];
  const attrs = new Map(rawAttrs.map((a) => [a.name.toLowerCase(), a.value]));
  const loc = node.sourceCodeLocation;
  const line = loc ? (loc.startTag?.startLine ?? loc.startLine ?? 1) : 1;
  const attrLocs = loc?.attrs || {};
  const attrList = rawAttrs.map((a) => {
    const name = a.name.toLowerCase();
    const al = attrLocs[name] ?? attrLocs[a.name];
    return { name, value: a.value, line: al?.startLine ?? line };
  });
  const textNode = (node.childNodes || []).find((c) => c.nodeName === "#text");
  const rawText =
    textNode && textNode.sourceCodeLocation
      ? {
          value: textNode.value,
          startLine: textNode.sourceCodeLocation.startLine,
        }
      : null;
  return {
    tag: node.tagName.toLowerCase(),
    attr: (name) => (attrs.has(name) ? attrs.get(name) : null),
    attrList,
    line,
    rawText,
  };
}
