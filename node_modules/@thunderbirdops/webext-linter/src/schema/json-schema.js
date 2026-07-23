// Translates the merged manifest type from the annotated schema (Mozilla's
// WebExtension schema dialect: $ref / $extend / choices / enum / properties)
// into a draft-07 JSON Schema that ajv can compile, for deep manifest
// validation. The translation is deliberately CONSERVATIVE so it can never
// wrongly reject a valid manifest:
//   - `choices` (multi-type) -> {} (accept anything): avoids anyOf cascades.
//   - additionalProperties is forced true everywhere: never rejects unknown
//     keys (the shallow manifest check handles unrecognized keys).
//   - no `required`: presence is handled by the manifest check.
//   - unknown constructs / unresolvable $ref -> {} (accept).
// The net effect: it only validates the value TYPE of known, concretely-typed
// properties (string/integer/boolean/array/object/enum), plus simple bounds.
//
// Belongs here: JSON-Schema derivation only - buildManifestJsonSchema reads a
// SchemaIndex's manifest types and emits the conservative draft-07 schema.
// Does NOT belong here: building or querying the SchemaIndex
// (src/schema/index.js), compiling or running ajv and acting on its errors,
// which belongs to the consuming mistyped-manifest-value check under
// src/checks/rules/*. User-facing wording for any finding lives in
// assets/registry.yaml.

const SCALAR_TYPES = new Set([
  "string",
  "integer",
  "number",
  "boolean",
  "array",
  "object",
  "null",
]);
const NUMERIC_KEYS = [
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
];

/**
 * Build a JSON Schema for the manifest from a SchemaIndex, or null if the
 * manifest types are unavailable.
 * @param {import("./index.js").SchemaIndex} schema
 * @returns {object|null}
 */
export function buildManifestJsonSchema(schema) {
  const definitions = {};
  // Map each $ref string to a unique definitions key, so two refs that sanitize
  // to the same string can't clobber each other's definition.
  const refKeys = new Map();

  /** @param {string} ref @returns {string} a unique definitions-safe key. */
  const keyFor = (ref) => {
    if (refKeys.has(ref)) {
      return refKeys.get(ref);
    }
    let key = ref.replace(/[^A-Za-z0-9_.]/g, "_");
    const used = new Set(refKeys.values());
    while (used.has(key)) {
      key += "_";
    }
    refKeys.set(ref, key);
    return key;
  };

  /** @param {string} ref @returns {string} definitions key */
  const ensureDef = (ref) => {
    const key = keyFor(ref);
    if (key in definitions) {
      return key;
    }
    definitions[key] = {}; // placeholder breaks reference cycles
    const type = schema.resolveRef(ref);
    definitions[key] = type ? translate(type) : {};
    return key;
  };

  /** @param {any} node @returns {object} */
  const translate = (node) => {
    if (!node || typeof node !== "object") {
      return {};
    }
    if (node.$ref) {
      return { $ref: `#/definitions/${ensureDef(node.$ref)}` };
    }
    if (node.choices) {
      return {}; // conservative: do not validate multi-type values
    }
    if (node.preprocess) {
      // The value is normalized (e.g. lower-cased) before the runtime checks
      // its enum/type, so a literal enum check here would be a false positive.
      return {};
    }
    const out = {};
    if (typeof node.type === "string" && SCALAR_TYPES.has(node.type)) {
      out.type = node.type;
    }
    if (Array.isArray(node.enum)) {
      const values = node.enum
        .map((e) => (e && typeof e === "object" ? e.name : e))
        .filter((v) => v !== undefined);
      // An empty enum makes ajv.compile throw (disabling the whole check), so
      // only keep a non-empty one. An absent enum simply accepts any value.
      if (values.length > 0) {
        out.enum = values;
      }
    }
    if (node.properties && typeof node.properties === "object") {
      if (!out.type) {
        out.type = "object";
      }
      out.properties = {};
      for (const [k, v] of Object.entries(node.properties)) {
        out.properties[k] = translate(v);
      }
      out.additionalProperties = true; // never reject unknown properties
    }
    if (node.items) {
      if (!out.type) {
        out.type = "array";
      }
      out.items = translate(node.items);
    }
    for (const k of NUMERIC_KEYS) {
      if (typeof node[k] === "number") {
        out[k] = node[k];
      }
    }
    return out;
  };

  const base =
    schema.globalTypes.get("manifest.ManifestBase")?.properties || {};
  const wem =
    schema.globalTypes.get("manifest.WebExtensionManifest")?.properties || {};
  const merged = { ...base, ...wem };
  if (Object.keys(merged).length === 0) {
    return null;
  }

  const properties = {};
  for (const [k, v] of Object.entries(merged)) {
    properties[k] = translate(v);
  }
  return {
    type: "object",
    properties,
    additionalProperties: true,
    definitions,
  };
}
