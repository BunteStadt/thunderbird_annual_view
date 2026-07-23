// File-classification primitives shared across the whole tool: which add-on
// paths count as JavaScript or HTML, and the small path helpers built on them.
// One neutral home (importable from every layer) so the extension sets cannot
// drift between the source collector, the normalizer, and the checks.
//
// Belongs here: pure path/extension string helpers (extname, basename) and the
// JS_EXTENSIONS / CSS_EXTENSIONS / HTML_EXTENSIONS sets. No filesystem IO and no
// dependencies. Does NOT belong here: reading files off disk or out of an
// archive - that is src/addon/load.js for the add-on and src/schema/load.js for
// schemas.

/** Extensions treated as JavaScript source: the ESM/CJS variants (Gecko loads a
 *  background.scripts entry by PATH, so a .cjs script is executable code and must be
 *  parsed and content-scanned like any .js), plus the TypeScript and JSX authored source
 *  a source code archive ships (the parser strips types; see src/parse/ast.js). This set is
 *  the corpus filter (collectJsSources), so a suffix missing here means the file is never
 *  parsed by ANY check - be inclusive: an over-inclusive guess costs one parse, an
 *  under-inclusive one silently skips review. A compiled XPI contains few of these. */
export const JS_EXTENSIONS = new Set([
  ".js",
  ".cjs",
  ".mjs",
  ".jsm",
  ".es",
  ".es6",
  ".ts",
  ".cts",
  ".mts",
  ".tsx",
  ".jsx",
]);

/** Extensions treated as CSS stylesheets. */
export const CSS_EXTENSIONS = new Set([".css"]);

/** Extensions treated as HTML documents. */
export const HTML_EXTENSIONS = new Set([".html", ".htm", ".xhtml"]);

/** Binary archive extensions. A committed archive in a source submission is build
 *  output / a decoy, never authored source; the committed-build-artifact check rejects
 *  one anywhere in --sca-root, unused-files flags one shipped in the XPI, and the build
 *  corpus never collects one (binary, not build input). */
export const ARCHIVE_EXTENSIONS = new Set([
  ".zip",
  ".xpi",
  ".crx",
  ".7z",
  ".rar",
  ".tar",
  ".tgz",
  ".gz",
]);

/** Every file extension the tool RECOGNIZES as a legitimate add-on file - code it reviews
 *  (JS/CSS/HTML/.vue) plus the ordinary web resources an add-on ships. It is the backstop
 *  for the unrecognized-file-type check: a packaged file REFERENCED by the manifest or a
 *  <script> tag whose suffix is NOT in here is a file the browser loads but the tool cannot
 *  classify - a silent review gap turned into a loud finding. Kept GENERIC (plain web file
 *  types) on purpose: this carries NO Thunderbird/manifest-key/schema knowledge. Widen it
 *  when a legitimate common type is missing; add a JS suffix to JS_EXTENSIONS instead (so the
 *  file is actually parsed, not merely recognized). */
export const RECOGNIZED_EXTS = new Set([
  ...JS_EXTENSIONS,
  ...CSS_EXTENSIONS,
  ...HTML_EXTENSIONS,
  ".vue",
  // Images
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".avif",
  ".ico",
  ".bmp",
  // Fonts
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  // Data / text
  ".json",
  ".txt",
  ".md",
  ".csv",
  ".xml",
  ".yaml",
  ".yml",
  ".map",
  ".wasm",
  // Media
  ".mp3",
  ".mp4",
  ".ogg",
  ".wav",
  ".webm",
]);

/**
 * Lowercased file extension including the dot (e.g. ".html"), or "".
 * @param {string} file
 * @returns {string}
 */
export function extname(file) {
  const i = file.lastIndexOf(".");
  return i === -1 ? "" : file.slice(i).toLowerCase();
}

/**
 * The final path segment of an add-on-relative posix path.
 * @param {string} file
 * @returns {string}
 */
export function basename(file) {
  return file.slice(file.lastIndexOf("/") + 1);
}

/**
 * The directory portion of an add-on-relative posix path, or "" if the path has
 * no directory (a root-level file).
 * @param {string} file
 * @returns {string}
 */
export function dirname(file) {
  const i = file.lastIndexOf("/");
  return i === -1 ? "" : file.slice(0, i);
}
