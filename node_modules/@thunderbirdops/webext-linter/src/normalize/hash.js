// Shared EOL-tolerant content hashing. Both the experiment allow-list matcher and
// the vendor tarball matcher compare bundled files against an upstream set by hash,
// and both want a CRLF/LF checkout to NOT read as a local change - so the bytes are
// EOL-normalized before hashing. Kept here so neither domain imports the other.
//
// Belongs here: the normalization transform and the normalized hash. Does NOT
// belong here: what is compared (src/experiments/verify.js, src/vendor/*).

import { createHash } from "node:crypto";

/**
 * Normalize end-of-lines for a byte-stable, EOL-tolerant compare: CRLF/CR collapse
 * to LF and trailing newlines are stripped. latin1 is byte-preserving.
 * @param {Buffer} buf
 * @returns {string}
 */
export function eolNormalize(buf) {
  return Buffer.isBuffer(buf)
    ? buf.toString("latin1").replace(/\r\n?/g, "\n").replace(/\n+$/, "")
    : "";
}

/**
 * EOL-normalized SHA-256 (hex). Both upstream and add-on files are hashed this way,
 * so a CRLF/LF difference is not treated as a change.
 * @param {Buffer} buf
 * @returns {string}
 */
export function normalizedSha256(buf) {
  return createHash("sha256").update(eolNormalize(buf), "latin1").digest("hex");
}

/**
 * Raw SHA-256 (hex) of the exact bytes - NO EOL normalization. The known-library
 * hash database (dispensary) hashes each release file's raw bytes, so a bundled
 * copy is matched byte-for-byte; a CRLF/whitespace-altered copy will not match.
 * @param {Buffer} buf
 * @returns {string}
 */
export function rawSha256(buf) {
  return createHash("sha256")
    .update(Buffer.isBuffer(buf) ? buf : Buffer.from(buf ?? ""))
    .digest("hex");
}
