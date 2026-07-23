// Parses a manifest content_security_policy (string in MV2, object of named
// policies in MV3) and reports the two risk categories the remote-code checks
// care about: dynamic-code keywords ('unsafe-eval' / 'unsafe-inline') and
// remote script-source hosts. CSP has no ubiquitous parser to depend on, so
// directives are split on semicolons and whitespace, hosts detected by pattern.
//
// Belongs here: parsing the manifest CSP string/object and extracting its raw
// facts (unsafe-eval, unsafe-inline, remote script-src hosts).
//
// Does NOT belong here: deciding whether those facts are a problem and the
// reviewer-facing wording - that lives in the checks (src/checks/rules/*) and
// the registry (assets/registry.yaml). Classifying arbitrary URL strings
// as remote/local belongs to src/scan/url.js. Reading the manifest off disk
// belongs to src/addon/load.js.

/** @typedef {import("../addon/load.js").Manifest} Manifest */

/**
 * @param {Manifest} manifest  Parsed manifest.json.
 * @returns {{unsafeEval: boolean, unsafeInline: boolean, remoteHosts: string[]}}
 */
export function analyzeCsp(manifest) {
  const csp = manifest?.content_security_policy;
  const strings =
    typeof csp === "string"
      ? [csp]
      : csp && typeof csp === "object"
        ? Object.values(csp).filter((v) => typeof v === "string")
        : [];

  let unsafeEval = false;
  let unsafeInline = false;
  const hosts = new Set();
  for (const s of strings) {
    // 'unsafe-eval'/'unsafe-inline' only enable dynamic code execution when they
    // govern scripts - i.e. in script-src, or default-src as its fallback. The
    // same keyword in style-src (or any other directive) is style/asset policy,
    // not code execution, so scope the test (and the host scan) to that one
    // directive. Without a script-governing directive scripts use the platform
    // default (restrictive), so nothing is permitted.
    const directive = scriptDirective(s);
    if (!directive) {
      continue;
    }
    if (/'unsafe-eval'/i.test(directive)) {
      unsafeEval = true;
    }
    if (/'unsafe-inline'/i.test(directive)) {
      unsafeInline = true;
    }
    for (const host of hostsFrom(directive)) {
      hosts.add(host);
    }
  }
  return { unsafeEval, unsafeInline, remoteHosts: [...hosts] };
}

/**
 * The directive that governs script execution: script-src (or script-src-elem),
 * falling back to default-src when no script-src is present. Null when the policy
 * has neither (scripts then fall to the platform default).
 * @param {string} csp
 * @returns {string|null}
 */
function scriptDirective(csp) {
  const directives = csp
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean);
  return (
    directives.find((d) => /^script-src(-elem)?\b/i.test(d)) ||
    directives.find((d) => /^default-src\b/i.test(d)) ||
    null
  );
}

/**
 * Remote hosts allowed by a single CSP directive (the script directive).
 * @param {string} directive
 * @returns {string[]}
 */
function hostsFrom(directive) {
  const hosts = [];
  for (const token of directive.split(/\s+/).slice(1)) {
    if (token.startsWith("'")) {
      continue; // 'self' 'none' 'unsafe-*' nonce/sha
    }
    if (/^(data|blob|filesystem|mediastream):$/i.test(token)) {
      continue;
    }
    if (
      token.includes("://") ||
      token.startsWith("//") ||
      /[a-z0-9*]\.[a-z]{2,}/i.test(token)
    ) {
      hosts.push(token);
    }
  }
  return hosts;
}
