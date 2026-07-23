// The post-summary recheck mechanism: re-judging items an earlier check could
// not settle, using the whole-add-on context of the --llm-review pass.
//
// A check that declares `post-summary-recheck: R` hands the manual-review items
// it would have produced to the recheck consumer R (the orchestrator diverts
// them into ctx.recheck.get(R) - see runChecks - but only when the summary will
// run, recheckActive). Two helpers serve that flow:
//
//   buildRecheckSections(ctx, registry) - what summaries.js appends to the
//     add-on-summary prompt: one labeled section per recheck consumer that was
//     handed items, carrying that consumer's rubric and the list of item keys to
//     judge. Most consumers carry a static `summary-prompt`; a `permission-recheck`
//     consumer instead assembles its rubric per review from the permission-prompt-
//     framing + permission-prompts sections, including only the permissions actually
//     handed over. A token-bearing permission is judged PER OCCURRENCE: the producer
//     located every site of its usage tokens, and each site is one item (an
//     orchestrator-minted id) the model verdicts while seeing the full add-on. A
//     token-less permission (no located sites) is judged holistically, one verdict
//     for the permission. The model returns a verdict per item in the review's
//     `recheck` field (stored on ctx.recheckVerdicts).
//
//   resolveRecheck(ctx, check) - the shared run() of most recheck consumers (a
//     normal post-summary check). It reads the items handed to THIS consumer and
//     the summary's verdicts, then follows the ordinary check contract: pass ->
//     drop (used), fail -> finding (the issue is present), unsure or no verdict
//     (summary skipped / errored) -> manual review. The consumer's own registry
//     wording (response/instructions) renders the result, since runOneCheck
//     stamps the finding/escalation with the consumer's id and severity.
//
//   resolvePermissionRecheck(ctx, check) - the run() of the permission consumer.
//     Same contract, but it AGGREGATES the per-occurrence verdicts of each permission
//     (any site exercised -> justified/drop; every site definitively not -> unused
//     finding; otherwise -> manual), so the model's answer for one site never decides
//     a whole permission alone.
//
// The guard: a resolve only ever consults verdicts for items actually handed to this
// consumer, so the summary can neither invent items nor flip anything it was not given.
//
// Belongs here: the prompt composition, the verdict->finding/manual mapping, and the
// verdict->display-row projection (buildRecheckVerdictReport, for the report's per-site
// verdict list). Does NOT belong here: diverting a producer's manual items
// (-> runChecks), the summary transport and storing ctx.recheckVerdicts
// (-> src/checks/summaries.js), locating the token sites (-> src/lib/permissions.js),
// rendering the display rows (-> src/report/format.js), or the recheck output schema
// (-> src/llm/schema.js).

import { VERDICT } from "./enum.js";
import { finding } from "../report/finding.js";
import { wrap } from "./untrusted.js";
import { versionInBounds, trunc } from "./util.js";

/** @typedef {import("../checks/registry.js").RunContext} RunContext */
/** @typedef {import("../checks/registry.js").LoadedCheck} LoadedCheck */
/** @typedef {import("../checks/registry.js").Registry} Registry */

/**
 * The key that ties a handed-over manual item to the summary's verdict for it:
 * the item token when present (e.g. a permission), else the file (e.g. an unused
 * file) - narrowed to `file:line` when the item carries a locus, so a per-site
 * producer (several sinks in one file) does not collapse to a single key. The
 * recheck section lists these keys, and the model echoes them back. So a per-site
 * recheck case (data-exfiltration, disguised-transmission) MUST leave `item` null
 * and key on `file:line`; its descriptor (the method/channel) rides on `hint`, not
 * `item` - else two sinks of the same kind would collide (see report/finding.js).
 * @param {{item?: ?string, file?: ?string, loc?: ?{line?: number}}} ref
 * @returns {?string}
 */
function itemKey(ref) {
  if (ref.item != null) {
    return ref.item;
  }
  if (ref.file == null) {
    return null;
  }
  return ref.loc?.line != null ? `${ref.file}:${ref.loc.line}` : ref.file;
}

/**
 * The recheck contribution to the add-on-summary prompt, split by trust: the trusted
 * `rubric` (each consumer's `summary-prompt` plus a uniform instruction to surface
 * fail/unsure verdicts as a labeled bullet) joins the SYSTEM prompt, while the
 * untrusted `items` (file paths etc.) are wrapped in nonce markers for the USER data,
 * each tagged with its check id so the model can correlate. Attaching the bullet
 * instruction here, in the orchestrator, is what makes every recheck reach the
 * summary - not each consumer's own rubric. Both are "" when nothing was handed over.
 * @param {RunContext} ctx
 * @param {import("../checks/registry.js").Registry} registry
 * @param {string} nonce  The per-review nonce wrapping the item lists.
 * @param {?Set<string>} [consumers]  When set, only these recheck-consumer ids are
 *   emitted - the SCA split runs one summary per corpus, each carrying the consumers
 *   anchored to that corpus. Undefined = every bucket (a single all-in-one summary).
 * @returns {{rubric: string, items: string}}
 */
export function buildRecheckSections(ctx, registry, nonce, consumers) {
  const buckets = ctx.recheck;
  if (!buckets || !buckets.size) {
    return { rubric: "", items: "" };
  }
  const rubrics = [];
  const itemBlocks = [];
  for (const [id, items] of buckets) {
    if (!items.length || (consumers && !consumers.has(id))) {
      continue;
    }
    const entry = registry.checkEntry(id);
    const keys = [];
    const seen = new Set();
    for (const ref of items) {
      const key = itemKey(ref);
      if (key != null && !seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
    if (!keys.length) {
      continue;
    }
    // A permission-recheck consumer assembles its rubric from the registry's
    // permission-prompts for just the permissions being rechecked, and its items are
    // the token SITES to judge (occurrence ids), or the permission itself when it has
    // no located site (holistic). Every other consumer carries a static
    // summary-prompt keyed by the item itself. Either may be "" (no rubric), in which
    // case the items stay unjudged and the resolve falls them to manual.
    let prompt;
    let itemKeys = keys;
    if (entry?.["permission-recheck"]) {
      // Assembled from the handed items (which carry each permission's located
      // sites). Only permissions the rubric actually grounds contribute items; a
      // handed permission whose sole prompt is version-filtered out yields no item,
      // so it falls to manual (the resolve's no-verdict path), never judged blind.
      const assembled = assemblePermissionPrompt(registry, ctx, items);
      prompt = assembled.prompt;
      itemKeys = assembled.itemKeys;
    } else {
      prompt = entry?.["summary-prompt"];
    }
    if (!prompt || !itemKeys.length) {
      continue;
    }
    const label = entry.title || id;
    rubrics.push(
      `=== recheck: ${id} ===\n${prompt}\n\n` +
        `Judge each item in the data block tagged RECHECK-ITEMS id=${JSON.stringify(id)}; ` +
        `return one recheck entry per item with check="${id}" and the exact item ` +
        'text. For every item you judge "fail" or "unsure", add a separate bullet ' +
        `point to the prose "summary" field, labeled "${label}", naming those items ` +
        "with a one-line reason, so the reviewer sees them in the overview and not " +
        "only in the structured result."
    );
    itemBlocks.push(
      wrap(
        nonce,
        "RECHECK-ITEMS",
        itemKeys.map((k) => `- ${k}`).join("\n"),
        `id=${JSON.stringify(id)}`
      )
    );
  }
  return { rubric: rubrics.join("\n\n"), items: itemBlocks.join("\n\n") };
}

/**
 * Assemble the unused-permission recheck rubric for the handed permission items: the
 * shared framing, the permission-prompts entries covering one of the requested
 * permissions whose version bounds fit the add-on's strict_min_version (deduped in
 * registry order, `{{note:<member>}}` placeholders resolved to version-matched schema
 * notes), and a "sites to judge" list. Each grounded, token-bearing permission
 * contributes one line per located occurrence (an id the model verdicts); a
 * token-less permission contributes a single holistic line. Returns the rubric AND
 * the item keys the model must return a verdict for (occurrence ids + holistic
 * permission names) - already filtered to what the rubric grounds, so a permission
 * whose only entry is version-filtered out contributes nothing and falls to manual.
 * `prompt` is "" and `itemKeys` empty when no entry matches at all.
 * @param {import("../checks/registry.js").Registry} registry
 * @param {import("../checks/registry.js").RunContext} ctx  For the manifest (version
 *   bounds) and the schema (member notes).
 * @param {import("../checks/escalation.js").ManualRef[]} items  The handed permission
 *   items, each carrying its located token occurrences.
 * @returns {{prompt: string, itemKeys: string[]}}
 */
function assemblePermissionPrompt(registry, ctx, items) {
  const occByPerm = new Map();
  for (const r of items) {
    if (r.item != null && !occByPerm.has(r.item)) {
      occByPerm.set(r.item, r.occurrences ?? []);
    }
  }
  const want = new Set(occByPerm.keys());
  const entries = registry
    .permissionPrompts()
    .filter(
      (e) =>
        e.permissions.some((p) => want.has(p)) &&
        versionInBounds(ctx.manifest, e.minStrictVersion, e.maxStrictVersion)
    );
  const grounded = new Set(entries.flatMap((e) => e.permissions));
  const groundedPerms = [...want].filter((p) => grounded.has(p));
  if (!entries.length || !groundedPerms.length) {
    return { prompt: "", itemKeys: [] };
  }
  const { preamble, closing } = registry.permissionPromptFraming();
  const itemKeys = [];
  const siteLines = [];
  for (const p of groundedPerms) {
    const occ = occByPerm.get(p) ?? [];
    if (occ.length) {
      for (const o of occ) {
        itemKeys.push(o.id);
        const loc = o.line != null ? `${o.file}:${o.line}` : o.file;
        // The exact SITE format the framing preamble documents - a located candidate,
        // no re-posed "is it used" question (the preamble sets the discriminator task).
        siteLines.push(`${o.id}: "${p}" token "${o.token}" at ${loc}`);
      }
    } else {
      itemKeys.push(p);
      siteLines.push(
        `${p}: no specific site - give one overall verdict for "${p}" from the full add-on.`
      );
    }
  }
  const prompt = [
    preamble,
    ...entries.map((e) => resolveNotes(e.prompt, ctx)),
    "Sites to judge (return a verdict for each id below):",
    ...siteLines,
    closing,
  ]
    .filter(Boolean)
    .join("\n");
  return { prompt, itemKeys };
}

// Replace each `{{note:<ns>.<member>}}` in a prompt with the version-matched `note`
// annotation(s) on that schema member (joined). A member with no note, or none in
// version bounds, resolves to empty.
function resolveNotes(text, ctx) {
  return text.replace(/\{\{note:([\w.]+)\}\}/g, (_, path) => {
    const matched = [];
    for (const n of ctx.schema?.memberNotes?.(path) ?? []) {
      if (
        versionInBounds(ctx.manifest, n.minStrictVersion, n.maxStrictVersion)
      ) {
        matched.push(n.note);
      }
    }
    return matched.join(" ");
  });
}

/**
 * The summary's verdicts for one consumer, indexed by item key. Only keys the
 * consumer handed over are ever looked up, so a verdict for anything else is inert -
 * the summary can neither invent items nor flip one it was not given.
 * @param {RunContext} ctx @param {string} checkId
 * @returns {Map<string, {verdict: import("./enum.js").Verdict, reason?: ?string}>}
 */
function verdictsFor(ctx, checkId) {
  const verdicts = new Map();
  for (const v of ctx.recheckVerdicts ?? []) {
    if (v && v.check === checkId && typeof v.item === "string") {
      verdicts.set(v.item, v);
    }
  }
  return verdicts;
}

/**
 * The run() of most recheck consumers (all but the permission consumer). Maps the
 * summary's verdict for each handed-over item to the ordinary check contract: pass ->
 * drop, fail -> finding, unsure or no verdict -> manual review (carrying the model's
 * reason). Only items handed to THIS consumer are consulted (the guard).
 * @param {RunContext} ctx
 * @param {LoadedCheck} check  The recheck consumer (its id keys ctx.recheck).
 * @returns {{findings: object[], escalations: {item: ?string, hint: ?string,
 *   file: ?string, loc: ?object, data: object}[]}}
 */
export function resolveRecheck(ctx, check) {
  const handed = ctx.recheck?.get(check.id) ?? [];
  if (!handed.length) {
    return { findings: [], escalations: [] };
  }
  const verdicts = verdictsFor(ctx, check.id);
  const findings = [];
  const escalations = [];
  // Label the feed note by the corpus this consumer ACTS ON (its producer's), not the
  // main ctx it runs on to read ctx.recheck - so a recheck's notes carry [XPI] when
  // they re-judge XPI-corpus items. check.labelInput is set at load; it falls back to
  // the note's bound input when absent.
  const labelInput = check.labelInput;
  for (const ref of handed) {
    const key = itemKey(ref);
    const v = key != null ? verdicts.get(key) : undefined;
    const verdict = v?.verdict ?? VERDICT.UNSURE;
    // The feed suffix after `file:line`: the item token, else a per-locus hint
    // (e.g. a transmission method). Never the file - that only repeated the locus.
    const label = ref.item ?? ref.hint ?? null;
    if (verdict.pass) {
      ctx.note?.(ref.file, ref.loc, label, VERDICT.PASS, labelInput);
      continue; // the summary confirmed it is used / justified - drop it
    }
    const data = { ...(ref.data ?? {}), reason: v?.reason ?? "" };
    if (verdict.fail) {
      ctx.note?.(ref.file, ref.loc, label, VERDICT.FAIL, labelInput);
      findings.push(
        finding({
          file: ref.file,
          loc: ref.loc,
          item: ref.item,
          hint: ref.hint,
          data,
        })
      );
    } else {
      // unsure, or no verdict at all (the summary was skipped or errored): the
      // item still needs a human, so route it to manual review.
      ctx.note?.(ref.file, ref.loc, label, VERDICT.UNSURE, labelInput);
      escalations.push({
        item: ref.item ?? null,
        hint: ref.hint ?? null,
        file: ref.file ?? null,
        loc: ref.loc ?? null,
        data,
      });
    }
  }
  return { findings, escalations };
}

/**
 * The run() of the unused-permission recheck consumer. Each handed permission was
 * given the summary as either its located token SITES (each an occurrence id) or, for
 * a permission with no located site, itself (one holistic key). This aggregates the
 * site verdicts per permission: ANY site exercised (pass) -> justified, drop; every
 * site definitively not (all fail) -> unused finding; anything else, including a
 * summary that never ran -> manual. The bias is deliberate and asymmetric: a permission
 * exercised at even one site IS used, so any pass justifies it - which trades a possible
 * false-drop (the model wrongly passes one site) for never emitting a false "unused" from
 * a permission that is genuinely used somewhere. Only items handed to THIS consumer are
 * consulted (the guard).
 * @param {RunContext} ctx
 * @param {LoadedCheck} check  The permission recheck consumer.
 * @returns {{findings: object[], escalations: {item: ?string, hint: ?string,
 *   file: ?string, loc: ?object, data: object}[]}}
 */
export function resolvePermissionRecheck(ctx, check) {
  const handed = ctx.recheck?.get(check.id) ?? [];
  if (!handed.length) {
    return { findings: [], escalations: [] };
  }
  const verdicts = verdictsFor(ctx, check.id);
  const findings = [];
  const escalations = [];
  const labelInput = check.labelInput;
  for (const ref of handed) {
    const permission = ref.item;
    const occ = ref.occurrences ?? [];
    // The keys whose verdicts decide this permission: its occurrence ids, or the
    // permission itself when judged holistically (no located site - a token-less
    // permission, or one whose tokens do not occur in the reviewed corpus).
    const keys = occ.length ? occ.map((o) => o.id) : [permission];
    const vs = keys.map((k) => verdicts.get(k)?.verdict ?? VERDICT.UNSURE);
    if (vs.some((v) => v.pass)) {
      ctx.note?.(ref.file, ref.loc, permission, VERDICT.PASS, labelInput);
      continue; // a site exercises the permission - justified, drop it
    }
    if (vs.length && vs.every((v) => v.fail)) {
      ctx.note?.(ref.file, ref.loc, permission, VERDICT.FAIL, labelInput);
      findings.push(
        finding({ file: ref.file, loc: ref.loc, item: permission })
      );
    } else {
      ctx.note?.(ref.file, ref.loc, permission, VERDICT.UNSURE, labelInput);
      escalations.push({
        item: permission ?? null,
        hint: null,
        file: ref.file ?? null,
        loc: ref.loc ?? null,
        data: null,
      });
    }
  }
  return { findings, escalations };
}

/**
 * The per-candidate display rows for the report's add-on-summary section: one row per item the
 * recheck HANDED the model (both SCA passes), each showing the model's verdict for it - so a reviewer
 * sees exactly what was asked and how it was judged. Driven by the handed items (ctx.recheck), NOT by
 * what the model returned: a model that under-answers - or ignores the recheck section entirely and
 * returns none - still gets a full table, with a missing verdict shown as `unsure` (exactly how
 * resolveRecheck/resolvePermissionRecheck treat a no-verdict item -> manual). A model verdict for an
 * item that was never handed is ignored (verdictsFor only reads handed keys). Precomputed here (not
 * in the renderer) because it needs the add-on corpus and the handed items, which the report layer
 * cannot reach.
 *
 * A handed item's candidate SITES and subject: a permission recheck's item carries its located token
 * occurrences -> one site per occurrence (subject = the permission), or, with no located site, the
 * item itself (holistic permission, subject = the permission); a non-permission consumer's item keys
 * on itemKey(ref) -> ref.file / ref.loc (subject = ref.item ?? ref.hint, e.g. a transmission method).
 * The source line is read from the consumer's OWN corpus (corpusForCheck), so a source-anchored item
 * reads the source and an xpi-anchored one the XPI - EXCEPT a manifest.json locus, whose line is
 * numbered against and labelled as the shipped manifest, so it is read from ctx.manifestText.
 * @param {RunContext} ctx
 * @param {Registry} registry
 * @param {(checkId: string) => ({files?: Map<string, Buffer>}|null|undefined)} corpusForCheck  The
 *   add-on whose files back a consumer's items (its producer's corpus).
 * @returns {{check: string, label: string, file: ?string, line: ?number, subject: ?string,
 *   verdict: import("./enum.js").Verdict, content: ?string}[]}
 */
export function buildRecheckVerdictReport(ctx, registry, corpusForCheck) {
  const rows = [];
  for (const [checkId, handed] of ctx.recheck ?? new Map()) {
    if (!handed?.length) {
      continue;
    }
    const verdicts = verdictsFor(ctx, checkId);
    const check = registry.checkEntry(checkId)?.title ?? checkId;
    const label = registry.labelInputFor(checkId);
    for (const ref of handed) {
      for (const site of candidateSites(ref)) {
        rows.push({
          check,
          label,
          file: site.file,
          line: site.line,
          subject: site.subject,
          // The model's verdict for this candidate, or `unsure` when it returned none - the same
          // default resolveRecheck/resolvePermissionRecheck apply (a no-verdict item -> manual).
          verdict: verdicts.get(site.key)?.verdict ?? VERDICT.UNSURE,
          // A manifest.json locus is line-numbered against the SHIPPED manifest (manifestPathLine
          // reads ctx.manifestLoc = the XPI's) and its report label is forced to [XPI], so read the
          // line from ctx.manifestText - not the producer's own corpus, whose source manifest may
          // differ from the built one. Every other locus reads its own corpus.
          content:
            site.file === "manifest.json"
              ? lineOfText(ctx.manifestText, site.line)
              : sourceLine(
                  corpusForCheck(checkId)?.files,
                  site.file,
                  site.line
                ),
        });
      }
    }
  }
  rows.sort(
    (a, b) =>
      a.check.localeCompare(b.check) ||
      (a.file ?? "").localeCompare(b.file ?? "") ||
      (a.line ?? 0) - (b.line ?? 0)
  );
  return rows;
}

/**
 * The candidate sites of one handed item, each keyed by the string the summary's verdict is looked
 * up by: a permission recheck's located token occurrences (per-site, keyed by occurrence id, subject
 * = the permission), else the item itself (a holistic permission or a non-permission consumer, keyed
 * by itemKey, subject = ref.item ?? ref.hint). Empty when the item has no key.
 * @param {import("../checks/escalation.js").ManualRef} ref
 * @returns {{key: string, file: ?string, line: ?number, subject: ?string}[]}
 */
function candidateSites(ref) {
  const occ = ref.occurrences ?? [];
  if (occ.length) {
    return occ.map((o) => ({
      key: o.id,
      file: o.file,
      line: o.line,
      subject: ref.item ?? null,
    }));
  }
  const key = itemKey(ref);
  return key == null
    ? []
    : [
        {
          key,
          file: ref.file ?? null,
          line: ref.loc?.line ?? null,
          subject: ref.item ?? ref.hint ?? null,
        },
      ];
}

/**
 * The trimmed, truncated 1-based `line` of `text`, or null when the text is missing, the line is
 * out of range, or the line is blank. Trimming also drops a trailing CR from CRLF files.
 * @param {?string} text @param {?number} line @returns {?string}
 */
function lineOfText(text, line) {
  if (text == null || line == null) {
    return null;
  }
  const trimmed = String(text).split("\n")[line - 1]?.trim();
  return trimmed ? trunc(trimmed) : null;
}

/**
 * The trimmed, truncated source line at `file:line` from `files`, or null when unavailable (no
 * corpus, no file, no line, or an out-of-range line).
 * @param {?Map<string, Buffer>} files @param {?string} file @param {?number} line
 * @returns {?string}
 */
function sourceLine(files, file, line) {
  if (!files || !file) {
    return null;
  }
  return lineOfText(files.get(file)?.toString("utf8"), line);
}
