// Reads the raw annotated-schema JSON files from a zip or a directory and
// returns them parsed. The downloaded codeload zip nests everything under a
// top-level folder (e.g.
// "webext-annotated-schemas-release-mv3/schema-files/*.json"). A directory
// source may point either at the repo root (containing schema-files/) or
// directly at a folder of .json files. We handle all of these so tests can use
// a plain directory fixture.
//
// Belongs here: file reading and JSON parsing - locating schema-files/*.json
// inside a zip or dir, JSON5-parsing each into namespace-object arrays, and
// returning the "<name>.json" -> parsed map. File IO only.
//
// Does NOT belong here: fetching or caching the zip (src/schema/fetch.js),
// merging the parsed fragments or any query logic (src/schema/merge.js and
// src/schema/index.js). The parsed output is handed to buildSchemaIndex.

import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import JSON5 from "json5";
import { debug } from "../util/log.js";
import { stripBom } from "../util/json.js";

/** @typedef {import("./index.js").SchemaNode} SchemaNode */

/** Matches ".../schema-files/<name>.json" and captures the base name. */
const SCHEMA_ENTRY = /(?:^|\/)schema-files\/([^/]+\.json)$/;

/** The Thunderbird version each schema file is stamped with (same on every file). */
const APP_VERSION_RE = /"applicationVersion"\s*:\s*"([^"]*)"/;

/**
 * Yield `[name, rawText]` for each schema-files/*.json in a zip or directory
 * source - the single reader that both the full parse (loadSchemaFiles) and the
 * cheap applicationVersion peek walk, so the zip/dir layout handling lives in one
 * place. A directory may hold the files directly or under a schema-files/ subdir
 * (test fixtures use the flat form); a zip yields only schema-files/ entries.
 * @param {string} source  Path to a .zip, a repo dir, or a dir of *.json.
 * @returns {Generator<[string, string]>}
 */
function* schemaFileTexts(source) {
  if (fs.statSync(source).isDirectory()) {
    const dir = fs.existsSync(path.join(source, "schema-files"))
      ? path.join(source, "schema-files")
      : source;
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith(".json")) {
        yield [name, fs.readFileSync(path.join(dir, name), "utf8")];
      }
    }
    return;
  }
  const zip = new AdmZip(source);
  for (const entry of zip.getEntries()) {
    const m = entry.isDirectory ? null : entry.entryName.match(SCHEMA_ENTRY);
    if (m) {
      yield [m[1], entry.getData().toString("utf8")];
    }
  }
}

/**
 * Read just the `applicationVersion` anchor a schema is stamped with (the target
 * Thunderbird version, e.g. "140.11.1esr") without parsing or indexing the whole
 * set. Every schema-files entry carries the same value, so the first match wins.
 * Used to compare a candidate branch's train against the add-on's version range.
 * @param {string} source  Path to a .zip, a repo dir, or a dir of *.json.
 * @returns {string|null} The version string, or null if none is stamped.
 */
export function peekApplicationVersion(source) {
  for (const [, text] of schemaFileTexts(source)) {
    const m = APP_VERSION_RE.exec(text);
    if (m) {
      return m[1];
    }
  }
  return null;
}

/**
 * @typedef {object} LoadedSchemas
 * @property {Record<string, SchemaNode[]>} files  "<name>.json" -> parsed.
 * @property {string} source  Description of where the schemas came from.
 */

/**
 * Load schema files from a zip path or a directory.
 * @param {string} source  Path to a .zip, a repo dir, or a dir of *.json
 *   schema files.
 * @returns {LoadedSchemas}
 */
export function loadSchemaFiles(source) {
  const files = {};
  for (const [name, text] of schemaFileTexts(source)) {
    files[name] = parse(name, text);
  }
  if (Object.keys(files).length === 0) {
    throw new Error(
      `No schema-files/*.json found in ${source}. ` +
        "Expected the annotated-schemas layout (a schema-files/ directory of JSON files)."
    );
  }
  debug(`Loaded ${Object.keys(files).length} schema files from ${source}`);
  return { files, source };
}

/**
 * @param {string} name  Schema file name (for error messages).
 * @param {string} text  Raw file contents.
 * @returns {SchemaNode[]} Parsed schema file (namespace objects).
 */
function parse(name, text) {
  try {
    return JSON5.parse(stripBom(text));
  } catch (err) {
    throw new Error(`Failed to parse schema file ${name}: ${err.message}`);
  }
}
