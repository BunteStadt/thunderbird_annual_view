// One place to fetch under a hard timeout, for the MANDATORY setup downloads (the
// schema, the allowed-experiments list, the library-hash DB). A bare fetch() with no
// timeout hangs the whole review on a half-open connection, silently and forever;
// these inputs are required, so a stalled fetch must fail loud (a throw that main()
// turns into exit 2), not hang.
//
// The timeout covers the WHOLE operation - the connection AND the body read - because
// `consume` runs while the abort signal is still armed. A timeout that only guarded
// the headers (the shape vendor/verify.js uses for its small JSON) would still hang on
// a body that never arrives.
//
// Belongs here: the abort-timeout wrapper. Does NOT belong here: what is fetched or
// where it is cached (-> src/util/download.js, src/lib/library-hashes.js).

import { SETUP_FETCH_TIMEOUT_MS } from "../config.js";

/**
 * Fetch `url` and consume the response, all under one abort timeout. On timeout the
 * connection/body is aborted and a clear error is thrown; a non-timeout failure (a
 * network error, or whatever `consume` throws on a bad status) propagates unchanged.
 * @template T
 * @param {string} url
 * @param {(res: Response) => Promise<T>} consume  Reads the body, or throws on a
 *   non-ok status with the caller's own wording. Runs while the timeout is armed.
 * @param {number} [timeoutMs]
 * @param {RequestInit} [init]  Extra fetch options (method/headers/body). The abort
 *   signal and redirect handling are set here and cannot be overridden.
 * @returns {Promise<T>}
 */
export async function fetchWithTimeout(
  url,
  consume,
  timeoutMs = SETUP_FETCH_TIMEOUT_MS,
  init
) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      redirect: "follow",
    });
    return await consume(res);
  } catch (err) {
    if (ctrl.signal.aborted) {
      throw new Error(`request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
