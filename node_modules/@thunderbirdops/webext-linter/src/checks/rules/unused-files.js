// LLM check: files that should not ship in a published add-on. The deterministic
// pre-flight (reachability.js follows import/getURL/HTML/CSS plus file-loading
// API edges) resolves the clear cases as findings: hidden/junk by name, and a
// clearly-unreferenced file (its basename appears in no other file AND the
// add-on uses no dynamic loaders). For an ambiguous file (its name appears in
// live code, or the add-on builds load paths at runtime) we cannot tell
// statically whether any of those sites really loads it, so each suspected
// loader SITE becomes an LLM candidate ("does this site load F?"). The
// orchestrator gathers one verdict per site (or routes to manual with no token);
// this check then aggregates per file F: if any site loads it, F is used; if
// none does, F is unused.
//
// Belongs here: the ALLOW / JUNK name lists, classifying each packaged file as a
// finding / candidate / clean against reachability, the per-site candidate set,
// and the per-F aggregation in resolve. Does NOT belong here: the reachability
// graph, dynamic-loader sites, and mention lookups -> src/lib/
// reachability.js. The non-authored (library / minified / bundled) classification
// -> nonAuthoredJs in src/lib/bundled.js. The model
// transport (batched verdicts) -> src/checks/llm-client.js. The LLM-or-manual
// orchestration -> src/checks/escalation.js. Authored wording ->
// assets/registry.yaml. Severity -> that registry entry, stamped by runChecks.

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { ARCHIVE_EXTENSIONS, extname } from "../../util/files.js";
import { nonAuthoredJs } from "../../lib/bundled.js";
import { buildReachability } from "../../lib/reachability.js";
import { aggregateGroups } from "../../lib/verdict-resolve.js";
import {
  referrerSupported,
  loaderSites,
  loaderTrace,
  isDocMetadataFile,
  isExperiment,
  DEPENDENCY_FILE_RE,
} from "../../lib/util.js";

/** @typedef {import("../registry.js").RunContext} RunContext */
/** @typedef {import("../../lib/reachability.js").Reachability} Reachability */

// Never flag: dependency manifests / lock files and locale message catalogs.
// Documentation / project metadata (license, readme, and the like) is exempted
// separately by isDocMetadataFile (a doc-type file whose name contains a known doc
// name). The manifest needs no entry: it is not in the corpus (the loader lifts it
// onto ctx), so it is never enumerated here.
const ALLOW = [DEPENDENCY_FILE_RE, /^_locales\//];

// Definite "should not ship" by name: OS/editor junk, source maps. Archives are handled
// separately via ARCHIVE_EXTENSIONS (shared with the loader / committed-build-artifact).
const JUNK = [
  /(^|\/)\.[^/]+(\/|$)/, // a dotfile/dotdir segment (.git/, .DS_Store, .vscode/)
  /(^|\/)(Thumbs\.db|__MACOSX(\/|$))/i,
  /~$/, // editor backups
  /\.(map|orig|bak|swp|tmp)$/i,
];

export default {
  /**
   * @param {RunContext} ctx
   * @returns {{findings: import("../../report/finding.js").Finding[],
   *   llm?: import("../escalation.js").LlmStep}}
   */
  run(ctx) {
    // Registry `input: xpi`: ctx.addon is the built XPI. A file bundled but reached
    // from no entry point is dead weight in what actually ships, so this runs over
    // the XPI - over a source submission it would instead flag every unreferenced
    // config / test / doc in the repo (all noise), while the XPI surfaces the build's
    // own dead files. (The reachability graph is the same XPI's.)
    const { addon } = ctx;
    if (!addon?.files) {
      return { findings: [] };
    }
    const reach = buildReachability(ctx);
    // Recognized third-party files are not the developer's authored code, so an
    // unreached one is not the developer's unused file - exempt it. This reads the
    // XPI's OWN classification (getBundled over ctx.addon), intrinsic to the artifact
    // under review, so it needs no cross-artifact review-target metadata: the
    // non-authored set (hash-identified libraries, minified bundles, obfuscated code,
    // vendored files), all skipped so a bundle is never orphaned by its loader.
    const skip = new Set(nonAuthoredJs(ctx));
    // An Experiment loads its files by mechanisms static analysis can't trace, so
    // "not reachable" is unreliable there - we'd mostly flag working experiment code.
    // Report only unambiguous junk; a separate "review the whole Experiment" check
    // (out of scope) prompts the manual pass.
    const experiment = isExperiment(ctx.manifest);
    const findings = [];
    const candidates = [];
    /**
     * @type {{ids: string[], finding: object}[]} one per file F.
     */
    const groups = [];
    let n = 0;

    for (const file of addon.files.keys()) {
      if (
        skip.has(file) ||
        isDocMetadataFile(file) ||
        ALLOW.some((re) => re.test(file))
      ) {
        continue;
      }
      if (
        JUNK.some((re) => re.test(file)) ||
        ARCHIVE_EXTENSIONS.has(extname(file))
      ) {
        ctx.note?.(file, null, "hidden/junk file", VERDICT.FAIL);
        findings.push(finding({ file }));
        continue;
      }
      if (experiment) {
        continue; // junk only for Experiments; reachability-unused is unreliable
      }
      if (reach.reachable.has(file)) {
        continue;
      }
      // Unreachable. A reference from live code (whether it is a real load is
      // the model's call) or a live dynamic loader makes it ambiguous. A file
      // named only by dead code with no live loader is a clear orphan.
      const mentions = reach.mentionsOf(file);
      const supported = mentions.some((m) => referrerSupported(reach, m.file));
      const orphan = !supported && !reach.hasDynamicLoaders;
      ctx.note?.(
        file,
        null,
        loaderTrace(reach, mentions, supported),
        orphan ? VERDICT.FAIL : VERDICT.UNSURE
      );
      if (orphan) {
        findings.push(finding({ file }));
        continue;
      }
      // One candidate per suspected loader site of this file.
      const ids = [];
      for (const site of loaderSites(reach, mentions, supported)) {
        const id = `U${++n}`;
        ids.push(id);
        candidates.push({
          id,
          file: site.file,
          line: site.line ?? undefined,
          note: `does this site load ${file}?`,
          corpus: [site.file],
        });
      }
      // The finding lists `file` via its location (the recheck key is the file).
      groups.push({ ids, finding: { file } });
    }

    if (!candidates.length) {
      return { findings };
    }
    return { findings, llm: { candidates, resolve: aggregateGroups(groups) } };
  },
};
