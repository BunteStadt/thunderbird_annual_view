// Shared network-cache IO for the two GitHub-branch fetchers (src/schema/fetch.js
// and src/experiments/fetch.js): the codeload zip URL and an atomic
// download-into-cache. Each fetcher keeps its own cache-path and error wording;
// only the URL shape and the truncation-safe write are shared here.

import { debug } from "./log.js";
import { writeFileAtomic } from "./atomic.js";
import { fetchWithTimeout } from "./net.js";

/**
 * The codeload zip URL for a whole GitHub branch (one request for the tree).
 * @param {string} repo  "owner/name".
 * @param {string} branch
 * @returns {string}
 */
export function codeloadZipUrl(repo, branch) {
  return `https://codeload.github.com/${repo}/zip/refs/heads/${encodeURIComponent(branch)}`;
}

/**
 * Download `url` to `dest` atomically - write a temp file then rename it into
 * place - so an interrupted download can't leave a truncated cache that later
 * fails with an opaque unzip error. On a non-ok response, throws the message
 * `describeError(res)` builds (each caller words its own).
 * @param {string} url
 * @param {string} dest  The final cache path.
 * @param {(res: Response) => string} describeError
 * @returns {Promise<void>}
 */
export async function downloadToCache(url, dest, describeError) {
  const buf = await fetchWithTimeout(url, async (res) => {
    if (!res.ok) {
      throw new Error(describeError(res));
    }
    return Buffer.from(await res.arrayBuffer());
  });
  writeFileAtomic(dest, buf);
  debug(`Wrote ${buf.length} bytes to ${dest}`);
}
