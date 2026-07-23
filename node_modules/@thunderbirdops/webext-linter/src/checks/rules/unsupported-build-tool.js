// Rejects a source-code submission whose build uses a package manager other than npm
// or pnpm. Only those two are supported: they share the .npmrc config format, keeping
// the reviewable build surface small (yarn's .yarnrc.yml / PnP / plugins / committed
// yarnPath binary and bun's runtime are a much larger surface). A disallowed manager
// is identified deterministically by its committed FINGERPRINT - a lockfile or the
// package.json "packageManager" field - so no LLM or network is needed. Pinning and
// the open-ended "undeclared source" review are owned by other checks
// (unpinned-dependency, undeclared-build-source).
//
// input: build - reads the SCA build corpus off ctx.addon. The build may run from a
// subfolder (cd frontend && npm ci), and selectScaBuildFiles keeps nested build files,
// so a fingerprint is matched by BASENAME at any depth, not just at the root. Only ONE
// finding is emitted (the tool policy is a single verdict).
//
// Belongs here: mapping a disallowed-tool fingerprint to a finding. Does NOT belong
// here: which files are in the build corpus (-> src/addon/load.js) or the wording
// (-> the registry).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { basename } from "../../util/files.js";

/** @typedef {import("../registry.js").RunContext} RunContext */

// Lockfile / config BASENAMES that name a DISALLOWED package manager (npm and pnpm are
// the only supported ones; their locks - package-lock.json / npm-shrinkwrap.json /
// pnpm-lock.yaml - are never listed here).
const DISALLOWED_BY_BASENAME = new Map([
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["bunfig.toml", "bun"],
]);

const SUPPORTED = new Set(["npm", "pnpm"]);

export default {
  /**
   * @param {RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    const files = ctx.addon?.files;
    if (!files) {
      return [];
    }
    // A committed lockfile / config (anywhere in the corpus) names its tool directly.
    for (const path of files.keys()) {
      const tool = DISALLOWED_BY_BASENAME.get(basename(path));
      if (tool) {
        return [reject(ctx, path, tool)];
      }
    }
    // Corepack's package.json "packageManager" field is an explicit declaration.
    for (const [path, buf] of files) {
      if (basename(path) !== "package.json") {
        continue;
      }
      const declared = packageManagerName(buf);
      if (declared && !SUPPORTED.has(declared)) {
        return [reject(ctx, path, declared)];
      }
    }
    return [];
  },
};

/**
 * The package manager named by package.json's "packageManager" field ("yarn@4.1.0" ->
 * "yarn"), lower-cased; null when the file/field is absent or unparseable.
 * @param {Buffer|undefined} buf  The package.json bytes.
 * @returns {?string}
 */
function packageManagerName(buf) {
  if (!buf) {
    return null;
  }
  try {
    const pm = JSON.parse(buf.toString("utf8")).packageManager;
    if (typeof pm !== "string") {
      return null;
    }
    return pm.split("@")[0].trim().toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * @param {RunContext} ctx
 * @param {string} file  The fingerprint file the finding anchors at.
 * @param {string} tool  The detected package manager (surfaced as {{item}}).
 * @returns {import("../../report/finding.js").Finding}
 */
function reject(ctx, file, tool) {
  ctx.note?.(file, null, `build uses ${tool}`, VERDICT.FAIL);
  return finding({ file, item: tool });
}
