// Loads the hand-curated Thunderbird domain facts from assets/webext-facts.yaml -
// data the API schema does not express (the API root globals, the user-data
// namespaces, the privileged core globals, and the file-loader method tables).
// The fact VALUES live in assets/ (like registry.yaml / library-blocks.yaml);
// this module is only the loader that reads them once and hands each consumer the
// shape it uses. Each list's consumer is named in the yaml.
//
// Belongs here: reading and shaping the facts (Set / Map). Does NOT belong here:
// the facts themselves (-> assets/webext-facts.yaml) or what a consumer does with
// them (-> src/parse/api-base.js, network-sinks.js, core-symbols.js,
// loader-files.js).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
// Resolved like library-blocks.js resolves assets/library-blocks.yaml.
const FACTS = YAML.parse(
  fs.readFileSync(path.resolve(here, "../../assets/webext-facts.yaml"), "utf8")
);

/** The WebExtension API root globals (browser / messenger / chrome). */
export const API_ROOTS = new Set(FACTS["api-roots"]);
/** WebExtension namespaces holding user data (network-sink payload evidence). */
export const DATA_APIS = new Set(FACTS["data-apis"]);
/** Privileged globals a WebExtension sandbox never provides. */
export const CORE_SYMBOLS = new Set(FACTS["core-symbols"]);
/** File-loader methods whose path is extension-root-relative (vs page-relative). */
export const ROOT_RELATIVE_FILE_METHODS = new Set(
  FACTS["root-relative-file-methods"]
);
/**
 * Schema-unmarked file loaders: dotted-method ->
 * {arg0?, stringKeys?, arrayKeys?, mv?} (see assets/webext-facts.yaml).
 * @type {Map<string, {arg0?: boolean, stringKeys?: string[], arrayKeys?: string[], mv?: number}>}
 */
export const BRIDGE = new Map(Object.entries(FACTS.bridge));
