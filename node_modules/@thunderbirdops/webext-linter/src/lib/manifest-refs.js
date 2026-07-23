// Manifest file references: reading the packaged-file paths a manifest declares,
// normalizing a raw reference to an add-on-relative key, and resolving a
// reference (directory-aware) against the packaged file set. Two readers of
// deliberately different scope, because their consumers ask opposite questions:
//   - manifestFileRefs: the SPECIFIC declared keys known to carry file paths
//     (content_scripts, background, options, popups), each with its location.
//     bundled-files uses it to warn a referenced file is MISSING - which needs
//     "this string is a file path" to hold independent of the file existing.
//   - manifestStringRefs: EVERY string in the manifest (outside experiment_apis).
//     reachability seeds from it, keeping only those that resolve to a packaged
//     file - so existence is the filter, and there is no per-key list to keep.
// Shared by the bundled-files check, the reachability graph, and the
// background-page-module check (a <script src> in the background page, via
// resolveRef).
//
// Belongs here: manifestFileRefs and manifestStringRefs (manifest -> paths),
// normalizeRef (raw path -> relative key, purely lexical), resolveRef (raw path +
// referrer -> packaged key, directory-aware), and resolveInDir (raw path +
// explicit base directory -> packaged key; the page-relative variant resolveRef
// delegates to).
//
// Does NOT belong here: walking the reference graph - that is reachability.js.
// web_accessible_resources shapes - web-accessible-resources.js. The
// bundled-files verdict - its rule under src/checks/rules/*. Generic shape
// guards like asArray - lib/util.js.

import { asArray } from "./util.js";
import { dirname } from "../util/files.js";

/** @typedef {import("../addon/load.js").Manifest} Manifest */

/**
 * Enumerate add-on-internal file paths referenced by the manifest.
 * @param {Manifest} manifest  Parsed manifest.json.
 * @returns {{path: string, where: string}[]}
 */
export function manifestFileRefs(manifest) {
  const refs = [];
  /**
   * @param {unknown} path  Candidate path (recorded only if a string).
   * @param {string} where  Manifest location, for the message.
   */
  const add = (path, where) => {
    if (typeof path === "string") {
      refs.push({ path, where });
    }
  };

  // A submitted manifest can be malformed. Guard every shape before iterating
  // so a bad value degrades gracefully instead of throwing.
  asArray(manifest.content_scripts).forEach((cs, i) => {
    if (!cs || typeof cs !== "object") {
      return;
    }
    for (const js of asArray(cs.js)) {
      add(js, `content_scripts[${i}].js`);
    }
    for (const css of asArray(cs.css)) {
      add(css, `content_scripts[${i}].css`);
    }
  });

  const bg = manifest.background;
  if (bg && typeof bg === "object") {
    for (const s of asArray(bg.scripts)) {
      add(s, "background.scripts");
    }
    add(bg.service_worker, "background.service_worker");
    add(bg.page, "background.page");
  }

  add(manifest.options_ui?.page, "options_ui.page");
  add(manifest.options_page, "options_page");
  for (const key of [
    "action",
    "browser_action",
    "compose_action",
    "message_display_action",
  ]) {
    add(manifest[key]?.default_popup, `${key}.default_popup`);
  }

  return refs;
}

/**
 * Every string value anywhere in the manifest, EXCEPT under experiment_apis
 * (privileged Experiment implementation paths, which must never enter the
 * WebExtension reachability tree). Unlike manifestFileRefs, this makes no
 * assumption about which keys carry file paths - it is the reachability seed
 * source, where a value only becomes a seed if it resolves to a packaged file,
 * so non-path strings (permissions, versions, match patterns, ids) drop out
 * harmlessly at the resolve gate. This covers every current and future
 * file-reference key (message_display_scripts, compose_scripts, ...) without an
 * enumeration to maintain.
 * @param {Manifest} manifest  Parsed manifest.json.
 * @returns {string[]}
 */
export function manifestStringRefs(manifest) {
  const out = [];
  // Iterative walk over an explicit stack: a submitted manifest is untrusted, so
  // recursion could overflow the call stack on a pathologically nested one. Seed
  // order does not matter (the caller dedups into a Set).
  const stack = [manifest];
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node === "string") {
      out.push(node);
    } else if (Array.isArray(node)) {
      stack.push(...node);
    } else if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (key === "experiment_apis") {
          continue;
        }
        stack.push(value);
      }
    }
  }
  return out;
}

/**
 * Normalize a manifest/JS file reference to an add-on-relative key.
 * @param {string} p  Raw referenced path.
 * @returns {string}
 */
export function normalizeRef(p) {
  return String(p)
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/[?#].*$/, "");
}

/**
 * Resolve a reference to an add-on-relative key, or null if it is not a packaged
 * file. `fromFile` null (manifest/getURL/injected) or a leading "/" means
 * extension-root-relative. Otherwise it is relative to `fromFile`'s directory.
 * @param {Map<string, Buffer>} files
 * @param {string|null} fromFile
 * @param {string} raw
 * @returns {string|null}
 */
export function resolveRef(files, fromFile, raw) {
  const dir = fromFile == null ? null : dirname(fromFile);
  return resolveInDir(files, dir, raw);
}

/**
 * Resolve a reference against an explicit base DIRECTORY, or null if it is not a
 * packaged file. `dir` null means extension-root-relative (as for the manifest /
 * getURL); `dir === ""` is the add-on root; any other value is that directory. A
 * leading "/" in `raw` is always root-relative. Used (via script-hosts.js) to
 * resolve a page-relative loader path against the calling script's HOST PAGE
 * directory. `.`/`..` are normalized, with ".." clamped at the package root.
 * @param {Map<string, Buffer>} files
 * @param {string|null} dir
 * @param {string} raw
 * @returns {string|null}
 */
/**
 * Normalize `raw` against base directory `dir` and collapse `.`/`..` to a packaged
 * key. Returns the collapsed key (null for an empty/blank reference) AND whether a
 * ".." climbed above the package root - which resolveInDir clamps silently but
 * resolveInDirStatus reports. `dir` null (or a leading "/" in raw) is root-relative.
 * @param {string|null} dir @param {string} raw
 * @returns {{key: string|null, escaped: boolean}}
 */
function normalizeRefInDir(dir, raw) {
  let p = String(raw ?? "")
    .replace(/\\/g, "/")
    .replace(/[?#].*$/, "")
    .trim();
  if (p === "") {
    return { key: null, escaped: false };
  }
  if (p.startsWith("/") || dir == null) {
    p = p.replace(/^\/+/, "");
  } else {
    p = dir ? `${dir}/${p}` : p;
  }
  const parts = [];
  let escaped = false;
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") {
      continue;
    }
    if (seg === "..") {
      if (parts.length === 0) {
        escaped = true; // climbed above the package root
      } else {
        parts.pop();
      }
    } else {
      parts.push(seg);
    }
  }
  return { key: parts.join("/"), escaped };
}

export function resolveInDir(files, dir, raw) {
  const { key } = normalizeRefInDir(dir, raw);
  return key != null && files.has(key) ? key : null;
}

/**
 * @typedef {object} RefStatus
 * @property {"ok"|"missing"|"escapes"} kind
 *   - "ok": the reference resolves within the package and the file is bundled
 *     (`key` is the resolved add-on-relative path);
 *   - "missing": it resolves within the package but no such file is bundled;
 *   - "escapes": a ".." segment climbs ABOVE the package root, so the path points
 *     outside the add-on - a wrong path, regardless of whether a file happens to
 *     sit at the root-clamped location.
 * @property {string} [key]  Resolved packaged path, present only when kind ="ok".
 */

/**
 * Like resolveInDir, but distinguishes a path that escapes the package root from
 * one that merely points at a missing file. resolveInDir silently clamps ".."
 * at the root (so an escaping path can masquerade as a present file); this
 * variant reports that escape instead, which the bundled-files check needs to
 * tell "wrong path" apart from "not bundled". An empty/blank reference is
 * reported as "missing".
 * @param {Map<string, Buffer>} files
 * @param {string|null} dir  Base directory; null = extension-root-relative.
 * @param {string} raw  Raw referenced path.
 * @returns {RefStatus}
 */
export function resolveInDirStatus(files, dir, raw) {
  const { key, escaped } = normalizeRefInDir(dir, raw);
  if (key == null) {
    return { kind: "missing" };
  }
  if (escaped) {
    return { kind: "escapes" };
  }
  return files.has(key) ? { kind: "ok", key } : { kind: "missing" };
}

/**
 * Directory-aware variant of resolveInDirStatus: resolve `raw` against
 * `fromFile`'s directory (null/leading "/" = extension-root-relative), reporting
 * a root escape. Mirrors resolveRef.
 * @param {Map<string, Buffer>} files
 * @param {string|null} fromFile
 * @param {string} raw
 * @returns {RefStatus}
 */
export function resolveRefStatus(files, fromFile, raw) {
  const dir = fromFile == null ? null : dirname(fromFile);
  return resolveInDirStatus(files, dir, raw);
}
