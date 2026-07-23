// What the OpenAI adapter LEARNED about a model, cached on disk between runs.
//
// The shipped table (assets/llm/<type>.yaml) is a starting guess: OpenAI publishes
// no capability-discovery endpoint, so when the server rejects a request shape the
// adapter repairs it from the rejection (src/llm/openai.js) and records the repair
// here. The next run sends the working shape straight away, so the probe is paid
// once per (server, model) rather than once per run.
//
// A record is the DELTA from the shipped entry, never a copy of it: the endpoint,
// and a rename of one request parameter. Everything the negotiation did not learn -
// the token cap's VALUE, maxRequests - keeps coming from the table, so editing the
// table still takes effect for a model something was once learned about.
//
// It is a cache, not an asset: a gitignored directory next to the other caches
// (.schema-cache, .lib-cdn-lookup-cache, ...), wiped by --cache-clear, and
// best-effort - an unwritable one costs the next run one extra probe and nothing
// else. Saving re-reads the file and merges, so two reviews running side by side do
// not drop each other's lessons.
//
// Belongs here: the on-disk format and its read/merge/write. Does NOT belong here:
// what a shape MEANS or how one is negotiated (-> openai.js), or the shipped table
// (-> settings.js).

import fs from "node:fs";
import path from "node:path";

import { LLM_MODEL_CACHE } from "../config.js";
import { writeFileAtomic } from "../util/atomic.js";
import { debug } from "../util/log.js";

/**
 * @typedef {object} Negotiated  What was learned about one model on one server.
 * @property {string} [endpoint]  The endpoint that actually served it.
 * @property {{from: string, to: string}} [rename]  A request parameter the server
 *   wanted under another name (the shipped entry's key -> the working one).
 */

// The cache directory. Not relocatable by a --cache-*-dir flag like the others:
// this one is read by the LLM adapters, which are handed a token and a model, not
// the pipeline's options. --cache-clear wipes it by name (src/cli.js).
let cacheDir = LLM_MODEL_CACHE;

/**
 * Point the cache at another directory and forget what was read. For tests, so one
 * that provokes a repair cannot write into the developer's real cache.
 * @param {string} [dir]  Defaults to the standard cache directory.
 */
export function resetNegotiated(dir) {
  cacheDir = dir ?? LLM_MODEL_CACHE;
  loaded.clear();
}

// One parsed file per type, read at most once per run.
const loaded = new Map();

/** @param {string} type @returns {string} */
function fileFor(type) {
  return path.join(cacheDir, `${type}.json`);
}

/**
 * A model is identified by the server it was negotiated against as well as its id:
 * a shape learned from a proxy behind LLM_API_URL says nothing about the same model
 * id on api.openai.com.
 * @param {string} [baseURL] @param {string} [model] @returns {string}
 */
function keyFor(baseURL, model) {
  return `${baseURL ?? ""}\u0000${model ?? ""}`;
}

/**
 * The whole cache for one type, or an empty map when it is absent or unreadable (a
 * corrupt cache is not an error: it just has not learned anything yet).
 * @param {string} [type] @returns {Record<string, Negotiated>}
 */
function load(type) {
  let entries = loaded.get(type);
  if (!entries) {
    try {
      entries = JSON.parse(fs.readFileSync(fileFor(type), "utf8"));
    } catch {
      entries = {};
    }
    loaded.set(type, entries);
  }
  return entries;
}

/**
 * What was learned about this model on this server, if anything.
 * @param {string} [type] @param {string} [baseURL] @param {string} [model]
 * @returns {?Negotiated}
 */
export function negotiated(type, baseURL, model) {
  return load(type)[keyFor(baseURL, model)] ?? null;
}

/**
 * Record what the negotiation learned. Merges into whatever is on disk right now
 * rather than into what this run read at startup, so a parallel review's lesson (or
 * a hand edit) is not overwritten. Best-effort: a failed write is logged and the run
 * carries on with the shape it already negotiated.
 * @param {string} [type] @param {string} [baseURL] @param {string} [model]
 * @param {Negotiated} record
 */
export function learn(type, baseURL, model, record) {
  const file = fileFor(type);
  try {
    let onDisk = {};
    try {
      onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      onDisk = {};
    }
    const merged = { ...onDisk, [keyFor(baseURL, model)]: record };
    writeFileAtomic(file, JSON.stringify(merged, null, 2));
    loaded.set(type, merged);
  } catch (err) {
    debug(`Could not write ${file}: ${err.message}`);
  }
}
