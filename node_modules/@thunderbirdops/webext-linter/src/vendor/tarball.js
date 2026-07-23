// Reads an npm-registry package tarball (.tgz) into the set of EOL-normalized
// content hashes of its files, so a vendored copy can be verified by membership -
// the same shape as the experiment allow-list (src/experiments/verify.js). The
// tarball is the whole package, so we hash every regular file and never rely on the
// in-archive path: a bundled file is "from this package" when its content hash is in
// the set, regardless of where it sits inside.
//
// gzip is node:zlib; the tar layer is a small ustar reader (the repo has adm-zip for
// ZIP but no tar lib). We only need file CONTENT, so metadata entries (PAX 'x'/'g',
// GNU longname 'L', directories, links) are skipped - their data blocks are stepped
// over by the header size, keeping the stream aligned - and never hashed.
//
// Belongs here: gunzip + tar walk + hashing. Does NOT belong here: fetching
// (src/vendor/verify.js), classification (src/vendor/sources.js), or the hash
// transform (src/normalize/hash.js).

import zlib from "node:zlib";

import { normalizedSha256 } from "../normalize/hash.js";
import { VENDOR_TARBALL_MAX_UNPACKED_BYTES } from "../config.js";

const BLOCK = 512;

/**
 * Parse a tar header's size field (octal ASCII, NUL/space padded). GNU base-256
 * (high bit of the first byte set) is not produced for the small files in an npm
 * package, so an unparsable size yields NaN and stops the walk.
 * @param {Buffer} header
 * @returns {number}
 */
function headerSize(header) {
  if (header[124] & 0x80) {
    return NaN; // base-256 encoded - not expected from npm; bail out safely
  }
  const raw = header.toString("latin1", 124, 136).replace(/[\s\0]+$/, "");
  return raw ? parseInt(raw, 8) : 0;
}

/** @param {Buffer} block @returns {boolean} all-zero (the archive terminator). */
function isZeroBlock(block) {
  for (let i = 0; i < block.length; i++) {
    if (block[i] !== 0) {
      return false;
    }
  }
  return true;
}

/**
 * The EOL-normalized SHA-256 of every regular file in a gzipped npm tarball.
 * @param {Buffer} tgz  The downloaded .tgz bytes.
 * @returns {Set<string>}  Normalized content hashes (see src/normalize/hash.js).
 * @throws if the stream is not gzip, exceeds the unpacked cap, or is malformed.
 */
export function tarballHashes(tgz) {
  const tar = zlib.gunzipSync(tgz, {
    maxOutputLength: VENDOR_TARBALL_MAX_UNPACKED_BYTES,
  });
  const hashes = new Set();
  let off = 0;
  while (off + BLOCK <= tar.length) {
    const header = tar.subarray(off, off + BLOCK);
    if (isZeroBlock(header)) {
      break; // end-of-archive marker
    }
    const size = headerSize(header);
    if (!Number.isInteger(size) || size < 0) {
      break; // malformed header - stop rather than misread
    }
    const type = header[156]; // typeflag: 0x30 '0' or 0x00 NUL = regular file
    const dataStart = off + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) {
      break; // truncated
    }
    if (type === 0x30 || type === 0x00) {
      hashes.add(normalizedSha256(tar.subarray(dataStart, dataEnd)));
    }
    // Advance past the header + the data (padded up to the next 512 boundary).
    off = dataStart + Math.ceil(size / BLOCK) * BLOCK;
  }
  return hashes;
}
