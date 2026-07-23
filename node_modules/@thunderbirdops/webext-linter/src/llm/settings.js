// The per-LLM_API_TYPE model table, from assets/llm/<type>.yaml: which model a run
// defaults to, how many requests it may make, and - per model - which endpoint
// serves it and which parameters its request body carries.
//
// The parameters are DATA: the adapters spread them into the request verbatim, so
// the output-token cap (max_tokens / max_completion_tokens / max_output_tokens) and
// any future knob are a YAML edit rather than a code change.
//
// The table is hand-curated and READ-ONLY. What the OpenAI adapter negotiates with
// a server that rejects a request shape is a delta on top of it, cached on disk by
// negotiated.js and applied here when a model is first resolved - so a learned
// endpoint or parameter name survives to the next run, while everything the
// negotiation did not learn keeps coming from the table, and an edit to the table
// still takes effect for a model something was once learned about.
//
// Belongs here: reading the tables and resolving a model against them. Does NOT
// belong here: the request shapes the parameters go into (-> anthropic.js,
// openai.js), the repair rules that decide a new shape (-> openai.js), where a
// learned shape is stored (-> negotiated.js), or the type -> adapter map
// (-> provider.js).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import YAML from "yaml";

import { negotiated } from "./negotiated.js";

/**
 * @typedef {object} ModelSettings  How to talk to one model. Mutable: openai.js's
 *   negotiation repairs it in place, so every later call this run sees the fix.
 * @property {string} [endpoint]  The API that serves it ("chat" | "responses"), for
 *   providers that have more than one. Absent for Anthropic.
 * @property {number} maxRequests  Model requests one run may make before pausing.
 * @property {Record<string, *>} parameters  Spread verbatim into the request body.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.resolve(here, "../../assets/llm");

// The tables, and the models resolved out of them. Both are session-scoped: a file
// is read once, and a model's settings are resolved once and then handed out as the
// SAME mutable object, which is how a repair negotiated mid-run survives to the next
// call. resetLlmSettings() clears them.
let assetDir = DEFAULT_DIR;
const files = new Map();
const resolved = new Map();

/**
 * Point the loader at another table directory and drop what it read. The directory
 * argument is for tests (a hand-written table); the shipped one is never written to.
 * @param {string} [dir]  Defaults to the shipped assets/llm.
 */
export function resetLlmSettings(dir) {
  assetDir = dir ?? DEFAULT_DIR;
  files.clear();
  resolved.clear();
}

/**
 * @typedef {object} LlmFile  One parsed assets/llm/<type>.yaml.
 * @property {string} path  Its absolute path, for error messages.
 * @property {object} data  Its content.
 */
/**
 * The table for an LLM_API_TYPE, read once per session. Throws on an unknown type:
 * every caller reaches this through provider.js, which validates the name first.
 * @param {string} type
 * @returns {LlmFile}
 */
function fileFor(type) {
  let file = files.get(type);
  if (!file) {
    const at = path.join(assetDir, `${type}.yaml`);
    if (!fs.existsSync(at)) {
      throw new Error(
        `no model table for LLM_API_TYPE "${type}" (expected ${at}).`
      );
    }
    file = { path: at, data: YAML.parse(fs.readFileSync(at, "utf8")) };
    validate(file);
    files.set(type, file);
  }
  return file;
}

/**
 * Reject a malformed entry when the table is read, rather than letting it match
 * nothing (or everything) at request time. An entry needs a `name` (an exact id), a
 * `match` (a regex), or BOTH - one entry can serve its exact id AND a family pattern.
 * @param {LlmFile} file
 */
function validate(file) {
  for (const [i, entry] of (file.data?.models ?? []).entries()) {
    if (entry?.name == null && entry?.match == null) {
      throw new Error(
        `${file.path}: models[${i}] must have a "name" (an exact model id), a ` +
          '"match" (a regex), or both.'
      );
    }
    if (entry.match != null) {
      try {
        new RegExp(entry.match);
      } catch (err) {
        throw new Error(
          `${file.path}: models[${i}] has an invalid "match" regex: ${err.message}`
        );
      }
    }
  }
}

/**
 * The model a run uses when LLM_API_MODEL is unset.
 * @param {string} type  An LLM_API_TYPE.
 * @returns {string}
 */
export function defaultModel(type) {
  return fileFor(type).data?.default?.model;
}

/**
 * How to talk to `model` under `type`, as the mutable object every call this run
 * shares. The table decides it - every entry's `name` is tried first, then every
 * entry's `match` in file order, so a curated entry cannot be shadowed by a broad
 * pattern above it and the table's catch-all is the genuine last resort. An entry may
 * carry BOTH a `name` and a `match`: it then wins for that exact id (the name pass)
 * and for anything else its pattern covers (the match pass). Anything negotiated
 * against this server on an earlier run is applied on top.
 * @param {string} type  An LLM_API_TYPE.
 * @param {string} [baseURL]  The API base URL ("" / undefined = the SDK default).
 * @param {string} [model]
 * @returns {ModelSettings}
 */
export function modelSettings(type, baseURL, model) {
  const key = `${type}\u0000${baseURL ?? ""}\u0000${model ?? ""}`;
  let settings = resolved.get(key);
  if (!settings) {
    settings = shippedSettings(type, model);
    apply(settings, negotiated(type, baseURL, model));
    resolved.set(key, settings);
  }
  return settings;
}

/**
 * `model`'s settings as the TABLE has them, with nothing learned applied and no
 * session state - what a negotiated shape is a delta FROM (openai.js).
 * @param {string} type @param {string} [model]
 * @returns {ModelSettings}
 */
export function shippedSettings(type, model) {
  const file = fileFor(type);
  const entry = entryFor(file, model);
  return {
    ...(entry.endpoint ? { endpoint: String(entry.endpoint) } : {}),
    maxRequests: entry.maxRequests ?? file.data?.default?.maxRequests,
    parameters: { ...entry.parameters },
  };
}

/**
 * Lay a negotiated delta over the table's settings: the endpoint that actually
 * served the model, and the rename of the one parameter the server wanted under
 * another name. The renamed parameter keeps the table's VALUE, so raising a cap in
 * the table still works for a model whose parameter name was once learned; and if
 * the table's own key changed since, the rename simply no longer applies and the
 * next request re-negotiates.
 * @param {ModelSettings} settings @param {?import("./negotiated.js").Negotiated} learned
 */
function apply(settings, learned) {
  if (!learned) {
    return;
  }
  if (learned.endpoint) {
    settings.endpoint = learned.endpoint;
  }
  const { from, to } = learned.rename ?? {};
  if (from && to && from in settings.parameters) {
    settings.parameters[to] = settings.parameters[from];
    delete settings.parameters[from];
  }
}

/**
 * @param {LlmFile} file @param {string} [model]
 * @returns {object}  The winning entry.
 */
function entryFor(file, model) {
  const id = String(model ?? "");
  const models = file.data?.models ?? [];
  const hit =
    models.find(
      (e) => e.name != null && String(e.name).toLowerCase() === id.toLowerCase()
    ) ??
    models.find((e) => e.match != null && new RegExp(e.match, "i").test(id));
  if (!hit) {
    throw new Error(
      `${file.path} has no entry for the model "${id}". Add one, or a catch-all ` +
        "`- match: .*` at the end of its models list."
    );
  }
  return hit;
}
