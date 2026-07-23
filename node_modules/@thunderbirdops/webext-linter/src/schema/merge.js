// Structural merging of annotated-schema objects, adapted from
// thunderbird/webext-docs-generator (mergeSchema / mergeSchemaExtensions).
// SchemaIndex builds its registries with the two exported entry points:
//   - mergeNamespace: accumulate one namespace's functions, events,
//     properties, permissions and annotations across the files declaring it,
//   - mergeExtension: deep-merge a `$extend` source into a base type (this is
//     how permission enums and manifest keys are spread across files).
//
// The deep merge is value-generic: primitives overwrite, arrays append unique
// items (deep equality via canonical JSON), `choices` arrays merge entry-wise
// by their `enum`/`$ref` key, and objects recurse.
//
// Belongs here: pure data transforms that combine schema fragments -
// mergeNamespace, mergeExtension, and their private deep-merge helpers. No IO
// and no query surface.
//
// Does NOT belong here: orchestrating the merge passes or exposing a query API
// (src/schema/index.js), reading or fetching files (src/schema/load.js and
// src/schema/fetch.js). The shared canonicalJson helper lives in
// src/util/json.js and is imported, not redefined here.

import { canonicalJson } from "../util/json.js";

/** @typedef {import("./index.js").SchemaNode} SchemaNode */
/** @typedef {import("./index.js").JsonValue} JsonValue */

/**
 * @param {JsonValue} v  Value to classify.
 * @returns {"primitive"|"array"|"object"} Type category.
 */
function getType(v) {
  if (v === null || typeof v !== "object") {
    return "primitive";
  }
  return Array.isArray(v) ? "array" : "object";
}

/**
 * @param {JsonValue} a  First value.
 * @param {JsonValue} b  Second value.
 * @returns {boolean} True if the two values are deeply equal.
 */
function isEqual(a, b) {
  return a === b || canonicalJson(a) === canonicalJson(b);
}

/**
 * Merge namespace object `b` into accumulator `a`
 * (functions/events/properties/etc.).
 * @param {SchemaNode} a  Accumulator namespace object (mutated in place).
 * @param {SchemaNode} b  Source namespace object to merge from.
 */
export function mergeNamespace(a, b) {
  for (const name of ["functions", "events"]) {
    for (const item of b[name] || []) {
      if (!a[name].some((existing) => existing.name === item.name)) {
        a[name].push(item);
      }
    }
  }
  if (b.properties) {
    Object.assign(a.properties, b.properties);
  }
  for (const p of b.permissions || []) {
    if (!a.permissions.includes(p)) {
      a.permissions.push(p);
    }
  }
  for (const an of b.annotations || []) {
    a.annotations.push(an);
  }
  if (b.deprecated !== undefined) {
    a.deprecated = b.deprecated;
  }
  if (b.unsupported !== undefined) {
    a.unsupported = b.unsupported;
  }
}

/**
 * Deep-merge a `$extend` source object into a destination type.
 * @param {SchemaNode} dst  Destination type object (not mutated).
 * @param {SchemaNode} src  Source $extend object.
 * @returns {SchemaNode} New merged type object.
 */
export function mergeExtension(dst, src) {
  const out = structuredClone(dst);
  mergeObject(out, src);
  return out;
}

/**
 * @param {JsonValue[]} a  Target array (mutated in place).
 * @param {JsonValue[]} b  Source array whose unique items are appended to `a`.
 */
function mergeArrayUnique(a, b) {
  for (const item of b) {
    if (!a.some((existing) => isEqual(existing, item))) {
      a.push(item);
    }
  }
}

/**
 * @param {SchemaNode} a  Accumulator type object whose choices array is merged.
 * @param {SchemaNode} b  Source type object supplying additional choices.
 * @param {string} key  Property key used to match choice entries.
 */
function mergeChoice(a, b, key) {
  for (const bEntry of b.choices.filter((e) => e[key] !== undefined)) {
    const aEntries = a.choices.filter((e) => e[key] !== undefined);
    if (aEntries.length === 0) {
      a.choices.push(bEntry);
      continue;
    }
    const aEntry =
      aEntries.find((e) => isEqual(e[key], bEntry[key])) || aEntries[0];
    if (getType(bEntry) === "array") {
      mergeArrayUnique(aEntry, bEntry);
    } else if (getType(bEntry) === "object") {
      mergeObject(aEntry, bEntry);
    }
  }
}

/**
 * @param {SchemaNode} a  Accumulator object (mutated in place).
 * @param {SchemaNode} b  Source object to merge from.
 * @returns {SchemaNode} The mutated accumulator `a`.
 */
function mergeObject(a, b) {
  for (const key of Object.keys(b)) {
    if (key === "$extend") {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(a, key)) {
      a[key] = b[key];
      continue;
    }
    switch (getType(a[key])) {
      case "primitive":
        a[key] = b[key];
        break;
      case "array":
        if (key === "choices") {
          mergeChoice(a, b, "enum");
          mergeChoice(a, b, "$ref");
        } else {
          mergeArrayUnique(a[key], b[key]);
        }
        break;
      case "object":
        mergeObject(a[key], b[key]);
        break;
    }
  }
  return a;
}
