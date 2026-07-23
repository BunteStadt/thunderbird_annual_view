// Referenced files must be bundled. Flags add-on-internal files that are
// referenced but not present in the package:
//   - manifest entries: content_scripts js/css, background scripts/page/
//     service_worker, options_ui.page, *_action.default_popup,
//   - file-loading API calls: every packaged-file path the schema-directed +
//     bridge extractor finds (register/setIcon/theme/menus, executeScript/
//     insertCSS, getURL, tabs.create, *.setPopup, ...) - see loader-files.js.
// Complements the remote-resources check (which catches remote sources).
//
// Belongs here: gathering referenced paths from both sources, keeping only
// packaged-file candidates (relative/root-relative, no scheme), and emitting a
// finding for each that is absent from the package.
//
// Does NOT belong here: extracting manifest file refs (-> src/lib/
// manifest-refs.js), extracting loader-API file refs (->
// src/parse/loader-files. js), URL classification (-> src/scan/url.js), the
// remote-source verdict (-> remote-resources.js), authored wording (->
// assets/registry.yaml), severity (-> that registry entry, stamped by
// src/checks/registry.js), and report formatting (-> src/report/format.js).

import { VERDICT } from "../../lib/enum.js";
import { finding } from "../../report/finding.js";
import { loaderRefsOf } from "../extract.js";
import { buildReachability } from "../../lib/reachability.js";
import { classifyUrl } from "../../scan/url.js";
import {
  manifestFileRefs,
  normalizeRef,
  resolveRef,
  resolveRefStatus,
} from "../../lib/manifest-refs.js";
import { scriptHostDirs, resolvePageRelative } from "../../lib/script-hosts.js";
import { manifestTokenLine, SCHEME_RE } from "../../lib/util.js";

export default {
  run(ctx) {
    // Registry `input: xpi`: ctx.addon is the built XPI. File-completeness is a
    // property of what actually ships - declared paths resolve against the XPI's OWN
    // files. In a source submission the built layout legitimately renames/relocates
    // entry scripts, so resolving these refs against the readable source would
    // falsely report every built path as "not bundled".
    const { addon } = ctx;
    const out = [];
    // Manifest paths are root-relative: satisfied only when the path resolves
    // WITHIN the package root to a bundled file ("ok"). "missing" (no such file)
    // and "escapes" (a ".." climbing outside the add-on - a wrong path) both
    // fail. (Loader-API refs below clamp ".." instead, matching Gecko's URL
    // resolution, so they never "escape".)
    /** @param {string} p @returns {boolean} whether the file is bundled. */
    const rootOk = (p) => resolveRefStatus(addon.files, null, p).kind === "ok";

    // 1. Files referenced from the manifest. Anchor on the manifest.json line
    // that cites the path (located by its quoted form), so the finding points at
    // the actual reference, not just the file; null loc when it cannot be found.
    if (ctx.manifest) {
      const manifestText = ctx.manifestText;
      for (const { path } of manifestFileRefs(ctx.manifest)) {
        if (typeof path !== "string") {
          continue;
        }
        const line = manifestTokenLine(manifestText, path);
        const loc = line ? { line } : null;
        const present = rootOk(path);
        ctx.note?.(
          "manifest.json",
          loc,
          path,
          present ? VERDICT.PASS : VERDICT.FAIL
        );
        if (!present) {
          out.push(finding({ file: "manifest.json", loc, item: path }));
        }
      }
    }

    // 2. Files referenced by file-loading API calls (schema-directed + bridge).
    // A base:"page" loader path (tabs.create {url}, executeScript {file}, menus
    // icons, ...) resolves against the calling script's HOST PAGE directory (".."
    // clamped at root); getURL/scripting.* (base:"root") are root-relative.
    //
    // Like the manifest refs above, loader refs are a property of the built XPI:
    // its scripts, its load graph, and the files they must resolve to - all read
    // from ctx.addon (the XPI, per `input: xpi`), so a source submission's pre-build
    // loader paths are never matched against the readable source tree.
    //
    // Only LIVE scripts are checked: a script reached from no entry point never
    // runs, so its loader calls never fire - a reference it makes to an absent
    // file is dead-code noise (an unused-files matter), not a missing bundled
    // file. isLive covers general + content-script reachability, so background,
    // content, and page-hosted scripts stay checked; only true orphans are skipped.
    const { isLive } = buildReachability(ctx);
    const hostDirs = scriptHostDirs(ctx);
    const seen = new Set();
    for (const src of ctx.jsSources) {
      if (!isLive(src.file)) {
        continue;
      }
      const { refs } = loaderRefsOf(src);
      for (const ref of refs) {
        if (!isPackagedPathRef(ref.path)) {
          continue;
        }
        const dedupKey = `${src.file}|${normalizeRef(ref.path)}`;
        if (seen.has(dedupKey)) {
          continue;
        }
        seen.add(dedupKey);
        const loc = { line: ref.line, column: ref.column };
        const present =
          ref.base === "page"
            ? resolvePageRelative(addon.files, hostDirs, src.file, ref.path) !=
              null
            : resolveRef(addon.files, null, ref.path) != null;
        ctx.note?.(
          src.file,
          loc,
          ref.path,
          present ? VERDICT.PASS : VERDICT.FAIL
        );
        if (!present) {
          out.push(finding({ file: src.file, loc, item: ref.path }));
        }
      }
    }

    return out;
  },
};

/**
 * True if a reference looks like a packaged add-on file (relative / root-
 * relative, no URI scheme, not a bare fragment), so a missing target is a real
 * "not bundled" error rather than an external/remote resource.
 * @param {string} raw  Referenced path.
 * @returns {boolean}
 */
function isPackagedPathRef(raw) {
  const s = String(raw ?? "").trim();
  if (s === "" || s.startsWith("#")) {
    return false;
  }
  if (SCHEME_RE.test(s)) {
    return false; // about:, moz-extension:, chrome:, http:, ...
  }
  return classifyUrl(s).local; // also drops protocol-relative "//host/x"
}
