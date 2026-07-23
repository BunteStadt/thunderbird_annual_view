// The add-on's _locales state, scanned once and shared. Both the
// default-locale-missing and default-locale-unused checks read this one result,
// so the file scan runs a single time per review - the same "compute once,
// checks read it" pattern as addon.outboundSinks / addon.bundled.
//
// Belongs here: getLocales - collecting the _locales/<lang> directories present
// in the package and memoizing the result on the addon.
//
// Does NOT belong here: the verdicts (-> src/checks/rules/default-locale-*.js),
// the English-localization judgement (-> missing-english-localization.js, which
// computes the same dir set inline and could later adopt this helper), and the
// authored wording (-> assets/registry.yaml).

/** @typedef {import("../checks/registry.js").RunContext} RunContext */

/**
 * The add-on's _locales directories, scanned once and memoized on the addon so
 * every check shares the result.
 * @param {RunContext} ctx
 * @returns {{dirs: Set<string>, hasLocales: boolean}}
 */
export function getLocales(ctx) {
  return (ctx.addon.locales ??= scan(ctx));
}

/**
 * @param {RunContext} ctx
 * @returns {{dirs: Set<string>, hasLocales: boolean}}
 */
function scan(ctx) {
  const dirs = new Set();
  for (const p of ctx.addon?.files?.keys() ?? []) {
    if (p.startsWith("_locales/")) {
      const lang = p.split("/")[1];
      if (lang) {
        dirs.add(lang);
      }
    }
  }
  return { dirs, hasLocales: dirs.size > 0 };
}
