// Manifest-derived helpers for Thunderbird Experiment add-ons (experiment_apis).
// Pure readers of the manifest, shared by the pipeline (schema registration),
// the experiment verifier (src/experiments/verify.js), reachability seeding, and
// the experiment-overrides-api check.
//
// Belongs here: extracting the declared API paths, the implementation file refs,
// and the bundle subtree root from experiment_apis. Does NOT belong here:
// detecting Experiment status (-> isExperiment in util.js), hashing/verifying
// the files (-> src/experiments/verify.js), or any verdict.

import { asArray, asObject } from "./util.js";

/** @typedef {import("../addon/load.js").Manifest} Manifest */

/**
 * The API path prefixes an experiment grafts onto, as dotted strings (e.g.
 * "calendar.items"). Taken from each entry's parent/child `paths` (arrays of
 * segment arrays). An entry with no `paths` falls back to its key.
 * @param {Manifest} manifest
 * @returns {string[]} Deduplicated dotted prefixes.
 */
export function experimentApiPaths(manifest) {
  const out = new Set();
  for (const [key, def] of Object.entries(
    asObject(manifest?.experiment_apis)
  )) {
    const d = asObject(def);
    const paths = [
      ...asArray(asObject(d.parent).paths),
      ...asArray(asObject(d.child).paths),
    ];
    let any = false;
    for (const segs of paths) {
      if (Array.isArray(segs) && segs.length) {
        out.add(segs.join("."));
        any = true;
      }
    }
    if (!any && key) {
      out.add(String(key));
    }
  }
  return [...out];
}

/**
 * The top-level API namespaces an add-on's Experiments expose, so the add-on's own
 * WebExtension code (browser|messenger|chrome.<namespace>.<method>(...)) resolves.
 * The AUTHORITATIVE source is each entry's bundled schema.json `namespace` field -
 * the manifest key and the binding `paths` are arbitrary and often differ from it
 * (e.g. key "qapp" exposes "qnote"; key "ExpressionSearchTools" binds path
 * "ExpressionSearch"). Falls back to the declared paths/key when an entry has no
 * readable bundled schema (an unsupported draft / a bare declaration).
 * @param {Manifest} manifest
 * @param {Map<string, Buffer>} [files]  The add-on's files, to read the schema(s).
 * @returns {Set<string>}
 */
export function experimentApiNamespaces(manifest, files) {
  const out = new Set();
  for (const [key, def] of Object.entries(
    asObject(manifest?.experiment_apis)
  )) {
    const fromSchema = schemaNamespaces(asObject(def).schema, files);
    const namespaces = fromSchema.length
      ? fromSchema
      : entryApiPaths(key, def).map((p) => p.split(".")[0]);
    for (const ns of namespaces) {
      if (ns) {
        out.add(ns);
      }
    }
  }
  return out;
}

/**
 * The top-level namespace(s) an experiment's bundled schema.json declares. A TB
 * schema is an array of namespace objects, each with a `namespace` field; the
 * schema-only `manifest` block (which declares manifest keys, not a callable API)
 * is excluded. Empty when the schema path is missing/unreadable/unparseable, so the
 * caller falls back to the manifest paths/key.
 * @param {unknown} schemaPath  The entry's `schema` (add-on-root-relative).
 * @param {Map<string, Buffer>} [files]
 * @returns {string[]}
 */
function schemaNamespaces(schemaPath, files) {
  if (typeof schemaPath !== "string" || !schemaPath || !files) {
    return [];
  }
  // Raw lookup, as the experiment verifier resolves its refs (src/experiments/
  // verify.js uses addon.files.has(ref)); a path that doesn't match is left to the
  // paths/key fallback.
  const buf = files.get(schemaPath);
  if (!buf) {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(buf.toString("utf8"));
  } catch {
    return [];
  }
  const out = [];
  for (const ns of asArray(parsed)) {
    const name = asObject(ns).namespace;
    if (typeof name === "string" && name) {
      const top = name.split(".")[0];
      if (top && top !== "manifest") {
        out.push(top);
      }
    }
  }
  return out;
}

/**
 * The top-level manifest keys an add-on's Experiments DECLARE via their bundled
 * schemas, so unrecognized-manifest-key must not flag them as unknown (the
 * developer's own experiment defines and reads them). Each comes from a
 * `namespace: "manifest"` block that `$extend`s WebExtensionManifest with extra
 * `properties` (e.g. the calendar experiment's "calendar_item_action").
 * @param {Manifest} manifest
 * @param {Map<string, Buffer>} [files]  The add-on's files, to read the schema(s).
 * @returns {Set<string>}
 */
export function experimentManifestKeys(manifest, files) {
  const out = new Set();
  for (const def of Object.values(asObject(manifest?.experiment_apis))) {
    for (const key of schemaManifestKeys(asObject(def).schema, files)) {
      out.add(key);
    }
  }
  return out;
}

/**
 * The manifest-key names one experiment's bundled schema declares: the
 * `properties` of any `namespace: "manifest"` type that `$extend`s
 * WebExtensionManifest. Empty when the schema path is missing/unreadable/
 * unparseable. Mirrors schemaNamespaces (which reads the SAME file's callable
 * namespaces and deliberately skips this manifest block).
 * @param {unknown} schemaPath  The entry's `schema` (add-on-root-relative).
 * @param {Map<string, Buffer>} [files]
 * @returns {string[]}
 */
function schemaManifestKeys(schemaPath, files) {
  if (typeof schemaPath !== "string" || !schemaPath || !files) {
    return [];
  }
  const buf = files.get(schemaPath);
  if (!buf) {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(buf.toString("utf8"));
  } catch {
    return [];
  }
  const out = [];
  for (const ns of asArray(parsed)) {
    if (asObject(ns).namespace !== "manifest") {
      continue;
    }
    for (const type of asArray(asObject(ns).types)) {
      const t = asObject(type);
      if (t.$extend === "WebExtensionManifest") {
        out.push(...Object.keys(asObject(t.properties)));
      }
    }
  }
  return out;
}

/** The `…/experiments/<seg>/` prefix of a path, or null. */
const EXP_ROOT_RE = /^(.*?\/experiments\/[^/]+\/)/;

/**
 * @typedef {object} ExperimentApisEntry  One experiment_apis entry value.
 * @property {string} [schema]  Add-on-root-relative schema file path.
 * @property {{script?: string, paths?: string[][]}} [parent]  Parent script and
 *   its grafted API paths (each path an array of segments).
 * @property {{script?: string, paths?: string[][]}} [child]  Child script and
 *   its grafted API paths (each path an array of segments).
 */

/**
 * @param {ExperimentApisEntry} def
 * @returns {string[]}
 */
function entryRefs(def) {
  const d = asObject(def);
  return [d.schema, asObject(d.parent).script, asObject(d.child).script].filter(
    (p) => typeof p === "string" && p
  );
}

/**
 * @param {string} key
 * @param {ExperimentApisEntry} def
 * @returns {string[]} dotted API paths.
 */
function entryApiPaths(key, def) {
  const d = asObject(def);
  const out = [];
  for (const segs of [
    ...asArray(asObject(d.parent).paths),
    ...asArray(asObject(d.child).paths),
  ]) {
    if (Array.isArray(segs) && segs.length) {
      out.push(segs.join("."));
    }
  }
  return out.length ? out : [String(key)];
}

/**
 * Common directory prefix (trailing "/") of paths, or "".
 * @param {string[]} paths
 * @returns {string}
 */
function commonDir(paths) {
  if (paths.length === 0) {
    return "";
  }
  const split = paths.map((r) => r.split("/").slice(0, -1));
  let common = split[0];
  for (const segs of split.slice(1)) {
    let i = 0;
    while (i < common.length && i < segs.length && common[i] === segs[i]) {
      i++;
    }
    common = common.slice(0, i);
  }
  return common.length ? common.join("/") + "/" : "";
}

/**
 * The experiment subtree root for one entry's refs: its `experiments/<seg>/`
 * prefix if present, else the common dir of its refs, else "".
 * @param {string[]} refs
 * @returns {string}
 */
function entryRoot(refs) {
  for (const r of refs) {
    const m = EXP_ROOT_RE.exec(r);
    if (m) {
      return m[1];
    }
  }
  return commonDir(refs);
}

/**
 * Group the manifest's experiment_apis entries into distinct experiments.
 * Entries whose files share an `experiments/<seg>/` subtree (the upstream
 * layout) are one experiment; an entry with no locatable files is its own group.
 * Each group: `{ root, name, apiNamespaces, entries: [{ key, apiPaths }] }`,
 * where `name` is the entries' top-level API namespace (e.g. "calendar"), and
 * `apiNamespaces` is the set of top-level segments the group declares (for the
 * recognised-name check).
 * @param {Manifest} manifest
 * @returns {{root: string, name: string, apiNamespaces: string[],
 *   entries: {key: string, apiPaths: string[], refs: string[]}[]}[]}
 */
export function experimentGroups(manifest) {
  const byKey = new Map();
  let refless = 0;
  for (const [key, def] of Object.entries(
    asObject(manifest?.experiment_apis)
  )) {
    const refs = entryRefs(def);
    const apiPaths = entryApiPaths(key, def);
    const root = entryRoot(refs);
    const groupKey = root || `\u0000${refless++}`; // ref-less entries stay separate
    let g = byKey.get(groupKey);
    if (!g) {
      g = { root, name: "", apiNamespaces: new Set(), entries: [] };
      byKey.set(groupKey, g);
    }
    g.entries.push({ key, apiPaths, refs });
    for (const p of apiPaths) {
      g.apiNamespaces.add(p.split(".")[0]);
    }
  }
  const groups = [];
  for (const g of byKey.values()) {
    const tops = [...g.apiNamespaces];
    const seg = g.root && /\/experiments\/([^/]+)\//.exec(g.root);
    groups.push({
      root: g.root,
      name: tops[0] || (seg && seg[1]) || g.entries[0]?.key || "experiment",
      apiNamespaces: tops,
      entries: g.entries,
    });
  }
  return groups;
}
