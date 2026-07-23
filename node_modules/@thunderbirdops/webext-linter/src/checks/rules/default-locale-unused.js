// A default_locale manifest key requires a packaged _locales directory; without
// it Thunderbird refuses to load the add-on. Errors when default_locale is
// declared but no _locales directory is present, locating the default_locale
// line. The inverse (_locales with no default_locale) is
// default-locale-missing.js.
//
// Belongs here: the declared-default_locale / absent-_locales verdict and
// locating the default_locale line. Does NOT belong here: the _locales scan (->
// getLocales in src/lib/locales.js, memoized and shared with
// default-locale-missing), finding a manifest key's line (-> manifestTokenLine
// in src/lib/util.js), authored wording (-> assets/registry.yaml), and
// severity (-> that registry entry).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { getLocales } from "../../lib/locales.js";
import { manifestTokenLine } from "../../lib/util.js";

/** @typedef {import("../registry.js").RunContext} RunContext */

export default {
  /**
   * @param {RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    // Registry `input: xpi`: ctx.addon is the built XPI. default_locale <-> _locales
    // is a property of what actually ships (a source submission's _locales may be
    // generated or live outside --sca-source), so both the manifest and the _locales
    // scan read the XPI.
    const manifest = ctx.manifest;
    if (!manifest) {
      ctx.note?.(
        "manifest.json",
        null,
        "manifest did not parse",
        VERDICT.SKIPPED
      );
      return [];
    }
    if (!manifest.default_locale) {
      ctx.note?.("manifest.json", null, "no default_locale", VERDICT.SKIPPED);
      return [];
    }
    if (getLocales(ctx).hasLocales) {
      ctx.note?.(
        "manifest.json",
        null,
        "_locales directory present",
        VERDICT.PASS
      );
      return [];
    }
    const text = ctx.manifestText;
    const line = manifestTokenLine(text, "default_locale");
    const loc = line ? { line, column: 0 } : null;
    ctx.note?.(
      "manifest.json",
      loc,
      "default_locale without _locales",
      VERDICT.FAIL
    );
    return [finding({ file: "manifest.json", loc })];
  },
};
