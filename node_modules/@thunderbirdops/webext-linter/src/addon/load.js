// Loads a submitted add-on, whether it's an .xpi/.zip archive or an
// already-unpacked directory, into an in-memory file map plus the parsed
// manifest. Keeping the whole add-on in memory (paths -> Buffer) lets every
// check read files without caring how the add-on was packaged.
//
// It also PARTITIONS a submitted SCA archive into the two artifacts a source-code
// review reads. loadScaAddon takes the review-source subtree (--sca-source);
// selectScaBuildFiles takes its COMPLEMENT - the archive minus that subtree, minus
// the Experiment subtree (--sca-exp-source), minus node_modules - as the build
// candidates. Two halves of ONE split: same archive, same --sca-* path semantics
// (scaRootRelative), so they live together and cannot drift apart. The split is a
// projection of the archive ALREADY in memory (loadAddon read it once); despite the
// "load" in loadScaAddon, neither half reads the disk again.
//
// Belongs here: unpacking the submission into the Addon model (files map +
// manifest parse + manifestError), the SCA archive partition above, the Manifest
// typedef, and the load-time path safety guards. Loading/parsing the package only
// (the tool never writes back).
//
// Does NOT belong here: reviewing the add-on - all verdicts live in the checks
// (src/checks/*). Which of the build candidates the build actually RUNS is a
// collection policy, seeded from package.json (-> src/build/corpus.js
// selectBuildCorpus). Enumerating which JS sources to scan is src/addon/sources.js.
// Parsing CSS/HTML/CSP content is src/scan/*. Schema files load via
// src/schema/load.js.

import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import JSON5 from "json5";

import { buildManifestLoc } from "./manifest-loc.js";
import { ARCHIVE_EXTENSIONS, extname } from "../util/files.js";
import { ADDON_MAX_UNPACKED_BYTES } from "../config.js";

/**
 * @typedef {object} GeckoSettings
 * @property {string} [id]  Extension id.
 * @property {string} [strict_min_version]  Lowest supported app version.
 * @property {string} [strict_max_version]  Highest supported app version.
 */

/**
 * One content_scripts entry.
 * @typedef {object} ContentScript
 * @property {string[]} [matches]  URL match patterns.
 * @property {string[]} [js]  Injected script paths.
 * @property {string[]} [css]  Injected stylesheet paths.
 */

/**
 * A web_accessible_resources entry in MV3 object form (MV2 uses bare strings).
 * @typedef {object} WebAccessibleResource
 * @property {string[]} [resources]  Exposed resource paths or globs.
 * @property {string[]} [matches]  Origins the resources are exposed to.
 */

/**
 * The background context (MV2 scripts/page or MV3 service worker).
 * @typedef {object} Background
 * @property {string[]} [scripts]  Background script paths (MV2).
 * @property {string} [service_worker]  Service worker path (MV3).
 * @property {string} [page]  Background page path.
 */

/**
 * The sidebar_action manifest key.
 * @typedef {object} SidebarAction
 * @property {string} [default_panel]  Panel document path.
 * @property {string} [default_icon]  Icon path.
 * @property {string} [default_title]  Sidebar title.
 */

/**
 * The parsed manifest.json. A WebExtension manifest is an open-ended JSON
 * object, so these are just the keys the review reads (others may be present).
 * @typedef {object} Manifest
 * @property {number} [manifest_version]  2 or 3.
 * @property {string} [name]  Add-on name.
 * @property {string} [version]  Add-on version.
 * @property {string} [default_locale]  Default _locales subdir.
 * @property {string[]} [permissions]  Declared permissions / host patterns.
 * @property {string[]} [optional_permissions]  Runtime-granted permissions.
 * @property {string[]} [host_permissions]  Host patterns (MV3).
 * @property {ContentScript[]} [content_scripts]  Declared content scripts.
 * @property {(string|WebAccessibleResource)[]} [web_accessible_resources]
 *   Resources exposed to web pages (MV2 strings, MV3 objects).
 * @property {{gecko?: GeckoSettings}} [browser_specific_settings]  Gecko data.
 * @property {{gecko?: GeckoSettings}} [applications]  Legacy gecko data.
 * @property {Record<string, object>} [experiment_apis]  Experiment API defs.
 * @property {{images?: Record<string, string>}} [theme]  Static theme.
 * @property {SidebarAction} [sidebar_action]  Sidebar action.
 * @property {{page?: string}} [options_ui]  Options UI page.
 * @property {string} [options_page]  Legacy options page path.
 * @property {Background} [background]  Background context.
 * @property {Record<string, string>} [icons]  Size -> icon path.
 * @property {Record<string, string>} [dictionaries]  Locale -> dictionary path.
 * @property {string|Record<string, string>} [content_security_policy]  CSP.
 */

/**
 * @typedef {object} Addon
 * @property {string} source                 Original path provided.
 * @property {"zip"|"dir"} kind
 * @property {Map<string, Buffer>} files  Add-on-relative path (posix "/")
 *   -> contents. The review corpus EXCLUDES manifest.json: assembleAddon lifts it
 *   into manifest / manifestText / manifestLoc and drops the key, so a corpus lookup
 *   can never return the manifest (in SCA it would be the source's pre-build one, not
 *   the shipped manifest). Read the manifest through those fields. (The SCA `build`
 *   corpus is selected separately and is not covered by this guarantee.)
 * @property {string[]} nodeModules  Posix paths of node_modules directories
 *   skipped at load (their contents are never read); empty when none. In SCA
 *   mode the committed-node-modules check rejects each.
 * @property {string[]} archives  Posix paths of committed binary archives
 *   (.zip/.xpi/... anywhere in the submission); empty when none. In SCA mode the
 *   committed-build-artifact check rejects each. Recorded at load, spanning the whole
 *   --sca-root (before the source/build split), so one is caught wherever it sits.
 * @property {string[]} skipped  Ready-to-narrate notices for entries skipped at
 *   load (a non-node_modules symlink, an unsafe archive path); empty when none.
 *   The loader collects them; the pipeline narrates them under "Reading add-on",
 *   so a pre-banner sizing load prints nothing before the Setup banner.
 * @property {?Manifest} manifest  Parsed; null if missing/invalid.
 * @property {string} manifestText  Raw manifest.json text ("" if none), lifted off
 *   the corpus so checks read it here, not via files.get("manifest.json").
 * @property {string|null} manifestError     Parse error message, if any.
 * @property {?import("./manifest-loc.js").ManifestLoc} manifestLoc  Resolves a
 *   manifest JSON path to its source line; null when there is no manifest.
 */

/**
 * @param {string} source  Path to an .xpi/.zip file or an unpacked add-on
 *   directory.
 * @returns {Addon}
 */
export function loadAddon(source) {
  const resolved = path.resolve(source);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Add-on not found: ${resolved}`);
  }
  const stat = fs.statSync(resolved);
  const { files, nodeModules, archives, skipped } = stat.isDirectory()
    ? readDir(resolved)
    : readZip(resolved);
  const addon = assembleAddon(files, {
    source: resolved,
    kind: stat.isDirectory() ? "dir" : "zip",
  });
  // Installed-dependency directories are skipped at load (never read) and only their
  // paths are recorded - a committed node_modules is a hard fail (committed-node-modules
  // in SCA mode), never reviewable input.
  addon.nodeModules = nodeModules;
  // Committed binary archives (.zip/.xpi/...) are recorded by path - a committed built
  // archive is a hard fail (committed-build-artifact in SCA mode), never authored input.
  addon.archives = archives;
  // Skipped-entry notices (symlinks, unsafe archive paths): the loader stays silent and
  // hands them back for the pipeline to narrate under the "Reading add-on" step, so a
  // pre-banner sizing load never prints before the Setup banner.
  addon.skipped = skipped;
  return addon;
}

/**
 * Build an Addon record from an in-memory file map: parse its manifest.json
 * (BOM-tolerant, JSON5) and stamp the source/kind. Shared by loadAddon and the
 * source code archive loader.
 * @param {Map<string, Buffer>} files
 * @param {{source: string, kind: "dir"|"zip"}} meta
 * @returns {Addon}
 */
function assembleAddon(files, { source, kind }) {
  const addon = {
    source,
    kind,
    files,
    manifest: null,
    manifestText: "",
    manifestError: null,
    manifestLoc: null,
  };
  const manifestBuf = files.get("manifest.json");
  if (manifestBuf) {
    addon.manifestText = manifestBuf.toString("utf8");
    let text = addon.manifestText;
    if (text.charCodeAt(0) === 0xfeff) {
      text = text.slice(1);
    }
    addon.manifestLoc = buildManifestLoc(text);
    try {
      addon.manifest = JSON5.parse(text);
    } catch (err) {
      addon.manifestError = err.message;
    }
  }
  // The manifest now lives on the addon (manifest / manifestText / manifestLoc); drop
  // it from the corpus so nothing can read it back through files (see the Addon typedef).
  files.delete("manifest.json");
  return addon;
}

// The dependency-manifest files loadScaAddon brings from the archive root into the
// review files (the root is the authoritative manifest); the lock names mirror
// src/vendor/locks.js.
const SCA_MANIFEST_FILES = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
];

/**
 * Resolve an SCA source-path flag (--sca-source / --sca-exp-source) to a posix path
 * relative to scaRoot. The value is either already relative to scaRoot, or an
 * absolute filesystem path (made relative to scaRoot). Throws when an absolute path
 * resolves OUTSIDE scaRoot - which also rejects an absolute path against a zip
 * scaRoot, since it can never sit under the archive file.
 * @param {string} value  The raw flag value.
 * @param {string} scaRoot  The --sca-root path.
 * @param {string} [flag]  The flag name to name in the error (e.g. "--sca-source").
 * @returns {string} A posix path relative to scaRoot ("" for the root itself).
 */
export function scaRootRelative(value, scaRoot, flag = "SCA path") {
  let v = String(value ?? "");
  if (path.isAbsolute(v)) {
    v = path.relative(path.resolve(scaRoot), path.resolve(v));
    if (v.startsWith("..") || path.isAbsolute(v)) {
      throw new Error(`${flag} "${value}" is outside --sca-root (${scaRoot})`);
    }
  }
  return v
    .replace(/\\/g, "/")
    .replace(/^[./]+/, "")
    .replace(/\/+$/, "");
}

/**
 * The Experiment folder as a path relative to the review SOURCE (scaSource), from
 * the --sca-exp-source flag which - like --sca-source - is relative to scaRoot (or
 * absolute). Both flags share the scaRoot base; this strips the scaSource prefix so
 * scaWebExtensionFiles can match it against the (already source-stripped) file keys.
 * @param {string|undefined} scaExpSource  The --sca-exp-source flag ("" when unset).
 * @param {string} scaSource  The --sca-source flag.
 * @param {string} scaRoot  The --sca-root flag.
 * @returns {string} A posix path relative to scaSource ("" when unset). Throws when
 *   the Experiment folder is not within scaSource.
 */
export function scaExpSourceRelative(scaExpSource, scaSource, scaRoot) {
  if (!scaExpSource) {
    return "";
  }
  const exp = scaRootRelative(scaExpSource, scaRoot, "--sca-exp-source");
  const src = scaRootRelative(scaSource, scaRoot, "--sca-source");
  if (!src) {
    return exp; // the review source IS the archive root
  }
  if (exp === src || !exp.startsWith(`${src}/`)) {
    throw new Error(
      `--sca-exp-source (${scaExpSource}) must be a folder within --sca-source (${scaSource})`
    );
  }
  return exp.slice(src.length + 1);
}

/**
 * Load a source code archive. The readable add-on code lives at `scaSource`
 * within the `scaRoot` archive (folder or zip); package.json/lock live at the
 * archive root. Returns a review Addon whose `files` are the scaSource subtree
 * (the prefix stripped, so `<scaSource>/manifest.json` becomes `manifest.json`)
 * PLUS the archive-root package.json + lock (so the dependency audit, which reads
 * addon.files, sees them).
 *
 * The source addon is PURE source - its own files and its own manifest.json. The
 * authoritative manifest is the built XPI's, exposed separately as ctx.manifest (the
 * orchestrator resolves it - see src/checks/context.js); nothing reviews the source
 * manifest, so it is left untouched here.
 * @param {Addon} archive  The scaRoot archive, loaded ONCE by the caller (loadAddon)
 *   and shared with selectScaBuildFiles - so the source tree is not read twice.
 * @param {string} scaSource  The add-on code root, relative to scaRoot or an
 *   absolute path (e.g. "src", "addon", or "/abs/path/to/root/addon").
 * @param {string} scaRoot  Path to the source archive root (for the path math).
 * @returns {Addon}
 */
export function loadScaAddon(archive, scaSource, scaRoot) {
  const rel = scaRootRelative(scaSource, scaRoot, "--sca-source");
  const prefix = rel ? `${rel}/` : "";
  const files = new Map();
  for (const [p, buf] of archive.files) {
    if (!prefix) {
      files.set(p, buf);
    } else if (p.startsWith(prefix)) {
      files.set(p.slice(prefix.length), buf);
    }
  }
  if (files.size === 0) {
    throw new Error(
      `--sca-source "${scaSource}" matched no files under ${scaRoot}`
    );
  }
  // Bring the archive-root dependency manifest into the review files (overriding
  // any same-named file inside scaSource - the root is authoritative).
  for (const name of SCA_MANIFEST_FILES) {
    const buf = archive.files.get(name);
    if (buf) {
      files.set(name, buf);
    }
  }
  return assembleAddon(files, {
    source: rel ? `${archive.source}:${rel}` : archive.source,
    kind: archive.kind,
  });
}

/**
 * SELECT the BUILD files of a source code archive - the COMPLEMENT of loadScaAddon over
 * the same, already-loaded archive (nothing is read from disk here): EVERY file in the
 * scaRoot archive EXCEPT the review source (scaSource), the Experiment source
 * (scaExpSource), and dotfiles/dotfolders (at any depth, except .npmrc). node_modules
 * never appears here -
 * loadAddon skips it at load (its contents are never read); its directories are passed
 * through as `nodeModules` for the committed-node-modules check. This is the tooling
 * that BUILDS the add-on - build scripts, bundler configs, Makefiles, package.json/lock,
 * READMEs - which the add-on review (loadScaAddon) deliberately drops. Keys keep their
 * real archive-relative paths (nothing is prefix-stripped). buildScaBuildCtx wraps these
 * as the SCA-only `input: build` checks' ctx.addon, so its files never enter the review
 * addon that the other checks scan.
 *
 * A pure EXCLUDE rule (no allow-list to maintain): whatever remains after removing the
 * add-on source, the Experiment source, and dot-prefixed paths is the build candidate
 * pool, from which the setup build analysis (analyzeBuild) selects the build-relevant
 * subset to show the model by tracing package.json (src/build/corpus.js). Dotfiles/folders
 * (.git, .github, .idea, .yarnrc, ...) are dropped as VCS/editor/CI noise - EXCEPT .npmrc,
 * the npm/pnpm registry config the build-tooling checks read.
 *
 * When scaSource IS the archive root (a flat layout: manifest.json at the root, with the
 * build tooling intermingled), there is no source subtree to remove, so the candidate pool
 * is the whole root - and selectBuildCorpus still traces the build off the root package.json
 * exactly as in a nested layout. The pool then overlaps the review addon (loadScaAddon), but
 * the two feed different checks, and the package.json trace keeps the build corpus tight.
 * @param {Addon} archive  The scaRoot archive, loaded ONCE by the caller and shared
 *   with loadScaAddon (the tree is not read twice).
 * @param {string} scaSource  The --sca-source flag (the review source subtree).
 * @param {string} scaRoot  Path to the source archive root (for the path math).
 * @param {string} [scaExpSource]  The --sca-exp-source flag; excluded too (it sits
 *   inside scaSource, so this is defensive).
 * @returns {{files: Map<string, Buffer>, nodeModules: string[], archives: string[]}}
 */
export function selectScaBuildFiles(archive, scaSource, scaRoot, scaExpSource) {
  const files = new Map();
  const src = scaRootRelative(scaSource, scaRoot, "--sca-source");
  // Nested layout: exclude the review-source subtree (it is the add-on, not the build).
  // Flat layout (scaSource IS the archive root, src === ""): there is no subtree to
  // exclude, so every file becomes a build candidate and selectBuildCorpus still traces
  // the build off the root package.json.
  const prefixes = [];
  if (src) {
    prefixes.push(src);
  }
  if (scaExpSource) {
    const exp = scaRootRelative(scaExpSource, scaRoot, "--sca-exp-source");
    if (exp) {
      prefixes.push(exp);
    }
  }
  for (const [p, buf] of archive.files) {
    // node_modules never reaches here - loadAddon skips it at load (never read) and
    // reports it as archive.nodeModules for the committed-node-modules check.
    // Dot-prefixed paths at any depth are VCS/editor/CI noise (.git, .github, .idea,
    // .yarnrc, ...) - EXCEPT a plain .npmrc, the npm/pnpm registry config the
    // build-registry-redirect check reads (kept unless itself buried in a dotfolder).
    const segments = p.split("/");
    const dotSegments = segments.filter((s) => s.startsWith("."));
    if (
      dotSegments.length > 0 &&
      !(dotSegments.length === 1 && segments[segments.length - 1] === ".npmrc")
    ) {
      continue;
    }
    // The review source + Experiment subtree are reviewed as the add-on, not the build.
    if (prefixes.some((pre) => p === pre || p.startsWith(`${pre}/`))) {
      continue;
    }
    files.set(p, buf);
  }
  // Copy nodeModules/archives so the build corpus owns its lists - the caller shares one
  // archive object with loadScaAddon, and the aliased array must not leak mutations back
  // to it (matching the fresh-Map discipline `files` already follows). Both span the whole
  // --sca-root so the committed-* checks catch a tree anywhere, not just outside the source.
  return {
    files,
    nodeModules: [...archive.nodeModules],
    archives: [...archive.archives],
  };
}

/** @returns {Error} The add-on-too-large error, shared by readZip and readDir. */
function addonTooLargeError() {
  const mb = ADDON_MAX_UNPACKED_BYTES / (1024 * 1024);
  return new Error(`Add-on unpacked size exceeds the ${mb} MB limit`);
}

/**
 * @param {string} zipPath  Path to the .xpi/.zip archive.
 * @returns {{files: Map<string, Buffer>, nodeModules: string[],
 *   skipped: string[]}}
 */
function readZip(zipPath) {
  const zip = new AdmZip(zipPath);
  const files = new Map();
  const nodeModules = new Set();
  const archives = new Set();
  const skipped = [];
  let unpacked = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) {
      continue;
    }
    const name = normalize(entry.entryName);
    // Reject path-traversal / absolute entry names from a (possibly malicious)
    // archive so they can never reach a filesystem write or the output package.
    if (!isSafeAddonPath(name)) {
      skipped.push(`Skipping unsafe archive entry: ${entry.entryName}`);
      continue;
    }
    // Never decompress an installed-dependency tree: record the outer node_modules
    // directory and skip BEFORE getData(), so its contents never enter memory.
    const segs = name.split("/");
    const nm = segs.indexOf("node_modules");
    if (nm !== -1 && nm < segs.length - 1) {
      nodeModules.add(segs.slice(0, nm + 1).join("/"));
      continue;
    }
    // A committed binary archive is recorded (the committed-build-artifact check reads
    // the list) but its bytes are still kept - unlike node_modules we do not skip, since
    // a shipped .xpi/.zip resource must remain readable for the normal XPI review.
    if (ARCHIVE_EXTENSIONS.has(extname(name))) {
      archives.add(name);
    }
    // Bound decompression against a zip bomb: check the declared size before
    // getData() so a lying-huge header aborts before inflating, then the actual
    // inflated length in case a crafted header under-reports it.
    if (unpacked + entry.header.size > ADDON_MAX_UNPACKED_BYTES) {
      throw addonTooLargeError();
    }
    const data = entry.getData();
    unpacked += data.length;
    if (unpacked > ADDON_MAX_UNPACKED_BYTES) {
      throw addonTooLargeError();
    }
    files.set(name, data);
  }
  return {
    files,
    nodeModules: [...nodeModules],
    archives: [...archives],
    skipped,
  };
}

/**
 * @param {string} dir  Root directory of the unpacked add-on.
 * @returns {{files: Map<string, Buffer>, nodeModules: string[],
 *   skipped: string[]}}
 */
function readDir(dir) {
  const files = new Map();
  const nodeModules = [];
  const archives = [];
  const skipped = [];
  let unpacked = 0;
  /** @param {string} current  Directory to recurse into. */
  const walk = (current) => {
    for (const e of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, e.name);
      if (e.isSymbolicLink()) {
        // A symlink named node_modules is a committed dependency tree too: record it
        // by name (its target is never followed or read) so committed-node-modules
        // still fires. Other symlinks are skipped rather than followed: a real .xpi
        // has none, and following could pull in host files or loop. Collect the skip
        // as a notice (the caller narrates it) so it is not silent.
        if (e.name === "node_modules") {
          nodeModules.push(normalize(path.relative(dir, full)));
        } else {
          skipped.push(
            `Skipping symlink (not packaged): ${path.relative(dir, full)}`
          );
        }
      } else if (e.isDirectory()) {
        // Never read an installed-dependency tree: record it and do NOT recurse, so
        // its (huge) contents never enter memory.
        if (e.name === "node_modules") {
          nodeModules.push(normalize(path.relative(dir, full)));
        } else {
          walk(full);
        }
      } else if (e.isFile()) {
        const rel = normalize(path.relative(dir, full));
        if (ARCHIVE_EXTENSIONS.has(extname(rel))) {
          archives.push(rel);
        }
        // Bound the total unpacked size, matching the archive path's zip-bomb cap.
        unpacked += fs.statSync(full).size;
        if (unpacked > ADDON_MAX_UNPACKED_BYTES) {
          throw addonTooLargeError();
        }
        files.set(rel, fs.readFileSync(full));
      }
    }
  };
  walk(dir);
  return { files, nodeModules, archives, skipped };
}

/**
 * Normalize an add-on-internal path to posix style without a leading "./".
 * @param {string} p  Raw path (may use backslashes or a leading "./").
 * @returns {string}
 */
function normalize(p) {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * True when a normalized add-on-relative path stays inside the add-on root: not
 * empty, not absolute, no Windows drive, and no ".." segment.
 * @param {string} p  Normalized posix path.
 * @returns {boolean}
 */
function isSafeAddonPath(p) {
  if (!p || p.startsWith("/") || /^[a-zA-Z]:/.test(p)) {
    return false;
  }
  return !p.split("/").includes("..");
}
