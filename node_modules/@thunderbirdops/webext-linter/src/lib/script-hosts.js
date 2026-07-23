// Maps each packaged JS file to the base directories of the extension PAGES
// whose document context can run it - the bases Gecko uses to resolve a relative
// file-loading path (a tabs.create/windows.create {url}, a tabs.executeScript/
// insertCSS/removeCSS {file}, a menus.create {icons}, ...). Such a path is
// resolved against the "current page URL" (the document the calling code runs
// in), NOT the extension root (that is getURL / scripting.*) and NOT the calling
// script's own URL (an `import`'s rule). So a script's resolution base is its
// HOST PAGE's directory, and ".." is clamped at the package root (it can never
// escape) - matching Gecko's `new URL(path, document.baseURI)`.
//
// A page contributes its own directory to every script it loads via <script src>
// and, transitively, to every module those scripts import - document.baseURI is
// the page's, not the imported module's, so a whole module subtree shares the
// page's base. The set of pages a script can run in is exactly the packaged HTML
// files that include it, so EVERY packaged HTML page is treated as a context -
// this covers manifest-declared pages and ones opened at runtime (tabs.create /
// window.open / <iframe src>) alike, with no allowlist. The background.scripts
// form is the one exception: it has no HTML page of its own (Gecko generates one
// at the extension ROOT), so its scripts (and their imports) get base "" (root).
//
// Belongs here: building the script -> host-page-dir map (memoized per ctx) and
// resolving a page-relative loader path against it. Used by reachability.js
// (reference-graph edges) and bundled-files.js (presence check).
//
// Does NOT belong here: extracting the loader paths themselves (-> src/parse/
// loader-files.js), the reachability graph (-> reachability.js), or the lexical
// path-resolution primitives (-> manifest-refs.js).

import { resolveRef, resolveInDir } from "./manifest-refs.js";
import { scanHtmlRemoteRefs } from "../scan/html.js";
import { localImportsOf } from "../checks/extract.js";
import { asArray } from "./util.js";
import { dirname, extname, HTML_EXTENSIONS } from "../util/files.js";

/** @typedef {import("../checks/registry.js").RunContext} RunContext */

// One host-dir map per RunContext - shared by the two consuming checks. Keyed by
// ctx in a WeakMap so it dies with the ctx (mirrors reachability's cache).
const cache = new WeakMap();

/**
 * Map each packaged JS file to the set of host-page base directories whose
 * document context can run it. Memoized per ctx.
 * @param {RunContext} ctx
 * @returns {Map<string, Set<string>>}
 */
export function scriptHostDirs(ctx) {
  let map = cache.get(ctx);
  if (!map) {
    map = compute(ctx);
    cache.set(ctx, map);
  }
  return map;
}

/**
 * Resolve a page-relative loader path against the host page(s) of the calling
 * script. With a known host page, resolve against each host directory (".."
 * clamped at the package root by resolveInDir) and return the first packaged
 * hit, else null - a genuine "not bundled" reference is still caught. With NO
 * known host page (e.g. the call sits in a script no declared page loads), fall
 * back to resolving the path root-relative.
 * @param {Map<string, Buffer>} files
 * @param {Map<string, Set<string>>} hostDirs  From scriptHostDirs.
 * @param {string} fromScript  The script file making the call.
 * @param {string} raw  The referenced path.
 * @returns {string|null}
 */
export function resolvePageRelative(files, hostDirs, fromScript, raw) {
  const dirs = hostDirs.get(fromScript);
  if (dirs && dirs.size) {
    for (const dir of dirs) {
      const hit = resolveInDir(files, dir, raw);
      if (hit) {
        return hit;
      }
    }
    return null;
  }
  return resolveRef(files, null, raw);
}

/**
 * @param {RunContext} ctx
 * @returns {Map<string, Set<string>>}
 */
function compute(ctx) {
  const files = ctx.addon?.files ?? new Map();
  const manifest = ctx.manifest || {};
  /** @type {Map<string, Set<string>>} */
  const map = new Map();

  // Import adjacency: each JS source -> the packaged JS files it imports
  // (resolved relative to the importer, as the module loader does). Inline
  // scripts are keyed under their HTML page, so a page's inline-module imports
  // propagate the page's base just like its <script src> children do.
  /** @type {Map<string, Set<string>>} */
  const imports = new Map();
  for (const src of ctx.jsSources || []) {
    let set = imports.get(src.file);
    for (const r of localImportsOf(src).refs) {
      const t = resolveRef(files, src.file, r.path);
      if (t) {
        if (!set) {
          imports.set(src.file, (set = new Set()));
        }
        set.add(t);
      }
    }
  }

  /**
   * @param {string} file
   * @param {string} dir
   * @returns {boolean} Newly added.
   */
  const record = (file, dir) => {
    let s = map.get(file);
    if (!s) {
      map.set(file, (s = new Set()));
    }
    if (s.has(dir)) {
      return false;
    }
    s.add(dir);
    return true;
  };

  // BFS over import edges from JS seeds that all share base `dir`, recording the
  // base for every JS file reached. An HTML node (a page seed) is not recorded -
  // it is only a source of inline-script import edges.
  /** @param {string[]} seeds @param {string} dir */
  const spread = (seeds, dir) => {
    const queue = [...seeds];
    while (queue.length) {
      const n = queue.pop();
      if (!HTML_EXTENSIONS.has(extname(n)) && !record(n, dir)) {
        continue; // a JS file already carrying this base - do not re-expand
      }
      for (const t of imports.get(n) ?? []) {
        queue.push(t);
      }
    }
  };

  // The packaged JS files a page loads directly via <script src>.
  /** @param {string} pageFile @returns {string[]} */
  const scriptChildren = (pageFile) => {
    const buf = files.get(pageFile);
    if (!buf) {
      return [];
    }
    const out = [];
    for (const r of scanHtmlRemoteRefs(buf.toString("utf8"))) {
      if (r.kind.script && r.klass.local) {
        const t = resolveRef(files, pageFile, r.url);
        if (t) {
          out.push(t);
        }
      }
    }
    return out;
  };

  /** @param {string} pageFile  A packaged HTML page. */
  const visitPage = (pageFile) => {
    const dir = dirname(pageFile);
    spread([pageFile, ...scriptChildren(pageFile)], dir);
  };

  // Every packaged HTML page is a context for the scripts it includes. A script
  // runs in a document only if that document loads it (via <script src> or a
  // static import from such a script), so "the pages a script can run in" is
  // just the HTML files that include it - the real structural signal, covering
  // manifest-declared pages (background.page, popups, options, sidebar) AND ones
  // opened at runtime (tabs.create/windows.create/window.open) or embedded as an
  // <iframe src> uniformly, with no manifest allowlist to keep in sync.
  for (const file of files.keys()) {
    if (HTML_EXTENSIONS.has(extname(file))) {
      visitPage(file);
    }
  }

  // background.scripts is the lone exception: it has no HTML page in the package
  // (Gecko generates one at the extension ROOT), so seed its scripts - and their
  // import closure - at base "" directly.
  const bg = manifest.background;
  if (bg && typeof bg === "object") {
    const bgScripts = [];
    for (const s of asArray(bg.scripts)) {
      const sj = typeof s === "string" ? resolveRef(files, null, s) : null;
      if (sj) {
        bgScripts.push(sj);
      }
    }
    if (bgScripts.length) {
      spread(bgScripts, "");
    }
  }

  return map;
}
