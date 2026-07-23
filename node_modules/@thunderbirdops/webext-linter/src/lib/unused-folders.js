// Condenses a set of "unused" file paths against the full packaged-file list:
// when EVERY packaged file under a folder is unused, the folder collapses to a
// single entry (the top-most such folder), recursively, so a fully-unused tree
// reports as one line instead of dozens. Pure path math - no I/O, no findings.
//
// Belongs here: the folder-collapse path logic (collapseUnused) and the in-place
// entry rewrite that applies it to a findings/manual list (collapseUnusedFolders).
// Does NOT belong here: WHICH files are unused (-> src/checks/rules/unused-files.js
// + the escalation resolution) or how the collapsed entries render (->
// src/report/format.js). The orchestrator (runChecks) applies collapseUnusedFolders
// to the final unused-files findings and manual refs, after every check has scanned
// every file.

/**
 * The ancestor directories of a path, shallowest first. For example, "a/b/c.js"
 * yields ["a", "a/b"], and "x.js" yields [].
 * @param {string} path
 * @returns {string[]}
 */
function ancestors(path) {
  const segs = path.split("/");
  const out = [];
  for (let i = 1; i < segs.length; i++) {
    out.push(segs.slice(0, i).join("/"));
  }
  return out;
}

/**
 * Collapse fully-unused folders. A directory is "fully unused" when `allFiles`
 * has at least one path under it and every such path is in `unusedFiles` (so a
 * kept/used/other-bucket file under it blocks the collapse). Each unused file is
 * mapped to its TOP-MOST fully-unused ancestor. Files with none stay as-is.
 * @param {Iterable<string>} unusedFiles  Paths flagged unused (one bucket).
 * @param {Iterable<string>} allFiles  Every packaged file path (the
 *   denominator).
 * @returns {string[]}  Collapsed entries, sorted: folders end with "/", files
 *   are verbatim.
 */
export function collapseUnused(unusedFiles, allFiles) {
  const unusedSet = new Set(unusedFiles);
  // Per-directory tallies: total packaged files under it, and unused ones.
  const total = new Map();
  const unused = new Map();
  /**
   * Increment the tally for `key` in `map` (treating a missing key as 0).
   * @param {Map<string, number>} map
   * @param {string} key
   * @returns {Map<string, number>}
   */
  const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
  for (const f of allFiles) {
    for (const dir of ancestors(f)) {
      bump(total, dir);
    }
  }
  for (const f of unusedSet) {
    for (const dir of ancestors(f)) {
      bump(unused, dir);
    }
  }
  /**
   * Whether a directory has packaged files and every one of them is unused.
   * @param {string} dir
   * @returns {boolean}
   */
  const fullyUnused = (dir) =>
    total.get(dir) > 0 && total.get(dir) === unused.get(dir);

  const folders = new Set();
  const files = [];
  for (const f of unusedSet) {
    const top = ancestors(f).find(fullyUnused); // shallowest fully-unused ancestor
    if (top) {
      folders.add(`${top}/`);
    } else {
      files.push(f);
    }
  }
  return [...folders, ...files].sort();
}

/**
 * Rewrite the unused-files entries (findings OR manual refs) in `entries`,
 * in place, collapsing fully-unused folders to a single top-most folder entry
 * (see collapseUnused). Only acts when at least one folder forms, so the common
 * "nothing collapses" case leaves the array untouched (no reordering). The first
 * unused-files entry serves as the template, so the collapsed entries keep its
 * `ruleId` + `severity` (findings) / `ruleId` + `kind` (manual refs). Each new
 * entry sets `file` to the collapsed path and clears `loc`/`item`.
 * The denominator is a RESOLVER, not a file list, and deliberately so. This post-pass keys off
 * a ruleId, so it is artifact-specific by definition - "every packaged file under this folder
 * is unused" is only true of the artifact whose paths the findings carry. Hand it a list and
 * the caller must pick that artifact, which is a choice it can get wrong: unused-files is
 * `input: xpi`, so its paths are the built XPI's, while the orchestrator's own `ctx.addon` is the
 * REVIEW TARGET - the readable source in SCA, a different tree entirely, against which "all
 * files under this folder are unused" goes vacuously true and the report tells the developer
 * to delete a folder the shipped add-on still imports from. Asking for the files OF THE RULE
 * being collapsed removes the choice: there is no list to pass, and none to pass wrongly.
 * @param {Array<{ruleId?: string, file?: ?string}>} entries
 * @param {(ruleId: string) => string[]} filesOfRule  Every packaged file path of the artifact
 *   the given rule's OUTPUT describes (see ctxForRule in src/checks/registry.js).
 */
export function collapseUnusedFolders(entries, filesOfRule) {
  const idx = [];
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].ruleId === "unused-files" && entries[i].file) {
      idx.push(i);
    }
  }
  if (!idx.length) {
    return;
  }
  const collapsed = collapseUnused(
    idx.map((i) => entries[i].file),
    filesOfRule("unused-files")
  );
  if (!collapsed.some((p) => p.endsWith("/"))) {
    return; // no folder formed - leave the per-file entries (and their order) as-is
  }
  const base = entries[idx[0]];
  const replacements = collapsed.map((file) => ({
    ...base,
    file,
    loc: null,
    item: null,
  }));
  const drop = new Set(idx);
  const rebuilt = [];
  for (let i = 0; i < entries.length; i++) {
    if (i === idx[0]) {
      rebuilt.push(...replacements); // collapsed group takes the first match's slot
    }
    if (!drop.has(i)) {
      rebuilt.push(entries[i]);
    }
  }
  entries.splice(0, entries.length, ...rebuilt);
}
