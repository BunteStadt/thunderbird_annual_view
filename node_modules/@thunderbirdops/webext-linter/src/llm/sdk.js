// Shared provider-SDK plumbing for the adapters (anthropic.js / openai.js). Kept
// in its own module - not provider.js - so the adapters can import it without a
// cycle (provider.js imports the adapters).

/**
 * Lazy-import a provider SDK (a regular dependency), throwing an actionable error
 * if it fails to load (e.g. a broken install). Prefers the module's default
 * export, then the named class, then the module itself.
 * @param {string} pkg  The npm package to import (e.g. "@anthropic-ai/sdk").
 * @param {string} named  The class export to prefer (e.g. "Anthropic", "OpenAI").
 * @returns {Promise<any>}  The SDK class.
 */
export async function lazyImportSdk(pkg, named) {
  try {
    const mod = await import(pkg);
    return mod.default || mod[named] || mod;
  } catch (err) {
    throw new Error(
      `${pkg} failed to load (try reinstalling with "npm install"): ${err.message}`
    );
  }
}

/**
 * Page through a provider's `client.models.list()` async iterator into a plain
 * array, mapping each raw model to the shared row shape via `mapRow` (the only
 * per-provider difference - the field names differ across SDKs).
 * @param {{models: {list: () => AsyncIterable<any>}}} client
 * @param {(m: any) => {id: string, displayName: string, createdAt: string}} mapRow
 * @returns {Promise<{id: string, displayName: string, createdAt: string}[]>}
 */
export async function collectModels(client, mapRow) {
  const models = [];
  for await (const m of client.models.list()) {
    models.push(mapRow(m));
  }
  return models;
}
