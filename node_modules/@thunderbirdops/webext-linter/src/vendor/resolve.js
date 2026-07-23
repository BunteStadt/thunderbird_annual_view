// Resolves the add-on's vendored declarations ONCE, at the top of the pipeline,
// before anything reformats or reviews files. This is the OFFLINE half: it
// parses the VENDOR file (with an LLM fallback) and the package.json dependency
// manifest (pinning each via an exact spec or a lock file), classifies each
// declared source, and builds the shared `addon.vendor` store. The network half
// (fetch + compare + popularity) is verifyVendor (src/vendor/verify.js), which
// fills in the per-file results. The review-phase checks only read the store.
//
// Belongs here: combining the VENDOR + package.json declarations into the
// offline `addon.vendor` (set, manifest, packages, unpinned, offline results).
// Does NOT belong here: the network verification (-> verify.js), the
// deterministic VENDOR parse (-> src/normalize/vendor.js), lock parsing (->
// src/vendor/locks.js), URL classification (-> src/vendor/sources.js), and the
// LLM wire protocol (-> src/llm/provider.js + the adapters).

import {
  parseVendorManifest,
  missingVendorEntries,
  readVendorFile,
  buildFileMatcher,
} from "../normalize/vendor.js";
import { classifySource } from "./sources.js";
import { lockedVersion } from "./locks.js";
import { getProvider } from "../llm/provider.js";
import { progress, FEED, llmErrorText } from "../util/log.js";
import { red } from "../util/color.js";
import { newNonce, wrap, framing } from "../lib/untrusted.js";
import { SCHEME_RE } from "../lib/util.js";

/** @typedef {import("../addon/load.js").Addon} Addon */
/** @typedef {import("../normalize/vendor.js").VendorEntry} VendorEntry */
/**
 * @typedef {object} VendorStore
 * @property {Set<string>} set  Vendored file paths (exact-match skip-set).
 * @property {Set<string>} folders  Vendored directory paths (prefix-match): every
 *   file under one is vendored (a folder declaration). Use isVendored to test both.
 * @property {{path: string, source: ?string, outcome: string}[]} results
 *   Per-file outcomes (offline ones now, network ones added by verifyVendor).
 * @property {(VendorEntry & {trusted: boolean, pinned: boolean})[]} manifest
 *   Classified VENDOR-file entries.
 * @property {{name: string, version: string}[]} packages  Pinned deps.
 * @property {{name: string, spec: string}[]} unpinned  Deps with no pin.
 * @property {{name: string, spec: string, repo: string, ref: ?string}[]}
 *   githubDeps  GitHub-sourced package.json deps (popularity-gated like a
 *   VENDOR.md github source; audited by verifyScaDependencies in SCA mode).
 * @property {{name: string, spec: string}[]} unsupportedDeps  package.json deps
 *   from an unsupported source (not npm, not GitHub); rejected by the
 *   unsupported-dependency check.
 * @property {{name: string, version: string}[]} devPackages  Pinned npm
 *   devDependencies. Never shipped, but OSV-audited in SCA mode because the
 *   reviewer builds from source (verifyScaDependencies).
 * @property {VendorEntry[]} missing  VENDOR entries whose file is absent.
 * @property {{source: string, paths: string[]}[]} ambiguousSources  Source URLs
 *   paired with more than one bundled file (the developer must split them or use a
 *   folder). Read by the vendor-ambiguous-source check.
 * @property {boolean} unparsedVendor  A VENDOR file exists but yielded nothing.
 * @property {?string} vendorFile  The VENDOR filename (e.g. "VENDOR.md"), or
 *   null; the anchor file for VENDOR-sourced vulnerability/unaudited findings.
 * @property {import("./verify.js").VendorVuln[]} vulnerabilities  Pinned npm
 *   packages (package.json deps + npm VENDOR entries) with known OSV advisories
 *   (filled by verifyVendor's audit; empty offline).
 * @property {import("./verify.js").VendorVuln[]} devVulnerabilities  SCA mode
 *   only: pinned npm devDependencies with known OSV advisories (filled by
 *   verifyScaDependencies; empty in XPI mode / offline). Read by the
 *   vendor-vulnerable-dev check.
 * @property {{path: string, source: ?string, repo: ?string}[]} unaudited
 *   GitHub-sourced VENDOR entries that could not be resolved to a verified npm
 *   identity for an OSV audit (filled by verifyVendor; empty offline). Read by
 *   the vendor-vuln-unknown check to surface them as info.
 * @property {{name: string, version: string, file: string, token: string}[]}
 *   unpopularDeps  SCA mode: declared dependencies that are not a confirmed
 *   widely-used library (filled by verifyScaDependencies; empty in XPI mode /
 *   offline). Read by the unpopular-source-dependency check.
 * @property {{name: string, version: string, status: string, reason: string,
 *   file: string, token: string}[]} blocked  Bundled library versions Mozilla
 *   add-on policy disallows (banned) or discourages (unadvised): auditNpm matches
 *   each audited (name, version) against the policy the audit is given and records a
 *   hit here (a banned one also skips the OSV query). Read by the banned-library check.
 */

// An exact semver (no range operators) - a concrete pinned version.
const EXACT = /^v?\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/;

/**
 * Whether a packaged file is vendored: an exact VENDOR-file entry, or a file under
 * a vendored folder declaration (prefix). The single test for "skip this file" used
 * by the normalizer-adjacent checks (bundled.js, unused-files.js) and verifyPackage.
 * @param {?{set?: Set<string>, folders?: Set<string>}} vendor  The vendor store.
 * @param {string} file  Add-on-relative path.
 * @returns {boolean}
 */
export function isVendored(vendor, file) {
  if (!vendor) {
    return false;
  }
  if (vendor.set?.has(file)) {
    return true;
  }
  for (const dir of vendor.folders ?? []) {
    if (file.startsWith(`${dir}/`)) {
      return true;
    }
  }
  return false;
}

/**
 * Resolve the offline vendored declarations into `addon.vendor`.
 * @param {object} params
 * @param {Addon} params.addon
 * @param {?string} [params.parsePrompt]  The registry prompts.vendor-parse text.
 * @param {boolean} [params.enabled]  Whether the LLM is enabled
 *   (--llm-review); gates the LLM parse fallback. Decoupled from the token (a
 *   keyless provider has none).
 * @param {?string} [params.token]  LLM token (a real key, or undefined keyless).
 * @param {string} [params.model]
 * @param {string} [params.url]  Override the LLM API base URL (LLM_API_URL).
 * @param {string} [params.type]  LLM_API_TYPE (claude | chatgpt | ollama).
 * @param {Function} [params.callText]  Injectable transport (else the
 *   provider's).
 * @param {import("../llm/budget.js").LlmBudget} [params.budget]  Run-wide model
 *   request cap; the parse fallback is skipped once it is exhausted.
 * @returns {Promise<VendorStore>}
 */
export async function resolveVendor({
  addon,
  parsePrompt,
  enabled = false,
  token,
  model,
  url,
  type,
  callText = getProvider(type).callText,
  budget,
}) {
  const vendorFile = readVendorFile(addon);
  const manifest = dedupeByPath(parseVendorManifest(addon));
  // The LLM parse fallback is one model request. Count it against the run-wide
  // cap and skip it (deterministic only) once that is spent. Gated on the LLM
  // being enabled, not on a token (Ollama is keyless).
  const wantLlmParse =
    Boolean(vendorFile) && manifest.length === 0 && enabled && parsePrompt;
  if (wantLlmParse && (!budget || (await budget.consume()))) {
    try {
      manifest.push(
        ...(await llmExtract({
          text: vendorFile.text,
          addon,
          parsePrompt,
          token,
          model,
          url,
          callText,
        }))
      );
    } catch (err) {
      // Report the failure at this step (visible without --verbose). The
      // deterministic parse still stands, so the review continues.
      progress(
        red(`vendor parse: LLM fallback failed - ${llmErrorText(err)}`),
        FEED.STEP
      );
    }
  }

  const set = new Set();
  const folders = new Set();
  const results = [];

  // One source URL paired with more than one bundled FILE is ambiguous: the
  // developer must give each file its own source, or declare the containing
  // folder as a single source. Pull those entries out of the manifest (we do not
  // verify a guessed pairing) but keep their paths vendored (skip-set), and
  // surface them via the vendor-ambiguous-source check. Folder entries are exempt
  // - a folder legitimately covers many files.
  const ambiguousSources = [];
  {
    const byUrl = new Map();
    for (const e of manifest) {
      if (e.kind === "folder" || !e.sourceUrl) {
        continue;
      }
      const list = byUrl.get(e.sourceUrl) ?? [];
      list.push(e.path);
      byUrl.set(e.sourceUrl, list);
    }
    const bad = new Set();
    for (const [source, paths] of byUrl) {
      if (paths.length > 1) {
        ambiguousSources.push({ source, paths });
        bad.add(source);
      }
    }
    for (let i = manifest.length - 1; i >= 0; i--) {
      if (manifest[i].kind !== "folder" && bad.has(manifest[i].sourceUrl)) {
        set.add(manifest[i].path); // still vendored, just unverifiable
        manifest.splice(i, 1);
      }
    }
  }

  for (const entry of manifest) {
    const src = classifySource(entry.sourceUrl);
    entry.trusted = src.trusted;
    entry.pinned = src.pinned;
    // A declared file/folder is vendored regardless of its outcome. A folder path
    // is a directory PREFIX (its files are skipped/verified by prefix - see
    // isVendored / verifyFolder), so it goes to `folders`, not the exact-path set.
    if (entry.kind === "folder") {
      folders.add(entry.path);
    } else {
      set.add(entry.path);
    }
    if (!entry.sourceUrl) {
      results.push({ path: entry.path, source: null, outcome: "no-url" });
    } else if (!src.trusted) {
      results.push({
        path: entry.path,
        source: entry.sourceUrl,
        outcome: "untrusted",
      });
    } else if (!src.pinned) {
      results.push({
        path: entry.path,
        source: entry.sourceUrl,
        outcome: "unpinned-source",
      });
    }
    // Trusted + pinned entries are left for verifyVendor to fetch.
  }

  const { packages, unpinned, githubDeps, unsupported, devPackages } =
    resolvePackages(addon);
  // VENDOR entries (file + source URL) naming a file the package does not
  // contain. Drives the missing-vendor-file check. Deterministic - the LLM
  // fallback only adds files that resolve, so it never affects this set.
  const missing = missingVendorEntries(addon);

  return {
    set,
    folders,
    results,
    manifest,
    packages,
    unpinned,
    // GitHub-sourced package.json deps (popularity-gated like a VENDOR.md github
    // source). Audited by verifyScaDependencies in SCA mode.
    githubDeps,
    // package.json deps from an unsupported source (not npm, not GitHub). Read by
    // the unsupported-dependency check, which rejects them.
    unsupportedDeps: unsupported,
    // Pinned npm devDependencies. Never shipped, but OSV-audited in SCA mode
    // because the reviewer builds from source (verifyScaDependencies).
    devPackages,
    missing,
    ambiguousSources,
    vendorFile: vendorFile?.name ?? null,
    // Filled by verifyVendor's OSV audit (network). Empty for offline runs.
    vulnerabilities: [],
    // Bundled library versions Mozilla add-on policy disallows (banned) or
    // discourages (unadvised): auditNpm matches each audited (name, version) against
    // the policy the audit is given (assets/library-blocks.yaml) and records a hit
    // here - a banned one also skips the OSV query. Read by the banned-library check.
    blocked: [],
    // SCA mode only: pinned npm devDependencies with known OSV advisories (filled
    // by verifyScaDependencies; empty in XPI mode / offline). Read by the
    // vendor-vulnerable-dev check.
    devVulnerabilities: [],
    // Filled by verifyVendor when a github source cannot be resolved to a
    // verified npm identity (network). Empty for offline runs.
    unaudited: [],
    // SCA mode only: declared dependencies that are not a confirmed widely-used
    // library (filled by verifyScaDependencies; empty in XPI mode / offline).
    // Read by the unpopular-source-dependency check.
    unpopularDeps: [],
    // "Unparsed" only when we extracted nothing at all - neither a matched entry
    // nor a missing-file declaration. A parseable-but-missing VENDOR goes to the
    // missing-vendor-file check instead of a "could not be parsed" manual item.
    unparsedVendor:
      Boolean(vendorFile) && manifest.length === 0 && missing.length === 0,
  };
}

/**
 * Classify one package.json dependency map (`dependencies` or `devDependencies`)
 * by each spec. Only two sources are supported: a pinned npm package (an exact
 * spec, or a range a lock file pins) and a GitHub URL (audited by popularity, like
 * a VENDOR.md github source). The rest are surfaced, not dropped: a range with no
 * lock is `unpinned` (the dep is real but unverifiable), and any other non-registry
 * spec (file:/link:/workspace:/npm: alias/tarball/non-github git) is `unsupported`.
 * @param {Record<string, string>|undefined} deps  A dependency map, or undefined.
 * @param {Addon} addon  Needed to pin a range against a lock file (lockedVersion
 *   also reads the lock's devDependencies).
 * @returns {{packages: {name: string, version: string}[],
 *   unpinned: {name: string, spec: string}[],
 *   githubDeps: {name: string, spec: string, repo: string, ref: ?string}[],
 *   unsupported: {name: string, spec: string}[]}}
 */
function classifyDeps(deps, addon) {
  const packages = [];
  const unpinned = [];
  const githubDeps = [];
  const unsupported = [];
  for (const [name, rawSpec] of Object.entries(deps ?? {})) {
    const spec = String(rawSpec).trim();
    if (EXACT.test(spec)) {
      packages.push({ name, version: spec.replace(/^v/, "") });
    } else if (/[:/]/.test(spec)) {
      // A non-registry spec. A GitHub source is allowed (popularity-gated); every
      // other source (file:/link:/workspace:/npm: alias/tarball/non-github git) is
      // not supported and is rejected rather than silently ignored.
      const gh = parseGithubSpec(spec);
      if (gh) {
        githubDeps.push({ name, spec, repo: gh.repo, ref: gh.ref });
      } else {
        unsupported.push({ name, spec });
      }
    } else {
      const version = lockedVersion(addon, name);
      if (version) {
        packages.push({ name, version });
      } else {
        unpinned.push({ name, spec });
      }
    }
  }
  return { packages, unpinned, githubDeps, unsupported };
}

/**
 * Classify package.json `dependencies` (all buckets) and `devDependencies` (pinned
 * npm only -> `devPackages`). Dev deps never ship, but the SCA reviewer builds the
 * add-on from source, so a pinned npm dev dep is OSV-audited too
 * (verifyScaDependencies). Only its pinned-npm bucket is kept: dev deps are not
 * popularity-gated, and their pinning / source support are shipping concerns.
 * A name in `dependencies` is a production dependency (npm ignores a same-named
 * `devDependencies` entry), so it is classified once as prod and dropped from the
 * dev set - the two vuln checks never double-report one package. Only
 * `dependencies` + `devDependencies` are read: `optionalDependencies` may be absent
 * at build, and `peerDependencies` are supplied by the host, not this build.
 * @param {Addon} addon
 * @returns {{packages: {name: string, version: string}[],
 *   unpinned: {name: string, spec: string}[],
 *   githubDeps: {name: string, spec: string, repo: string, ref: ?string}[],
 *   unsupported: {name: string, spec: string}[],
 *   devPackages: {name: string, version: string}[]}}
 */
function resolvePackages(addon) {
  let pkg;
  try {
    pkg = JSON.parse(addon.files.get("package.json").toString("utf8"));
  } catch {
    return {
      packages: [],
      unpinned: [],
      githubDeps: [],
      unsupported: [],
      devPackages: [],
    };
  }
  // A dev dep also declared in `dependencies` is a production dependency (the
  // dependencies copy wins, as in npm) - drop it from the dev set so it is audited
  // and reported once, as prod. devPackages is dev-ONLY.
  const prodNames = new Set(Object.keys(pkg.dependencies ?? {}));
  const devOnly = Object.fromEntries(
    Object.entries(pkg.devDependencies ?? {}).filter(
      ([name]) => !prodNames.has(name)
    )
  );
  return {
    ...classifyDeps(pkg.dependencies, addon),
    devPackages: classifyDeps(devOnly, addon).packages,
  };
}

/**
 * Parse a package.json dependency spec pointing at GitHub into {repo, ref}, or
 * null when it is not a GitHub source. Covers npm's recognized GitHub forms: the
 * bare "owner/repo" shorthand, "github:owner/repo", and git / git+http(s) /
 * git+ssh / https URLs whose host is github.com. A trailing "#ref" (tag, commit,
 * or "semver:RANGE") becomes the ref; repo is normalized to "owner/repo".
 * @param {string} spec
 * @returns {{repo: string, ref: ?string} | null}
 */
function parseGithubSpec(spec) {
  const s = String(spec).trim();
  const split = (rest) => {
    const i = rest.indexOf("#");
    const repo = (i === -1 ? rest : rest.slice(0, i))
      .replace(/\.git$/i, "")
      .split("/")
      .slice(0, 2)
      .join("/");
    const ref = i === -1 ? null : rest.slice(i + 1).replace(/^semver:/i, "");
    return { repo, ref: ref || null };
  };
  // Bare "owner/repo" shorthand (npm reads this as GitHub): one slash, no scheme.
  if (!SCHEME_RE.test(s) && /^[\w.-]+\/[\w.-]+(?:#.*)?$/.test(s)) {
    return split(s);
  }
  if (/^github:/i.test(s)) {
    return split(s.slice("github:".length));
  }
  const url = s.match(
    /^(?:git\+)?(?:https?|git|ssh):\/\/(?:[^@/]+@)?github\.com\/(.+)$/i
  );
  if (url) {
    return split(url[1]);
  }
  // SCP-style git URL: [git+][user@]github.com:owner/repo[.git][#ref] - the form
  // npm accepts for a GitHub source without a scheme (a ":" after the host, not "/").
  const scp = s.match(/^(?:git\+)?(?:[^@/]+@)?github\.com:(.+)$/i);
  if (scp) {
    return split(scp[1]);
  }
  return null;
}

/**
 * Extract {path, sourceUrl} from a free-form VENDOR file via the LLM, keeping
 * only paths that resolve to a real packaged file.
 * @param {object} params
 * @param {string} params.text @param {Addon} params.addon
 * @param {string} params.parsePrompt @param {string} params.token
 * @param {string} params.model @param {string} [params.url]  LLM base URL.
 * @param {Function} params.callText
 * @returns {Promise<VendorEntry[]>}
 */
async function llmExtract({
  text,
  addon,
  parsePrompt,
  token,
  model,
  url,
  callText,
}) {
  // The VENDOR file is free-form, attacker-controlled text - the highest-risk
  // injection vector. Trusted instructions go in system; the file is wrapped in
  // nonce markers as user data (see src/lib/untrusted.js).
  const nonce = newNonce();
  const reply = await callText({
    token,
    model,
    baseURL: url,
    system: `${framing(nonce)}\n\n${parsePrompt}`,
    prompt: wrap(nonce, "VENDOR", text),
  });
  const match = buildFileMatcher(addon);
  const out = [];
  const seen = new Set();
  for (const item of parseJsonArray(reply)) {
    const path =
      item && typeof item.file === "string" ? match(item.file) : null;
    if (path && !seen.has(path)) {
      seen.add(path);
      out.push({
        path,
        sourceUrl: typeof item.url === "string" ? item.url : null,
      });
    }
  }
  return out;
}

/** @param {VendorEntry[]} entries @returns {VendorEntry[]} */
function dedupeByPath(entries) {
  const seen = new Set();
  return entries.filter((e) => !seen.has(e.path) && seen.add(e.path));
}

/** @param {string} reply @returns {Array<{file?: string, url?: string}>} */
function parseJsonArray(reply) {
  const m = String(reply).match(/\[[\s\S]*\]/);
  if (!m) {
    return [];
  }
  try {
    const value = JSON.parse(m[0]);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
