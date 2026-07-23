// SchemaIndex - turns the raw annotated-schema JSON files into queryable
// structures:
//
//   - a namespace registry (dotted name -> merged {functions, events,
//     properties, permissions}) so we can resolve a browser.* / messenger.*
//     / chrome.* usage,
//   - a global type registry keyed "<namespace>.<id>" with all `$extend`
//     additions merged in (this is how permission enums and manifest keys
//     are spread across files),
//   - the flattened set of valid permission strings and valid top-level
//     manifest keys,
//   - the target Thunderbird applicationVersion for version_added
//     comparisons.
//
// The structural merging itself lives in merge.js. The model mirrors
// thunderbird/webext-docs-generator (global types keyed "<namespace>.<id>",
// $extend targeting "manifest.<type>", version_added inside annotations[]).
//
// Belongs here: the SchemaIndex query API the rest of the app consults -
// resolveApi/resolveRef, requiredPermissions, validPermissions,
// permissionWebApis, validManifestKeys, manifestKeyPermissions,
// manifestVersionMajor, fileLoaderMethods, and the static annotation helpers
// (versionAdded, deprecation, isUnsupported, docUrl). It consumes the parsed
// files and calls merge.js to build its registries.
//
// Does NOT belong here: the merge algorithm itself (src/schema/merge.js),
// fetching or reading files (src/schema/fetch.js and src/schema/load.js), ajv
// JSON-Schema derivation (src/schema/json-schema.js), and any review or
// detection logic, which belongs in the checks (src/checks/rules/*).

import { debug } from "../util/log.js";
import { mergeNamespace, mergeExtension } from "./merge.js";

// Permission container types (in the manifest namespace) whose union forms
// the set of valid named permissions an add-on may declare.
const PERMISSION_TYPES = [
  "Permission",
  "PermissionNoPrompt",
  "PermissionPrivileged",
  "OptionalPermission",
  "OptionalPermissionNoPrompt",
  "OptionalOnlyPermission",
  "OptionalPermissionOrOrigin",
  "PermissionOrOrigin",
];

const DATA_COLLECTION_TYPES = [
  "DataCollectionPermission",
  "OptionalDataCollectionPermission",
  "CommonDataCollectionPermission",
];

const MANIFEST_KEY_TYPES = ["ManifestBase", "WebExtensionManifest"];

// String formats that mark a value as an extension-relative path (a packaged
// file the runtime loads), as opposed to a generic/remote "url". A function
// parameter that transitively contains one is treated as a file-loader API.
// Exported so the loader extractor can recognize the same leaf format when it
// walks a call's arguments against this schema's parameter types.
export const REL_URL_FORMATS = new Set([
  "relativeUrl",
  "strictRelativeUrl",
  "imageDataOrStrictRelativeUrl",
  "unresolvedRelativeUrl",
]);

/**
 * A node in the annotated WebExtension schema graph - a namespace object, a
 * type, a function, an event, a property, or a parameter. The schema is sparse,
 * so every field is optional and the resolver/merge code reads only the ones a
 * given node actually carries.
 * @typedef {object} SchemaNode
 * @property {string} [id]  Type id (base types register as "<namespace>.<id>").
 * @property {string} [name]  Member name (functions, events).
 * @property {string} [namespace]  Namespace name (top-level objects).
 * @property {string} [$ref]  Reference to another type.
 * @property {string} [$extend]  Manifest type this node extends.
 * @property {string} [type]  JSON-schema kind such as string, object, array.
 * @property {string} [format]  String format (see REL_URL_FORMATS).
 * @property {(string|number)[]} [enum]  Enumerated values.
 * @property {SchemaNode[]} [choices]  Union alternatives.
 * @property {SchemaNode} [items]  Array element type.
 * @property {Record<string, SchemaNode>} [properties]  Object properties.
 * @property {SchemaNode[]} [types]  Types declared on a namespace object.
 * @property {SchemaNode[]} [functions]  Namespace/type functions.
 * @property {SchemaNode[]} [events]  Namespace/type events.
 * @property {SchemaNode[]} [parameters]  Function parameters.
 * @property {string[]} [permissions]  Permissions the API requires.
 * @property {Annotation[]} [annotations]  version_added / deprecated / doc URLs.
 * @property {string} [applicationVersion]  Target app version (top-level).
 * @property {string|boolean} [deprecated]  Deprecation message or flag.
 * @property {boolean} [unsupported]  Marks an API as unsupported.
 */

/**
 * One entry in a schema node's `annotations[]`.
 * @typedef {object} Annotation
 * @property {string|boolean} [version_added]  Version the API first appeared in;
 *   `false` marks it unsupported in this app, `true`/`"≤N"` mean baseline.
 * @property {string|boolean} [deprecated]  Deprecation message or flag.
 * @property {boolean} [unsupported]  Unsupported flag.
 * @property {string} [api_documentation_url]  Thunderbird API doc URL.
 * @property {string} [mdn_documentation_url]  MDN doc URL.
 */

/**
 * Any JSON value the structural merge (merge.js) walks over: a primitive, an
 * array, or an object. The merge helpers classify and compare values
 * generically, so they are value-typed rather than tied to one node shape.
 * @typedef {Record<string, JsonValue>} JsonObject
 * @typedef {string|number|boolean|null|JsonValue[]|JsonObject} JsonValue
 */

export class SchemaIndex {
  /**
   * @param {Record<string, SchemaNode[]>} files  Map "<name>.json" -> parsed
   *   JSON array of namespace objects.
   */
  constructor(files) {
    this.files = files;
    /** @type {Map<string, SchemaNode>} namespace name -> merged namespace */
    this.namespaces = new Map();
    /** @type {Map<string, SchemaNode>} "<namespace>.<id>" -> merged type */
    this.globalTypes = new Map();
    /** @type {Set<string>} "<namespace>.<method>" of file-loading functions */
    this.fileLoaderMethods = new Set();
    /** @type {Set<string>} base API namespaces a valid Experiment adds (e.g.
     * "calendar"); filled by registerExperimentNamespaces, consulted by
     * resolveApi (via longest-prefix match) to mark the namespace and everything
     * under it as known. */
    this.experimentNamespaces = new Set();
    this.applicationVersion = null;

    this._build();
  }

  _build() {
    // Flatten every top-level namespace object across all files.
    const objects = [];
    for (const [file, data] of Object.entries(this.files)) {
      if (!Array.isArray(data)) {
        continue;
      }
      for (const obj of data) {
        objects.push({ file, obj });
        if (obj.applicationVersion) {
          // Last one wins (matches docs-generator's .pop()).
          this.applicationVersion = obj.applicationVersion;
        }
      }
    }

    // Pass 1: register all base types (those carrying an id) as
    // "<namespace>.<id>".
    for (const { obj } of objects) {
      const ns = obj.namespace;
      for (const type of obj.types || []) {
        if (type.id) {
          const key = `${ns}.${type.id}`;
          this.globalTypes.set(key, structuredClone(type));
        }
      }
    }

    // Pass 2: apply $extend additions. Per the docs generator, $extend targets
    // a type in the manifest namespace ("manifest.<extend>").
    for (const { obj } of objects) {
      for (const type of obj.types || []) {
        const extend = type.$extend;
        if (!extend) {
          continue;
        }
        const key = `manifest.${extend}`;
        const existing = this.globalTypes.get(key) || { id: extend };
        this.globalTypes.set(key, mergeExtension(existing, type));
      }
    }

    // Pass 3: build the namespace registry (everything except the "manifest"
    // pseudo-namespace, which only carries types/permission extensions).
    for (const { obj } of objects) {
      const name = obj.namespace;
      if (!name || name === "manifest") {
        continue;
      }
      const merged = this.namespaces.get(name) || {
        namespace: name,
        functions: [],
        events: [],
        properties: {},
        permissions: [],
        annotations: [],
        deprecated: undefined,
        unsupported: undefined,
      };
      mergeNamespace(merged, obj);
      this.namespaces.set(name, merged);
    }

    // Derived sets.
    this.validPermissions = this._collectEnumStrings(PERMISSION_TYPES);
    this.dataCollectionPermissions = this._collectEnumStrings(
      DATA_COLLECTION_TYPES
    );
    this.permissionWebApis = this._collectPermissionWebApis();
    this.validManifestKeys = this._collectManifestKeys();
    this.manifestKeyPermissions = this._collectManifestKeyPermissions();
    this.manifestVersionMajor = this._detectManifestVersion();
    this.fileLoaderMethods = this._collectFileLoaderMethods();

    debug(
      `SchemaIndex: ${this.namespaces.size} namespaces, ` +
        `${this.globalTypes.size} types, ${this.validPermissions.size} permissions, ` +
        `appVersion=${this.applicationVersion}`
    );
  }

  // ---- Type resolution.

  /**
   * Resolve a $ref string to a type, trying bare, manifest-qualified, then
   * any prefix.
   * @param {string} ref  The $ref value to look up.
   * @returns {?SchemaNode} The resolved type object, or null if not found.
   */
  resolveRef(ref) {
    if (this.globalTypes.has(ref)) {
      return this.globalTypes.get(ref);
    }
    if (this.globalTypes.has(`manifest.${ref}`)) {
      return this.globalTypes.get(`manifest.${ref}`);
    }
    // Fall back to a suffix match across known prefixes (e.g. "types.Setting").
    for (const [key, type] of this.globalTypes) {
      if (key.endsWith(`.${ref}`)) {
        return type;
      }
    }
    return null;
  }

  /**
   * Recursively collect every enum string reachable from the named manifest
   * types.
   * @param {string[]} typeNames  Names of manifest types to start from.
   * @returns {Set<string>} All reachable enum string values.
   */
  _collectEnumStrings(typeNames) {
    const out = new Set();
    const seen = new Set();
    /** @param {SchemaNode} type  Schema type node to visit. */
    const visit = (type) => {
      if (!type || typeof type !== "object") {
        return;
      }
      if (Array.isArray(type.enum)) {
        for (const v of type.enum) {
          if (typeof v === "string") {
            out.add(v);
          }
        }
      }
      for (const choice of type.choices || []) {
        visit(choice);
      }
      if (type.$ref) {
        const key = type.$ref;
        if (!seen.has(key)) {
          seen.add(key);
          visit(this.resolveRef(key));
        }
      }
    };
    for (const name of typeNames) {
      visit(this.globalTypes.get(`manifest.${name}`));
    }
    return out;
  }

  /**
   * Collect the Web/DOM-API grounding for permissions the schema annotates but
   * cannot gate through a browser.* member: a permission enum value may carry a
   * `web_api` annotation naming the navigator.* calls that consume it
   * (e.g. clipboardRead -> navigator.clipboard.read/readText). Used by the
   * unused-permission grounding to prove such a permission is in use. Empty when
   * the schema carries no such annotation.
   * @returns {Map<string, {receiver: string, methods: string[]}[]>}  Permission
   *   name -> its Web/DOM-API signatures.
   */
  _collectPermissionWebApis() {
    const out = new Map();
    const seen = new Set();
    /** @param {SchemaNode} type  Schema type node to visit. */
    const visit = (type) => {
      if (!type || typeof type !== "object") {
        return;
      }
      for (const value of Array.isArray(type.enum) ? type.enum : []) {
        if (typeof value !== "string" || out.has(value)) {
          continue;
        }
        const annotations = type.enums?.[value]?.annotations ?? [];
        const webApi = annotations
          .map((a) => a?.additional_properties?.web_api)
          .find(Array.isArray);
        if (webApi) {
          out.set(value, webApi);
        }
      }
      for (const choice of type.choices || []) {
        visit(choice);
      }
      if (type.$ref && !seen.has(type.$ref)) {
        seen.add(type.$ref);
        visit(this.resolveRef(type.$ref));
      }
    };
    for (const name of PERMISSION_TYPES) {
      visit(this.globalTypes.get(`manifest.${name}`));
    }
    return out;
  }

  /**
   * Functions that take an extension-relative file path as a parameter, i.e.
   * APIs that load a packaged file (content/message-display/compose script
   * registration, setIcon, theme images, windows.create, ...). Derived so the
   * reachability graph need not hardcode them. Keyed "<namespace>.<method>" to
   * match the dotted call path. APIs typed as a plain string / generic "url"
   * (e.g. runtime.getURL) carry no marker and are not derivable here.
   * @returns {Set<string>}
   */
  _collectFileLoaderMethods() {
    const out = new Set();
    for (const ns of this.namespaces.values()) {
      for (const fn of ns.functions || []) {
        const params = fn.parameters || [];
        if (params.some((p) => this._hasPathLeaf(p, new Set()))) {
          out.add(`${ns.namespace}.${fn.name}`);
        }
      }
    }
    return out;
  }

  /**
   * True if a parameter/type tree contains a string leaf with an
   * extension-relative-url format (resolving $refs, with a cycle guard).
   * @param {SchemaNode} type  A schema type node.
   * @param {Set<string>} seen  Visited $refs (cycle guard).
   * @returns {boolean}
   */
  _hasPathLeaf(type, seen) {
    if (!type || typeof type !== "object") {
      return false;
    }
    if (typeof type.format === "string" && REL_URL_FORMATS.has(type.format)) {
      return true;
    }
    if (type.$ref) {
      if (seen.has(type.$ref)) {
        return false;
      }
      seen.add(type.$ref);
      if (this._hasPathLeaf(this.resolveRef(type.$ref), seen)) {
        return true;
      }
    }
    for (const choice of type.choices || []) {
      if (this._hasPathLeaf(choice, seen)) {
        return true;
      }
    }
    if (type.items && this._hasPathLeaf(type.items, seen)) {
      return true;
    }
    for (const prop of Object.values(type.properties || {})) {
      if (this._hasPathLeaf(prop, seen)) {
        return true;
      }
    }
    return false;
  }

  _collectManifestKeys() {
    const keys = new Set();
    for (const name of MANIFEST_KEY_TYPES) {
      const type = this.globalTypes.get(`manifest.${name}`);
      for (const key of Object.keys(type?.properties || {})) {
        keys.add(key);
      }
    }
    return keys;
  }

  /**
   * @typedef {object} RequiredPermissionEntry  One `required_permissions`
   *   annotation on a manifest-key property, with its optional strict-version
   *   bound (so a version-dependent requirement is several entries the grounding
   *   version-filters).
   * @property {string[]} permissions  The permissions this entry requires.
   * @property {?string} minStrictVersion  Inclusive lower Thunderbird bound, or null.
   * @property {?string} maxStrictVersion  Inclusive upper Thunderbird bound, or null.
   */

  /**
   * Manifest keys that require a permission, read from `required_permissions`
   * annotations on the key's property (e.g. compose_scripts -> compose,
   * message_display_scripts -> messagesModify [+ scripting before 154]). This is
   * the script-injection channel the browser.* API gate never covers - Gecko does
   * not enforce it, but the annotation records it and the grounding consumes it.
   * Each annotation object becomes ONE entry, carrying its own
   * `min_strict_version`/`max_strict_version` bound (so a version-dependent
   * requirement is several entries); the grounding version-filters them. A key with
   * no such annotation never appears here.
   * @returns {Map<string, RequiredPermissionEntry[]>}  Manifest key -> entries.
   */
  _collectManifestKeyPermissions() {
    const out = new Map();
    for (const name of MANIFEST_KEY_TYPES) {
      const type = this.globalTypes.get(`manifest.${name}`);
      for (const [key, prop] of Object.entries(type?.properties || {})) {
        const entries = [];
        for (const a of prop?.annotations ?? []) {
          const req = a?.additional_properties?.required_permissions;
          if (!Array.isArray(req)) {
            continue;
          }
          const permissions = req.filter((p) => typeof p === "string");
          if (!permissions.length) {
            continue;
          }
          entries.push({
            permissions,
            minStrictVersion: a.min_strict_version ?? null,
            maxStrictVersion: a.max_strict_version ?? null,
          });
        }
        if (entries.length) {
          out.set(key, entries);
        }
      }
    }
    return out;
  }

  _detectManifestVersion() {
    // The manifest_version property enum in ManifestBase tells us the supported
    // MV.
    const base = this.globalTypes.get("manifest.ManifestBase");
    const mv = base?.properties?.manifest_version;
    const en = mv?.enum || mv?.choices?.flatMap((c) => c.enum || []);
    if (Array.isArray(en) && en.length) {
      return Math.max(...en.filter((n) => typeof n === "number"));
    }
    return null;
  }

  // ---- API usage resolution.

  /**
   * @typedef {object} ApiResolution
   * @property {"root"|"namespace"|"function"|"event"|"property"|
   *            "unknown-member"|"unknown-namespace"} kind  Resolution kind.
   * @property {string} [namespace]  Matched namespace name.
   * @property {string} [member]  Matched member name.
   * @property {SchemaNode} [def]  Schema definition for the member.
   * @property {SchemaNode} [namespaceDef]  Merged namespace object.
   */

  /**
   * Resolve an API access path (the segments after the browser/messenger/chrome
   * root). Walks past a property into its `$ref`/inline type so deeper members
   * are validated too, e.g. browser.storage.local.get resolves the `get`
   * function on the StorageArea type, and browser.storage.local.bogus is
   * reported as unknown. Descent stops (and the access is accepted) once a type
   * cannot be resolved or does not enumerate members, to avoid false positives.
   * @param {string[]} pathSegments  e.g. ["messages","tags","list"]
   * @returns {ApiResolution} Resolution result.
   */
  resolveApi(pathSegments) {
    if (pathSegments.length === 0) {
      return { kind: "root" };
    }
    // Longest matching namespace prefix wins (handles dotted sub-namespaces).
    // A real API always takes precedence over an experiment registration, so an
    // experiment grafting onto a built-in namespace does NOT mask it here (that
    // collision is flagged by the experiment-overrides-api check).
    for (let n = pathSegments.length; n >= 1; n--) {
      const nsName = pathSegments.slice(0, n).join(".");
      const ns = this.namespaces.get(nsName);
      if (ns) {
        return this._resolveMembers(ns, nsName, pathSegments, n);
      }
    }
    // No real namespace matched: a path under a registered experiment prefix is
    // a genuinely-new experiment API - known, not unknown.
    const exp = this._matchExperiment(pathSegments);
    if (exp) {
      return { kind: "experiment", namespace: exp };
    }
    return { kind: "unknown-namespace", namespace: pathSegments[0] };
  }

  /**
   * Register the dotted API prefixes a valid Experiment declares (e.g.
   * "calendar.items"), so resolveApi treats genuinely-new experiment APIs as
   * known rather than unknown.
   * @param {string[]} prefixes
   */
  registerExperimentNamespaces(prefixes) {
    for (const p of prefixes) {
      if (p) {
        this.experimentNamespaces.add(p);
      }
    }
  }

  /**
   * The longest registered experiment prefix that `segments` falls under, or
   * null.
   * @param {string[]} segments
   * @returns {?string}
   */
  _matchExperiment(segments) {
    if (this.experimentNamespaces.size === 0) {
      return null;
    }
    for (let n = segments.length; n >= 1; n--) {
      const name = segments.slice(0, n).join(".");
      if (this.experimentNamespaces.has(name)) {
        return name;
      }
    }
    return null;
  }

  /**
   * Walk the segments after a matched namespace, descending through property
   * types. `ns` is the top namespace object, always returned as namespaceDef
   * (with nsName as namespace) so namespace-level facts still apply to deep
   * members: version_added/deprecation/unsupported read namespaceDef, and
   * requiredPermissions resolves namespace-level permissions from namespace.
   * @param {SchemaNode} ns  Matched top namespace object.
   * @param {string} nsName  Matched namespace name.
   * @param {string[]} segments  Full path segments.
   * @param {number} start  Index of the first segment after the namespace.
   * @returns {ApiResolution}
   */
  _resolveMembers(ns, nsName, segments, start) {
    if (start >= segments.length) {
      return {
        kind: "namespace",
        namespace: nsName,
        member: undefined,
        def: ns,
        namespaceDef: ns,
      };
    }
    let ctx = ns; // current lookup context: a namespace or a resolved type.
    let ctxName = nsName; // deepest resolved context name, for diagnostics.
    for (let i = start; i < segments.length; i++) {
      const seg = segments[i];
      const member = segments.slice(start, i + 1).join(".");
      const fn = (ctx.functions || []).find((f) => f.name === seg);
      if (fn) {
        return {
          kind: "function",
          namespace: nsName,
          member,
          def: fn,
          namespaceDef: ns,
        };
      }
      const ev = (ctx.events || []).find((e) => e.name === seg);
      if (ev) {
        return {
          kind: "event",
          namespace: nsName,
          member,
          def: ev,
          namespaceDef: ns,
        };
      }
      const props = ctx.properties || {};
      if (Object.prototype.hasOwnProperty.call(props, seg)) {
        const propDef = props[seg];
        const type = this._propertyType(propDef);
        // More segments follow and the property has a type with its own
        // members: descend and keep validating.
        if (i < segments.length - 1 && this._hasMembers(type)) {
          ctx = type;
          ctxName = `${ctxName}.${seg}`;
          continue;
        }
        return {
          kind: "property",
          namespace: nsName,
          member: segments.slice(start).join("."),
          def: propDef,
          namespaceDef: ns,
        };
      }
      // The context exists but does not define this segment.
      return {
        kind: "unknown-member",
        namespace: ctxName,
        member: seg,
        namespaceDef: ns,
      };
    }
    return { kind: "namespace", namespace: nsName, def: ns, namespaceDef: ns };
  }

  /**
   * Resolve the type object a property points at, via `$ref` or an inline type.
   * @param {SchemaNode} propDef  A property definition from a namespace/type.
   * @returns {?SchemaNode} The resolved type object, or null if none.
   */
  _propertyType(propDef) {
    if (!propDef || typeof propDef !== "object") {
      return null;
    }
    if (propDef.$ref) {
      return this.resolveRef(propDef.$ref);
    }
    if (this._hasMembers(propDef)) {
      return propDef;
    }
    return null;
  }

  /**
   * True if a type/namespace object enumerates members we can validate against
   * (functions, events, or properties).
   * @param {SchemaNode} type  A type or namespace object.
   * @returns {boolean}
   */
  _hasMembers(type) {
    return Boolean(
      type &&
      ((type.functions && type.functions.length) ||
        (type.events && type.events.length) ||
        (type.properties && Object.keys(type.properties).length))
    );
  }

  /**
   * Permissions required to use a given resolved API (namespace + member
   * function). A nested namespace is gated by its ancestors' permissions too -
   * the runtime only exposes browser.a.b when the permission gating each
   * namespace along the path (a, then a.b) is held - so this unions permissions
   * across every dotted prefix, not just the deepest matched namespace (which is
   * all resolution.namespaceDef holds).
   * @param {ApiResolution} resolution  Resolved API object from resolveApi.
   * @returns {string[]} List of required permission strings.
   */
  requiredPermissions(resolution) {
    const perms = new Set();
    const nsName = resolution.namespace;
    if (nsName) {
      const parts = nsName.split(".");
      for (let n = 1; n <= parts.length; n++) {
        const ns = this.namespaces.get(parts.slice(0, n).join("."));
        for (const p of ns?.permissions || []) {
          perms.add(p);
        }
      }
    }
    for (const p of resolution.def?.permissions || []) {
      perms.add(p);
    }
    return [...perms];
  }

  /**
   * The `note` annotations on a resolved API member (e.g. "tabs.query"), each with
   * its optional strict-version bound - the dual-purpose doc/review notes a
   * `{{note:<member>}}` recheck-prompt placeholder pulls in (version-filtered by the
   * caller). Empty when the member or its notes are absent.
   * @param {string} path  Dotted member path after the browser/messenger root.
   * @returns {{note: string, minStrictVersion: ?string, maxStrictVersion: ?string}[]}
   */
  memberNotes(path) {
    const res = this.resolveApi(path.split("."));
    return (res?.def?.annotations ?? [])
      .filter((a) => a && typeof a.note === "string")
      .map((a) => ({
        note: a.note,
        minStrictVersion: a.min_strict_version ?? null,
        maxStrictVersion: a.max_strict_version ?? null,
      }));
  }

  // ---- Annotation helpers.

  static versionAdded(def) {
    const a = def?.annotations?.find(
      (x) => typeof x.version_added === "string"
    );
    return a ? a.version_added : null;
  }

  static deprecation(def) {
    if (def?.deprecated !== undefined && def.deprecated !== false) {
      return def.deprecated; // string message or true
    }
    const a = def?.annotations?.find((x) => x.deprecated !== undefined);
    return a ? a.deprecated : null;
  }

  /**
   * An API is unsupported when explicitly flagged, or when the schema annotates
   * its introduction as `version_added: false` - the schemas carry no
   * `unsupported` key, so `false` (the observed quirk `"false"` too) is how a
   * documented-but-unavailable Firefox API is marked in Thunderbird.
   * @param {SchemaNode} def  The merged schema definition for the API.
   * @returns {boolean}
   */
  static isUnsupported(def) {
    if (def?.unsupported === true) {
      return true;
    }
    return Boolean(
      def?.annotations?.some(
        (x) => x.version_added === false || x.version_added === "false"
      )
    );
  }

  static docUrl(def) {
    const a = def?.annotations?.find(
      (x) => x.api_documentation_url || x.mdn_documentation_url
    );
    return a ? a.api_documentation_url || a.mdn_documentation_url : null;
  }

  get applicationVersionMajor() {
    if (!this.applicationVersion) {
      return null;
    }
    const m = String(this.applicationVersion).match(/^(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }
}

/**
 * Build a SchemaIndex from loaded schema files.
 * @param {{files: Record<string, SchemaNode[]>}} loaded
 */
export function buildSchemaIndex(loaded) {
  return new SchemaIndex(loaded.files);
}
