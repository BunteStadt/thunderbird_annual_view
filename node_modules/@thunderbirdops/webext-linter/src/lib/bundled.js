// Classifies each JS or CSS file once into { library, minified, obfuscated } for
// the missing-library, minified-code and obfuscated-code checks. `library` is a
// TRUE content-hash match against the known-library database (a file whose raw
// sha256 is a known release is the library, identified by name@version - see
// src/lib/library-hashes.js). `minified` is a structural signal (statement density,
// see src/lib/minified.js); `obfuscated` is a structural match against a known
// obfuscator family (see src/lib/obfuscation.js).
//
// The classification keys off the raw shipped bytes (the library hash, and each
// detector's parse of the shipped source), so it is resolved ONCE up front - before the
// normalizer reformats files - by the pipeline into addon.bundled (classifyBundled), the
// same "compute once, checks read it" pattern as addon.vendor. Were it computed during
// the review, build/lint mode (which pretty-prints first) would change the bytes and
// miss all three.
//
// Belongs here: classifyBundled (the one-shot classification + non-authored skip
// set) and the per-file tagging it uses. classifyAddonJs / nonAuthoredJs are thin
// readers of the memoized store. The known-library hash DB itself is fetched and
// parsed in src/lib/library-hashes.js.
//
// Does NOT belong here: the rule verdicts and findings - those live in the
// missing-library, minified-code and obfuscated-code rules under src/checks/rules/*. Resolving
// the vendored set it builds on (addon.vendor.set) - src/vendor/resolve.js.
// Extension-set helpers - src/util/files.js.

import { extname, JS_EXTENSIONS, CSS_EXTENSIONS } from "../util/files.js";
import { isVendored } from "../vendor/resolve.js";
import { rawSha256 } from "../normalize/hash.js";
import { obfuscationVerdict } from "./obfuscation.js";
import { VERDICT } from "./enum.js";
import { isMinified } from "./minified.js";

/** @typedef {import("../checks/registry.js").RunContext} RunContext */
/** @typedef {import("../addon/load.js").Addon} Addon */
/** @typedef {{name: string, version: string}} LibraryId */
/** @typedef {{file: string, library: boolean, minified: boolean,
 *   obfuscation: import("./enum.js").Verdict, untrusted?: boolean, libraryId?: LibraryId,
 *   cdn?: {url: string, type?: string, popular?: boolean}}} BundleTag  `library` is set by a
 *   content-hash match against the known-library database; `libraryId` names the
 *   matched release (for the missing-library finding). `minified` is the raw
 *   minified-by-geometry verdict; a minified non-library is non-authored and the CDN
 *   identifier considers it for a jsDelivr match. `obfuscation` is the three-state VERDICT
 *   from src/lib/obfuscation.js: FAIL (a STRONG-family match - the obfuscated-code finding,
 *   non-authored), UNSURE (a weak-family-only match - readable, authored, scanned, and
 *   referred to obfuscated-code's LLM/manual adjudication), or PASS. `cdn` is set later
 *   (src/lib/cdn-lookup.js) when such a bundle is matched on the jsDelivr CDN:
 *   it holds the jsDelivr source URL (and its type) for the find-lib-on-cdn finding
 *   plus `popular` - whether the matched package cleared the popularity trust bar.
 *   A POPULAR match ALSO sets `library`/`libraryId` (vendored-family, like a hash
 *   match); a NOT-popular one sets `untrusted` instead (identified but not exempt -
 *   see markUntrusted), keeping `libraryId` for the OSV audit. */
/** @typedef {{classified: BundleTag[], nonAuthored: Set<string>,
 *   untrusted: Array<{file: string, source?: string, name?: string, unreadable: boolean}>}} Bundled */

/**
 * Classify the add-on's JS and CSS once: per-file library/minified/obfuscated tags
 * plus the not-the-developer's-source skip set. Pure and addon-keyed, so the pipeline can
 * run it before normalize. The result is stored on addon.bundled.
 *
 * `nonAuthored` is the VENDOR.md-declared third-party files plus any JS or CSS
 * tagged library / minified / obfuscated. The source-level finding scanners (the
 * eval checks, unsafe-html, remote-resources, code-sanity) skip these to save time
 * and noise - minified or obfuscated code is forbidden anyway (minified-code,
 * obfuscated-code and missing-library reject it and request the original sources,
 * which are then reviewed), and vendored files are declared third-party. Reachability skips
 * them only when REACHABILITY_SKIPS_NON_AUTHORED is on (src/config.js, off by
 * default), since dropping their loader edges would wrongly orphan what they
 * load.
 *
 * The `library` tag is a content-hash match (libraryHashes); the matched release
 * is named on tag.libraryId, which missing-library surfaces and which
 * auditIdentifiedLibraries (src/vendor/verify.js) OSV-audits so an undeclared
 * vulnerable bundle is caught. TODO: extend the same hashing to recognize
 * minified/obfuscated bundles.
 *
 * Composed of classifyFiles (the per-file library/minified/obfuscated tags +
 * non-authored skip set) and assembleBundled (the thin finalizer that seeds the empty
 * `untrusted` list). Every mode and caller shares this one path - there is no separate
 * precomputed-verdict route, since the obfuscation detector is self-contained.
 *
 * @param {Addon} addon
 * @param {{libraryHashes?: Map<string, LibraryId>}} [opts]
 *   libraryHashes: the known-library `sha256 -> {name, version}` map - a file whose
 *   raw hash is a key is tagged `library` (and identified). Empty map = nothing
 *   recognized. A minified-by-geometry file (an unidentifiable webpack/tsc bundle) is
 *   non-authored (skipped by the source-level scanners and rejected by minified-code),
 *   in both XPI and source-code submission reviews. A hash-identified library is real
 *   third-party code, so it - like the obfuscated tag and VENDOR.md-declared /
 *   experiment-trusted files - stays non-authored.
 * @returns {Bundled}
 */
export function classifyBundled(addon, { libraryHashes = new Map() } = {}) {
  return assembleBundled(classifyFiles(addon, { libraryHashes }));
}

/**
 * The per-file classification: library (content hash) / minified (geometry) /
 * obfuscation (structural, via classify) tags, plus the vendored / experiment-trusted /
 * library / minified / obfuscated non-authored seed. `tag.obfuscation` is the final
 * verdict here - the detector is structural, so there is no later AST correction.
 * @param {Addon} addon
 * @param {{libraryHashes?: Map<string, LibraryId>}} [opts]
 * @returns {{classified: BundleTag[], nonAuthored: Set<string>}}
 */
export function classifyFiles(addon, { libraryHashes = new Map() } = {}) {
  const classified = [];
  // Files of a recognised allowed Experiment (pristine or modified) are
  // upstream-derived, not the developer's - the byte-match IS their review, so
  // the source-level scanners skip them like a vendored library, regardless of
  // --allow-experiments. trustedFiles is empty only when some experiment is
  // unsupported (not a known upstream draft): then nothing is trusted and all of
  // it stays linted.
  const trusted = addon.experiments?.trustedFiles ?? new Set();
  const nonAuthored = new Set([...trusted]);
  for (const [file, buf] of addon.files) {
    const ext = extname(file);
    // A vendored file (an exact VENDOR entry OR a file under a vendored folder) is
    // not the developer's code: skip scanning it and treat it as non-authored.
    const vend = isVendored(addon.vendor, file);
    if (vend) {
      nonAuthored.add(file);
    }
    if ((!JS_EXTENSIONS.has(ext) && !CSS_EXTENSIONS.has(ext)) || vend) {
      continue;
    }
    if (buf.length < 1024) {
      // Too small (by bytes, as hashed) to be a library or a worrying blob. The floor
      // also bounds the obfuscation detector to sizes where it is precise: on a tiny
      // file its array-replacement heuristic fires on an ordinary string-lookup table
      // (e.g. a day-name array), a false positive that vanishes above ~1KB.
      continue;
    }
    const text = buf.toString("utf8");
    // The library tag is a true content-hash match against the known-library DB;
    // a hit also names the matched release (libraryId) for missing-library.
    const libraryId = libraryHashes.get(rawSha256(buf));
    const content = classify(text, file);
    const tag = { file, library: Boolean(libraryId), ...content };
    if (libraryId) {
      tag.libraryId = libraryId;
    }
    classified.push(tag);
    // A library/minified/obfuscated file is not the developer's reviewable source, so
    // it joins the skip set: identified libraries are declared third-party, minified
    // and obfuscated files are rejected (and their original source requested) rather
    // than scanned.
    if (tag.library || tag.minified || tag.obfuscation.fail) {
      nonAuthored.add(file);
    }
  }
  return { classified, nonAuthored };
}

/**
 * Finalize the classification into a Bundled: the classified tags and non-authored set
 * from classifyFiles, plus the empty `untrusted` list. Pure, no parse.
 * @param {{classified: BundleTag[], nonAuthored: Set<string>}} byteResult  From
 *   classifyFiles.
 * @returns {Bundled}
 */
export function assembleBundled({ classified, nonAuthored }) {
  // `untrusted` is filled later (cdn-lookup.js, vendor/verify.js) for an
  // identified-but-not-popular library: known by content, but not confirmed
  // widely used, so NOT in the trusted/exempt family - see markUntrusted.
  return { classified, nonAuthored, untrusted: [] };
}

/**
 * Record an identified-but-not-popular ("untrusted") library and route it out of
 * the trusted/exempt family: a readable one is reviewed as authored code (removed
 * from the non-authored skip set), an unreadable (minified/obfuscated) one stays
 * skipped and is rejected by untrusted-minified-library. The untrusted-library /
 * untrusted-minified-library checks read addon.bundled.untrusted. Idempotent and
 * defensive (no-op without a bundled store, e.g. some unit harnesses).
 * @param {Addon} addon
 * @param {{file: string, source?: string, name?: string, unreadable: boolean}} entry
 *   `name` is the display id (e.g. "lodash 4.17.21"); `source` the upstream URL.
 */
export function markUntrusted(addon, { file, source, name, unreadable }) {
  const bundled = addon?.bundled;
  if (!bundled) {
    return;
  }
  bundled.untrusted.push({ file, source, name, unreadable });
  if (unreadable) {
    bundled.nonAuthored.add(file); // unreadable -> not scanned; the reject asks for source
  } else {
    bundled.nonAuthored.delete(file); // readable -> reviewed as authored code
  }
}

/**
 * Reconcile the `not-popular` VENDOR/package results (recorded by verifyVendor)
 * into the untrusted family - identified but not a confirmed widely-used library,
 * so reviewed as authored code (markUntrusted). Done as a pipeline step AFTER
 * classifyBundled (which builds addon.bundled), since verifyVendor runs before it.
 * The reconciled results leave vendor.results (they are no longer manual review).
 * The CDN not-popular case is handled in cdn-lookup.js, which already runs after
 * classifyBundled. No-op without a bundled store or vendor results.
 * @param {Addon} addon
 */
export function applyNotPopularVendor(addon) {
  const results = addon?.vendor?.results;
  if (!results || !addon.bundled) {
    return;
  }
  const remaining = [];
  for (const result of results) {
    if (result.outcome !== "not-popular") {
      remaining.push(result);
      continue;
    }
    const buf = addon.files?.get(result.path);
    const content = buf
      ? classify(buf.toString("utf8"), result.path)
      : { minified: false, obfuscation: VERDICT.PASS };
    markUntrusted(addon, {
      file: result.path,
      source: result.source,
      unreadable: content.minified || content.obfuscation.fail,
    });
  }
  addon.vendor.results = remaining;
}

/**
 * The bundled classification for this review: the pipeline's pre-normalize
 * addon.bundled, or a lazy compute for callers that ran no pre-step (unit tests,
 * which never normalize). Memoized on the addon so the ~8 consumers share it.
 * @param {RunContext} ctx
 * @returns {Bundled}
 */
function getBundled(ctx) {
  // The pipeline pre-classifies the review target in setup (and, in SCA, the built XPI
  // too - in XPI mode they are one artifact), so this lazy fallback only fires for a
  // caller that ran no pre-step (a rejected Experiment or a direct unit ctx). Minified
  // is classified identically in every mode and artifact - a minified non-library is
  // non-authored (and rejected).
  return (ctx.addon.bundled ??= classifyBundled(ctx.addon, {
    libraryHashes: ctx.options?.libraryHashes,
  }));
}

/**
 * Per-file library/minified/obfuscated tags for the add-on's JS (see classifyBundled).
 * @param {RunContext} ctx
 * @returns {BundleTag[]}
 */
export function classifyAddonJs(ctx) {
  return getBundled(ctx).classified;
}

/**
 * Files that are not the developer's authored source (see classifyBundled).
 * @param {RunContext} ctx
 * @returns {Set<string>}
 */
export function nonAuthoredJs(ctx) {
  return getBundled(ctx).nonAuthored;
}

/**
 * Identified-but-not-popular libraries (see markUntrusted), read by the
 * untrusted-library (info) and untrusted-minified-library (reject) checks.
 * @param {RunContext} ctx
 * @returns {Array<{file: string, source?: string, name?: string, unreadable: boolean}>}
 */
export function untrustedLibs(ctx) {
  return getBundled(ctx).untrusted ?? [];
}

/**
 * A minified first-party file: minified geometry, not a recognized library, not
 * obfuscated, not an identified-but-untrusted match - exactly what minified-code flags.
 * @param {BundleTag} c
 * @returns {boolean}
 */
export function isMinifiedFirstParty(c) {
  return Boolean(
    c.minified && !c.library && !c.obfuscation.fail && !c.untrusted
  );
}

/**
 * An obfuscated first-party file: the FAIL verdict, on the developer's own code (not a
 * recognized library, not an identified-but-untrusted match). Read by hasUnreviewableCode
 * to decide whether the shipped XPI carries developer-authored obfuscated code, so the
 * source-archive review is kept: a recognized library is reviewable by its identity, and
 * an untrusted match is counted by its own branch there.
 * @param {BundleTag} c
 * @returns {boolean}
 */
export function isObfuscatedFirstParty(c) {
  return Boolean(c.obfuscation.fail && !c.library && !c.untrusted);
}

/**
 * Whether the add-on ships code that cannot be reviewed as-is: minified or obfuscated
 * first-party code, or an identified-but-untrusted library that is unreadable. The union
 * of what minified-code / obfuscated-code / untrusted-minified-library flag, so the
 * pipeline's "is the shipped XPI directly reviewable?" decision and those checks share one
 * definition. (The untrusted list is CDN/vendor-filled later, so at the pipeline decision
 * point only the deterministic hash-DB classification contributes - the conservative choice.)
 * @param {?Bundled} bundled  A classifyBundled result.
 * @returns {boolean}
 */
export function hasUnreviewableCode(bundled) {
  if (!bundled) {
    return false;
  }
  const classified = bundled.classified ?? [];
  return (
    classified.some(isMinifiedFirstParty) ||
    classified.some(isObfuscatedFirstParty) ||
    (bundled.untrusted ?? []).some((lib) => lib.unreadable)
  );
}

/**
 * The CONTENT signal for one file: whether it is minified (packed code, via isMinified)
 * and its obfuscation verdict (a recognized obfuscator's AST structure, via
 * obfuscationVerdict). Library detection is NOT here - it is a true content-hash match
 * against the known-library database, done in classifyBundled. Pure (bytes + filename
 * only; both detectors parse `text` internally, offline).
 * @param {string} text
 * @param {string} file
 * @returns {{minified: boolean, obfuscation: import("./enum.js").Verdict}}
 */
export function classify(text, file) {
  // Obfuscation is JS-only (a stylesheet is never obfuscated in this sense); isMinified
  // handles both JS (statement density) and CSS (packed rules). The verdict is three-state:
  // a weak-family-only match is UNSURE (readable, authored, scanned) and referred to the
  // obfuscated-code check's LLM/manual adjudication, never a deterministic finding.
  return {
    minified: isMinified(text, file),
    obfuscation: JS_EXTENSIONS.has(extname(file))
      ? obfuscationVerdict(text, file)
      : VERDICT.PASS,
  };
}
