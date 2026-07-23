// A packaged _locales directory requires a default_locale manifest key; without
// it Thunderbird refuses to load the add-on. Errors when _locales is present but
// default_locale is absent. The inverse (default_locale with no _locales) is
// default-locale-unused.js.
//
// Belongs here: the present-_locales / absent-default_locale verdict. Does NOT
// belong here: the _locales scan (-> getLocales in src/lib/locales.js,
// memoized and shared with default-locale-unused), authored wording (->
// assets/registry.yaml), and severity (-> that registry entry).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { getLocales } from "../../lib/locales.js";

/** @typedef {import("../registry.js").RunContext} RunContext */

export default {
  /**
   * @param {RunContext} ctx
   * @returns {import("../../report/finding.js").Finding[]}
   */
  run(ctx) {
    // Registry `input: xpi`: ctx.addon is the built XPI. _locales <-> default_locale
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
    if (!getLocales(ctx).hasLocales) {
      ctx.note?.(
        "manifest.json",
        null,
        "no _locales directory",
        VERDICT.SKIPPED
      );
      return [];
    }
    if (manifest.default_locale) {
      ctx.note?.(
        "manifest.json",
        null,
        "default_locale declared",
        VERDICT.PASS
      );
      return [];
    }
    ctx.note?.(
      "manifest.json",
      null,
      "_locales without default_locale",
      VERDICT.FAIL
    );
    return [finding({ file: "manifest.json" })];
  },
};
