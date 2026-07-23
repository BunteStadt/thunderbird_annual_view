// Classifies a declared vendor source URL, with no network. It decides whether
// the host is one we may fetch from, whether the ref is immutable (so a byte
// comparison against it is stable), the raw URL to fetch, and the identifier
// used for the popularity lookup (npm package or GitHub owner/repo).
//
// Belongs here: parsing the trusted host shapes (unpkg, jsDelivr npm + gh,
// raw.githubusercontent) plus the github.com/.../blob -> raw rewrite, and the
// pinned-ref heuristic. The host allowlist policy itself is config.js
// VENDOR_TRUSTED_HOSTS - the single source of truth this module gates on (a host
// it does not list is untrusted, no matter what a parser could do with it). Does
// NOT belong here: fetching/comparing/popularity (-> src/vendor/verify.js), or
// the finding/manual routing (-> the check).

import { VENDOR_TRUSTED_HOSTS } from "../config.js";

/**
 * @typedef {object} VendorSource
 * @property {boolean} trusted  Host is one we may fetch from.
 * @property {boolean} pinned  Ref is immutable (a version/tag/commit).
 * @property {boolean} tarball  rawUrl serves a whole-package tarball (the npm
 *   registry), not a single file - verified by extracting + per-file hash match
 *   instead of a single-file byte compare.
 * @property {?string} rawUrl  The raw URL to fetch (blob URLs rewritten to raw).
 * @property {?("npm"|"github")} kind  Source family, for popularity.
 * @property {?string} pkg  npm package name (npm kind).
 * @property {?string} version  npm version, when given (npm kind); else null.
 * @property {?string} repo  "owner/repo" (github kind).
 * @property {?string} ref  Git ref (version tag or commit) (github kind); else
 *   null. The npm-resolution audit derives the version from this.
 * @property {?string} subpath  For a github /tree/ DIRECTORY source: the path
 *   within the repo whose files are the upstream set (rawUrl is the repo ZIP
 *   archive). null for single-file/package sources.
 */

const UNTRUSTED = Object.freeze({
  trusted: false,
  pinned: false,
  tarball: false,
  rawUrl: null,
  kind: null,
  pkg: null,
  version: null,
  repo: null,
  ref: null,
  subpath: null,
});

// A concrete npm version (not a dist-tag like "latest"/"next").
const VERSION = /^v?\d+(\.\d+)*([.-][0-9a-z.-]+)?$/i;
// A pinned git ref: a version tag or a full 40-hex commit SHA.
const GIT_REF = /^(v?\d+(\.\d+)*([.-][0-9a-z.-]+)?|[0-9a-f]{40})$/i;

// An accepted INPUT host that is not itself a fetch host: a github.com/.../blob
// URL is rewritten to raw.githubusercontent.com (which IS in VENDOR_TRUSTED_HOSTS)
// before fetch, so github.com is allowed as an alias but never listed as a fetch
// host in config.
const GITHUB_INPUT_HOST = "github.com";

// Per-host URL parsers. The keys are the only hosts classifySource will parse;
// each value turns the path segments into a VendorSource. Trust is still gated on
// VENDOR_TRUSTED_HOSTS below - this table only knows how to read each host's URL
// shape, not whether the host is allowed.
const HOST_PARSERS = {
  "unpkg.com": (segs, url) => {
    const { pkg, version } = npmFromPath(segs);
    return pkg ? npm(pkg, version, url) : UNTRUSTED;
  },
  "cdn.jsdelivr.net": (segs, url) => {
    if (segs[0] === "npm") {
      const { pkg, version } = npmFromPath(segs.slice(1));
      return pkg ? npm(pkg, version, url) : UNTRUSTED;
    }
    if (segs[0] === "gh" && segs.length >= 3) {
      const { repo, ref } = ghSpec(segs[1], segs[2]);
      return github(repo, ref, url);
    }
    return UNTRUSTED;
  },
  // GitHub serves raw files both as <owner>/<repo>/<ref>/<path> and fully
  // qualified as <owner>/<repo>/refs/(tags|heads)/<ref>/<path>. Read the real
  // ref from the latter so a tag like refs/tags/v3.10.1 is seen as pinned, not
  // the literal "refs". rawUrl stays the original URL (fetchable as-is).
  "raw.githubusercontent.com": (segs, url) => {
    if (segs[2] === "refs") {
      return segs.length >= 6
        ? github(`${segs[0]}/${segs[1]}`, segs[4], url)
        : UNTRUSTED;
    }
    return segs.length >= 4
      ? github(`${segs[0]}/${segs[1]}`, segs[2], url)
      : UNTRUSTED;
  },
  [GITHUB_INPUT_HOST]: (segs) => {
    const [owner, repo, type, ref, ...rest] = segs;
    // A single file: /blob/<ref>/<path> -> the raw file URL (byte-compared).
    if (type === "blob" && segs.length >= 5) {
      const raw = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${rest.join("/")}`;
      return github(`${owner}/${repo}`, ref, raw);
    }
    // A directory: /tree/<ref>/<subpath> -> the repo ZIP archive; only files
    // under <subpath> are the upstream set (a folder declaration, see verifyFolder).
    if (type === "tree" && segs.length >= 4) {
      const archive = `https://github.com/${owner}/${repo}/archive/${ref}.zip`;
      return {
        ...github(`${owner}/${repo}`, ref, archive),
        subpath: rest.join("/"),
      };
    }
    return UNTRUSTED;
  },
  // The npm registry serves the whole package as a versioned .tgz, e.g.
  // /ical.js/-/ical.js-2.2.1.tgz - verified by extract + per-file hash match.
  "registry.npmjs.org": (segs, url) => {
    const { pkg, version } = npmTarballFromPath(segs);
    return pkg && version
      ? { ...npm(pkg, version, url), tarball: true }
      : UNTRUSTED;
  },
};

// The hosts a source URL may use: every config fetch host, plus the github.com
// input alias. classifySource accepts nothing outside this set, so config is the
// authority for what is trusted.
const ALLOWED_HOSTS = new Set([...VENDOR_TRUSTED_HOSTS, GITHUB_INPUT_HOST]);

// Fail fast on drift: a fetch host in config with no parser here would silently
// be rejected by classifySource (no way to read its URL), so require one.
for (const host of VENDOR_TRUSTED_HOSTS) {
  if (!HOST_PARSERS[host]) {
    throw new Error(
      `No vendor source parser for trusted host "${host}" (src/vendor/sources.js HOST_PARSERS must cover every config.js VENDOR_TRUSTED_HOSTS entry)`
    );
  }
}

/**
 * Classify a declared source URL.
 * @param {?string} url
 * @returns {VendorSource}
 */
export function classifySource(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return UNTRUSTED;
  }
  if (u.protocol !== "https:") {
    return UNTRUSTED;
  }
  const host = u.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    return UNTRUSTED;
  }
  const segs = u.pathname.split("/").filter(Boolean);
  return HOST_PARSERS[host](segs, url);
}

/**
 * @param {string} pkg @param {?string} version @param {string} rawUrl
 * @returns {VendorSource}
 */
function npm(pkg, version, rawUrl) {
  return {
    ...UNTRUSTED,
    trusted: true,
    kind: "npm",
    pkg,
    version: version ?? null,
    rawUrl,
    pinned: Boolean(version) && version !== "latest" && VERSION.test(version),
  };
}

/**
 * @param {string} repo  "owner/repo" @param {?string} ref @param {string} rawUrl
 * @returns {VendorSource}
 */
function github(repo, ref, rawUrl) {
  return {
    ...UNTRUSTED,
    trusted: true,
    kind: "github",
    repo,
    ref: ref ?? null,
    rawUrl,
    pinned: Boolean(ref) && GIT_REF.test(ref),
  };
}

/**
 * Split an npm path into {pkg, version}, handling a scoped "@scope/name@ver".
 * @param {string[]} segs  Path segments after the host (and after "npm" for
 *   jsDelivr).
 * @returns {{pkg: ?string, version: ?string}}
 */
function npmFromPath(segs) {
  if (!segs.length) {
    return { pkg: null, version: null };
  }
  if (segs[0].startsWith("@") && segs.length >= 2) {
    const at = segs[1].indexOf("@");
    const name = at >= 0 ? segs[1].slice(0, at) : segs[1];
    return {
      pkg: `${segs[0]}/${name}`,
      version: at >= 0 ? segs[1].slice(at + 1) : null,
    };
  }
  const at = segs[0].indexOf("@");
  return {
    pkg: at >= 0 ? segs[0].slice(0, at) : segs[0],
    version: at >= 0 ? segs[0].slice(at + 1) : null,
  };
}

/**
 * Split an npm-registry tarball path into {pkg, version}. The shape is
 * `<pkg>/-/<name>-<version>.tgz`, with `<pkg>` either "name" or "@scope/name" and
 * `<name>` the unscoped package name. Returns nulls when it does not match.
 * @param {string[]} segs  Path segments after registry.npmjs.org.
 * @returns {{pkg: ?string, version: ?string}}
 */
function npmTarballFromPath(segs) {
  const scoped = segs[0]?.startsWith("@");
  const dash = scoped ? 2 : 1;
  if (segs[dash] !== "-" || segs.length !== dash + 2) {
    return { pkg: null, version: null };
  }
  const name = scoped ? segs[1] : segs[0];
  const file = segs[dash + 1];
  if (!name || !file.endsWith(".tgz") || !file.startsWith(`${name}-`)) {
    return { pkg: null, version: null };
  }
  return {
    pkg: scoped ? `${segs[0]}/${segs[1]}` : segs[0],
    version: file.slice(name.length + 1, -4),
  };
}

/**
 * Split a jsDelivr "gh" repo segment "<repo>@<ref>" into {repo, ref}.
 * @param {string} owner @param {string} repoSeg
 * @returns {{repo: string, ref: ?string}}
 */
function ghSpec(owner, repoSeg) {
  const at = repoSeg.indexOf("@");
  const repo = at >= 0 ? repoSeg.slice(0, at) : repoSeg;
  return {
    repo: `${owner}/${repo}`,
    ref: at >= 0 ? repoSeg.slice(at + 1) : null,
  };
}
