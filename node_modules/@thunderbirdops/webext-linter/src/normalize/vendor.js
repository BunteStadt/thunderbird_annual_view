// Parses the add-on's VENDOR file (developers list every bundled third-party
// library there so reviewers can verify it matches upstream). Those files must
// stay byte-for-byte identical to the release they came from, so the normalizer
// skips any path listed here, and vendor verification fetches the declared
// source to confirm it (src/vendor/verify.js).
//
// Real submissions write this file in many styles, so the parser scans sequentially.
// It pairs a packaged file with its own source URL (a URL that points to a file; a
// bare repository link is not a source), TRUSTING the declaration: any packaged file
// paired with a source URL is vendored, whether or not the library classifier
// recognizes it (so a small readable module is not lost). A declaration flushes as
// soon as a new token (or a second URL) follows a complete one, so an unindented list
// with no blank lines still splits per declaration - in either order (file->source or
// source->file) - instead of collapsing onto the first URL; headings/blank lines
// (splitBlocks) only bound sections. Tokens may be Markdown code-spans. This reads the
// "File:"/"Source:", "path:" + "- URL:", "name.js : <url>", and `## Lib` block styles
// alike. Deterministic extraction is best-effort - the LLM fallback
// (src/vendor/resolve.js) covers a free-form file the scan cannot map.
//
// Belongs here: the deterministic VENDOR parse only - locating the file
// (readVendorFile), the packaged-file matcher (buildFileMatcher), the
// {path, sourceUrl} extraction (parseVendorManifest), and the entries whose
// declared file is absent (missingVendorEntries). It is LLM-free and pure.
//
// Does NOT belong here: the LLM parse fallback and the canonical resolved set
// (-> src/vendor/resolve.js). The consumers of the set: prettyprint.js skips
// vendored files from reformatting, bundled.js skips them from scanning, and
// unused-files exempts them. Fetching/verifying the declared source is the
// vendor verification pre-step + the vendor checks. This file makes no verdict.

import { basename } from "../util/files.js";

/** @typedef {import("../addon/load.js").Addon} Addon */
/** @typedef {{path: string, sourceUrl: ?string, kind?: string}} VendorEntry */

// VENDOR filenames developers use (matched case-insensitively).
const VENDOR_NAMES = new Set(["vendor", "vendor.md", "vendors", "vendors.md"]);

/**
 * The add-on's VENDOR file, or null when there is none.
 * @param {Addon} addon
 * @returns {?{name: string, text: string}}
 */
export function readVendorFile(addon) {
  const files = addon?.files;
  if (!files) {
    return null;
  }
  const name = [...files.keys()].find((f) => VENDOR_NAMES.has(f.toLowerCase()));
  return name ? { name, text: files.get(name).toString("utf8") } : null;
}

/**
 * Normalize a free-form token: trim, strip surrounding quotes and trailing
 * punctuation, fold Windows "\" separators, drop a leading "./".
 * @param {string} token
 * @returns {string}
 */
function normalizeToken(token) {
  return String(token)
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "") // strip surrounding quotes / Markdown backticks
    .replace(/[,;:]+$/g, "")
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "");
}

// Any extension - a loose "could name a file" gate (so a real ".7z" still
// matches). A letter-led extension (.js, .css, .min.js) is the stricter gate for
// picking a MISSING candidate, so a version token like "2.2.1" is not mistaken
// for a filename.
const LOOSE_EXT = /\.[a-z0-9]+$/i;
const STRONG_EXT = /\.[a-z][a-z0-9]*$/i;

/**
 * @typedef {object} TokenInfo
 * @property {string} norm  The normalized token.
 * @property {?string} path  Resolved packaged path (exact or unambiguous
 *   basename), else null.
 * @property {boolean} exists  The package has this path or its basename.
 * @property {boolean} strongFileLike  Has a letter-led extension.
 * @property {?string} [dir]  Resolved packaged DIRECTORY (a folder declaration),
 *   else null. Only set for no-extension tokens.
 */

/**
 * Build a token classifier over the add-on's files (maps built once, shared by
 * buildFileMatcher and the VENDOR record scan).
 * @param {Addon} addon
 * @returns {(token: string) => TokenInfo}
 */
function buildClassifier(addon) {
  const paths = new Set(addon.files.keys());
  const byBase = new Map();
  const dirs = new Set(); // every directory prefix of a packaged file
  for (const p of addon.files.keys()) {
    const b = basename(p);
    const list = byBase.get(b);
    if (list) {
      list.push(p);
    } else {
      byBase.set(b, [p]);
    }
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join("/"));
    }
  }
  return (token) => {
    const norm = normalizeToken(token);
    // A no-extension token may name a packaged DIRECTORY (a folder declaration);
    // otherwise it is not a file reference.
    if (!LOOSE_EXT.test(norm)) {
      return {
        norm,
        path: null,
        exists: false,
        strongFileLike: false,
        dir: dirs.has(norm) ? norm : null,
      };
    }
    const hits = byBase.get(basename(norm));
    return {
      norm,
      path: paths.has(norm) ? norm : hits && hits.length === 1 ? hits[0] : null,
      exists: paths.has(norm) || Boolean(hits && hits.length),
      strongFileLike: STRONG_EXT.test(norm),
      dir: null,
    };
  };
}

/**
 * A matcher resolving a free-form token to a packaged add-on path, or null: by
 * exact posix path or an unambiguous basename, normalizing "\" separators,
 * surrounding quotes, and trailing punctuation. Used by the deterministic parse
 * and to validate LLM-suggested paths (so a hallucinated file is dropped).
 * @param {Addon} addon
 * @returns {(token: string) => ?string}
 */
export function buildFileMatcher(addon) {
  const classify = buildClassifier(addon);
  return (token) => classify(token).path;
}

// Code-hosting roots: github.com/owner/repo (<= 2 path segments) is a repository,
// not a file, even when the repo name ends in ".js" - so it is never a source URL.
const REPO_HOSTS = new Set([
  "github.com",
  "gitlab.com",
  "bitbucket.org",
  "codeberg.org",
  "sourceforge.net",
]);

// All http(s) URLs on a line (so a Source: line and an Upstream-repository: line
// are both seen, and the file one wins).
const URLS_RE = /https?:\/\/\S+/gi;

/**
 * Whether a URL points to a fetchable FILE (so a bare repository link is not a
 * source): its last path segment has a file extension, and it is not a code-host
 * repository root. CDN / registry / raw URLs pass; an untrusted-but-file URL also
 * passes (so resolve.js can still flag it "untrusted host").
 * @param {string} url
 * @returns {boolean}
 */
function pointsToFile(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const segs = u.pathname.split("/").filter(Boolean);
  const last = segs[segs.length - 1] ?? "";
  if (!LOOSE_EXT.test(last)) {
    return false; // no filename/extension - a page or repo root
  }
  return !(REPO_HOSTS.has(u.hostname.toLowerCase()) && segs.length <= 2);
}

/**
 * Whether a URL points to a DIRECTORY we can resolve to a fetchable archive (so a
 * folder declaration can be verified): a github `…/tree/<ref>/<path>` URL. The
 * source classifier (src/vendor/sources.js) maps it to the repo ZIP + the subpath.
 * A bare repo root is not a directory source.
 * @param {string} url
 * @returns {boolean}
 */
function isDirSource(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const segs = u.pathname.split("/").filter(Boolean);
  return (
    u.hostname.toLowerCase() === "github.com" &&
    segs[2] === "tree" &&
    segs.length >= 4
  );
}

/**
 * Split the VENDOR text into blocks: a blank line ends a block, and a Markdown
 * heading starts a new one (belonging to it). Multiple blank lines just yield
 * separate (sub-)blocks.
 * @param {string} text
 * @returns {string[][]}
 */
function splitBlocks(text) {
  const blocks = [];
  let cur = [];
  const flush = () => {
    if (cur.length) {
      blocks.push(cur);
      cur = [];
    }
  };
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*$/.test(line)) {
      flush();
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      flush();
    }
    cur.push(line);
  }
  flush();
  return blocks;
}

/**
 * Scan the VENDOR file into one record per declaration: a packaged file (the path)
 * paired with its own source URL - a URL that points to a file (a bare repository
 * link is ignored). We trust the developer's declaration: ANY packaged file paired
 * with a source URL is vendored, whether or not the library classifier recognizes it
 * (so a small readable module like `i18n.mjs` is not lost). A declaration whose only
 * file-like token is ABSENT yields a missing record (path null).
 *
 * Pairing is a stateful, self-delimiting scan: one in-flight declaration accumulates
 * file/absent token(s) and a URL, and FLUSHES the moment a new token arrives after it
 * is already complete (or a second URL arrives) - so `file -> source` (cardbook's
 * no-blank-line list) and `source -> file` (the NC `## Lib` block) both pair their own
 * file with their own URL, instead of every file collapsing onto the block's first
 * URL. An incidental own-file mention that trails a completed declaration (DOMPurify's
 * "Usage: `modules/htmlSanitizer.js`") lands in a fresh, URL-less declaration and is
 * dropped. `splitBlocks` is kept only as an outer section boundary (a dangling URL
 * cannot reach a file across a blank line / heading). A declaration with no source URL
 * yields nothing (the VENDOR file is "unparseable" when no record is produced - see
 * resolveVendor). Two files sharing one URL is a real record set here and flagged
 * ambiguous in resolveVendor (a multi-file source must be declared as a folder).
 * @param {Addon} addon
 * @returns {{token: string, path: ?string, kind: ?string, sourceUrl: ?string}[]}
 */
function scanVendorRecords(addon) {
  const vendor = readVendorFile(addon);
  if (!vendor) {
    return [];
  }
  const classify = buildClassifier(addon);
  const records = [];

  for (const block of splitBlocks(vendor.text)) {
    // The declaration being assembled. "Complete" = a URL AND a file/folder/absent
    // token; the next token (or a second URL) then starts a fresh declaration.
    let pending = { files: [], folder: null, absents: [], url: null };
    const complete = () =>
      pending.url != null &&
      (pending.files.length || pending.folder || pending.absents.length);
    const flush = () => {
      const source = pending.url;
      if (source && pending.folder) {
        records.push({
          token: pending.folder,
          path: pending.folder,
          kind: "folder",
          sourceUrl: source,
        });
      } else if (source && pending.files.length) {
        const seen = new Set();
        for (const path of pending.files) {
          if (!seen.has(path)) {
            seen.add(path);
            records.push({
              token: path,
              path,
              kind: "file",
              sourceUrl: source,
            });
          }
        }
      } else if (source && pending.absents.length) {
        records.push({
          token: pending.absents[0],
          path: null,
          kind: "file",
          sourceUrl: source,
        });
      }
      pending = { files: [], folder: null, absents: [], url: null };
    };
    // A new URL always starts a new declaration when one is already in flight.
    const addUrl = (u) => {
      if (pending.url != null) {
        flush();
      }
      pending.url = u;
    };
    const addFile = (path) => {
      if (complete()) {
        flush();
      }
      pending.files.push(path);
    };
    const addFolder = (dir) => {
      if (complete()) {
        flush();
      }
      pending.folder = dir;
    };
    const addAbsent = (norm) => {
      if (complete()) {
        flush();
      }
      pending.absents.push(norm);
    };

    for (const line of block) {
      // URLs first, then the line's remaining tokens (textual order within one
      // declaration does not matter - neither half completes it alone). A file URL
      // pairs with a file token; a directory (github tree) URL pairs with a folder.
      const lineUrls = line.match(URLS_RE) || [];
      let remainder = line;
      for (const raw of lineUrls) {
        remainder = remainder.replace(raw, " ");
        const u = raw.replace(/[).,;'"]+$/, "");
        if (pointsToFile(u) || isDirSource(u)) {
          addUrl(u);
        }
      }
      for (const token of remainder.split(/\s+/)) {
        const info = classify(token);
        if (info.path) {
          addFile(info.path);
        } else if (info.dir) {
          addFolder(info.dir);
        } else if (info.strongFileLike && !info.exists) {
          addAbsent(info.norm);
        }
      }
    }
    flush(); // end of section: a boundary always ends the declaration
  }
  return records;
}

/**
 * Parse the add-on's VENDOR file into the third-party entries it declares: each
 * a packaged-file path and (when present) the http(s) source URL paired with it.
 * Deterministic and pure; returns [] when there is no VENDOR file.
 * @param {Addon} addon
 * @returns {VendorEntry[]}
 */
export function parseVendorManifest(addon) {
  const seen = new Set();
  const entries = [];
  for (const r of scanVendorRecords(addon)) {
    if (r.path && !seen.has(r.path)) {
      seen.add(r.path);
      entries.push({ path: r.path, sourceUrl: r.sourceUrl, kind: r.kind });
    }
  }
  return entries;
}

/**
 * The VENDOR entries whose declared file is NOT in the submission: a strongly
 * file-like token paired with an http(s) source URL that resolves to no packaged
 * file. The URL anchor keeps prose from being mistaken for a declaration.
 * Deterministic and pure; returns [] when there is no VENDOR file.
 * @param {Addon} addon
 * @returns {VendorEntry[]}
 */
export function missingVendorEntries(addon) {
  const seen = new Set();
  const entries = [];
  for (const r of scanVendorRecords(addon)) {
    if (!r.path && r.sourceUrl && !seen.has(r.token)) {
      seen.add(r.token);
      entries.push({ path: r.token, sourceUrl: r.sourceUrl });
    }
  }
  return entries;
}
