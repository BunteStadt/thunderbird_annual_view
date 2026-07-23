// Reads a GitHub repo ZIP archive into the EOL-normalized content hashes of the
// files under a declared subpath, so a vendored FOLDER can be verified by membership
// - the same shape as the tarball matcher (src/vendor/tarball.js), but path-scoped.
// A github `/tree/<ref>/<subpath>` source (a directory in a repo) is resolved to the
// repo archive ZIP (src/vendor/sources.js); only the files inside <subpath> are the
// upstream set.
//
// ZIP (not .tar.gz) because adm-zip is already a dependency and gives clean entry
// paths; the hand-rolled tar reader (tarball.js) skips PAX long-name entries, so a
// .tar.gz could not be reliably path-filtered. A github archive has a single
// top-level directory (`<repo>-<ref>/`), stripped before the subpath compare.
//
// Belongs here: the ZIP read + subpath filter + hashing. Does NOT belong here:
// fetching (src/vendor/verify.js), classification (src/vendor/sources.js), or the
// hash transform (src/normalize/hash.js).

import AdmZip from "adm-zip";

import { normalizedSha256 } from "../normalize/hash.js";
import { VENDOR_TARBALL_MAX_UNPACKED_BYTES } from "../config.js";

/**
 * The EOL-normalized SHA-256 of every file under `subpath` in a GitHub repo ZIP
 * archive. The archive's single top-level directory (`<repo>-<ref>/`) is stripped
 * before matching, so `subpath` is repo-relative ("" includes every file).
 * @param {Buffer} zipBuf  The downloaded archive .zip bytes.
 * @param {string} [subpath]  Repo-relative directory; "" includes the whole repo.
 * @returns {Set<string>}  Normalized content hashes (see src/normalize/hash.js).
 * @throws if the buffer is not a valid ZIP or the unpacked subpath exceeds the cap.
 */
export function zipHashesUnder(zipBuf, subpath = "") {
  const prefix = subpath ? `${subpath.replace(/\/+$/, "")}/` : "";
  const hashes = new Set();
  let unpacked = 0;
  for (const entry of new AdmZip(zipBuf).getEntries()) {
    if (entry.isDirectory) {
      continue;
    }
    // Strip the archive's top-level `<repo>-<ref>/` directory, then keep only the
    // entries inside the declared subpath.
    const rel = entry.entryName.replace(/^[^/]+\//, "");
    if (prefix !== "" && !rel.startsWith(prefix)) {
      continue;
    }
    unpacked += entry.header.size;
    if (unpacked > VENDOR_TARBALL_MAX_UNPACKED_BYTES) {
      throw new Error("archive exceeds unpacked cap");
    }
    hashes.add(normalizedSha256(entry.getData()));
  }
  return hashes;
}
