// Deterministic trademark check on the add-on NAME. Mozilla's policy: "Firefox",
// "Mozilla", and "MZLA" are never allowed in the name, and "Thunderbird" only as
// the trailing "<name> for Thunderbird" form. All matching is case-insensitive.
// A localized __MSG__ name is resolved from _locales (which a deterministic
// check can read, unlike the LLM). The icon - the other trademark vector - is an
// image, so it is left to the manual-review list instead. This check returns
// Finding[] directly - it does not escalate.
//
// Belongs here: resolving the literal or __MSG__ name and matching it against
// the FORBIDDEN brand terms and the Thunderbird-suffix rule. Does NOT belong
// here: reporting a malformed locale file (skipped here - its JSON validity is
// out of this check's scope). The icon trademark vector, deferred to manual
// review by its registry entry. Authored wording -> assets/registry.yaml.
// Severity -> that registry entry, stamped by runChecks (src/checks/
// registry.js). Report formatting -> src/report/format.js.

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { manifestTokenLine } from "../../lib/util.js";

/** @typedef {import("../registry.js").RunContext} RunContext */
/** @typedef {import("../../addon/load.js").Addon} Addon */

// Brand terms never allowed anywhere in the name (lowercased needle -> label).
const FORBIDDEN = [
  ["firefox", "Firefox"],
  ["mozilla", "Mozilla"],
  ["mzla", "MZLA"],
];

export default {
  /**
   * @param {RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    // Registry `input: xpi`: ctx.addon is the built XPI. The displayed name - and a
    // __MSG_ placeholder's _locales resolution - are properties of what actually
    // ships (a source submission's _locales may be generated or live outside
    // --sca-source), so the name, its anchor line, and the _locales all come from
    // the XPI's own files.
    const { addon } = ctx;
    const name = ctx.manifest?.name;
    if (typeof name !== "string") {
      ctx.note?.("manifest.json", null, "no add-on name", VERDICT.SKIPPED);
      return [];
    }
    // Anchor every note/finding on the manifest's `name` property line.
    const text = ctx.manifestText;
    const line = manifestTokenLine(text, "name");
    const loc = line ? { line } : null;
    const candidates = resolveNames(name, addon);
    if (!candidates.length) {
      ctx.note?.(
        "manifest.json",
        loc,
        `${name} not resolvable`,
        VERDICT.SKIPPED
      );
      return [];
    }
    for (const candidate of candidates) {
      const term = trademarkTerm(candidate);
      if (term) {
        ctx.note?.("manifest.json", loc, `name uses "${term}"`, VERDICT.FAIL);
        return [finding({ file: "manifest.json", loc, item: candidate })];
      }
    }
    ctx.note?.("manifest.json", loc, `name "${name}"`, VERDICT.PASS);
    return [];
  },
};

/**
 * Names to check: the literal manifest name, or - for a __MSG_key__ placeholder
 * - the message resolved from every _locales/<locale>/messages.json.
 * @param {string} name
 * @param {Addon} addon
 * @returns {string[]}
 */
function resolveNames(name, addon) {
  const msg = /^__MSG_(.+)__$/.exec(name);
  if (!msg) {
    return [name];
  }
  const key = msg[1];
  const names = [];
  for (const [path, buf] of addon.files) {
    if (!/^_locales\/[^/]+\/messages\.json$/.test(path)) {
      continue;
    }
    let json;
    try {
      json = JSON.parse(buf.toString("utf8"));
    } catch {
      continue; // a malformed locale file is skipped (not this check's concern)
    }
    const value = json?.[key]?.message;
    if (typeof value === "string") {
      names.push(value);
    }
  }
  return names;
}

/**
 * The Mozilla trademark a name misuses, or null. Case-insensitive. "Firefox" /
 * "Mozilla" / "MZLA" are never allowed. "Thunderbird" only as the trailing
 * "<name> for Thunderbird".
 * @param {string} name
 * @returns {string|null}
 */
function trademarkTerm(name) {
  const lc = name.toLowerCase();
  for (const [needle, label] of FORBIDDEN) {
    if (lc.includes(needle)) {
      return label;
    }
  }
  const withoutSuffix = lc.replace(/\s+for\s+thunderbird\s*$/, "");
  if (withoutSuffix.includes("thunderbird")) {
    return "Thunderbird";
  }
  return null;
}
