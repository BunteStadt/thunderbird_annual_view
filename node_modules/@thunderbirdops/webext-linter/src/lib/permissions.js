// Shared permission analysis for the missing-permission and missing-manifest-key
// checks. Cross-checks the permissions an add-on requires - via the APIs it calls
// AND via a manifest key that implies one (compose_scripts -> compose,
// message_display_scripts -> messagesModify, from the key's `required_permissions`
// annotation) - against what its manifest declares:
//   - missingPermissions: a required permission that is not declared,
//   - missingManifestKeys: an API that needs a manifest key not declared.
// Severity comes from each owning registry entry (missing-permission /
// missing-manifest-key), stamped by runChecks.
//
// A declared-but-unused permission is reported deterministically ONLY when it is
// provable: a permission can be needed just to read a permission-gated property
// of returned data (e.g. accountsRead for a message header's folder), which the
// schema-driven scan cannot confirm - but when the registry's permission-prompts
// entry names that permission's justifying usages as `tokens` and none of them
// occurs anywhere in the live code or manifest, "unused" is sound as long as the
// scan can see every usage: an SCA review (build-time dependencies invisible in
// the source corpus), a source that failed to parse, or any unresolved API
// surface (apiUsage limitations / dynamic tails, which could spell a gated call
// without its token) disables the deterministic path. Accepted residual gap: a
// COMPUTED property name - built at runtime and never a literal token
// substring - defeats both signals at once, whichever side of an API call it
// sits on: a gated property READ off returned data (msg["fol"+"der"]) is not an
// API usage the chain-walker sees, and a gated property WRITE into an outgoing
// argument object (opts[key] = v; browser.tabs.create(opts)) is equally
// invisible to it, since the walker resolves member chains rooted at the API
// object, not arbitrary object-literal keys. A token read from a runtime data
// file is the same class of gap. Everything undecided escalates; the optional
// --llm-review pass assesses those advisorily.
//
// The schema expresses "this API needs a manifest key" via pseudo-permissions
// of the form "manifest:<key>" (e.g. browserAction needs "manifest:action" OR
// "manifest:browser_action"). Those are not declarable permissions - the
// manifest must declare at least one of the named keys.
//
// Belongs here: analyzePermissions (memoized via getPermissionAnalysis), the
// missing diff the rules consume, returning structured findings
// (file/loc/item/data) only, the Web/DOM-API grounding that proves the
// permissions the browser.* schema cannot gate (clipboard/geolocation) used,
// the manifest-key grounding that proves a script-injection key's implied
// permission used (and missing when undeclared), and enumerateUnusedPermissions
// with its live-code token scan (locateTokens) - the unused-permission producer's
// deterministic verdicts, plus the token occurrences the recheck judges per site.
//
// Does NOT belong here: the rules' wiring and any severity or text - that lives
// in the missing-permission / missing-manifest-key rules under
// src/checks/rules/* and in assets/registry.yaml (resolved by
// src/report/responses.js). The API-needs-which-permission schema knowledge -
// src/schema/index.js (incl. the permissionWebApis annotation). The navigator.*
// call match itself - src/parse/web-api-calls.js. Match-pattern helpers - lib/util.js.

import { VERDICT } from "./enum.js";
import { finding } from "../report/finding.js";
import {
  asArray,
  isMatchPattern,
  manifestPathLine,
  manifestTokenLine,
  versionInBounds,
  wholeWordRe,
} from "./util.js";
import { resolveApiUsages } from "./api-resolution.js";
import { buildReachability } from "./reachability.js";
import { webApiSignatures } from "../parse/web-api-calls.js";
import { webApiPermsOf, codeAtomsOf } from "../checks/extract.js";

/** @typedef {import("../checks/registry.js").RunContext} RunContext */
/** @typedef {import("../addon/load.js").Manifest} Manifest */

const MANIFEST_PREFIX = "manifest:";
const GATED_KINDS = new Set(["function", "event", "property", "namespace"]);

/**
 * @typedef {{file: string, loc: ?{line: number, column: number}, item: string,
 *   verdict: import("./enum.js").Verdict}} PermNote  A feed-activity record
 *   (emitted by the owning rule, so each appears once under the right check group).
 */

/**
 * @typedef {object} PermissionAnalysis
 * @property {import("../report/finding.js").Finding[]} missingPermissions  A
 *   required permission (item) not declared in the manifest.
 * @property {import("../report/finding.js").Finding[]} missingManifestKeys
 *   An API (item) needing a manifest key (data.keys) that is not declared.
 * @property {Set<string>} usedPermissions  Named permissions a reachable API
 *   call provably requires (so the add-on is definitely using them), plus the
 *   Web/DOM-API permissions grounded from navigator.* calls (see
 *   groundWebApiPermissions) that the browser.* schema cannot gate, plus a
 *   script-injection manifest key's implied permission (compose_scripts,
 *   message_display_scripts). The unused-permission check drops these from its
 *   by-hand checklist. Only ever proves a permission USED - a permission absent
 *   here may still be needed via a gated property a static scan cannot see (see
 *   the file header).
 * @property {{requirements: PermNote[], manifestKeys: PermNote[]}} notes  Feed
 *   records, one list per owning rule.
 */

/**
 * Cross-check the permissions/manifest keys the called APIs require against what
 * the manifest declares. Use getPermissionAnalysis (memoized) from the rules.
 * @param {RunContext} ctx  The shared check context.
 * @returns {PermissionAnalysis}
 */
function analyzePermissions(ctx) {
  const { schema } = ctx;
  const missingPermissions = [];
  const missingManifestKeys = [];
  // Named permissions some reachable API call provably requires (used below to
  // trim the by-hand unused-permission checklist).
  const usedPermissions = new Set();
  // Activity records, one list per owning rule's feed group.
  const requirements = [];
  const manifestKeyNotes = [];
  const notes = {
    requirements,
    manifestKeys: manifestKeyNotes,
  };
  if (!ctx.manifest) {
    return { missingPermissions, missingManifestKeys, usedPermissions, notes };
  }

  const declared = declaredPermissions(ctx.manifest);
  const manifestKeys = new Set(Object.keys(ctx.manifest));
  const missingReported = new Set();
  // namespace -> { alts:Set<key>, example, file, loc } for "manifest:<key>".
  const manifestKeyReqs = new Map();

  // Only usages in the pure WebExtension tree count: dead code and privileged
  // Experiment/core code (which uses no manifest permissions) are outside it, so they
  // bear on neither used nor missing permissions (resolveApiUsages applies the filter).
  for (const { file, usage, res } of resolveApiUsages(ctx)) {
    if (!GATED_KINDS.has(res.kind)) {
      continue;
    }
    const member = res.member ?? "(namespace)";
    const loc = { line: usage.line, column: usage.column };
    for (const perm of schema.requiredPermissions(res)) {
      if (perm.startsWith(MANIFEST_PREFIX)) {
        const rec = manifestKeyReqs.get(res.namespace) || {
          alts: new Set(),
          example: `${res.namespace}.${member}`,
          file,
          loc,
        };
        rec.alts.add(perm.slice(MANIFEST_PREFIX.length));
        manifestKeyReqs.set(res.namespace, rec);
        continue;
      }
      // A reachable call requires this permission, so the add-on provably
      // uses it (whether or not it is declared - the manual checklist below
      // intersects this with the declared set).
      usedPermissions.add(perm);
      const declaredHere = declared.named.has(perm);
      requirements.push({
        file,
        loc,
        item: `${res.namespace}.${member} needs '${perm}'`,
        verdict: declaredHere ? VERDICT.PASS : VERDICT.FAIL,
      });
      if (!declaredHere && !missingReported.has(perm)) {
        missingReported.add(perm);
        missingPermissions.push(finding({ file, loc, item: perm }));
      }
    }
  }

  // Ground the permissions the schema cannot gate through a browser.* member -
  // the Web/DOM-API permissions (clipboardRead/clipboardWrite/geolocation),
  // consumed via navigator.* calls the schema names in its `web_api` annotation.
  // These feed only the USED set (so the unused-permission check stops flagging a
  // genuinely-used one); they never enter missingPermissions above.
  for (const perm of groundWebApiPermissions(ctx, declared.named)) {
    usedPermissions.add(perm);
  }

  // A manifest key can require a permission the browser.* API gate never covers
  // (compose_scripts -> compose, message_display_scripts -> messagesModify [+
  // scripting before Thunderbird 154]) - the key's required_permissions annotation
  // records it as one or more entries, each with an optional strict-version bound.
  // For a declared key, an entry that is IN version bounds contributes its
  // permissions (grounded used, flagged missing when undeclared); an out-of-bounds
  // entry is skipped. Anchored to the manifest key, not a call site.
  for (const [key, entries] of schema.manifestKeyPermissions ?? []) {
    if (!manifestKeys.has(key)) {
      continue;
    }
    const line = manifestPathLine(ctx, key);
    const loc = line ? { line } : null;
    for (const entry of entries) {
      if (
        !versionInBounds(
          ctx.manifest,
          entry.minStrictVersion,
          entry.maxStrictVersion
        )
      ) {
        continue;
      }
      for (const perm of entry.permissions) {
        usedPermissions.add(perm);
        const declaredHere = declared.named.has(perm);
        requirements.push({
          file: "manifest.json",
          loc,
          item: `manifest key "${key}" needs '${perm}'`,
          verdict: declaredHere ? VERDICT.PASS : VERDICT.FAIL,
        });
        if (!declaredHere && !missingReported.has(perm)) {
          missingReported.add(perm);
          missingPermissions.push(
            finding({ file: "manifest.json", loc, item: perm })
          );
        }
      }
    }
  }

  // Manifest-key requirements: at least one of the named keys must be declared.
  // The schema lists both MV2/MV3 spellings, but only the one valid for the
  // target manifest version counts.
  /** @param {string} k @returns {string} top-level segment of a dotted key. */
  const topLevel = (k) => k.split(".")[0];
  for (const [, rec] of manifestKeyReqs) {
    const allAlts = [...rec.alts];
    const validAlts = allAlts.filter((k) =>
      schema.validManifestKeys.has(topLevel(k))
    );
    const altsToCheck = validAlts.length ? validAlts : allAlts;
    const satisfied = altsToCheck.some((k) => manifestKeys.has(topLevel(k)));
    const alts = altsToCheck.join('", "');
    manifestKeyNotes.push({
      file: rec.file,
      loc: rec.loc,
      item: `${rec.example} needs manifest key "${alts}"`,
      verdict: satisfied ? VERDICT.PASS : VERDICT.FAIL,
    });
    if (!satisfied) {
      missingManifestKeys.push(
        finding({
          file: rec.file,
          loc: rec.loc,
          item: rec.example,
          data: { keys: `"${alts}"` },
        })
      );
    }
  }

  return { missingPermissions, missingManifestKeys, usedPermissions, notes };
}

/**
 * The permission analysis, computed once and memoized on the addon so the
 * missing-permission and missing-manifest-key checks share one pass.
 * @param {RunContext} ctx
 * @returns {PermissionAnalysis}
 */
export function getPermissionAnalysis(ctx) {
  return (ctx.addon.permissionAnalysis ??= analyzePermissions(ctx));
}

/**
 * The Web/DOM-API permissions a reachable WebExtension call proves in use - the
 * ones the browser.* schema cannot gate (clipboardRead/clipboardWrite/geolocation),
 * consumed via navigator.* calls the schema names in its `web_api` annotation. The
 * schema supplies the receiver+methods per permission; this scans the same pure
 * WebExtension tree resolveApiUsages uses for browser.* grounding. Called once,
 * from analyzePermissions (itself memoized), so it needs no memo of its own.
 *
 * Only DECLARED permissions are grounded: the result feeds the unused check (which
 * only concerns declared permissions) and never missingPermissions, so grounding an
 * undeclared one would be inert - and skipping them lets the common add-on that
 * declares no Web/DOM permission early-out before scanning any file.
 * @param {RunContext} ctx
 * @param {Set<string>} declaredNamed  The declared named permissions.
 * @returns {Set<string>}  Grounded permission names.
 */
function groundWebApiPermissions(ctx, declaredNamed) {
  const signatures = webApiSignatures(ctx.schema, declaredNamed);
  const grounded = new Set();
  if (!signatures.length) {
    return grounded;
  }
  const webext = buildReachability(ctx).pureWebExtensionReachable;
  for (const src of ctx.jsSources ?? []) {
    if (!webext.has(src.file)) {
      continue;
    }
    // webApiPermsOf returns the pass's grounding against ALL web_api signatures - every
    // source, authored or not (a vendored library's navigator.* call still uses the
    // permission). Keep only the declared ones.
    const perms = webApiPermsOf(src);
    for (const perm of perms) {
      if (declaredNamed.has(perm)) {
        grounded.add(perm);
      }
    }
  }
  return grounded;
}

/**
 * Enumerate the declared named permissions that warrant a closer look: every one
 * a reachable API call does NOT provably require, anchored to its manifest.json
 * line. A permission a reachable call provably requires (usedPermissions) is
 * justified and dropped. A permission whose (version-matched) permission-prompts
 * entries declare usage `tokens` that appear NOWHERE in the add-on's live code
 * (comments excluded) or manifest is deterministically unused - a finding, with
 * or without --llm-review (see the blindness guard below for when this path
 * stands down). Every other permission escalates as a manual-review case, to be
 * re-judged by the LLM recheck when the registry has a prompt for it (see
 * registry.rechecks) or reviewed by hand otherwise. Host match patterns are
 * minimize-host-permissions' concern and are skipped. Backs the unused-permission
 * producer.
 * @param {RunContext} ctx
 * @param {?{permissionPrompts?: object[]}} [recheckData]  The producer's linked
 *   consumer data (LoadedCheck.recheckData): the permission-prompts entries
 *   carrying the usage tokens. Absent/empty -> no deterministic verdicts,
 *   escalate all.
 * @returns {{findings: {item: string, file: string, loc: ?object}[], escalations:
 *   {item: string, file: string, loc: ?object}[]}}
 */
export function enumerateUnusedPermissions(ctx, recheckData) {
  const used = getPermissionAnalysis(ctx).usedPermissions;
  // A deterministic "unused" FINDING claims "nothing this permission gates can be in
  // use" - only tenable when the scan can see every usage, so that a token found
  // NOWHERE really means nowhere. Cases where absence cannot be trusted, so a
  // token-bearing permission escalates instead of becoming a finding:
  //  - an SCA review scans the SOURCE corpus, but the shipped XPI may exercise
  //    the permission through dependencies materialized at build time;
  //  - a source that failed to PARSE (apiUsage.parseError) yields no usages and
  //    no limitations - indistinguishable from a clean empty file unless this
  //    checks for it explicitly;
  //  - unresolved API surface (a computed/dynamic member chain, a destructured
  //    alias - the apiUsage limitations) could spell a gated call without its
  //    token appearing anywhere;
  //  - an ABSENT ctx.apiUsages is a view with no visibility into the source's
  //    API surface (the sibling-ctx marker) - maximally blind, so it fails
  //    closed rather than reading as fully sighted.
  // This gates only the finding: token PRESENCE is always trustworthy (a located
  // occurrence IS a real site), so occurrences are collected regardless and the
  // recheck judges them the same in every mode.
  const decidable =
    !ctx.mode?.sca &&
    Array.isArray(ctx.apiUsages) &&
    !ctx.apiUsages.some(
      (u) =>
        u.parseError ||
        u.limitations?.length ||
        u.usages?.some((x) => x.dynamicTail)
    );
  const tokensFor = permissionTokens(
    ctx.manifest,
    recheckData?.permissionPrompts
  );
  // One scan over the live code + manifest for the union of every permission's
  // tokens, recording WHERE each occurs; each permission then reads its own subset,
  // both to decide presence (no occurrence, when decidable = unused) and to hand the
  // recheck the sites to judge.
  const located = locateTokens(ctx, new Set([...tokensFor.values()].flat()));
  const m = ctx.manifest ?? {};
  const seen = new Set();
  const findings = [];
  const escalations = [];
  for (const key of ["permissions", "optional_permissions"]) {
    asArray(m[key]).forEach((p, i) => {
      if (typeof p !== "string" || isMatchPattern(p) || seen.has(p)) {
        return;
      }
      seen.add(p);
      const line = manifestPathLine(ctx, key, i);
      const loc = line ? { line } : null;
      if (used.has(p)) {
        // A reachable call provably requires it, so it is justified - not a manual
        // case. Every other declared permission is judged below.
        ctx.note?.("manifest.json", loc, p, VERDICT.PASS);
        return;
      }
      // Deterministically unused: the permission's prompt entries name its
      // justifying usages as tokens, and not one of them occurs anywhere in the
      // live code or manifest - nothing the permission gates can be in use. Only
      // when the scan is decidable, so absence is trustworthy (else escalate).
      const tokens = tokensFor.get(p);
      const occurrences = permissionOccurrences(p, tokens, located);
      if (decidable && tokens?.length && !occurrences.length) {
        ctx.note?.("manifest.json", loc, p, VERDICT.FAIL);
        findings.push(finding({ item: p, file: "manifest.json", loc }));
        return;
      }
      // Everything else escalates (a token was found, the entry declares no tokens,
      // the scan was not decidable, or the permission has no prompt entry). Whether it
      // is re-judged by the LLM or stays manual-only is decided later, at the divert,
      // by registry.rechecks - the check does not know. The token sites (empty for a
      // token-less permission, or when no token is visible) ride along so the recheck
      // can point the model at each one; with none it is judged holistically.
      ctx.note?.("manifest.json", loc, p, VERDICT.UNSURE);
      escalations.push({ item: p, file: "manifest.json", loc, occurrences });
    });
  }
  return { findings, escalations };
}

/**
 * Map each permission to the union of the usage tokens of every prompt entry that
 * names it and matches the add-on's strict_min_version. A permission missing from
 * the map (no entry) or mapped to [] is deterministically undecidable and must
 * escalate - and a matched entry WITHOUT tokens (unlimitedStorage) poisons its
 * permissions to [] even when another entry contributes tokens, because that
 * entry's usages are declared token-undetectable.
 * @param {?object} manifest
 * @param {?object[]} prompts  LoadedCheck.recheck.permissionPrompts.
 * @returns {Map<string, string[]>}
 */
function permissionTokens(manifest, prompts) {
  const map = new Map();
  const poisoned = new Set();
  for (const e of prompts ?? []) {
    if (!versionInBounds(manifest, e.minStrictVersion, e.maxStrictVersion)) {
      continue;
    }
    for (const p of e.permissions) {
      if (!e.tokens?.length) {
        poisoned.add(p);
      }
      map.set(p, [...new Set([...(map.get(p) ?? []), ...(e.tokens ?? [])])]);
    }
  }
  for (const p of poisoned) {
    map.set(p, []);
  }
  return map;
}

/**
 * Every occurrence of each of `tokens` in the add-on's code or manifest, keyed by
 * token: `{file, line}` per site (line null only when a manifest occurrence cannot
 * be located). Both the presence decision (a token with no occurrences is unused)
 * and the recheck (each occurrence is a site the model judges) read this.
 *
 * A token comes in two forms. A DOTTED token `ns.member` (e.g. `tabs.executeScript`)
 * is an API CALL: it is resolved against the api-usage analysis (resolveApiUsages),
 * matching a call whose resolved namespace + member equal `ns` + `member` - precise
 * (tabs.executeScript vs scripting.executeScript), comment-free, and it never matches a
 * bare identifier or a property read on a non-API object. A BARE token is a plain word,
 * matched textually as below.
 *
 * Every jsSource counts - authored AND non-authored, since a library exercising a
 * permission counts (deciding "unused" stays conservative). An AUTHORED source is
 * searched over its comment-free code-text atoms, each carrying its real source
 * line (so a token in a developer's comment does NOT ground the permission); a
 * non-authored bundle has no atoms, so its raw text is scanned line by line (a
 * token in its comments only over-includes an occurrence, the safe direction).
 * String literals deliberately count (dynamic access spells the token in a string).
 * The manifest is also searched as JSON (no comments there) and a manifest occurrence
 * is located via manifestTokenLine - though the script-injection manifest keys
 * (compose_scripts / message_display_scripts) are NOT tokens: they ground their
 * permission deterministically (analyzePermissions), so the recheck never sees them.
 *
 * A token matches on WORD BOUNDARIES (case-sensitive): it must be a whole
 * identifier / key / string word, not a coincidental substring of a longer name -
 * so `folder` does not match `displayedFolder` or a variable `targetFolder`, and
 * `url` does not match `homepage_url`. Every justifying spelling is therefore
 * listed explicitly in the registry rather than caught by a broad substring.
 * @param {RunContext} ctx
 * @param {Set<string>} tokens
 * @returns {Map<string, {file: string, line: ?number}[]>}
 */
function locateTokens(ctx, tokens) {
  const located = new Map([...tokens].map((t) => [t, []]));
  if (!tokens.size) {
    return located;
  }
  // A DOTTED token `ns.member` is an API call, not a text word: it is resolved against
  // the api-usage analysis (namespace + member), which distinguishes tabs.executeScript
  // from scripting.executeScript and never matches a bare identifier, a property read on
  // a non-API object, or a comment. A BARE token is a plain word matched textually.
  const dotted = [...tokens].filter((t) => t.includes("."));
  const bare = [...tokens].filter((t) => !t.includes("."));

  if (dotted.length) {
    const wanted = dotted.map((t) => {
      const dot = t.lastIndexOf(".");
      return { token: t, ns: t.slice(0, dot), member: t.slice(dot + 1) };
    });
    for (const { file, usage, res } of resolveApiUsages(ctx)) {
      if (!res) {
        continue;
      }
      for (const { token, ns, member } of wanted) {
        if (res.namespace === ns && res.member === member) {
          located.get(token).push({ file, line: usage.line });
        }
      }
    }
  }

  if (bare.length) {
    const patterns = new Map(bare.map((t) => [t, wholeWordRe(t)]));
    const manifestJson = JSON.stringify(ctx.manifest ?? {});
    for (const [t, re] of patterns) {
      if (re.test(manifestJson)) {
        located.get(t).push({
          file: "manifest.json",
          line: manifestTokenLine(ctx.manifestText, t),
        });
      }
    }
    for (const src of ctx.jsSources ?? []) {
      const atoms = codeAtomsOf(src);
      if (atoms) {
        for (const a of atoms) {
          for (const [t, re] of patterns) {
            if (re.test(a.value)) {
              located.get(t).push({ file: src.file, line: a.line });
            }
          }
        }
      } else {
        const lines = src.code.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          for (const [t, re] of patterns) {
            if (re.test(lines[i])) {
              located
                .get(t)
                .push({ file: src.file, line: i + 1 + (src.lineOffset ?? 0) });
            }
          }
        }
      }
    }
  }
  return located;
}

/**
 * The token sites of one permission, merged across its tokens and deduped by
 * `file:line` (two tokens on the same line collapse to one site), each stamped with
 * an orchestrator-minted id the recheck hands the model to echo a verdict back
 * against. Empty when the permission has no tokens (a token-less permission) or when
 * none of its tokens occur in the reviewed corpus - the recheck then judges it
 * holistically.
 * @param {string} permission
 * @param {?string[]} tokens  The permission's usage tokens.
 * @param {Map<string, {file: string, line: ?number}[]>} located
 * @returns {{id: string, file: string, line: ?number, token: string}[]}
 */
function permissionOccurrences(permission, tokens, located) {
  if (!tokens?.length) {
    return [];
  }
  const seen = new Set();
  const out = [];
  for (const t of tokens) {
    for (const occ of located.get(t) ?? []) {
      const key = `${occ.file}:${occ.line}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push({
        id: `${permission}#${out.length + 1}`,
        file: occ.file,
        line: occ.line,
        token: t,
      });
    }
  }
  return out;
}

/**
 * Split declared manifest permissions into named permissions (required +
 * optional) and host match patterns, where `required` is the "permissions"
 * array only (used for the unused check). Shared with the native-messaging
 * check, which keys off whether a named permission is declared.
 * @param {Manifest} manifest
 * @returns {{named: Set<string>, required: Set<string>, hosts: Set<string>}}
 */
export function declaredPermissions(manifest) {
  const named = new Set();
  const required = new Set();
  const hosts = new Set();
  const lists = [
    { list: manifest.permissions, required: true },
    { list: manifest.optional_permissions, required: false },
    { list: manifest.host_permissions, required: false },
  ];
  for (const { list, required: isRequired } of lists) {
    for (const p of asArray(list)) {
      if (typeof p !== "string") {
        continue;
      }
      if (isMatchPattern(p)) {
        hosts.add(p);
      } else {
        named.add(p);
        if (isRequired) {
          required.add(p);
        }
      }
    }
  }
  return { named, required, hosts };
}
