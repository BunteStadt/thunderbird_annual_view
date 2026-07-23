// JSON canonicalization shared by the schema merger, the bump-only diff check,
// and the LLM context builder: deep-sort object keys so deeply-equal values
// serialize to identical bytes.
//
// Belongs here: deterministic JSON shaping (sortKeys, canonicalJson) and the
// tiny shared JSON-text helper stripBom (used by the trusted-upstream JSON5
// readers in src/schema and src/experiments). Does NOT belong here: parsing
// JSON/JSON5 text from a submission, which is src/addon/load.js. Diffing or
// comparing two values for a check belongs to that check (src/checks/rules/*).
// User-facing JSON report output is src/report/*.

/**
 * Recursively sort object keys (array order is preserved). The result
 * serializes byte-identically for deeply-equal inputs.
 * @param {unknown} value
 * @returns {unknown}
 */
export function sortKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      out[k] = sortKeys(value[k]);
    }
    return out;
  }
  return value;
}

/**
 * Canonical JSON text (sorted keys) of a value, for deep-equality comparison.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

/**
 * Drop a leading UTF-8 BOM so a tolerant parser (JSON5) sees clean text.
 * @param {string} text @returns {string}
 */
export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
