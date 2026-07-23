// The Anthropic (Claude) provider adapter: the forced structured-result tool and
// the calls, over @anthropic-ai/sdk. Structured output is forced via tool_choice
// (this SDK version predates messages.parse), then run through the shared
// coercers in schema.js, so callers get a typed result regardless of provider.
//
//   - @anthropic-ai/sdk is imported lazily (only when a token is present), so a
//     deterministic-only run never loads it,
//   - the token and add-on contents are never sent anywhere but the API.
//
// The model's request parameters (max_tokens, and anything else the model wants)
// come from assets/llm/claude.yaml via settings.js and are spread into the body as
// they stand. Anthropic serves every model from one endpoint under one parameter
// name, so - unlike openai.js - there is nothing here to negotiate.
//
// Belongs here: the Anthropic request/response shape (callVerdicts / callText /
// callReview / listModels) and the lazy SDK import. Does NOT belong here: the
// schemas + coercion (-> schema.js), the model table (-> settings.js), the
// per-review add-on context and transport (-> src/checks/llm-client.js), the
// provider selection (-> src/llm/provider.js) itself, or any model-facing prompt
// (-> the registry).

import { lazyImportSdk, collectModels } from "./sdk.js";
import { modelSettings } from "./settings.js";
import {
  RESULT_TOOL,
  REVIEW_TOOL,
  RESULT_SCHEMA,
  ADDON_REVIEW_SCHEMA,
  coerceResult,
  coerceReview,
} from "./schema.js";
import { LLM_REQUEST_TIMEOUT_MS, LLM_MAX_RETRIES } from "../config.js";

/**
 * @typedef {InstanceType<typeof import("@anthropic-ai/sdk").default>} Anthropic
 */

/**
 * Build an Anthropic client from a token (+ optional baseURL), unless an
 * injectable one is supplied (tests pass a fake).
 * @param {string} token @param {string} [baseURL] @param {Anthropic} [client]
 * @returns {Promise<Anthropic>}
 */
async function clientFor(token, baseURL, client) {
  if (client) {
    return client;
  }
  if (!token) {
    throw new Error("the LLM call requires an API token.");
  }
  const Anthropic = await lazyImportSdk("@anthropic-ai/sdk", "Anthropic");
  return new Anthropic({
    apiKey: token,
    timeout: LLM_REQUEST_TIMEOUT_MS,
    maxRetries: LLM_MAX_RETRIES,
    ...(baseURL ? { baseURL } : {}),
  });
}

/**
 * The parameters the model's request body carries, from assets/llm/<type>.yaml.
 * @param {string} [type]  The LLM_API_TYPE the adapter was bound to.
 * @param {string} [baseURL] @param {string} [model]
 * @returns {Record<string, *>}
 */
function parametersFor(type, baseURL, model) {
  return modelSettings(type, baseURL, model).parameters ?? {};
}

/**
 * Evaluate one check criterion and return a structured verdict result.
 * @param {object} params
 * @param {string} params.token @param {string} [params.type]  The LLM_API_TYPE
 *   (bound by getProvider), which selects the model table.
 * @param {string} [params.model] @param {string} [params.baseURL]
 * @param {Array<object>|string} params.system  System prompt (text blocks; the
 *   last carries cache_control for the shared add-on context).
 * @param {string} params.criterion  The check's instruction/rubric.
 * @param {Anthropic} [params.client]
 * @returns {Promise<import("./schema.js").LlmResult>}
 */
export async function callVerdicts({
  token,
  type,
  model,
  baseURL,
  system,
  criterion,
  client,
}) {
  client = await clientFor(token, baseURL, client);
  const message = await client.messages.create({
    model,
    ...parametersFor(type, baseURL, model),
    system,
    tools: [
      {
        name: RESULT_TOOL,
        description: "Report the result of the review check.",
        input_schema: RESULT_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: RESULT_TOOL },
    messages: [{ role: "user", content: criterion }],
  });
  return coerceResult(toolInput(message, RESULT_TOOL));
}

/**
 * Free-form text completion (no forced tool): used for the advisory change
 * summary. Returns the model's joined text blocks, trimmed.
 * @param {object} params
 * @param {string} params.token @param {string} [params.type]
 * @param {string} [params.model]
 * @param {string} [params.baseURL] @param {Array<object>|string} [params.system]
 * @param {string} params.prompt
 * @param {Anthropic} [params.client]
 * @returns {Promise<string>}
 */
export async function callText({
  token,
  type,
  model,
  baseURL,
  system,
  prompt,
  client,
}) {
  client = await clientFor(token, baseURL, client);
  const message = await client.messages.create({
    model,
    ...parametersFor(type, baseURL, model),
    ...(system ? { system } : {}),
    messages: [{ role: "user", content: prompt }],
  });
  return (message.content || [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/**
 * The structured --llm-review review: a forced report_addon_review tool whose
 * input is { summary, recheck }.
 * @param {object} params
 * @param {string} params.token @param {string} [params.type]
 * @param {string} [params.model]
 * @param {string} [params.baseURL] @param {Array<object>|string} [params.system]
 * @param {string} params.prompt
 * @param {Anthropic} [params.client]
 * @returns {Promise<import("./schema.js").AddonReview>}
 */
export async function callReview({
  token,
  type,
  model,
  baseURL,
  system,
  prompt,
  client,
}) {
  client = await clientFor(token, baseURL, client);
  const message = await client.messages.create({
    model,
    ...parametersFor(type, baseURL, model),
    ...(system ? { system } : {}),
    tools: [
      {
        name: REVIEW_TOOL,
        description:
          "Report the add-on summary and your verdict on each item listed in a " +
          "recheck section.",
        input_schema: ADDON_REVIEW_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: REVIEW_TOOL },
    messages: [{ role: "user", content: prompt }],
  });
  return coerceReview(toolInput(message, REVIEW_TOOL));
}

/**
 * @typedef {object} ContentBlock  One block in a Claude message's content.
 * @property {string} type  Block type, e.g. "text" or "tool_use".
 * @property {string} [name]  The tool name (tool_use blocks).
 * @property {*} [input]  The tool's input arguments (tool_use blocks).
 */
/**
 * @typedef {object} ClaudeMessage  A Claude messages.create response.
 * @property {ContentBlock[]} content  The response content blocks.
 */
/**
 * @typedef {object} ToolInput  The raw arguments of a forced tool_use block (a
 *   RESULT_SCHEMA or ADDON_REVIEW_SCHEMA shape, validated by the coercers).
 */
/**
 * The input of the forced tool_use block, or throw if the model returned none.
 * @param {ClaudeMessage} message @param {string} toolName
 * @returns {ToolInput}
 */
function toolInput(message, toolName) {
  const block = (message.content || []).find(
    (b) => b.type === "tool_use" && b.name === toolName
  );
  if (!block) {
    throw new Error("the model did not return a structured tool_use result.");
  }
  return block.input;
}

/**
 * List the Anthropic models available to the given token (newest first).
 * @param {{token: string, baseURL?: string}} params
 * @returns {Promise<{id: string, displayName: string, createdAt: string}[]>}
 */
export async function listModels({ token, baseURL }) {
  const client = await clientFor(token, baseURL);
  return collectModels(client, (m) => ({
    id: m.id,
    displayName: m.display_name ?? "",
    createdAt: m.created_at ?? "",
  }));
}
