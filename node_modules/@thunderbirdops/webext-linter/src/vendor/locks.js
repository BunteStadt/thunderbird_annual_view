// Resolves the exact installed version of a dependency from the project's lock
// file, so a package.json range (e.g. "^3.10.0") can still be pinned to the one
// version that was actually used. Reads whichever lock the submission ships:
// npm (package-lock.json / npm-shrinkwrap.json, JSON), pnpm (pnpm-lock.yaml,
// YAML), or yarn (yarn.lock - v1's custom format or berry's YAML).
//
// Belongs here: lockedVersion(addon, name) and the per-format readers. Does NOT
// belong here: reading package.json itself or deciding pinned/unpinned (->
// src/vendor/resolve.js), and the verification that follows (-> verify.js).

import YAML from "yaml";

/** @typedef {import("../addon/load.js").Addon} Addon */

/**
 * The exact version a lock file pins `name` to, or null if no lock present
 * resolves it. Tries npm, then pnpm, then yarn.
 * @param {Addon} addon
 * @param {string} name  The npm package name (may be scoped, "@scope/pkg").
 * @returns {?string}
 */
export function lockedVersion(addon, name) {
  const files = addon?.files;
  if (!files) {
    return null;
  }
  /** @param {string} n @returns {string|undefined} */
  const read = (n) => files.get(n)?.toString("utf8");
  return (
    npmLock(read("package-lock.json") ?? read("npm-shrinkwrap.json"), name) ??
    pnpmLock(read("pnpm-lock.yaml"), name) ??
    yarnLock(read("yarn.lock"), name)
  );
}

/**
 * @param {?string} text  package-lock.json / npm-shrinkwrap.json contents.
 * @param {string} name
 * @returns {?string}
 */
function npmLock(text, name) {
  if (!text) {
    return null;
  }
  try {
    const data = JSON.parse(text);
    // lockfileVersion 2/3: the hoisted entry under "node_modules/<name>".
    const pkg = data.packages?.[`node_modules/${name}`];
    if (pkg?.version) {
      return pkg.version;
    }
    // lockfileVersion 1: dependencies tree.
    const dep = data.dependencies?.[name];
    return dep?.version ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {?string} text  pnpm-lock.yaml contents.
 * @param {string} name
 * @returns {?string}
 */
function pnpmLock(text, name) {
  if (!text) {
    return null;
  }
  try {
    const data = YAML.parse(text);
    const root = data?.importers?.["."] ?? data;
    const entry = root?.dependencies?.[name] ?? root?.devDependencies?.[name];
    const version = typeof entry === "string" ? entry : entry?.version;
    if (version) {
      return cleanVersion(version);
    }
    // Fallback: a "/<name>@<version>" or "/<name>/<version>" packages key.
    for (const key of Object.keys(data?.packages ?? {})) {
      const m = key.match(/^\/?(@?[^@/]+(?:\/[^@/]+)?)[@/]([0-9][^()/]*)/);
      if (m && m[1] === name) {
        return cleanVersion(m[2]);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * @param {?string} text  yarn.lock contents (v1 custom format or berry YAML).
 * @param {string} name
 * @returns {?string}
 */
function yarnLock(text, name) {
  if (!text) {
    return null;
  }
  // Berry (v2+) is YAML with a __metadata key.
  if (/^__metadata:/m.test(text)) {
    try {
      const data = YAML.parse(text);
      for (const [key, value] of Object.entries(data ?? {})) {
        if (
          key !== "__metadata" &&
          keyNamesPackage(key, name) &&
          value?.version
        ) {
          return cleanVersion(String(value.version));
        }
      }
    } catch {
      return null;
    }
    return null;
  }
  // Yarn v1: top-level "<keys>:" header lines, then an indented `version "x"`.
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      !line ||
      line.startsWith("#") ||
      /^\s/.test(line) ||
      !line.endsWith(":")
    ) {
      continue;
    }
    const matches = line
      .slice(0, -1)
      .split(",")
      .some((k) => keyNamesPackage(k.trim().replace(/^"|"$/g, ""), name));
    for (let j = i + 1; j < lines.length && /^\s/.test(lines[j]); j++) {
      const v = lines[j].match(/^\s+version:?\s+"?([^"\s]+)"?/);
      if (matches && v) {
        return cleanVersion(v[1]);
      }
    }
  }
  return null;
}

/**
 * Whether a yarn lock key (e.g. `name@^1.0.0` or `name@npm:^1.0.0`) is for
 * package `name`.
 * @param {string} key @param {string} name
 * @returns {boolean}
 */
function keyNamesPackage(key, name) {
  return key.startsWith(`${name}@`);
}

/**
 * Strip a pnpm/berry version suffix (a peer-deps "(...)" tail) down to the bare
 * semver.
 * @param {string} version
 * @returns {string}
 */
function cleanVersion(version) {
  return version.replace(/\(.*$/, "").trim();
}
