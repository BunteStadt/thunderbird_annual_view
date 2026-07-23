// Small shared helpers for rule modules. A check never sets a severity or a
// message - runChecks stamps every finding with its registry entry's severity,
// and the report resolver fills its text, so the yaml is the single source of
// both. A check that cannot settle a case returns an escalation. Only the
// orchestrator (escalation.js) routes it to the LLM or to manual review.
//
// Belongs here: generic, dependency-light check helpers - dedupe,
// the asArray/asObject manifest guards, isMatchPattern/isBroadHost, scheme,
// trunc, manifestTokenLine, isExperiment/strictMaxVersion, the version family
// (strictMinVersion, parseVersion, cmpVersion, versionInBounds - shared by the
// recheck rubric assembler and the unused-permission token selection), the
// suspected-loader helpers referrerSupported/loaderSites, and the feed-note
// builder loaderTrace.
//
// Does NOT belong here: anything with a heavier dependency or a single home -
// reachability lives in reachability.js, permission analysis in permissions.js,
// manifest ref enumeration in manifest-refs.js, library classification in
// bundled.js. Shared utilities used across the whole repo (extname, sortKeys,
// debug) stay in src/util/files.js, src/util/json.js, src/util/log.js. Any
// rule's verdict logic - src/checks/rules/*.

import { DISPLAY_TRUNCATE_LENGTH } from "../config.js";
import { basename, extname } from "../util/files.js";

/** @typedef {import("../checks/registry.js").RunContext} RunContext */
/** @typedef {import("./reachability.js").Reachability} Reachability */
/** @typedef {import("../addon/load.js").Manifest} Manifest */

// Documentation file extensions; an extensionless file (LICENSE, AUTHORS) also
// counts as a doc type.
const DOC_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".rst"]);

// Base NAMES (lowercased) of documentation / project-metadata files an add-on may
// ship (for tooling, its store listing, or the i18n runtime) but never loads at
// runtime. Matched as a SUBSTRING of the basename.
const DOC_NAMES = [
  "license",
  "licence",
  "copying",
  "readme",
  "changelog",
  "authors",
  "notice",
  "vendor",
  "description",
  "contributing",
  "install",
  "update",
  "history",
  "security",
  "code_of_conduct",
  "todo",
];

/**
 * Whether a packaged file is documentation / project metadata the add-on ships but
 * never loads at runtime: a doc-TYPE file (a DOC_EXTENSIONS extension, or none -
 * LICENSE, AUTHORS) whose basename CONTAINS a DOC_NAME. Substring + doc-type, so
 * localized / variant names (README_DE, README.de.md, CHANGELOG.v2.md) are all
 * covered, while a same-named CODE file (README.js, history.js) is not. Shared so
 * the unused-files ALLOW list and reachability's doc-file test agree.
 * @param {string} file
 * @returns {boolean}
 */
export function isDocMetadataFile(file) {
  const ext = extname(file);
  if (ext !== "" && !DOC_EXTENSIONS.has(ext)) {
    return false;
  }
  const base = basename(file).toLowerCase();
  return DOC_NAMES.some((name) => base.includes(name));
}

// Dependency manifests / lock files (a valid third-party-library declaration).
// Matched as EXACT filenames - the extension is part of the identity, so unlike
// the name-based docs above there is no name-without-extension ambiguity and no
// risk of exempting a same-named code file.
export const DEPENDENCY_FILE_RE =
  /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/i;

/**
 * Broader doc test for reachability's mention net: a named doc, a dependency
 * manifest / lock file, or ANY doc-extension file (even unnamed, e.g. notes.md) -
 * all prose / metadata, never a runtime loader.
 * @param {string} file
 * @returns {boolean}
 */
export function isDocFile(file) {
  return (
    isDocMetadataFile(file) ||
    DEPENDENCY_FILE_RE.test(file) ||
    DOC_EXTENSIONS.has(extname(file))
  );
}

/**
 * Drop findings that duplicate file+line+column+item+data (the discriminators
 * now that findings carry no message).
 * @param {import("../report/finding.js").Finding[]} findings
 * @returns {import("../report/finding.js").Finding[]}
 */
export function dedupe(findings) {
  const seen = new Set();
  return findings.filter((f) => {
    const key = [
      f.file,
      f.loc?.line,
      f.loc?.column,
      f.item,
      JSON.stringify(f.data),
    ].join("|");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Whether a referencing file is itself loaded by something that runs: it is
 * reachable, or its basename is named in a reachable file (so it is loaded along
 * a path static analysis could not follow, e.g. a config fetched by minified
 * code). A reference from a file that is NOT supported is dead and should not
 * count as use. Reads only the static reachability sets, so it is independent of
 * which file was checked first.
 * @param {Reachability} reach
 * @param {string} f  The referencing (loader) file.
 * @returns {boolean}
 */
export function referrerSupported(reach, f) {
  return (
    reach.isLive(f) || reach.mentionsOf(f).some((m) => reach.isLive(m.file))
  );
}

/**
 * The suspected loader sites of an unreachable file F, for per-site LLM judging:
 * when live code names F, the live mention sites (file:line), otherwise the live
 * runtime-loader sites (file, no line). Deduped. The caller excludes F from
 * `mentions`.
 * @param {Reachability} reach
 * @param {{file: string, line: number}[]} mentions  Referrers of F's basename.
 * @param {boolean} supported  Whether any referrer is itself reachable.
 * @returns {{file: string, line: ?number}[]}
 */
export function loaderSites(reach, mentions, supported) {
  const seen = new Set();
  const out = [];
  /**
   * Record one loader site, skipping a file:line already seen.
   * @param {string} file
   * @param {?number} line
   * @returns {void}
   */
  const add = (file, line) => {
    const key = `${file}:${line ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ file, line });
    }
  };
  if (supported) {
    for (const m of mentions) {
      if (referrerSupported(reach, m.file)) {
        add(m.file, m.line);
      }
    }
  } else {
    for (const s of reach.dynamicLoaderSites) {
      add(s.file, null);
    }
  }
  return out;
}

/** @param {string} a @param {string} b  Stable ascending string compare. */
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The feed-note item tracing every loader the pre-flight examined for an
 * unreachable candidate: all referrers (file:line) it found, or the runtime
 * loaders when only those could load it, or that nothing references it. Sorted
 * so the trace never depends on iteration order, listing all of them - the feed
 * is a local re-check trail with no token cost. Adds "(dead code only)" when a
 * referrer exists but none is itself reachable.
 * @param {Reachability} reach
 * @param {{file: string, line: number}[]} mentions  Referrers of the basename.
 * @param {boolean} supported  Whether any referrer is itself reachable.
 * @returns {string}
 */
export function loaderTrace(reach, mentions, supported) {
  if (mentions.length) {
    const refs = [...mentions]
      .sort((a, b) =>
        a.file !== b.file ? cmp(a.file, b.file) : a.line - b.line
      )
      .map((m) => `${m.file}:${m.line}`);
    const tail = supported ? "" : " (dead code only)";
    return `referenced by ${refs.join(", ")}${tail}`;
  }
  if (reach.hasDynamicLoaders) {
    const sites = [
      ...new Set(reach.dynamicLoaderSites.map((s) => s.file)),
    ].sort(cmp);
    return `a runtime loader may build its path (${sites.join(", ")})`;
  }
  return "referenced by no loaded file";
}

/**
 * Whether the add-on is a Thunderbird Experiment (declares experiment_apis).
 * @param {Manifest} manifest
 * @returns {boolean}
 */
export function isExperiment(manifest) {
  const apis = manifest?.experiment_apis;
  return (
    Boolean(apis) && typeof apis === "object" && Object.keys(apis).length > 0
  );
}

/**
 * The declared gecko strict_max_version, from browser_specific_settings or the
 * legacy applications key, or undefined.
 * @param {Manifest} manifest
 * @returns {string|undefined}
 */
export function strictMaxVersion(manifest) {
  return (
    manifest?.browser_specific_settings?.gecko?.strict_max_version ??
    manifest?.applications?.gecko?.strict_max_version
  );
}

/**
 * The declared gecko strict_min_version, from browser_specific_settings or the
 * legacy applications key, or undefined.
 * @param {Manifest} manifest
 * @returns {string|undefined}
 */
export function strictMinVersion(manifest) {
  return (
    manifest?.browser_specific_settings?.gecko?.strict_min_version ??
    manifest?.applications?.gecko?.strict_min_version
  );
}

/**
 * Parse a version string into numeric components ([115,0] for "115.0",
 * [140,4,1] for "140.4.1"). Leading non-digits per component are dropped
 * ("0a1" -> 0). Returns null when nothing numeric reads, or when "≤"/"<"-
 * prefixed: "≤59" etc. predate WebExtension support (Thunderbird 60+), so the
 * API is always available to any real add-on and is skipped.
 * @param {unknown} v
 * @returns {number[]|null}
 */
export function parseVersion(v) {
  if (typeof v !== "string") {
    return null;
  }
  const s = v.trim();
  if (/^[≤<]/.test(s)) {
    return null;
  }
  const nums = [];
  for (const part of s.split(".")) {
    const d = /^\d+/.exec(part);
    if (!d) {
      break;
    }
    nums.push(parseInt(d[0], 10));
  }
  return nums.length ? nums : null;
}

/**
 * Component-wise compare two version tuples (missing components are 0).
 * @param {number[]} a @param {number[]} b
 * @returns {number} -1 if a<b, 0 if equal, 1 if a>b.
 */
export function cmpVersion(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Whether the add-on's strict_min_version falls within an INCLUSIVE [min, max]
 * Thunderbird version range (each bound optional), compared at the BOUND's own
 * precision - so a bound of "153" denotes the whole 153.* series: 153, 153.0 and
 * 153.9 all satisfy min "153" AND max "153". Adjacent major bounds therefore
 * partition the version line with no gap (the tabs.query member notes pivot on
 * min 154 / max 153, meeting at the 154 boundary, pulled into the recheck rubric
 * version-matched via {{note:tabs.query}}). An absent or unparsable
 * strict_min_version counts as oldest: it fails any min but satisfies any max.
 * Shared by the manifest-key permission grounding, the recheck rubric assembler
 * (its permission-prompts filter and its {{note}} resolver), and the
 * unused-permission producer's token selection.
 * @param {?object} manifest
 * @param {?string} min  Inclusive lower bound, or null.
 * @param {?string} max  Inclusive upper bound, or null.
 * @returns {boolean}
 */
export function versionInBounds(manifest, min, max) {
  const v = parseVersion(strictMinVersion(manifest));
  const minV = min ? parseVersion(min) : null;
  const maxV = max ? parseVersion(max) : null;
  // Truncate v to each bound's component count before comparing, so "153" covers
  // every 153.* point release rather than only the exact "153". The min/max guards
  // are deliberately asymmetric for an unparsable/absent v (which counts as oldest):
  // min FAILS on a null v - the `!(v && ...)` makes a null v fall through to false;
  // max SATISFIES on a null v - the leading `v &&` short-circuits it to pass.
  if (minV && !(v && cmpVersion(v.slice(0, minV.length), minV) >= 0)) {
    return false;
  }
  if (maxV && v && cmpVersion(v.slice(0, maxV.length), maxV) > 0) {
    return false;
  }
  return true;
}

/**
 * The value if it is an array, else [] (defensive manifest-shape guard).
 * @param {unknown} v
 * @returns {unknown[]}
 */
export function asArray(v) {
  return Array.isArray(v) ? v : [];
}

/**
 * The value if it is a non-null object, else {} (defensive manifest guard).
 * @param {unknown} v
 * @returns {Record<string, unknown>}
 */
export function asObject(v) {
  return v && typeof v === "object" ? v : {};
}

/**
 * True if the string is a URL match pattern rather than a named permission.
 * @param {string} p
 * @returns {boolean}
 */
export function isMatchPattern(p) {
  return p === "<all_urls>" || p.includes("://") || /^\*/.test(p);
}

/**
 * 1-based line of the first occurrence of `"<token>"` in the manifest text, or
 * null if not found. Works for any quoted JSON token - a key or a string value
 * (a permission, host pattern, or web_accessible_resources entry). Best-effort:
 * a token appearing more than once resolves to its first line.
 * @param {string} manifestText
 * @param {string} token  The bare key/value, without surrounding quotes.
 * @returns {number|null}
 */
export function manifestTokenLine(manifestText, token) {
  if (!manifestText) {
    return null;
  }
  const needle = `"${token}"`;
  const lines = manifestText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(needle)) {
      return i + 1;
    }
  }
  return null;
}

/**
 * Exact 1-based source line of a manifest value addressed by its JSON path
 * (e.g. manifestPathLine(ctx, "host_permissions", 0)). Unlike manifestTokenLine
 * this is unambiguous for repeated values and immune to \uXXXX escaping. Returns
 * null when there is no position index or the path is absent. Prefer this over
 * manifestTokenLine for array values; the token search remains for unique top-level
 * keys. Reads ctx.manifestLoc - the SHIPPED manifest's index (see the RunContext).
 * @param {?import("../checks/registry.js").RunContext} ctx
 * @param {...(string|number)} path
 * @returns {number|null}
 */
export function manifestPathLine(ctx, ...path) {
  return ctx?.manifestLoc?.lineAt(path) ?? null;
}

/**
 * 1-based line of the first line containing `needle` as a plain substring, or
 * null. Unlike manifestTokenLine (which matches a quoted JSON token), this suits
 * free-form text such as a VENDOR file, where a finding anchors on the verbatim
 * source URL rather than a quoted key.
 * @param {string} text
 * @param {string} needle
 * @returns {number|null}
 */
export function lineContaining(text, needle) {
  if (!text || !needle) {
    return null;
  }
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(needle)) {
      return i + 1;
    }
  }
  return null;
}

/**
 * True if a match pattern grants global host access (<all_urls> or a "*" host).
 * @param {string} p
 * @returns {boolean}
 */
export function isBroadHost(p) {
  if (p === "<all_urls>") {
    return true;
  }
  const m = /^[^:]+:\/\/([^/]*)/.exec(p);
  return Boolean(m) && m[1] === "*";
}

/**
 * The scheme of a URL-ish string (text before the first ":").
 * @param {string} url
 * @returns {string}
 */
export function scheme(url) {
  return String(url).split(":")[0];
}

/**
 * Does a ref begin with an absolute-URL scheme (`http:`, `moz-extension:`, `data:`)?
 * The whole-prefix test - distinct from scheme(), which extracts the scheme name.
 */
export const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Escape a string for literal use inside a RegExp.
 * @param {string} s @returns {string}
 */
export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A regexp matching `token` as a whole word (case-sensitive) - the basis for
 * grounding a usage token in code (permissions.locateTokens), so a permission is
 * settled by a stable word-boundary rule.
 * @param {string} token @returns {RegExp}
 */
export function wholeWordRe(token) {
  return new RegExp(`\\b${escapeRegExp(token)}\\b`);
}

/**
 * Truncate a string for display.
 * @param {string} url
 * @param {number} [max]
 * @returns {string}
 */
export function trunc(url, max = DISPLAY_TRUNCATE_LENGTH) {
  const s = String(url);
  return s.length > max ? s.slice(0, max) + "…" : s;
}
