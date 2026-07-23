// Selects the LLM provider adapter by LLM_API_TYPE. Both adapters expose the
// same four operations (callVerdicts / callText / callReview / listModels), so
// the rest of the tool is provider-agnostic - it asks getProvider(type) for the
// functions and never imports an adapter directly. ollama reuses the OpenAI
// adapter (its endpoint is OpenAI-compatible), with a local default base URL and
// no API key.
//
// getProvider BINDS the type into the adapter it hands back, because an adapter
// needs to know which type it is serving to look its model up in the right
// assets/llm/<type>.yaml - the OpenAI adapter serves both chatgpt and ollama. Call
// sites therefore never carry the type themselves: they ask for the provider once
// and call it with the token, model and base URL, as they always have.
//
// Belongs here: the type -> adapter map, every per-provider requirement (default
// base URL, whether a key is required, whether the model can be verified up
// front), and the config/availability validators the CLI + pipeline call. Does NOT
// belong here: the request shapes (-> the adapters), the per-model settings
// (-> settings.js), the schemas (-> schema.js), or reading the env vars
// (-> src/cli.js).

import * as anthropic from "./anthropic.js";
import * as openai from "./openai.js";
import { defaultModel } from "./settings.js";

const PROVIDERS = {
  claude: {
    adapter: anthropic,
    requiresKey: true,
  },
  chatgpt: {
    adapter: openai,
    requiresKey: true,
  },
  // Local, OpenAI-compatible. No key, a local default endpoint. The chosen
  // model must be pulled, which checkModelAvailable verifies up front.
  ollama: {
    adapter: openai,
    requiresKey: false,
    baseUrl: "http://localhost:11434/v1",
    checkModel: true,
  },
};

// The bound adapters, one per type: built on first use and reused, so a caller
// that holds on to one keeps calling the same functions.
const bound = new Map();

/** The supported LLM_API_TYPE values. */
export const LLM_TYPES = Object.keys(PROVIDERS);

/** The default LLM_API_TYPE when the env var is unset. */
export const DEFAULT_LLM_TYPE = "claude";

/**
 * Whether `type` is a supported LLM_API_TYPE.
 * @param {string} type @returns {boolean}
 */
export function isLlmType(type) {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, type);
}

/**
 * The provider adapter (callVerdicts / callText / callReview / listModels) for an
 * LLM_API_TYPE, with the type bound in so the adapter can find the model's
 * settings. Defaults to claude. Throws on an unknown type.
 * @param {string} [type]
 * @returns {{callVerdicts: Function, callText: Function, callReview: Function,
 *   listModels: Function}}
 */
export function getProvider(type = DEFAULT_LLM_TYPE) {
  const entry = PROVIDERS[type];
  if (!entry) {
    throw new Error(
      `unknown LLM_API_TYPE "${type}" (expected one of: ${LLM_TYPES.join(", ")})`
    );
  }
  if (!bound.has(type)) {
    const { adapter } = entry;
    bound.set(type, {
      callVerdicts: (args) => adapter.callVerdicts({ ...args, type }),
      callText: (args) => adapter.callText({ ...args, type }),
      callReview: (args) => adapter.callReview({ ...args, type }),
      // Listing models needs no model, so nothing to bind.
      listModels: adapter.listModels,
    });
  }
  return bound.get(type);
}

/**
 * The default model for an LLM_API_TYPE (used when LLM_API_MODEL is not set), from
 * that type's assets/llm file. An unknown type answers with the default type's,
 * which is what validateLlmConfig then rejects by name.
 * @param {string} [type]
 * @returns {string}
 */
export function defaultModelFor(type = DEFAULT_LLM_TYPE) {
  return defaultModel(isLlmType(type) ? type : DEFAULT_LLM_TYPE);
}

/**
 * The default API base URL for an LLM_API_TYPE (used when LLM_API_URL is unset),
 * or undefined when the provider has none (the SDK's own default applies).
 * @param {string} [type]
 * @returns {string|undefined}
 */
export function defaultBaseUrlFor(type) {
  return PROVIDERS[type]?.baseUrl;
}

/**
 * Validate the (instant) LLM config for a type: an unknown type, or a provider
 * that requires an API key but has none. Returns an actionable error string, or
 * null when usable. Each provider owns its own key requirement, so callers never
 * branch by type.
 * @param {string} type @param {{apiKey?: string}} cfg
 * @returns {?string}
 */
export function validateLlmConfig(type, { apiKey } = {}) {
  if (!isLlmType(type)) {
    return (
      `Unknown LLM_API_TYPE "${type}" ` +
      `(expected one of: ${LLM_TYPES.join(", ")}).`
    );
  }
  if (PROVIDERS[type].requiresKey && !apiKey) {
    return "Enabling the LLM checks needs an API token (set LLM_API_KEY in the environment).";
  }
  return null;
}

/**
 * @typedef {object} CheckModelOpts
 * @property {string} model  The chosen model id.
 * @property {string} [token]  API token (keyless providers have none).
 * @property {string} [baseURL]  Override the API base URL.
 * @property {Function} [listModels]  Injectable model lister (tests).
 */
/**
 * Confirm the chosen model is actually available, for providers that can be
 * checked cheaply up front (Ollama - a local list call). A no-op (null) for the
 * cloud providers, which validate the model at call time. Returns an actionable
 * error string, or null. `listModels` is injectable for tests.
 * @param {string} type
 * @param {CheckModelOpts} opts
 * @returns {Promise<?string>}
 */
export async function checkModelAvailable(
  type,
  { model, token, baseURL, listModels } = {}
) {
  const entry = PROVIDERS[type];
  if (!entry?.checkModel) {
    return null;
  }
  const list = listModels ?? entry.adapter.listModels;
  let models;
  try {
    models = await list({ token, baseURL });
  } catch (err) {
    return (
      `Could not reach the ${type} server at ${baseURL ?? "its default URL"} ` +
      `(${err.message}). Is it running?`
    );
  }
  const names = (models ?? []).map((m) => m.id);
  // Ollama lists a tagged id ("llama3.1:latest"). A bare "llama3.1" means
  // ":latest".
  const ok = names.some(
    (n) => n === model || n.split(":")[0] === model.split(":")[0]
  );
  if (!ok) {
    return (
      `Model "${model}" is not available in your ${type} instance. ` +
      `Pull it (e.g. \`ollama pull ${model}\`) or set LLM_API_MODEL to a pulled ` +
      `model. Available: ${names.join(", ") || "(none)"}.`
    );
  }
  return null;
}
