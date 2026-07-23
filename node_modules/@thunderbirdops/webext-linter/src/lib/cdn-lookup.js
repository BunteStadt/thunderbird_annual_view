// Second-tier library identifier: for a bundled file the Mozilla hash DB did NOT
// recognize - an unidentified minified bundle that would otherwise fall to
// minified-code, or a readable file large enough to be a library shipped un-minified
// (CDN_LOOKUP_READABLE_MIN_BYTES) - ask the jsDelivr CDN whether the file's exact bytes
// are a known published release. jsDelivr indexes the raw SHA-256 of every file it serves, so
// `GET <CDN_LOOKUP_URL><sha256>` is a content-addressed reverse lookup (no filename
// guessing) returning `{type, name, version, file}` on a hit, 404 on a miss.
//
// Every hit is IDENTIFIED - the tag gets a `libraryId` (so the OSV audit covers it) and a
// `cdn` marker holding the canonical, trusted+pinned jsDelivr source URL - but whether it
// is TRUSTED depends on popularity, the same trust bar a declared VENDOR/package.json
// source gets (isPopular). jsDelivr is uncurated, so a match alone is not trust:
//   - POPULAR -> joins the vendored family, exactly like a Mozilla hash match: the tag
//     becomes `library` (so minified-code skips it), the file is excluded from scanning,
//     and find-lib-on-cdn surfaces the "declare it" finding.
//   - NOT popular -> identified but UNtrusted (markUntrusted): a minified/obfuscated one is
//     unreadable, so it stays non-authored and untrusted-minified-library rejects it; a
//     readable one is reviewed as authored code and untrusted-library flags it (info).
//     find-lib-on-cdn stays silent.
// (Mozilla hash-DB matches are NOT gated - DB membership is the signal.)
//
// Best-effort, like auditIdentifiedLibraries: results (positive AND negative) are
// cached on disk so a repeat review of the same bundle makes no request, and any
// network error - or an injected net with no fetchJson (offline / the golden
// harness) - simply leaves the tag untouched, so a minified file falls through to
// minified-code and a readable one is scanned as authored source. Never throws, never
// blocks a review.
//
// Belongs here: the per-file lookup, the disk cache IO, and the tag promotion.
// Does NOT belong here: the raw hashing (src/normalize/hash.js rawSha256), the
// finding (src/checks/rules/find-lib-on-cdn.js), or the OSV audit
// (src/vendor/verify.js auditIdentifiedLibraries).

import fs from "node:fs";
import path from "node:path";

import { debug } from "../util/log.js";
import { writeFileAtomic } from "../util/atomic.js";
import { rawSha256 } from "../normalize/hash.js";
import { defaultNet, isPopular } from "../vendor/verify.js";
import { markUntrusted } from "./bundled.js";
import {
  CDN_LOOKUP_URL,
  CDN_LOOKUP_CACHE,
  CDN_LOOKUP_READABLE_MIN_BYTES,
} from "../config.js";

/** @typedef {import("../addon/load.js").Addon} Addon */
/** @typedef {import("../vendor/verify.js").VendorNet} VendorNet */
/** @typedef {{type: string, name: string, version: string, file: string}} CdnHit */

/**
 * Build the canonical jsDelivr CDN URL for a lookup hit - a trusted + pinned
 * vendor source (src/vendor/sources.js), so the entry it suggests is verifiable.
 * @param {CdnHit} hit
 * @returns {string}
 */
export function cdnUrl({ type, name, version, file }) {
  const base = type === "gh" ? "gh" : "npm";
  return `https://cdn.jsdelivr.net/${base}/${name}@${version}${file}`;
}

/**
 * Identify unrecognized bundles (a minified one, or a large readable one likely to be a
 * library shipped un-minified) via the jsDelivr hash lookup. A hit is tagged libraryId +
 * cdn; a POPULAR hit also joins the vendored family (library), a not-popular one is marked
 * untrusted. Mutates the tags in `addon.bundled.classified` and the `nonAuthored` set in
 * place. Must run AFTER classifyBundled (Mozilla hashes) and BEFORE auditIdentifiedLibraries,
 * so a CDN match is OSV-audited like any other identified library.
 *
 * @param {Addon} addon
 * @param {object} [opts]
 * @param {VendorNet} [opts.net]      Injectable transport (fetchJson); defaults to
 *   the real fetch. The golden harness injects an offline net (fetchJson throws),
 *   like verifyVendor / auditIdentifiedLibraries, so its runs make no request.
 * @param {string} [opts.cacheDir]    Where hash->result is cached.
 * @param {boolean} [opts.enabled]    Off disables the lookup entirely (--cdn-lib-lookup false).
 * @returns {Promise<void>}
 */
export async function resolveCdnLibraries(
  addon,
  { net = defaultNet, cacheDir = CDN_LOOKUP_CACHE, enabled = true } = {}
) {
  const classified = addon?.bundled?.classified;
  // No net, no fetchJson (offline / golden harness), disabled, or nothing to do:
  // skip entirely so the review stays deterministic and offline-safe.
  if (!enabled || !classified || typeof net?.fetchJson !== "function") {
    return;
  }
  const nonAuthored = addon.bundled.nonAuthored;
  const cache = loadCache(cacheDir);
  let dirty = false;

  for (const tag of classified) {
    // Never CDN-identify an already-recognized library or an obfuscated file - the
    // latter must not be laundered into the trusted family, minified or readable.
    if (tag.library || tag.obfuscation.fail) {
      continue;
    }
    const buf = addon.files.get(tag.file);
    if (!buf) {
      continue;
    }
    // Try to recognise: an unidentified MINIFIED bundle (which minified-code would
    // otherwise reject), OR a large READABLE file (>= CDN_LOOKUP_READABLE_MIN_BYTES) -
    // a library shipped un-minified (e.g. pdf.mjs), so it is excluded from content
    // analysis instead of scanned as authored code. A small readable file is the
    // developer's own source; skip it. (Unlike the free local Mozilla hash DB, which
    // matches any file, a CDN lookup is a network request that fingerprints the file's
    // hash to a third party - hence the size floor, to keep it off small authored files.)
    if (!tag.minified && buf.length < CDN_LOOKUP_READABLE_MIN_BYTES) {
      continue;
    }
    const hash = rawSha256(buf);

    let hit;
    if (Object.prototype.hasOwnProperty.call(cache, hash)) {
      hit = cache[hash]; // cached result (a CdnHit, or null for a known miss)
      if (hit && (!hit.name || !hit.version)) {
        hit = null; // a corrupt/foreign cache entry is treated as a miss
      }
    } else {
      const { state, hit: looked } = await lookupHash(net, hash);
      if (state === "error") {
        // Transient (offline / 5xx / rate-limit / DNS / timeout): do NOT cache,
        // so a later online run retries instead of treating a blip as a permanent
        // miss. Only a genuine 404 - a stable, content-addressed negative - and a
        // hit are cached.
        continue;
      }
      hit = looked ?? null; // null for a confirmed 404 miss (JSON drops undefined)
      cache[hash] = hit; // a CdnHit, or null
      dirty = true;
    }
    if (!hit) {
      continue;
    }

    // Identified by content: keep the release id (for the OSV audit) and the
    // jsDelivr source URL either way.
    tag.libraryId = { name: hit.name, version: hit.version };
    tag.cdn = { url: cdnUrl(hit), type: hit.type };
    debug(`CDN-identified ${tag.file} as ${hit.name}@${hit.version}`);

    // Apply the same popularity trust bar a declared VENDOR/package.json source
    // gets: jsDelivr is uncurated (unlike the Mozilla hash DB, whose membership IS
    // the popularity signal), so an obscure or author-published package found here
    // must not be silently accepted. Looked up fresh each run (popularity is
    // time-varying, so it is not cached with the hash hit) and offline-safe (a
    // lookup error returns false).
    const src =
      hit.type === "gh"
        ? { kind: "github", repo: hit.name }
        : { kind: "npm", pkg: hit.name };
    tag.cdn.popular = await isPopular(src, net);
    if (tag.cdn.popular) {
      // Popular -> trusted vendored family (like a Mozilla hash match): excluded
      // from scanning, surfaced by find-lib-on-cdn ("declare it"), OSV-audited.
      tag.library = true;
      nonAuthored.add(tag.file);
    } else {
      // Not popular -> identified but UNtrusted: it does not earn the review exemption.
      // markUntrusted routes it by readability: a minified/obfuscated hit is unreadable,
      // so it stays in the non-authored skip set and untrusted-minified-library rejects
      // it; a readable hit is reviewed as authored code and untrusted-library flags it
      // (info). Either way libraryId is kept for the OSV audit.
      tag.untrusted = true;
      markUntrusted(addon, {
        file: tag.file,
        source: tag.cdn.url,
        name: `${hit.name} ${hit.version}`,
        unreadable: tag.minified || tag.obfuscation.fail,
      });
    }
  }

  if (dirty) {
    saveCache(cacheDir, cache);
  }
}

/**
 * One hash lookup against jsDelivr, as a tri-state so the caller can cache only
 * STABLE outcomes:
 *   - "hit"   {hit}  - identified; cache it (a file hash maps to one release
 *                      forever, so a positive is immutable).
 *   - "miss"         - a genuine HTTP 404 ("Couldn't find <hash>"): the bytes are
 *                      not published, a content-addressed and therefore stable
 *                      negative; cache it.
 *   - "error"        - offline / 5xx / rate-limit / DNS / timeout / bad JSON: a
 *                      TRANSIENT failure; do NOT cache, so a later run retries.
 * VendorNet.fetchJson throws "HTTP <status>" on a non-2xx, so a 404 is told apart
 * from other failures by the status in the message.
 * @param {VendorNet} net @param {string} hash
 * @returns {Promise<{state: "hit"|"miss"|"error", hit?: CdnHit}>}
 */
async function lookupHash(net, hash) {
  try {
    const j = await net.fetchJson(`${CDN_LOOKUP_URL}${hash}`);
    if (j && j.name && j.version) {
      return {
        state: "hit",
        hit: {
          type: j.type,
          name: j.name,
          version: j.version,
          file: j.file ?? "",
        },
      };
    }
    // 2xx with an unexpected shape: a stable "nothing here", cacheable as a miss.
    debug(`CDN lookup unexpected response for ${hash}`);
    return { state: "miss" };
  } catch (err) {
    const miss = /\b404\b/.test(err.message);
    debug(`CDN lookup ${miss ? "miss" : "error"} for ${hash}: ${err.message}`);
    return { state: miss ? "miss" : "error" };
  }
}

/** The on-disk cache file: a `{ "<sha256>": CdnHit | null }` JSON map. */
function cacheFile(cacheDir) {
  return path.join(cacheDir, "jsdelivr-hash-lookup.json");
}

/**
 * Load the hash->result cache, or an empty map when absent/corrupt.
 * @param {string} cacheDir
 * @returns {Record<string, CdnHit|null>}
 */
function loadCache(cacheDir) {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(cacheDir), "utf8"));
  } catch {
    return {};
  }
}

/**
 * Persist the cache. Best-effort: a write failure is non-fatal (the lookups just
 * aren't cached for next run).
 * @param {string} cacheDir @param {Record<string, CdnHit|null>} cache
 */
function saveCache(cacheDir, cache) {
  try {
    writeFileAtomic(cacheFile(cacheDir), JSON.stringify(cache));
  } catch (err) {
    debug(`Could not write CDN lookup cache: ${err.message}`);
  }
}
