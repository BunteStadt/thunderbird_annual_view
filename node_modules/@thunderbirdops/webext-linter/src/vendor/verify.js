// The network half of vendor resolution, run ONCE before normalize and review.
// resolveVendor (offline) settled the no-url / untrusted / unpinned cases into
// addon.vendor.results. This step does the work that needs the network and
// writes its results into the same shared store, so the review-phase checks
// only read it (nothing is fetched twice).
//
// Two sources are verified:
//   - VENDOR entries that are trusted-host + pinned: fetch the declared URL and
//     EOL-tolerant compare against the packaged bytes (verified / modified),
//     then gate on popularity (verified / not-popular) - except a github source
//     from a first-party trusted org (e.g. github.com/thunderbird/...) is
//     accepted by provenance, skipping the popularity bar. An unfetchable URL is
//     escalated to manual review. An npm-sourced entry is also OSV-audited
//     (auditNpm); a github-sourced one (bar a first-party org) is run through
//     auditGithub, which tries to PROVE an npm twin by content-hash match (the
//     deterministic repo-name candidate, then an optional LLM-proposed name,
//     always re-proved by hash) and audit it, recording the rest as unaudited.
//   - package.json dependencies pinned to a version: fetch the published file
//     listing from unpkg ONCE (it carries a per-file sha256 integrity) and mark
//     vendored any packaged file whose content hash matches a published file's
//     integrity - matched locally, no file bytes downloaded, so it scales to a
//     large package. A file that does not hash-match is left alone, as it may be
//     the author's own code or a modified copy. The same pinned name@version is
//     also audited against OSV (auditNpm); known advisories are recorded for
//     the vendor-vulnerable check.
//
// Belongs here: verifyVendor (the batch), the per-source compare, the popularity
// lookup, and the default network transport. Does NOT belong here: URL
// classification (-> sources.js), the offline parse (-> resolve.js), the host
// allowlist + thresholds (-> config.js), and the finding/manual routing (-> the
// four vendor checks + registry).

import { createHash } from "node:crypto";

import { classifySource } from "./sources.js";
import { tarballHashes } from "./tarball.js";
import { zipHashesUnder } from "./archive.js";
import { isVendored } from "./resolve.js";
import { npmNameForLibrary } from "../lib/library-hashes.js";
import { matchLibraryBlock } from "../lib/library-blocks.js";
import { normalizedSha256, eolNormalize } from "../normalize/hash.js";
import { fetchWithTimeout } from "../util/net.js";
import { getProvider } from "../llm/provider.js";
import { newNonce, wrap, framing } from "../lib/untrusted.js";
import {
  VENDOR_NPM_MIN_DOWNLOADS,
  VENDOR_GITHUB_MIN_STARS,
  VENDOR_TRUSTED_GITHUB_ORGS,
  VENDOR_FETCH_TIMEOUT_MS,
  VENDOR_FETCH_MAX_BYTES,
  VENDOR_OSV_API,
} from "../config.js";

/** @typedef {import("../addon/load.js").Addon} Addon */
/** @typedef {import("./resolve.js").VendorStore} VendorStore */
/** @typedef {import("./sources.js").VendorSource} VendorSource */
/**
 * @typedef {{fetchBytes: (url: string) => Promise<Buffer>,
 *   fetchJson: (url: string) => Promise<object>,
 *   postJson: (url: string, body: object) => Promise<object>}} VendorNet
 */
/**
 * @typedef {object} VendorVuln  One vulnerable npm package (OSV audit) - a
 * package.json dependency, an npm-sourced VENDOR entry, or a hash-identified
 * (undeclared) bundled library.
 * @property {string} name  npm package name.
 * @property {string} version  The bundled (pinned/identified) version audited.
 * @property {string[]} ids  Advisory ids (CVE preferred, else OSV/GHSA).
 * @property {string} severity  Highest reported severity, or "unknown".
 * @property {string[]} fixed  Versions the advisories were fixed in (may be
 *   empty).
 * @property {string} file  Where the finding anchors (package.json, the VENDOR
 *   file, or the bundled library file itself).
 * @property {string} token  The string locating the declaration line in `file`,
 *   or "" when there is none (an identified library has no declaration line, so
 *   the finding anchors at the file with no line).
 */
/**
 * @typedef {object} MetaNode  A node in an unpkg "?meta" listing. unpkg returns
 * a flat `files` array whose entries each carry a `path` and a `type` that is
 * the file's MIME type (e.g. "application/javascript") - NOT the literal
 * "file". The listing root (and any directory node in the older nested form)
 * instead carries a `files` child array, so a node is a FILE when it has a
 * `path` and no `files`.
 * @property {string} [path]  The published path.
 * @property {string} [type]  A file's MIME type, or "directory" (nested form).
 * @property {string} [integrity]  A file's Subresource-Integrity hash, e.g.
 *   "sha256-<base64>" (used to match without downloading the bytes).
 * @property {MetaNode[]} [files]  Child nodes (the listing root / a directory).
 */

/**
 * @typedef {object} VendorLlm  The LLM params for the github->npm resolution
 *   fallback, threaded from the pipeline (mirrors resolveVendor's LLM inputs).
 *   When absent or `enabled` is false, github entries resolve deterministically
 *   only (offline runs and the golden harness pass nothing).
 * @property {boolean} [enabled]  Whether the LLM is enabled (--llm-review).
 * @property {?string} [resolvePrompt]  The registry prompts.vendor-npm-resolve
 *   text (the rubric for proposing an npm package).
 * @property {?string} [token]  LLM token (a real key, or undefined keyless).
 * @property {string} [model] @property {string} [url]  LLM base URL override.
 * @property {string} [type]  LLM_API_TYPE (claude | chatgpt | ollama).
 * @property {Function} [callText]  Injectable transport (else the provider's).
 * @property {import("../llm/budget.js").LlmBudget} [budget]  Run-wide model cap.
 */

/**
 * Verify the resolved vendor declarations over the network, appending per-file
 * results to (and extending the skip-set of) the shared `addon.vendor` store.
 * @param {Addon} addon  Must already carry `addon.vendor` from resolveVendor.
 * @param {VendorNet} [net]
 * @param {VendorLlm} [llm]  LLM params for the github->npm resolution fallback;
 *   defaults to "no LLM" (deterministic resolution only).
 * @param {?Map<string, object>} [blocks]  The Mozilla policy blocklist, applied to
 *   these shipped/declared libraries (see auditNpm).
 * @returns {Promise<void>}
 */
export async function verifyVendor(addon, net = defaultNet, llm = {}, blocks) {
  const vendor = addon?.vendor;
  if (!vendor) {
    return;
  }
  // VENDOR entries known trusted + pinned (the rest were settled offline).
  for (const entry of vendor.manifest) {
    if (!entry.trusted || !entry.pinned) {
      continue;
    }
    // A folder declaration: every packaged file under the directory is matched
    // against the repo archive (scoped to the declared subpath), one result each.
    if (entry.kind === "folder") {
      await verifyFolder(entry, addon, vendor, net);
      continue;
    }
    // A whole-package tarball source (npm registry) is extracted + per-file hash
    // matched; a single-file source is byte-compared.
    const src = classifySource(entry.sourceUrl);
    const outcome = src.tarball
      ? await verifyTarball(entry, addon, net)
      : await verifyUrl(entry, addon, net);
    vendor.results.push({
      path: entry.path,
      source: entry.sourceUrl,
      outcome,
    });
    // An npm-sourced VENDOR lib is also audited for known vulnerabilities (the
    // same OSV query as a package.json dep), anchored at its VENDOR-file line.
    // A github source carries no npm identity directly, so auditGithub tries to
    // PROVE one (content-hash match against a candidate npm package) and audit
    // it too; an unprovable one is recorded as unaudited.
    if (src.kind === "npm") {
      await auditNpm(
        src.pkg,
        src.version,
        vendor.vendorFile,
        entry.sourceUrl,
        vendor,
        net,
        vendor.vulnerabilities,
        blocks
      );
    } else if (src.kind === "github") {
      await auditGithub(entry, src, addon, vendor, net, llm, blocks);
    }
  }
  for (const pkg of vendor.packages) {
    await verifyPackage(pkg, addon, vendor, net);
    await auditNpm(
      pkg.name,
      pkg.version,
      "package.json",
      pkg.name,
      vendor,
      net,
      vendor.vulnerabilities,
      blocks
    );
  }
  // A `not-popular` outcome is reconciled into addon.bundled.untrusted later, by
  // applyNotPopularVendor (src/lib/bundled.js), because addon.bundled is
  // built AFTER this step in the pipeline. It stays in vendor.results until then.
}

/**
 * SCA (source code archive) dependency audit: the network half for SCA mode,
 * the analogue of verifyVendor for XPI mode. The source archive's package.json
 * is the only dependency manifest (no VENDOR.md, no hash/CDN matching - the built
 * libraries are not present in the readable source and are mangled in the XPI).
 * For each pinned dependency it records (a) OSV advisories (auditNpm ->
 * vendor.vulnerabilities, read by vendor-vulnerable) and (b) a non-popular verdict
 * (-> vendor.unpopularDeps, read by unpopular-source-dependency): a dependency
 * that is not a confirmed widely-used library is pulled in at build and cannot be
 * reviewed, so the developer must ship its readable source in --sca-source. Each
 * pinned devDependency additionally gets (c) an OSV audit (-> vendor.devVulnerabilities,
 * read by vendor-vulnerable-dev) but no popularity gate: the reviewer builds from
 * source, so a vulnerable build tool is a real risk, while a niche-but-legit one
 * must not be rejected as unpopular.
 *
 * Popularity uses a direct npm-downloads lookup (npmDownloads), not isPopular, so
 * a FAILED lookup skips rather than false-rejecting a popular dependency; offline
 * runs (the listing/downloads throw) therefore record nothing.
 * @param {Addon} addon  Must already carry `addon.vendor` from resolveVendor.
 * @param {VendorNet} [net]
 * @param {?Map<string, object>} [blocks]  The Mozilla policy blocklist, applied to
 *   the declared (shipped) dependencies - NOT to devDependencies (never shipped).
 * @returns {Promise<void>}
 */
export async function verifyScaDependencies(addon, net = defaultNet, blocks) {
  const vendor = addon?.vendor;
  if (!vendor) {
    return;
  }
  for (const pkg of vendor.packages) {
    await auditNpm(
      pkg.name,
      pkg.version,
      "package.json",
      pkg.name,
      vendor,
      net,
      vendor.vulnerabilities,
      blocks
    );
    const downloads = await npmDownloads(pkg.name, net);
    if (downloads !== null && downloads < VENDOR_NPM_MIN_DOWNLOADS) {
      vendor.unpopularDeps.push({
        name: pkg.name,
        version: pkg.version,
        file: "package.json",
        token: pkg.name,
      });
    }
  }
  // GitHub-sourced deps clear the bar by stars (or a trusted-org free pass) - the
  // same popularity check a VENDOR.md github source gets. No content/OSV audit
  // here: the build pulls the code from GitHub at build time, so it is not present
  // to hash. A failed lookup records nothing (like npmDownloads above).
  for (const dep of vendor.githubDeps ?? []) {
    const popular = await githubPopular(dep.repo, net);
    if (popular === false) {
      vendor.unpopularDeps.push({
        name: dep.name,
        version: dep.spec,
        file: "package.json",
        token: dep.name,
      });
    }
  }
  // Dev dependencies never ship, but the reviewer builds the add-on from source,
  // so a vulnerable build tool runs on the reviewer's machine. Audit each pinned
  // npm dev dep for OSV only - no popularity gate (a niche-but-legit build tool is
  // fine) - recording hits on devVulnerabilities for the vendor-vulnerable-dev check.
  for (const pkg of vendor.devPackages ?? []) {
    // No blocklist here: a devDependency is never shipped, so the shipped-library
    // policy does not apply. It is OSV-audited (into devVulnerabilities) but never
    // recorded as a banned-library - auditNpm is passed no `blocks`.
    await auditNpm(
      pkg.name,
      pkg.version,
      "package.json",
      pkg.name,
      vendor,
      net,
      vendor.devVulnerabilities
    );
  }
}

/**
 * Whether a GitHub repo clears the popularity bar (stargazers >=
 * VENDOR_GITHUB_MIN_STARS), with a trusted-org (VENDOR_TRUSTED_GITHUB_ORGS) free
 * pass. Returns null when the stars lookup fails - kept distinguishable from a
 * real below-bar reading (like npmDownloads) so an offline / flaky run records
 * nothing rather than false-rejecting a popular repo.
 * @param {string} repo  "owner/repo".
 * @param {VendorNet} net
 * @returns {Promise<boolean | null>}
 */
async function githubPopular(repo, net) {
  const owner = String(repo ?? "")
    .split("/")[0]
    .toLowerCase();
  if (VENDOR_TRUSTED_GITHUB_ORGS.includes(owner)) {
    return true; // first-party org (e.g. Thunderbird) - trusted by provenance
  }
  try {
    const j = await net.fetchJson(`https://api.github.com/repos/${repo}`);
    const n = Number(j?.stargazers_count);
    return Number.isFinite(n) ? n >= VENDOR_GITHUB_MIN_STARS : null;
  } catch {
    return null;
  }
}

/**
 * Last-month npm download count for a package, or null when the lookup fails.
 * Unlike isPopular (which collapses any error to "not popular"), this keeps a
 * failed lookup distinguishable so the unpopular-source-dependency REJECT only
 * ever fires on a positive below-threshold reading, never on a flaky network call
 * (or an offline run). The npm download API serves scoped packages too.
 * @param {string} name  npm package name.
 * @param {VendorNet} net
 * @returns {Promise<number | null>}
 */
async function npmDownloads(name, net) {
  try {
    const j = await net.fetchJson(
      `https://api.npmjs.org/downloads/point/last-month/${name}`
    );
    const n = Number(j?.downloads);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Audit a pinned npm package@version against the OSV vulnerability database.
 * First consults the Mozilla policy blocklist `blocks` (when given): a banned
 * name@version is recorded on vendor.blocked and SKIPS the OSV query (rejected
 * regardless); an unadvised one is recorded but still audited (a live CVE on an
 * allowed library still matters). `blocks` is passed only for SHIPPED libraries, so
 * an SCA devDependency (never shipped) is audited but never policy-blocked.
 * Best-effort: a package with known advisories is recorded on
 * `into` (one entry aggregating its advisories, anchored at `file`/`token`). Any
 * network or parse error - or an injected net without `postJson` (offline runs,
 * the golden harness) - records nothing. Drives package.json deps and npm-sourced
 * VENDOR entries -> vendor.vulnerabilities (read by vendor-vulnerable), and SCA
 * devDependencies -> vendor.devVulnerabilities (read by vendor-vulnerable-dev); the
 * caller passes the target `into` array.
 * @param {string} name  npm package name.
 * @param {string} version  The bundled (pinned) version.
 * @param {string} file  Where the finding anchors (package.json / the VENDOR
 *   file).
 * @param {string} token  The string locating the declaration line in `file`.
 * @param {VendorStore} vendor @param {VendorNet} net
 * @param {VendorVuln[]} into  The array to record a hit on: vendor.vulnerabilities
 *   for shipped/declared deps, or vendor.devVulnerabilities for SCA dev deps.
 *   Explicit - never defaulted - so a hit is never silently mis-bucketed.
 * @param {?Map<string, object>} [blocks]  The Mozilla policy blocklist to apply
 *   (assets/library-blocks.yaml); absent/null for an SCA devDependency (never
 *   shipped, so never policy-blocked).
 * @returns {Promise<void>}
 */
async function auditNpm(name, version, file, token, vendor, net, into, blocks) {
  // The Mozilla policy blocklist is consulted BEFORE the OSV query (see the JSDoc):
  // a banned version records a hit and returns (no OSV); an unadvised one records a
  // hit and still audits. `blocks` is passed only for shipped libraries.
  const block = matchLibraryBlock(blocks, name, version);
  if (block) {
    (vendor.blocked ??= []).push({
      name,
      version,
      status: block.status,
      reason: block.reason,
      file,
      token,
    });
    if (block.status === "banned") {
      return;
    }
  }
  let vulns;
  try {
    const res = await net.postJson(VENDOR_OSV_API, {
      // OSV npm versions carry no "v" prefix. A vendored URL may (e.g.
      // "@v1.2.3").
      version: String(version).replace(/^v/i, ""),
      package: { name, ecosystem: "npm" },
    });
    vulns = Array.isArray(res?.vulns) ? res.vulns : [];
  } catch {
    return; // offline / no postJson / OSV unreachable - skip silently
  }
  if (!vulns.length) {
    return;
  }
  const ids = new Set();
  const fixed = new Set();
  let severity = "unknown";
  for (const v of vulns) {
    ids.add(advisoryId(v));
    for (const f of fixedVersions(v, name)) {
      fixed.add(f);
    }
    severity = worseSeverity(severity, vulnSeverity(v));
  }
  into.push({
    name,
    version,
    ids: [...ids],
    severity,
    fixed: [...fixed],
    file,
    token,
  });
}

/**
 * OSV-audit the libraries identified by content hash (addon.bundled.classified
 * entries carrying a libraryId) - the undeclared third-party libraries the hash
 * classifier recognized. A declared/vendored copy is excluded before
 * classification, so this catches exactly the bundles a developer shipped without
 * a VENDOR declaration: the same auditNpm an npm dep gets, so an undeclared
 * vulnerable jquery is flagged just like a declared one. The dispensary name is
 * mapped to its npm package (npmNameForLibrary); the finding anchors at the
 * bundled file with no line (an undeclared library has no declaration line, so
 * the token is empty). Each release is audited at most once: a package already
 * flagged as a declared dep / VENDOR entry, or the same library bundled in more
 * than one file, is not re-queried or double-reported. Best-effort: runs after
 * classifyBundled, shares the OSV transport, and skips silently offline. Requires
 * addon.vendor (resolveVendor) for the shared vulnerabilities store.
 * @param {Addon} addon  Must carry addon.vendor and addon.bundled.
 * @param {VendorNet} [net]
 * @param {?Map<string, object>} [blocks]  The Mozilla policy blocklist (applied to
 *   these identified, hence shipped, libraries; see auditNpm).
 * @returns {Promise<void>}
 */
export async function auditIdentifiedLibraries(
  addon,
  net = defaultNet,
  blocks
) {
  const vendor = addon?.vendor;
  const classified = addon?.bundled?.classified;
  if (!vendor || !classified) {
    return;
  }
  // Skip a release already recorded - as a declared dep / VENDOR entry
  // (vulnerabilities), or as a policy hit (blocked, which a BANNED library never adds
  // to vulnerabilities) - and collapse the same library bundled in several files to
  // one audit. Seeding `seen` from `blocked` too keeps a declared-AND-bundled banned
  // library from being recorded twice.
  const seen = new Set(
    [...vendor.vulnerabilities, ...vendor.blocked].map(
      (v) => `${v.name}@${v.version}`
    )
  );
  for (const tag of classified) {
    if (!tag.libraryId) {
      continue;
    }
    // A CDN match identified via a GitHub source has no npm identity (its name is
    // "owner/repo"), so the npm OSV query would be meaningless - skip it. Hash-DB
    // and npm-CDN matches are npm packages and audited normally.
    if (tag.cdn && tag.cdn.type !== "npm") {
      continue;
    }
    const name = npmNameForLibrary(tag.libraryId.name);
    const key = `${name}@${tag.libraryId.version}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    await auditNpm(
      name,
      tag.libraryId.version,
      tag.file,
      "",
      vendor,
      net,
      vendor.vulnerabilities,
      blocks
    );
  }
}

/**
 * Try to audit a github-sourced VENDOR entry via its npm twin. A first-party
 * trusted org (VENDOR_TRUSTED_GITHUB_ORGS) stays completely silent - no audit,
 * no unaudited record. Otherwise an npm identity is PROVEN by content-hash
 * matching the bundled bytes against a candidate package's published files
 * (npmHashMatches - path-independent, no bytes downloaded): the deterministic
 * candidate first (repo name @ ref-without-v), then, only if that fails and the
 * LLM is enabled, an LLM-proposed name that is RE-VERIFIED by the same hash match
 * before any audit (the hash is the proof; a wrong guess is rejected, never
 * audited). A proven identity is audited (auditNpm, anchored at the VENDOR-file
 * source line - the developer sees the declared github URL, never the resolved
 * npm one); an unresolved entry is recorded on vendor.unaudited for the
 * vendor-vuln-unknown check.
 * @param {VendorEntry & {trusted: boolean, pinned: boolean}} entry
 * @param {VendorSource} src  The classified github source (carries repo + ref).
 * @param {Addon} addon @param {VendorStore} vendor @param {VendorNet} net
 * @param {VendorLlm} llm @param {?Map<string, object>} [blocks]  The Mozilla policy
 *   blocklist (applied to a proven npm twin; see auditNpm).
 * @returns {Promise<void>}
 */
async function auditGithub(entry, src, addon, vendor, net, llm, blocks) {
  const owner = String(src.repo ?? "")
    .split("/")[0]
    .toLowerCase();
  if (VENDOR_TRUSTED_GITHUB_ORGS.includes(owner)) {
    // First-party (e.g. Thunderbird) - trusted by provenance: no OSV audit, and no
    // policy blocklist check either (a first-party org is not expected to ship a
    // banned upstream). The same boundary the OSV audit already draws.
    return;
  }
  const bundled = addon.files.get(entry.path) ?? Buffer.alloc(0);
  const version = String(src.ref ?? "").replace(/^v/i, "");

  // (a) Deterministic: the npm package usually shares the repo name.
  const repoName = String(src.repo ?? "")
    .split("/")
    .slice(1)
    .join("/");
  if (
    repoName &&
    version &&
    (await npmHashMatches(repoName, version, bundled, net))
  ) {
    await auditNpm(
      repoName,
      version,
      vendor.vendorFile,
      entry.sourceUrl,
      vendor,
      net,
      vendor.vulnerabilities,
      blocks
    );
    return;
  }

  // (b) LLM fallback: the model only PROPOSES a name (handling scoped/renamed
  // packages the bare repo name misses); the hash match below re-proves it.
  if (
    llm.enabled &&
    llm.resolvePrompt &&
    (!llm.budget || (await llm.budget.consume()))
  ) {
    const proposal = await llmProposeNpm(entry, src, llm).catch(() => null);
    const name = proposal?.name;
    const ver = String(proposal?.version ?? version).replace(/^v/i, "");
    if (name && ver && (await npmHashMatches(name, ver, bundled, net))) {
      await auditNpm(
        name,
        ver,
        vendor.vendorFile,
        entry.sourceUrl,
        vendor,
        net,
        vendor.vulnerabilities,
        blocks
      );
      return;
    }
  }

  // (c) Unresolved - hand to vendor-vuln-unknown.
  vendor.unaudited.push({
    path: entry.path,
    source: entry.sourceUrl,
    repo: src.repo,
  });
}

/**
 * Whether `bytes` content-hash-matches ANY published file of the npm package
 * name@version - a path-independent Subresource-Integrity match from the package
 * "?meta" listing (the same proof verifyPackage uses, but for one buffer and
 * fetching only the listing, no file bodies). Best-effort: any error, a net
 * without fetchJson (offline / the golden harness), or a non-existent candidate
 * package returns false, so the caller falls back / records the entry as
 * unaudited rather than guessing.
 * @param {string} name @param {string} version @param {Buffer} bytes
 * @param {VendorNet} net
 * @returns {Promise<boolean>}
 */
async function npmHashMatches(name, version, bytes, net) {
  let listing;
  try {
    listing = await net.fetchJson(`https://unpkg.com/${name}@${version}/?meta`);
  } catch {
    return false;
  }
  const byHash = indexBySri(listing);
  for (const algo of new Set([...byHash.keys()].map((k) => k.split("-")[0]))) {
    if (
      byHash.has(`${algo}-${createHash(algo).update(bytes).digest("base64")}`)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Index an unpkg "?meta" listing's published files by their SRI hash
 * ("<algo>-<base64>" -> published path), first occurrence winning. unpkg emits
 * standard padded base64, which matches Node's digest("base64"). Shared by
 * verifyPackage (which needs the path) and npmHashMatches (which needs only
 * membership).
 * @param {MetaNode} listing
 * @returns {Map<string, string>}
 */
function indexBySri(listing) {
  const byHash = new Map();
  for (const f of metaFiles(listing)) {
    for (const sri of String(f.integrity ?? "")
      .trim()
      .split(/\s+/)) {
      if (/^sha\d+-./.test(sri) && !byHash.has(sri)) {
        byHash.set(sri, f.path);
      }
    }
  }
  return byHash;
}

/**
 * Ask the LLM for the npm package (and version) a github-sourced library
 * corresponds to. The reply is UNTRUSTED and only a hint - auditGithub re-proves
 * it by hash before any audit. The repo/ref/file/source describing the library
 * are wrapped in nonce markers as USER data, with the trusted rubric in the
 * SYSTEM prompt (src/lib/untrusted.js), exactly like resolveVendor's parse
 * fallback.
 * @param {VendorEntry} entry @param {VendorSource} src @param {VendorLlm} llm
 * @returns {Promise<?{name: string, version: ?string}>}
 */
async function llmProposeNpm(entry, src, llm) {
  const callText = llm.callText ?? getProvider(llm.type).callText;
  const nonce = newNonce();
  const body = JSON.stringify({
    repo: src.repo,
    ref: src.ref,
    file: entry.path,
    source: entry.sourceUrl,
  });
  const reply = await callText({
    token: llm.token,
    model: llm.model,
    baseURL: llm.url,
    system: `${framing(nonce)}\n\n${llm.resolvePrompt}`,
    prompt: wrap(nonce, "VENDOR", body),
  });
  const m = String(reply).match(/\{[\s\S]*\}/);
  if (!m) {
    return null;
  }
  try {
    const j = JSON.parse(m[0]);
    return typeof j?.name === "string" && j.name
      ? {
          name: j.name,
          version: typeof j.version === "string" ? j.version : null,
        }
      : null;
  } catch {
    return null;
  }
}

/**
 * @typedef {object} OsvAffected  One `affected` range group of an OSV record.
 * @property {{ecosystem?: string, name?: string}} [package]  The affected
 *   package (ecosystem + name).
 * @property {{events?: {fixed?: string}[]}[]} [ranges]  Version ranges, each
 *   carrying `fixed` events.
 */
/**
 * @typedef {object} OsvVuln  An OSV vulnerability record (the fields this module
 *   reads from the OSV query response).
 * @property {string} [id]  The OSV/GHSA id.
 * @property {string[]} [aliases]  Alias ids (a CVE may appear here).
 * @property {OsvAffected[]} [affected]  Affected package/version ranges.
 * @property {{severity?: string}} [database_specific]  Database-specific data,
 *   e.g. GHSA's severity label.
 * @property {{score?: string}[]} [severity]  Severity entries (e.g. a CVSS
 *   vector string under `score`).
 */
/**
 * The advisory's preferred id: a CVE alias if present, else the OSV/GHSA id.
 * @param {OsvVuln} v  An OSV vuln record.
 * @returns {string}
 */
function advisoryId(v) {
  const cve = (v?.aliases ?? []).find((a) => /^CVE-/i.test(String(a)));
  return cve || v?.id || "unknown";
}

/**
 * The fixed versions OSV lists for `name` (npm) in this advisory: the `fixed`
 * events of every matching `affected` range.
 * @param {OsvVuln} v  An OSV vuln record. @param {string} name
 * @returns {string[]}
 */
function fixedVersions(v, name) {
  const out = [];
  for (const a of v?.affected ?? []) {
    if (a?.package?.ecosystem !== "npm" || a?.package?.name !== name) {
      continue;
    }
    for (const range of a?.ranges ?? []) {
      for (const ev of range?.events ?? []) {
        if (ev?.fixed) {
          out.push(String(ev.fixed));
        }
      }
    }
  }
  return out;
}

// OSV / GitHub Advisory severity labels, low to high. Unknown sorts lowest.
const SEVERITY_RANK = [
  "unknown",
  "low",
  "moderate",
  "medium",
  "high",
  "critical",
];

/**
 * A human severity label for an OSV vuln: the database-specific label (GHSA's
 * LOW/MODERATE/HIGH/CRITICAL) when present, else derived coarsely from a CVSS
 * vector, else "unknown".
 * @param {OsvVuln} v  An OSV vuln record.
 * @returns {string}
 */
function vulnSeverity(v) {
  const ds = v?.database_specific?.severity;
  if (typeof ds === "string" && ds) {
    return ds.toLowerCase();
  }
  // A CVSS vector string under severity[]: map its base score band if present.
  const score = (v?.severity ?? []).find((s) => s?.score)?.score;
  if (typeof score === "string" && /^CVSS:/i.test(score)) {
    return "unknown"; // a vector without a numeric base - leave unlabelled
  }
  return "unknown";
}

/** The higher of two severity labels. @param {string} a @param {string} b */
function worseSeverity(a, b) {
  return SEVERITY_RANK.indexOf(b) > SEVERITY_RANK.indexOf(a) ? b : a;
}

/**
 * Compare a packaged file against its declared trusted+pinned URL.
 * @param {{path: string, sourceUrl: string}} entry
 * @param {Addon} addon @param {VendorNet} net
 * @returns {Promise<"verified"|"modified"|"not-popular"|"unfetchable">}
 */
async function verifyUrl(entry, addon, net) {
  const src = classifySource(entry.sourceUrl);
  const mine = addon.files.get(entry.path) ?? Buffer.alloc(0);
  let fetched;
  try {
    fetched = await net.fetchBytes(src.rawUrl);
  } catch {
    return "unfetchable";
  }
  if (!eolEqual(mine, fetched)) {
    return "modified";
  }
  return (await isPopular(src, net)) ? "verified" : "not-popular";
}

/**
 * Verify a packaged file against a whole-package npm-registry tarball: download the
 * .tgz, hash every file inside (EOL-normalized), and accept the bundled file when its
 * normalized hash is among them - the same content-match the experiment allow-list
 * uses, just sourced from the tarball instead of a remote hash listing. A fetch,
 * gunzip, or parse failure is reported as unfetchable (the bytes to compare against
 * could not be obtained).
 * @param {{path: string, sourceUrl: string}} entry
 * @param {Addon} addon @param {VendorNet} net
 * @returns {Promise<"verified"|"modified"|"not-popular"|"unfetchable">}
 */
async function verifyTarball(entry, addon, net) {
  const src = classifySource(entry.sourceUrl);
  const mine = addon.files.get(entry.path) ?? Buffer.alloc(0);
  let hashes;
  try {
    hashes = tarballHashes(await net.fetchBytes(src.rawUrl));
  } catch {
    return "unfetchable";
  }
  if (!hashes.has(normalizedSha256(mine))) {
    return "modified";
  }
  return (await isPopular(src, net)) ? "verified" : "not-popular";
}

/**
 * Verify a vendored FOLDER: resolve its github tree source to the repo ZIP archive,
 * hash every upstream file under the declared subpath, then match EACH packaged file
 * under the directory by content hash (the same membership test as verifyTarball,
 * one result per file). A file not in the upstream set is `modified`; a fetch/parse
 * failure records the whole folder `unfetchable` (so it escalates to manual review,
 * not silence).
 * @param {{path: string, sourceUrl: string}} entry  Folder entry (path = directory).
 * @param {Addon} addon @param {VendorStore} vendor @param {VendorNet} net
 * @returns {Promise<void>}
 */
async function verifyFolder(entry, addon, vendor, net) {
  const src = classifySource(entry.sourceUrl);
  let hashes;
  try {
    hashes = zipHashesUnder(
      await net.fetchBytes(src.rawUrl),
      src.subpath ?? ""
    );
  } catch {
    vendor.results.push({
      path: entry.path,
      source: entry.sourceUrl,
      outcome: "unfetchable",
    });
    return;
  }
  const prefix = `${entry.path.replace(/\/+$/, "")}/`;
  let popular = null; // looked up once, lazily, only if a file actually matches
  for (const [addonPath, mine] of addon.files) {
    if (!addonPath.startsWith(prefix)) {
      continue;
    }
    if (!hashes.has(normalizedSha256(mine))) {
      vendor.results.push({
        path: addonPath,
        source: entry.sourceUrl,
        outcome: "modified",
      });
      continue;
    }
    if (popular === null) {
      popular = await isPopular(src, net);
    }
    vendor.results.push({
      path: addonPath,
      source: entry.sourceUrl,
      outcome: popular ? "verified" : "not-popular",
    });
  }
}

/**
 * Match packaged files against a pinned npm package's published files by
 * Subresource-Integrity hash (the per-file sha256 in the "?meta" listing),
 * recording each match as vendored. The match is purely local - the listing is
 * the only fetch and no file bytes are downloaded - so it scales to large
 * packages.
 * @param {{name: string, version: string}} pkg
 * @param {Addon} addon @param {VendorStore} vendor @param {VendorNet} net
 * @returns {Promise<void>}
 */
async function verifyPackage(pkg, addon, vendor, net) {
  // A declared dependency whose files match nothing in the package is silently
  // ignored, by design: dependencies are installed/bundled at build time, so a
  // not-yet-built submission legitimately omits them (unlike a VENDOR entry,
  // whose file must be present - see missing-vendor-file.js). We only record the
  // files that DO match.
  const base = `https://unpkg.com/${pkg.name}@${pkg.version}`;
  let listing;
  try {
    listing = await net.fetchJson(`${base}/?meta`);
  } catch {
    return; // can't list the package - its files (if shipped) are scanned as-is
  }
  // Index the published files by their SRI hash ("<algo>-<base64>" -> path).
  const byHash = indexBySri(listing);
  const algos = [...new Set([...byHash.keys()].map((k) => k.split("-")[0]))];
  let popular = null; // looked up once, lazily, only if a file actually matches
  for (const [addonPath, mine] of addon.files) {
    if (isVendored(vendor, addonPath)) {
      continue; // already vendored (a VENDOR file entry or folder)
    }
    // A packaged file is vendored when its exact content hash matches a
    // published file (basename-independent - a renamed verbatim copy still
    // matches). A file that does not hash-match is left alone (it may be the
    // author's own code, or a modified copy).
    let path = null;
    for (const algo of algos) {
      const sri = `${algo}-${createHash(algo).update(mine).digest("base64")}`;
      if (byHash.has(sri)) {
        path = byHash.get(sri);
        break;
      }
    }
    if (!path) {
      continue;
    }
    if (popular === null) {
      popular = await isPopular({ kind: "npm", pkg: pkg.name }, net);
    }
    vendor.set.add(addonPath);
    vendor.results.push({
      path: addonPath,
      source: `${base}${path}`,
      outcome: popular ? "verified" : "not-popular",
    });
  }
}

/**
 * Whether two buffers are equal once end-of-line differences are normalized:
 * CRLF / CR collapse to LF and trailing newlines are ignored (the developer's
 * "allow EOL diffs"). Compared via latin1, which is byte-preserving.
 * @param {Buffer} a @param {Buffer} b
 * @returns {boolean}
 */
function eolEqual(a, b) {
  return eolNormalize(a) === eolNormalize(b);
}

/**
 * The published file nodes (each `{path, integrity, ...}`) an unpkg "?meta"
 * listing contains. A node is a file when it has a `path` and no `files` child
 * of its own - which covers both unpkg's flat listing (every entry is a file,
 * its `type` a MIME type) and the older nested tree (directories carry a `files`
 * array). Keying off `type === "file"` would miss the flat form, whose entries
 * carry a MIME type instead.
 * @param {MetaNode} node @param {MetaNode[]} [out]
 * @returns {MetaNode[]}
 */
function metaFiles(node, out = []) {
  if (!node || typeof node !== "object") {
    return out;
  }
  if (typeof node.path === "string" && node.files === undefined) {
    out.push(node);
  }
  for (const child of node.files ?? []) {
    metaFiles(child, out);
  }
  return out;
}

/**
 * Whether the source clears the trust bar: a broadly-used library (npm monthly
 * downloads or GitHub stars over the configured bar) OR a github source from a
 * first-party trusted org (VENDOR_TRUSTED_GITHUB_ORGS, e.g. Thunderbird), which
 * is accepted by provenance regardless of stars and without a popularity lookup.
 * A lookup error counts as "not popular" (the case then goes to manual review).
 * Shared by verifyVendor's per-source checks (VENDOR / package.json) and the CDN
 * identifier (src/lib/cdn-lookup.js), so all identification paths gate on
 * the same bar. `src` need only carry {kind, pkg} (npm) or {kind, repo} (github).
 * @param {VendorSource} src @param {VendorNet} net
 * @returns {Promise<boolean>}
 */
export async function isPopular(src, net) {
  try {
    if (src.kind === "npm") {
      const j = await net.fetchJson(
        `https://api.npmjs.org/downloads/point/last-month/${src.pkg}`
      );
      return Number(j?.downloads) >= VENDOR_NPM_MIN_DOWNLOADS;
    }
    if (src.kind === "github") {
      const owner = String(src.repo ?? "")
        .split("/")[0]
        .toLowerCase();
      if (VENDOR_TRUSTED_GITHUB_ORGS.includes(owner)) {
        return true; // first-party org (e.g. Thunderbird) - trusted by provenance
      }
      const j = await net.fetchJson(`https://api.github.com/repos/${src.repo}`);
      return Number(j?.stargazers_count) >= VENDOR_GITHUB_MIN_STARS;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * The default network transport: a timeout- and size-capped HTTPS fetch. The
 * caller only ever passes an already trusted-host URL.
 * @type {VendorNet}
 */
export const defaultNet = {
  fetchBytes(url) {
    return fetchWithTimeout(url, readBytes, VENDOR_FETCH_TIMEOUT_MS);
  },
  fetchJson(url) {
    return fetchWithTimeout(url, readJson, VENDOR_FETCH_TIMEOUT_MS);
  },
  postJson(url, body) {
    return fetchWithTimeout(url, readJson, VENDOR_FETCH_TIMEOUT_MS, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  },
};

/**
 * Read a fetch Response as bytes, enforcing the size cap (fetchBytes' consumer). A
 * consume callback for fetchWithTimeout, so the read runs under the abort timeout.
 * @param {Response} res
 * @returns {Promise<Buffer>}
 */
async function readBytes(res) {
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const declared = Number(res.headers.get("content-length"));
  if (declared && declared > VENDOR_FETCH_MAX_BYTES) {
    throw new Error("source exceeds size cap");
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > VENDOR_FETCH_MAX_BYTES) {
    throw new Error("source exceeds size cap");
  }
  return buf;
}

/**
 * Read a fetch Response as JSON, enforcing the size cap. Shared by fetchJson and
 * postJson.
 * @param {Response} res
 * @returns {Promise<object>}
 */
async function readJson(res) {
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const declared = Number(res.headers.get("content-length"));
  if (declared && declared > VENDOR_FETCH_MAX_BYTES) {
    throw new Error("response exceeds size cap");
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > VENDOR_FETCH_MAX_BYTES) {
    throw new Error("response exceeds size cap");
  }
  return JSON.parse(buf.toString("utf8"));
}
