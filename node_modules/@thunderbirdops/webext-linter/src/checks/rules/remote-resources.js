// LLM check: the add-on must bundle everything it loads. The deterministic
// pre-flight flags the definite remote loads - <script>/<link>/<iframe>/media in
// HTML, @import/url() in CSS, import()/importScripts()/module imports, runtime
// <script> injection, remote WASM, and a content_security_policy that permits a
// remote script source. Statically-undecidable cases (non-literal URLs, inline
// data:/blob: script sources) are escalated, carrying the offending file so the
// orchestrator can ask the LLM whether the source is remote (else manual
// review).
//
// Belongs here: classifying each scanned ref as definite-remote (-> finding) or
// undecidable (-> escalation with file evidence) across HTML, CSS, JS, and CSP.
// Does NOT belong here: the scanners themselves - HTML refs (-> src/scan/
// html.js), CSS refs (-> src/scan/css.js), JS import/inject hits (-> src/parse/
// remote-js.js), CSP hosts (-> src/scan/csp.js) - the LLM-or-manual verdict on
// escalations (-> src/checks/escalation.js), missing local files (->
// bundled-files.js), authored wording (-> assets/registry.yaml), severity
// (-> that registry entry, stamped by src/checks/registry.js), and report
// formatting (-> src/report/format.js).

import { VERDICT } from "../../lib/enum.js";
import { scanHtmlRemoteRefs, scanHtmlInlineCssRefs } from "../../scan/html.js";
import { scanCssRemoteRefs } from "../../scan/css.js";
import { remoteJsOf } from "../extract.js";
import { analyzeCsp } from "../../scan/csp.js";
import { nonAuthoredJs } from "../../lib/bundled.js";
import { dedupe, scheme, trunc } from "../../lib/util.js";
import { perCandidateResolve } from "../../lib/verdict-resolve.js";
import { finding } from "../../report/finding.js";
import { extname, HTML_EXTENSIONS } from "../../util/files.js";

/** @typedef {import("../registry.js").RunContext} RunContext */
/** @typedef {import("../../scan/html.js").HtmlRef} HtmlRef */
/** @typedef {import("../../scan/css.js").CssRef} CssRef */
/** @typedef {import("../../parse/remote-js.js").RemoteJsHit} RemoteJsHit */
/** @typedef {import("../escalation.js").Escalation} Escalation */

export default {
  /**
   * @param {RunContext} ctx
   * @returns {{findings: import("../../report/finding.js").Finding[],
   *   llm?: import("../escalation.js").LlmStep}}
   */
  run(ctx) {
    const { addon } = ctx;
    const findings = [];
    // Collector for the undecidable sites: one candidate + 1:1 case per site.
    const esc = { candidates: [], cases: [], n: 0 };

    for (const [file, buf] of addon.files) {
      const ext = extname(file);
      if (HTML_EXTENSIONS.has(ext)) {
        const html = buf.toString("utf8");
        for (const ref of scanHtmlRemoteRefs(html)) {
          pushHtml(ctx, findings, esc, file, ref);
        }
        // CSS inside the HTML (<style> blocks, style= attrs) is scanned with the
        // same css.js scanner as a .css file, so a remote @import/url() there is
        // not missed.
        for (const ref of scanHtmlInlineCssRefs(html)) {
          pushCss(ctx, findings, file, ref);
        }
      } else if (ext === ".css") {
        for (const ref of scanCssRemoteRefs(buf.toString("utf8"))) {
          pushCss(ctx, findings, file, ref);
        }
      }
    }

    // Skip non-authored JS (see nonAuthoredJs). Remote refs in HTML/CSS and the
    // CSP check below still apply - those are not per-file JS scans.
    const skip = nonAuthoredJs(ctx);
    for (const src of ctx.jsSources) {
      if (skip.has(src.file)) {
        continue;
      }
      const { hits } = remoteJsOf(src);
      for (const hit of hits) {
        pushJs(ctx, findings, esc, src.file, hit);
      }
    }

    for (const host of analyzeCsp(ctx.manifest).remoteHosts) {
      findings.push(finding({ file: "manifest.json", item: host }));
      ctx.note?.("manifest.json", null, `CSP script-src ${host}`, VERDICT.FAIL);
    }

    const result = { findings: dedupe(findings) };
    if (esc.candidates.length) {
      result.llm = {
        candidates: esc.candidates,
        resolve: perCandidateResolve(esc.cases),
      };
    }
    return result;
  },
};

/**
 * Record one undecidable site as an LLM candidate (file:line, with the construct
 * `note`) plus its 1:1 case (a `fail` verdict becomes a finding at that site).
 * @param {{candidates: object[], cases: object[], n: number}} esc
 * @param {string} file
 * @param {number} line
 * @param {{line: number, column: number}} loc
 * @param {string} note  What the site does (the construct description).
 */
function addCandidate(esc, file, line, loc, note) {
  const id = `R${++esc.n}`;
  esc.candidates.push({ id, file, line, note, corpus: [file] });
  // The undecidable site carries no resolvable URL, so its finding shows only the
  // locus (file:line); the response/instructions wording is generic (no {{item}}).
  esc.cases.push({ id, finding: { file, loc } });
}

/**
 * @param {RunContext} ctx
 * @param {import("../../report/finding.js").Finding[]} findings
 * @param {{candidates: object[], cases: object[], n: number}} esc
 * @param {string} file
 * @param {HtmlRef} ref
 */
function pushHtml(ctx, findings, esc, file, ref) {
  const { tag, kind, url, klass, line } = ref;
  const loc = { line, column: 0 };
  const item = `<${tag}> ${trunc(url)}`;
  if (klass.remote) {
    findings.push(finding({ file, loc, item: url }));
    ctx.note?.(file, loc, item, VERDICT.FAIL);
  } else if (klass.embedded && kind.script) {
    addCandidate(
      esc,
      file,
      line,
      loc,
      `has a <script> with an inline ${scheme(url)} URL`
    );
    ctx.note?.(file, loc, item, VERDICT.UNSURE);
  } else if (klass.local && (kind.script || kind.content)) {
    // A bundled script/iframe load - cleared, but on the trail of "what runs".
    ctx.note?.(file, loc, item, VERDICT.PASS);
  }
}

/**
 * @param {RunContext} ctx
 * @param {import("../../report/finding.js").Finding[]} findings
 * @param {string} file
 * @param {CssRef} ref
 */
function pushCss(ctx, findings, file, ref) {
  const { url, klass, line } = ref;
  if (!klass.remote) {
    return; // local CSS url()/imports are bundled assets - benign, not noted
  }
  const loc = { line, column: 0 };
  findings.push(finding({ file, loc, item: url }));
  ctx.note?.(file, loc, `css ${trunc(url)}`, VERDICT.FAIL);
}

// Remote-JS hit types that are definite remote loads (vs the undecidable ones,
// which carry no resolvable URL and are escalated for judgement).
const REMOTE_JS = new Set([
  "remote-import",
  "remote-importscripts",
  "remote-script-src",
  "remote-script-html",
  "remote-wasm",
]);

// What each undecidable hit does, for the escalation evidence line.
const UNDECIDABLE_JS = {
  "embedded-script-src": "sets a <script> src to an inline data:/blob: URL",
  "ambiguous-import": "calls dynamic import() with a non-literal URL",
  "ambiguous-importscripts": "calls importScripts() with a non-literal URL",
  "ambiguous-script-src":
    "sets a <script> element's src from a non-literal value",
};

/**
 * @param {RunContext} ctx
 * @param {import("../../report/finding.js").Finding[]} findings
 * @param {{candidates: object[], cases: object[], n: number}} esc
 * @param {string} file
 * @param {RemoteJsHit} hit
 */
function pushJs(ctx, findings, esc, file, hit) {
  const loc = { line: hit.line, column: hit.column };
  if (REMOTE_JS.has(hit.type)) {
    findings.push(finding({ file, loc, item: hit.url ?? null }));
    ctx.note?.(
      file,
      loc,
      `${hit.type}${hit.url ? ` ${trunc(hit.url)}` : ""}`,
      VERDICT.FAIL
    );
  } else if (UNDECIDABLE_JS[hit.type]) {
    addCandidate(esc, file, hit.line, loc, UNDECIDABLE_JS[hit.type]);
    ctx.note?.(file, loc, UNDECIDABLE_JS[hit.type], VERDICT.UNSURE);
  }
}
