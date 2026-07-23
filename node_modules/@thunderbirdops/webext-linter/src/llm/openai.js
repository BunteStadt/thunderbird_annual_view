// The OpenAI (ChatGPT) provider adapter: the same four operations as
// anthropic.js (callVerdicts / callText / callReview / listModels), over the
// openai SDK. Structured output is forced via a function tool whose parameters
// are the shared JSON schema, then run through the same coercers in schema.js, so
// callers get an identical typed result.
//
// It speaks TWO OpenAI endpoints. chat/completions is the default and the only one
// a local OpenAI-compatible server (ollama, reached via baseURL) understands;
// responses is the only one that serves the codex models. Which one a model wants -
// and which token parameter it accepts - comes from assets/llm/<type>.yaml via
// settings.js. OpenAI publishes no way to ASK (its /v1/models says nothing about
// endpoints or parameters), so that table is a starting guess: when the server
// rejects the shape, negotiate() repairs it from the rejection itself, and once the
// answer has been READ the repair is cached by negotiated.js. A repair therefore
// costs one round-trip, once per server and model, and never a failed review.
//
//   - the openai SDK is imported lazily (only when a token is present),
//   - the Anthropic-style `system` text-block array is flattened to one string
//     (OpenAI takes a single system message; prompt caching is automatic there),
//   - the token and add-on contents are never sent anywhere but the API.
//
// Belongs here: the OpenAI request/response shapes, the lazy SDK import, and the
// repair rules that turn an API rejection into a working request. Does NOT belong
// here: the model table (-> settings.js + assets/llm/*.yaml), where a negotiated
// shape is stored (-> negotiated.js), the schemas + coercion (-> schema.js), the
// provider selection (-> src/llm/provider.js), or any model-facing prompt (-> the
// registry).

import { lazyImportSdk, collectModels } from "./sdk.js";
import { modelSettings, shippedSettings } from "./settings.js";
import { learn } from "./negotiated.js";
import {
  RESULT_TOOL,
  REVIEW_TOOL,
  RESULT_SCHEMA,
  ADDON_REVIEW_SCHEMA,
  coerceResult,
  coerceReview,
} from "./schema.js";
import { LLM_REQUEST_TIMEOUT_MS, LLM_MAX_RETRIES } from "../config.js";

/** @typedef {InstanceType<typeof import("openai").default>} OpenAI */
/** @typedef {import("./settings.js").ModelSettings} ModelSettings */
/**
 * @typedef {object} ForcedTool  The tool the model is forced to call.
 * @property {string} name @property {string} description @property {object} schema
 */

// The openai SDK constructor requires a non-empty apiKey string. A keyless local
// server (Ollama, reached via baseURL) has no key, so fall back to this harmless
// placeholder - the server ignores it. Cloud callers always pass a real token
// (the pre-flight requires it), so this only ever applies to the keyless path.
const KEYLESS_PLACEHOLDER = "ollama";

// The output-token parameter each endpoint accepts. Renaming it is half the
// negotiation: a repair that moves a model to another endpoint must carry the cap
// over to that endpoint's own name, or the next request is rejected for the
// parameter instead of the endpoint.
const TOKEN_PARAMS = {
  chat: ["max_tokens", "max_completion_tokens"],
  responses: ["max_output_tokens"],
};

/**
 * Build an OpenAI client from a token (+ optional baseURL), unless an injectable
 * one is supplied (tests pass a fake). A missing token uses the keyless
 * placeholder rather than failing, so an OpenAI-compatible local server works.
 * @param {string} [token] @param {string} [baseURL] @param {OpenAI} [client]
 * @returns {Promise<OpenAI>}
 */
async function clientFor(token, baseURL, client) {
  if (client) {
    return client;
  }
  const OpenAI = await lazyImportSdk("openai", "OpenAI");
  return new OpenAI({
    apiKey: token || KEYLESS_PLACEHOLDER,
    timeout: LLM_REQUEST_TIMEOUT_MS,
    maxRetries: LLM_MAX_RETRIES,
    ...(baseURL ? { baseURL } : {}),
  });
}

/**
 * The Anthropic-style system (an array of {type,text} blocks, or a string) as a
 * single OpenAI system-message string.
 * @param {Array<object>|string|undefined} system
 * @returns {string}
 */
function flattenSystem(system) {
  if (Array.isArray(system)) {
    return system
      .map((b) => (b && typeof b.text === "string" ? b.text : ""))
      .filter(Boolean)
      .join("\n\n");
  }
  return typeof system === "string" ? system : "";
}

/** @see import("./anthropic.js").callVerdicts */
export async function callVerdicts({
  token,
  type,
  model,
  baseURL,
  system,
  criterion,
  client,
}) {
  const { res, endpoint, commit } = await negotiate({
    client: await clientFor(token, baseURL, client),
    type,
    model,
    baseURL,
    system,
    prompt: criterion,
    tool: {
      name: RESULT_TOOL,
      description: "Report the result of the review check.",
      schema: RESULT_SCHEMA,
    },
  });
  const result = coerceResult(callArgs(res, endpoint, RESULT_TOOL));
  commit();
  return result;
}

/** @see import("./anthropic.js").callText */
export async function callText({
  token,
  type,
  model,
  baseURL,
  system,
  prompt,
  client,
}) {
  const { res, endpoint, commit } = await negotiate({
    client: await clientFor(token, baseURL, client),
    type,
    model,
    baseURL,
    system,
    prompt,
  });
  const text = textOf(res, endpoint);
  commit();
  return text;
}

/** @see import("./anthropic.js").callReview */
export async function callReview({
  token,
  type,
  model,
  baseURL,
  system,
  prompt,
  client,
}) {
  const { res, endpoint, commit } = await negotiate({
    client: await clientFor(token, baseURL, client),
    type,
    model,
    baseURL,
    system,
    prompt,
    tool: {
      name: REVIEW_TOOL,
      description:
        "Report the add-on summary and your verdict on each item listed in a " +
        "recheck section.",
      schema: ADDON_REVIEW_SCHEMA,
    },
  });
  const review = coerceReview(callArgs(res, endpoint, REVIEW_TOOL));
  commit();
  return review;
}

/**
 * @typedef {object} Call  One request/response pair.
 * @property {object} res  The API response.
 * @property {string} endpoint  The endpoint that served it, which decides how the
 *   response is read (a chat completion and a response object share no shape).
 */
/**
 * Send the request the model's settings describe and, when the server rejects that
 * shape in a way we know how to repair, fix the settings and send it again.
 *
 * Only the API call is inside the try: a response we cannot READ is a different
 * failure (the model ignored the tool) and must not be retried with a new shape.
 * For the same reason a repair is not RECORDED here - a shape the server accepted
 * can still have produced an unusable answer. The caller commits it once it has
 * read the response, so nothing that never worked is cached for the next run.
 * @param {object} params
 * @param {OpenAI} params.client @param {string} params.type
 * @param {string} [params.model] @param {string} [params.baseURL]
 * @param {Array<object>|string} [params.system] @param {string} params.prompt
 * @param {ForcedTool} [params.tool]
 * @returns {Promise<Call>}
 */
async function negotiate({
  client,
  type,
  model,
  baseURL,
  system,
  prompt,
  tool,
}) {
  const settings = modelSettings(type, baseURL, model);
  const req = { model, sys: flattenSystem(system), user: prompt, tool };
  const tried = new Set();
  let repaired = false;
  for (;;) {
    const endpoint = endpointOf(settings);
    tried.add(shapeOf(settings));
    try {
      const res = await send(
        client,
        endpoint,
        bodyFor(settings, endpoint, req)
      );
      return {
        res,
        endpoint,
        commit: () => {
          if (repaired) {
            learn(type, baseURL, model, deltaOf(type, model, settings));
          }
        },
      };
    } catch (err) {
      // Repair only what the server told us how to repair. Everything else - a
      // bad token, a rate limit, a dead local server, a network error - is the
      // caller's to report, and must reach it unchanged. Re-sending a shape we
      // already tried would loop, so that ends the attempt too.
      if (!repair(settings, err) || tried.has(shapeOf(settings))) {
        throw err;
      }
      repaired = true;
    }
  }
}

/**
 * What the negotiation learned, as a delta from the TABLE - never a copy of the
 * resolved settings, so a cap the reviewer later raises in the table still applies
 * to a model whose parameter NAME was once learned.
 * @param {string} type @param {string} [model] @param {ModelSettings} settings
 * @returns {import("./negotiated.js").Negotiated}
 */
function deltaOf(type, model, settings) {
  const shipped = shippedSettings(type, model);
  const from = tokenKey(shipped);
  const to = tokenKey(settings);
  return {
    ...(settings.endpoint ? { endpoint: settings.endpoint } : {}),
    ...(from && to && from !== to ? { rename: { from, to } } : {}),
  };
}

/**
 * The request shape the settings describe: the endpoint plus the token parameter,
 * which together are everything a repair can change.
 * @param {ModelSettings} settings @returns {string}
 */
function shapeOf(settings) {
  return `${endpointOf(settings)} ${tokenKey(settings) ?? ""}`;
}

/**
 * The endpoint that serves this model. Anything the table does not call "responses"
 * is chat - the endpoint every OpenAI-compatible server has, and the one a model
 * with no endpoint of its own gets.
 * @param {ModelSettings} settings @returns {string}
 */
function endpointOf(settings) {
  return settings.endpoint === "responses" ? "responses" : "chat";
}

/**
 * @param {OpenAI} client @param {string} endpoint @param {object} body
 * @returns {Promise<object>}
 */
function send(client, endpoint, body) {
  return endpoint === "responses"
    ? client.responses.create(body)
    : client.chat.completions.create(body);
}

/**
 * The request body for one endpoint. The two share only the model: the system
 * prompt, the user prompt and the forced tool each have their own shape (the
 * Responses function tool is flat, where chat nests it under `function`). The
 * model's parameters are spread in as they stand.
 * @param {ModelSettings} settings @param {string} endpoint
 * @param {{model?: string, sys: string, user: string, tool?: ForcedTool}} req
 * @returns {object}
 */
function bodyFor(settings, endpoint, { model, sys, user, tool }) {
  const params = settings.parameters ?? {};
  if (endpoint === "responses") {
    return {
      model,
      ...params,
      ...(sys ? { instructions: sys } : {}),
      input: user,
      ...(tool
        ? {
            // `strict` defaults to true on this endpoint, and a strict tool
            // demands a schema with no optional properties and
            // additionalProperties:false. Ours (schema.js) are not written that
            // way, so a strict tool would be rejected outright.
            tools: [
              {
                type: "function",
                name: tool.name,
                description: tool.description,
                parameters: tool.schema,
                strict: false,
              },
            ],
            tool_choice: { type: "function", name: tool.name },
          }
        : {}),
    };
  }
  return {
    model,
    ...params,
    messages: [
      ...(sys ? [{ role: "system", content: sys }] : []),
      { role: "user", content: user },
    ],
    ...(tool
      ? {
          tools: [
            {
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.schema,
              },
            },
          ],
          tool_choice: { type: "function", function: { name: tool.name } },
        }
      : {}),
  };
}

/**
 * The model's free-form text. The Responses SDK synthesizes an `output_text`
 * getter over its own responses, but only there - so read the output items, and
 * keep that getter as the fallback.
 * @param {object} res @param {string} endpoint
 * @returns {string}
 */
function textOf(res, endpoint) {
  if (endpoint !== "responses") {
    return (res?.choices?.[0]?.message?.content ?? "").trim();
  }
  const text = (res?.output ?? [])
    .filter((item) => item?.type === "message")
    .flatMap((item) => item?.content ?? [])
    .filter((c) => c?.type === "output_text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n")
    .trim();
  return text || String(res?.output_text ?? "").trim();
}

/**
 * The arguments of the model's forced function call, or throw if there is none -
 * naming the output-token cap when that is what swallowed it, since a reasoning
 * model can spend the whole cap thinking and never reach the call.
 * @param {object} res @param {string} endpoint @param {string} name
 * @returns {object}  A RESULT_SCHEMA or ADDON_REVIEW_SCHEMA shape, for the coercers.
 */
function callArgs(res, endpoint, name) {
  const args =
    endpoint === "responses"
      ? (res?.output ?? []).find(
          (item) => item?.type === "function_call" && item?.name === name
        )?.arguments
      : res?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) {
    throw new Error(
      truncated(res, endpoint)
        ? "the model hit its output-token limit before returning a structured " +
            "function call (raise the cap in assets/llm)."
        : "the model did not return a structured function call."
    );
  }
  return JSON.parse(args);
}

/**
 * Whether the response stops at the output-token cap.
 * @param {object} res @param {string} endpoint @returns {boolean}
 */
function truncated(res, endpoint) {
  return endpoint === "responses"
    ? res?.incomplete_details?.reason === "max_output_tokens"
    : res?.choices?.[0]?.finish_reason === "length";
}

/**
 * The output-token parameter the settings carry, if any.
 * @param {ModelSettings} settings @returns {?string}
 */
function tokenKey(settings) {
  const names = Object.values(TOKEN_PARAMS).flat();
  return Object.keys(settings.parameters ?? {}).find((k) => names.includes(k));
}

/**
 * Move the output-token cap onto `name`, keeping its value.
 * @param {ModelSettings} settings @param {string} name
 */
function renameToken(settings, name) {
  const key = tokenKey(settings);
  if (key === name) {
    return;
  }
  const value = key ? settings.parameters[key] : undefined;
  if (key) {
    delete settings.parameters[key];
  }
  if (value !== undefined) {
    settings.parameters[name] = value;
  }
}

/**
 * Adjust the settings in place from what the server said was wrong with the
 * request. True when something changed and the request is worth re-sending.
 *
 * The rejection is read as fields (status, param), not prose - the one exception
 * being the endpoint 404, whose DIRECTION ("use the v1/responses endpoint
 * instead") the API states only in the message. That test is kept narrow on
 * purpose: a 404 that does not point at another endpoint is a dead local server, a
 * wrong base URL or an unpulled model, and has to surface as itself.
 *
 * Duck-typed on the error's fields rather than `instanceof APIError`: the SDK is
 * behind a lazy import, and tests inject plain objects.
 * @param {ModelSettings} settings
 * @param {{status?: number, param?: string, message?: string}} err
 * @returns {boolean}
 */
function repair(settings, err) {
  const endpoint = endpointOf(settings);
  const status = err?.status;
  const message = String(err?.message ?? "");

  // "Unsupported parameter: 'max_tokens' ... Use 'max_completion_tokens'": a
  // reasoning model. The reverse - a server that knows only max_tokens - happens
  // when a `match` pattern claimed a model it should not have, and is the same
  // repair the other way round.
  if (status === 400 && endpoint === "chat") {
    for (const [from, to] of [
      ["max_tokens", "max_completion_tokens"],
      ["max_completion_tokens", "max_tokens"],
    ]) {
      if (err?.param === from && tokenKey(settings) === from) {
        renameToken(settings, to);
        return true;
      }
    }
  }
  if (status === 404 && endpoint === "chat" && /responses/i.test(message)) {
    settings.endpoint = "responses";
    renameToken(settings, TOKEN_PARAMS.responses[0]);
    return true;
  }
  // A server with no /v1/responses at all (an OpenAI-compatible shim we wrongly
  // sent there).
  if (
    endpoint === "responses" &&
    (status === 404 || status === 405 || status === 501)
  ) {
    settings.endpoint = "chat";
    renameToken(settings, TOKEN_PARAMS.chat[0]);
    return true;
  }
  return false;
}

/**
 * List the OpenAI models available to the given token.
 * @param {{token: string, baseURL?: string}} params
 * @returns {Promise<{id: string, displayName: string, createdAt: string}[]>}
 */
export async function listModels({ token, baseURL }) {
  const client = await clientFor(token, baseURL);
  return collectModels(client, (m) => ({
    id: m.id,
    displayName: "",
    createdAt: m.created != null ? String(m.created) : "",
  }));
}
