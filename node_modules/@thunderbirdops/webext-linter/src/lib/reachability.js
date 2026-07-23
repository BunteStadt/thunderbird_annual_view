// Static reachability over an add-on's files: which packaged files are reached
// from the manifest entry points, following references in HTML
// (<script>/<link>/
// <img>), CSS (@import/url()), and JS (import/require/importScripts, plus every
// file-loading API call - getURL, executeScript/insertCSS, the register family,
// setIcon, tabs.create, ... - extracted by loader-files.js). Two checks share
// this: unused-files (files reachable from ANY entry point) and minimize-web-
// accessible-resources (resources reachable from a WEB-FACING entry point, i.e.
// a content script). Whether library/minified/vendored JS is parsed for edges
// is the REACHABILITY_SKIPS_NON_AUTHORED toggle in src/config.js - off by
// default, so the graph follows edges everywhere (skipping them would hide a
// loader and wrongly orphan what it loads). `hasDynamicLoaders` is set when a
// LIVE (reachable) file builds a load path at runtime (dynamic import/getURL)
// that static analysis can't follow - a loader in dead code never runs, so it
// is dropped. `isLive` says whether a file is reached from any entry point. A
// `mentionsOf` string-find net catches references the structured parsers miss
// (custom loaders, odd strings); it is path-aware, so a reference to a
// same-basename file elsewhere (a library's own button.js) does not make an
// unrelated file look mentioned.
//
// `pureWebExtensionReachable` is the positive "this is WebExtension code" set the
// API/permission validators (unknown-api, deprecated-api, api-coverage, strict-
// min/max-version-api, permissions, core-symbol-in-webext) check against: the
// closure from the manifest WebExtension entry points over standard edges, PLUS
// any plain `.html` file passed as an Experiment-API parameter (a content page),
// and never crossing into experiment implementation code.
//
// Belongs here: building the reference graph and the Reachability result
// (reachable/webReachable/pureWebExtensionReachable sets, the dynamic-loader flag,
// mentionsOf), memoized per ctx in a WeakMap. The seeding and resolution that need
// the packaged file set.
//
// Does NOT belong here: extracting the edges themselves - HTML/CSS refs come
// from src/scan/html.js and src/scan/css.js, JS imports from
// src/parse/local-imports.js, loader-API paths from src/parse/loader-files.js.
// The manifest ref enumeration - manifest-refs.js. WAR expansion -
// web-accessible-resources.js. The library/vendored leaf set - bundled.js. The
// unused-files and minimize-web-accessible-resources verdicts - their rules
// under src/checks/rules/*.

import { manifestStringRefs, resolveRef } from "./manifest-refs.js";
import { scriptHostDirs, resolvePageRelative } from "./script-hosts.js";
import {
  warResourceList,
  expandResourcePattern,
  isOverBroadResource,
} from "./web-accessible-resources.js";
import { scanHtmlRemoteRefs } from "../scan/html.js";
import { scanCssRemoteRefs } from "../scan/css.js";
import {
  localImportsOf,
  loaderRefsOf,
  experimentRefsOf,
} from "../checks/extract.js";
import { nonAuthoredJs } from "./bundled.js";
import { asArray, isExperiment, isDocFile, escapeRegExp } from "./util.js";
import {
  basename,
  extname,
  JS_EXTENSIONS,
  HTML_EXTENSIONS,
  RECOGNIZED_EXTS,
} from "../util/files.js";
import { REACHABILITY_SKIPS_NON_AUTHORED } from "../config.js";

/** @typedef {import("../checks/registry.js").RunContext} RunContext */
/** @typedef {import("../addon/load.js").Manifest} Manifest */

// Files worth scanning for a bare basename mention (the safety net).
const TEXT_EXTS = new Set([
  ...JS_EXTENSIONS,
  ...HTML_EXTENSIONS,
  ".json",
  ".css",
  ".md",
  ".txt",
  ".svg",
  ".xml",
  ".yaml",
  ".yml",
]);

// Plain HTML (a content page). An Experiment can only LOAD such a file - i.e. as a
// WebExtension page - so a `.html` parameter to an Experiment API bridges into the
// WebExtension tree. Privileged UI is `.xhtml` and privileged logic a `.js` script,
// so those are deliberately excluded.
const PLAIN_HTML = new Set([".html", ".htm"]);
/**
 * @typedef {object} Reachability
 * @property {Set<string>} reachable       Files reachable from any entry point.
 * @property {Set<string>} webReachable    Files reachable from a content script.
 * @property {Set<string>} pureWebExtensionReachable  Files reachable from a
 *   WebExtension entry point over standard edges, plus `.html` files passed as
 *   Experiment-API parameters (and their closures) - the positive "this is
 *   WebExtension code" set every validator checks against. Experiment implementation
 *   code is never traced into it.
 * @property {boolean} hasDynamicLoaders  A live, authored file builds a load
 *   path at run time (dead-code and non-authored/library loaders are excluded).
 * @property {{file: string, kind: string}[]} dynamicLoaderSites  Live, authored.
 * @property {(file: string) => {file: string, line: number}[]} mentionsOf
 *   Lines in OTHER files that reference `file` by its basename - path-aware: an
 *   occurrence whose surrounding path resolves to a DIFFERENT packaged file (a
 *   same-basename namesake) is not counted.
 * @property {(file: string) => boolean} isLive  Reachable from ANY entry point
 *   (general or web-facing) - tells a check whether a referrer is itself live
 *   code, so a reference from a dead file can be discounted.
 * @property {(roots: Iterable<string>) => Set<string>} closureFrom  The files
 *   reachable from the given roots over the same reference edges (imports,
 *   module loaders, HTML/CSS), roots included - used to gather a file's nested
 *   helper modules.
 * @property {{file: string, referrer: string, line?: number}[]} unrecognizedRefs
 *   Live packaged files referenced by the manifest or a <script> tag whose suffix is not
 *   in RECOGNIZED_EXTS - the browser loads them but the tool cannot classify them. `file`
 *   is the target, `referrer` is "manifest.json" or the HTML page path (+ `line`). Deduped
 *   by target. Read by the unrecognized-file-type check.
 */

// One reachability graph per RunContext - both consuming checks share the
// build. Cached in a WeakMap keyed by ctx so the cache stays out of the
// RunContext contract (and dies with the ctx).
const graphs = new WeakMap();

/**
 * Build the reference graph (computed once per ctx, then shared).
 * @param {RunContext} ctx
 * @returns {Reachability}
 */
export function buildReachability(ctx) {
  let graph = graphs.get(ctx);
  if (!graph) {
    graph = compute(ctx);
    graphs.set(ctx, graph);
  }
  return graph;
}

/**
 * SCA mode: the WebExtension code set is every readable-source file EXCEPT the
 * Experiment subtree named by ctx.scaExpSource - a source-relative path (runPipeline
 * re-bases the scaRoot-relative --sca-exp-source flag to it via scaExpSourceRelative,
 * matching the addon.files keys loadScaAddon already stripped of the scaSource
 * prefix). Files equal to `<exp>` or under `<exp>/` are excluded;
 * an empty/absent value excludes nothing (so experiment code is reviewed too, the
 * deferred false-positive case).
 * @param {Map<string, Buffer>} files
 * @param {?string} scaExpSource
 * @returns {Set<string>}
 */
function scaWebExtensionFiles(files, scaExpSource) {
  const exp = String(scaExpSource ?? "")
    .replace(/^[./]+/, "")
    .replace(/\/+$/, "");
  const all = [...files.keys()];
  if (!exp) {
    return new Set(all);
  }
  return new Set(all.filter((f) => f !== exp && !f.startsWith(`${exp}/`)));
}

/**
 * @param {RunContext} ctx
 * @returns {Reachability}
 */
function compute(ctx) {
  // Reachability describes whatever artifact the orchestrator routed into ctx.addon:
  // the built XPI for the structure checks (registry `input: xpi` - bundled-files,
  // unused-files, minimize-web-accessible-resources), the review target for the
  // WebExtension-code checks (`input: source` - the API/permission validators). Every
  // `addon`/`files`/`jsSources` below is that one artifact's, so the graph is always
  // internally consistent.
  //
  // pureWebExtensionReachable's SCA "all readable-source files" branch exists only
  // for the review source, whose pre-build layout the manifest's built entry-point
  // paths miss (so the closure would be empty). It is gated on the review-target ctx
  // (NOT ctx.isShippedView), so on a shipped view it falls to the closure branch -
  // the XPI's manifest entry points resolve against its own files, giving a
  // meaningful WebExtension scope there too. (It is still read only by `input: source`
  // checks over the review target - see the consumer split the reachability tests
  // pin - so the shipped-view value is unused; the gate keeps it correct regardless.)
  const addon = ctx.addon;
  const files = addon?.files;
  // A context with no files (degenerate / unit harness) has nothing reachable;
  // return an inert graph so every consumer (incl. the API checks) is a no-op.
  if (!files) {
    return {
      reachable: new Set(),
      webReachable: new Set(),
      pureWebExtensionReachable: new Set(),
      hasDynamicLoaders: false,
      dynamicLoaderSites: [],
      mentionsOf: () => [],
      isLive: () => false,
      closureFrom: () => new Set(),
      unrecognizedRefs: [],
    };
  }
  const manifest = ctx.manifest || {};

  // Non-authored (vendored / library / minified) JS. We still parse it for
  // outgoing edges (so what it statically loads stays reachable), but its own
  // runtime-built loaders are NOT add-on loader sites: a third-party library
  // does not load the add-on's own files, so its dynamic loads must not make
  // every unreferenced add-on file look ambiguous.
  const nonAuthored = nonAuthoredJs(ctx);
  // JS we do NOT parse for outgoing edges. Off by default (see config.js):
  // skipping a non-authored file would drop its loader edges and make the files
  // it loads look unreachable. The finding scanners still skip these themselves.
  const skipParse = REACHABILITY_SKIPS_NON_AUTHORED ? nonAuthored : new Set();

  // Host-page directories per script, for resolving page-relative loader paths
  // (computed once, shared with bundled-files via the per-ctx cache).
  const hostDirs = scriptHostDirs(ctx);

  // Outgoing edges: each file -> the resolved package paths it references.
  const outEdges = new Map();
  const dynamicLoaderSites = [];
  /** @param {string} from @param {string|null} p  Edge target, or null. */
  const addEdge = (from, p) => {
    if (!p) {
      return;
    }
    let set = outEdges.get(from);
    if (!set) {
      outEdges.set(from, (set = new Set()));
    }
    set.add(p);
  };

  // A packaged file REFERENCED (by the manifest, or a <script src>) whose suffix is not in
  // `allowed` - the browser loads it but no check reviewed it. Collected here, where each ref
  // is already resolved, and filtered to LIVE targets at the return (a reference in dead code
  // never runs). Deduped by target; the first referrer wins. Read by the unrecognized-file-type
  // check via the result's `unrecognizedRefs`.
  //
  // `allowed` differs by role, because the threshold does. The manifest walk is role-blind
  // (it seeds scripts, icons, themes alike), so RECOGNIZED_EXTS - any ordinary file type is
  // fine. A <script src>, though, loads its target AS CODE whatever the extension, so the bar
  // is JS_EXTENSIONS: a <script src="x.png"> / "x.txt" executes that file as JavaScript, and a
  // suffix that merely looks like a resource is a lie in that context.
  const unrecognizedRefs = [];
  const seenUnrecognized = new Set();
  /**
   * @param {string|null} file  Resolved target
   * @param {string} referrer
   * @param {Set<string>} allowed  Suffixes that are NOT flagged (RECOGNIZED_EXTS or JS_EXTENSIONS)
   * @param {number} [line]
   */
  const noteUnrecognized = (file, referrer, allowed, line) => {
    if (!file || seenUnrecognized.has(file) || allowed.has(extname(file))) {
      return;
    }
    seenUnrecognized.add(file);
    unrecognizedRefs.push(
      line == null ? { file, referrer } : { file, referrer, line }
    );
  };

  for (const [file, buf] of files) {
    const ext = extname(file);
    if (HTML_EXTENSIONS.has(ext)) {
      for (const r of scanHtmlRemoteRefs(buf.toString("utf8"))) {
        if (r.klass.local) {
          const target = resolveRef(files, file, r.url);
          addEdge(file, target);
          // A <script src> loads its target AS CODE (kind:"script" covers <script>,
          // modulepreload, preload as=script) - so a target that is not JS-parseable
          // (extname not in JS_EXTENSIONS) is executable code no check reviewed.
          if (r.kind.script) {
            noteUnrecognized(target, file, JS_EXTENSIONS, r.line);
          }
        }
      }
    } else if (ext === ".css") {
      for (const r of scanCssRemoteRefs(buf.toString("utf8"))) {
        if (r.klass.local) {
          addEdge(file, resolveRef(files, file, r.url));
        }
      }
    }
  }

  for (const src of ctx.jsSources || []) {
    if (skipParse.has(src.file)) {
      continue;
    }
    // JS import/require/importScripts are relative to the importing file.
    // localImportsOf returns the pass's precomputed refs, or re-scans for a
    // shipped-view source the pass never ran on.
    const imp = localImportsOf(src);
    for (const r of imp.refs) {
      addEdge(src.file, resolveRef(files, src.file, r.path));
    }
    if (imp.hasDynamic && !nonAuthored.has(src.file)) {
      dynamicLoaderSites.push({ file: src.file, kind: "dynamic-import" });
    }
    // File-loading API calls (schema-directed + bridge): getURL, executeScript/
    // insertCSS, the register family, setIcon, tabs.create, ... getURL and
    // scripting.* are extension-root-relative (base:"root"); every other loader
    // is page-relative (base:"page") - resolved against the calling script's
    // HOST PAGE directory (".." clamped at root), per script-hosts.js.
    const loaded = loaderRefsOf(src);
    for (const r of loaded.refs) {
      const target =
        r.base === "page"
          ? resolvePageRelative(files, hostDirs, src.file, r.path)
          : resolveRef(files, null, r.path);
      addEdge(src.file, target);
    }
    if (loaded.hasDynamic && !nonAuthored.has(src.file)) {
      dynamicLoaderSites.push({ file: src.file, kind: "dynamic-loader" });
    }
  }

  // Seeds: every string in the manifest (outside experiment_apis), resolved
  // root-relative. The seed gate keeps only those that resolve to a packaged
  // file, so non-path strings drop out and every file-reference key - declared
  // (message_display_scripts, background, popups) or icon/dictionary/theme leaf -
  // is seeded without a per-key enumeration to maintain.
  const generalSeeds = new Set();
  /** @param {Set<string>} set @param {string} raw  Root-relative seed path. */
  const seed = (set, raw) => {
    const p = resolveRef(files, null, raw);
    if (p) {
      set.add(p);
    }
  };
  for (const raw of manifestStringRefs(manifest)) {
    const p = resolveRef(files, null, raw);
    if (p) {
      generalSeeds.add(p);
      // The manifest walk is role-blind (it seeds scripts, icons, themes alike), so this is
      // role-blind too: the manifest declares a packaged file whose type we do not recognize
      // at all. Whatever its role, that is worth a look.
      noteUnrecognized(p, "manifest.json", RECOGNIZED_EXTS);
    }
  }
  for (const entry of warResourceList(manifest)) {
    for (const pat of entry.resources) {
      if (isOverBroadResource(pat)) {
        continue; // do not let "*" mark every file as used
      }
      for (const p of expandResourcePattern(files, pat)) {
        generalSeeds.add(p);
      }
    }
  }

  const webSeeds = new Set();
  for (const cs of asArray(manifest.content_scripts)) {
    if (cs && typeof cs === "object") {
      for (const j of asArray(cs.js)) {
        seed(webSeeds, j);
      }
      for (const c of asArray(cs.css)) {
        seed(webSeeds, c);
      }
    }
  }

  // The general WebExtension reachable set, from the manifest entry points over
  // standard edges. unused-files (non-Experiment) and isLive read this.
  const reachable = bfs(generalSeeds, outEdges);

  // basename -> packaged files of that name, for an Experiment-API parameter matched
  // by file NAME (a chrome://resource:// URL the add-on hands to an experiment).
  const byBasename = new Map();
  for (const f of files.keys()) {
    const b = basename(f);
    let list = byBasename.get(b);
    if (!list) {
      byBasename.set(b, (list = []));
    }
    list.push(f);
  }
  /** Resolve an injected {kind, value} ref to packaged files. */
  const refTargets = (r) =>
    r.kind === "path"
      ? [resolveRef(files, null, r.value)].filter(Boolean)
      : (byBasename.get(r.value) ?? []);

  // The ONE bridge across the WebExtension->Experiment boundary: a plain `.html` file
  // passed as a parameter to an Experiment API is a content page - i.e. a WebExtension
  // page (privileged UI would be `.xhtml`, privileged logic a `.js` script). So such
  // files seed the WebExtension tree (their standard closure follows); everything else
  // an experiment loads stays outside it. Deterministic, no classification, no LLM.
  const htmlInjectedSeeds = new Set();
  if (isExperiment(manifest)) {
    for (const src of ctx.jsSources || []) {
      for (const r of experimentRefsOf(src).refs) {
        for (const t of refTargets(r)) {
          if (PLAIN_HTML.has(extname(t))) {
            htmlInjectedSeeds.add(t);
          }
        }
      }
    }
  }

  // The pure WebExtension dependency tree every check validates against: the closure
  // (standard WebExtension edges only) from the manifest entry points PLUS the `.html`
  // Experiment-API parameters. It never traces into experiment implementation code.
  //
  // The SCA REVIEW SOURCE has no usable tree: the manifest's entry points name BUILT
  // paths that don't exist in the readable source layout, so the closure would be
  // empty and every WebExtension code check would review nothing. There we instead
  // review EVERY source file - except an Experiment subtree named by --sca-exp-source
  // (ctx.scaExpSource), whose privileged (Services/ChromeUtils) code is not
  // WebExtension code and would false-positive these checks. The shipped view is
  // excluded (ctx.isShippedView): the built XPI's entry points DO resolve, so it uses
  // the closure branch, like an XPI review. (That closure already excludes experiment
  // implementation code.)
  const pureWebExtensionReachable =
    ctx.mode?.sca && !ctx.isShippedView
      ? scaWebExtensionFiles(files, ctx.scaExpSource)
      : bfs(new Set([...generalSeeds, ...htmlInjectedSeeds]), outEdges);

  const webReachable = bfs(webSeeds, outEdges);
  /** @param {string} file @returns {boolean} Reached from any entry point. */
  const isLive = (file) => reachable.has(file) || webReachable.has(file);
  // A dynamic loader only matters if the file that builds the path actually
  // runs: a loader in unreachable (dead) code never executes, so it cannot load
  // anything. Drop dead loader sites so they neither force an escalation nor
  // appear as evidence.
  const liveLoaders = dynamicLoaderSites.filter((s) => isLive(s.file));
  return {
    reachable,
    webReachable,
    pureWebExtensionReachable,
    hasDynamicLoaders: liveLoaders.length > 0,
    dynamicLoaderSites: liveLoaders,
    mentionsOf: makeMentions(files),
    isLive,
    closureFrom: (roots) => bfs(new Set(roots), outEdges),
    // Keep only LIVE targets: a manifest-declared file is an entry point (always live), and
    // a <script src> target is live iff its page is reached - a reference in dead code never
    // executes, so reporting it would be noise (and its dead page is already unused-files).
    unrecognizedRefs: unrecognizedRefs.filter((r) => isLive(r.file)),
  };
}

/** @param {Set<string>} seeds @param {Map<string,Set<string>>} outEdges */
function bfs(seeds, outEdges) {
  const reached = new Set();
  const queue = [...seeds];
  while (queue.length) {
    const f = queue.pop();
    if (reached.has(f)) {
      continue;
    }
    reached.add(f);
    for (const e of outEdges.get(f) ?? []) {
      if (!reached.has(e)) {
        queue.push(e);
      }
    }
  }
  return reached;
}

/**
 * Whether a line that contains `target`'s basename could actually reference
 * `target` - as opposed to a DIFFERENT packaged file that happens to share the
 * basename. Each path-like token ending in the basename is resolved (relative to
 * the mentioning file AND root-relative). A token that resolves to some OTHER
 * packaged file points elsewhere. The line refers to `target` UNLESS every such
 * token points elsewhere - a bare basename, an unresolvable token, or one
 * resolving to `target` itself all keep the line (the net stays recall-first).
 * @param {string} line
 * @param {RegExp} tokenRe  Global regex for "<path>basename".
 * @param {string} fromFile  The mentioning file (for relative resolution).
 * @param {string} target  The file whose reference we are looking for.
 * @param {Map<string, Buffer>} files
 * @returns {boolean}
 */
function refersTo(line, tokenRe, fromFile, target, files) {
  tokenRe.lastIndex = 0;
  let sawElsewhere = false;
  let m;
  while ((m = tokenRe.exec(line))) {
    const tok = m[0];
    const rel = resolveRef(files, fromFile, tok);
    const root = resolveRef(files, null, tok);
    if (rel === target || root === target) {
      return true; // explicitly references the target
    }
    if (!rel && !root) {
      return true; // bare / unresolvable token - cannot rule out the target
    }
    sawElsewhere = true; // resolves only to other packaged file(s)
  }
  return !sawElsewhere;
}

/**
 * The string-find safety net: every other text file's lines that reference
 * `file` by its basename (a reference the structured parsers may have missed).
 * Path-aware (see refersTo): an occurrence that resolves to a different
 * same-basename file is not counted, so a vendored `components/button/button.js`
 * reference does not make an unrelated `widgets/button.js` look mentioned.
 * @param {Map<string, Buffer>} files
 * @returns {(file: string) => {file: string, line: number}[]}
 */
function makeMentions(files) {
  // Documentation files are not code: a README image link is not a runtime load, so
  // it must not make a declared resource look mentioned. (The manifest is not here
  // to exclude - the loader keeps it out of the corpus entirely, see addon/load.js.)
  /** @type {Map<string, string[]>} */
  const lines = new Map();
  for (const [file, buf] of files) {
    if (!isDocFile(file) && TEXT_EXTS.has(extname(file))) {
      lines.set(file, buf.toString("utf8").split("\n"));
    }
  }
  return (target) => {
    const base = basename(target);
    const tokenRe = new RegExp(`[\\w./@-]*${escapeRegExp(base)}`, "g");
    const hits = [];
    for (const [file, ls] of lines) {
      if (file === target) {
        continue; // a file mentioning its own name does not save itself
      }
      ls.forEach((line, i) => {
        if (
          line.includes(base) &&
          refersTo(line, tokenRe, file, target, files)
        ) {
          hits.push({ file, line: i + 1 });
        }
      });
    }
    return hits;
  };
}
