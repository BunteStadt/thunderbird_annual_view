// Selects the build files the SCA build analysis (analyzeBuild, ./analyze.js) sends to the
// model, by COLLECTING from package.json (an allowlist), not by pruning the whole build tree. The
// build has a deterministic entry point exactly like the normal review's manifest.json:
// package.json. We seed from it and follow its `scripts`, so a file is collected only
// because the build references it. Build OUTPUT (a committed dist/, a built .xpi), docs,
// images, and tooling the build never runs are simply never collected - no exclude lists.
//
// Following a script (shallow-tokenized - NOT a real shell): a recognized build tool
// (BUILD_TOOLS) contributes its convention config file(s), which the tool auto-discovers
// by name; a referenced local file (node x.mjs, ./build.sh, a copied path) is collected,
// and a shell script is followed one level deeper - collecting the files it names and
// recognizing the tools it invokes (so `npx webpack` inside build.sh collects
// webpack.config). A reference not in the submission is silently ignored (the dev did not
// pack it, so it cannot run). Two steps the linter cannot statically bound are surfaced as
// `unresolved` (-> human review): an OPAQUE orchestrator (make/gradle/... - a non-npm build
// system), and a network fetch (curl/wget/an http(s) URL) in a script. Ordinary npm CLIs
// (eslint/rimraf/jest/a bundler) are NOT flagged - they run from the declared dependencies.
//
// Belongs here: the collection policy and the script scan. Does NOT belong here: loading
// the build files (-> src/addon/load.js selectScaBuildFiles), running the analysis / model
// transport (-> ./analyze.js + src/llm/provider.js), the finding/manual mapping or wording
// (-> src/checks/rules/undeclared-build-source.js + assets/registry.yaml).

import { ARCHIVE_EXTENSIONS, basename, extname } from "../util/files.js";
import { resolveRef } from "../lib/manifest-refs.js";

/** Recognized build tools -> their convention config filenames (auto-discovered by name,
 *  so a reference walk never sees them). Recognition also marks the tool KNOWN, so it is
 *  not reported as unresolved. Kept comprehensive for the WebExtension ecosystem - the two
 *  WebExtension build frameworks `wxt` and `web-ext` are here alongside the bundlers, so a
 *  config carrying an exfil is not missed. */
const BUILD_TOOLS = new Map([
  [
    "webpack",
    [
      "webpack.config.js",
      "webpack.config.cjs",
      "webpack.config.mjs",
      "webpack.config.ts",
    ],
  ],
  [
    "vite",
    ["vite.config.js", "vite.config.cjs", "vite.config.mjs", "vite.config.ts"],
  ],
  [
    "rollup",
    [
      "rollup.config.js",
      "rollup.config.cjs",
      "rollup.config.mjs",
      "rollup.config.ts",
    ],
  ],
  [
    "rspack",
    [
      "rspack.config.js",
      "rspack.config.cjs",
      "rspack.config.mjs",
      "rspack.config.ts",
    ],
  ],
  ["esbuild", []],
  [
    "tsup",
    ["tsup.config.js", "tsup.config.cjs", "tsup.config.mjs", "tsup.config.ts"],
  ],
  ["tsc", ["tsconfig.json"]],
  ["parcel", [".parcelrc"]],
  ["wxt", ["wxt.config.ts", "wxt.config.js", "wxt.config.mjs"]],
  [
    "web-ext",
    ["web-ext-config.js", "web-ext-config.cjs", "web-ext-config.mjs"],
  ],
  [
    "babel",
    [
      "babel.config.js",
      "babel.config.cjs",
      "babel.config.mjs",
      "babel.config.json",
      ".babelrc",
      ".babelrc.js",
      ".babelrc.cjs",
      ".babelrc.json",
    ],
  ],
  [
    "postcss",
    [
      "postcss.config.js",
      "postcss.config.cjs",
      "postcss.config.mjs",
      "postcss.config.json",
    ],
  ],
  [
    "tailwindcss",
    [
      "tailwind.config.js",
      "tailwind.config.cjs",
      "tailwind.config.mjs",
      "tailwind.config.ts",
    ],
  ],
  [
    "svelte-kit",
    ["svelte.config.js", "svelte.config.cjs", "svelte.config.mjs"],
  ],
  ["gulp", ["gulpfile.js", "gulpfile.cjs", "gulpfile.mjs"]],
]);

/** Package-manager / runner wrappers that precede the real command. */
const RUNNERS = new Set([
  "npx",
  "pnpm",
  "npm",
  "yarn",
  "cross-env",
  "node",
  "bash",
  "sh",
]);
/** Tools that take other script NAMES as their arguments (recurse into each). */
const SCRIPT_RUNNERS = new Set([
  "run-s",
  "run-p",
  "npm-run-all",
  "concurrently",
]);

/** Opaque, non-npm build orchestrators the linter cannot follow: their presence in a
 *  script means the build corpus is incomplete -> human review. */
const OPAQUE_TOOLS = new Set([
  "make",
  "gmake",
  "cmake",
  "gradle",
  "gradlew",
  "mvn",
  "maven",
  "rake",
  "bazel",
  "buck",
  "ninja",
  "scons",
  "ant",
  "task",
  "just",
  "mage",
  "meson",
  "waf",
  "configure",
  "./configure",
  "cargo",
  "go",
]);

/** npm/pnpm/yarn subcommands that are NOT a script invocation. */
const PM_SUBCOMMANDS = new Set([
  "install",
  "i",
  "ci",
  "add",
  "remove",
  "rm",
  "update",
  "up",
  "audit",
  "publish",
  "pack",
  "link",
  "unlink",
  "prune",
  "rebuild",
  "config",
  "why",
]);

/**
 * @param {{files: Map<string, Buffer>}} build  The build files (ctx.addon in build ctx).
 * @returns {{corpus: string[], resolved: string[], unresolved: {kind: string, detail: string}[]}}
 *   corpus = the file paths to send the model; resolved = recognized build-tool names;
 *   unresolved = build steps the linter could not statically bound (force human review).
 */
export function selectBuildCorpus(build) {
  const files = build?.files ?? new Map();
  const keep = new Set();
  const resolved = new Set();
  const unresolved = [];
  const seenUnresolved = new Set();
  const flag = (kind, detail) => {
    const k = `${kind}:${detail}`;
    if (!seenUnresolved.has(k)) {
      seenUnresolved.add(k);
      unresolved.push({ kind, detail });
    }
  };
  const keepRef = (raw) => {
    const key = resolveRef(files, null, stripPathArg(raw));
    // A build script names an archive only as its OUTPUT (a zip target); it is binary,
    // never build input, so it is never collected (and committed-build-artifact rejects
    // a committed one separately).
    if (key && !ARCHIVE_EXTENSIONS.has(extname(key))) {
      keep.add(key);
      return key;
    }
    return null;
  };
  const scanNetwork = (text, where) => {
    if (
      /\b(curl|wget|Invoke-WebRequest)\b/.test(text) ||
      /https?:\/\//.test(text)
    ) {
      flag("network", where);
    }
  };

  // Seeds: package.json (the declared deps + scripts) and every .npmrc (registry config).
  // NOT the lock file - it is large, mostly integrity hashes, and adds no build-safety
  // signal the model can use; the deterministic dep/registry checks read it directly.
  if (files.has("package.json")) {
    keep.add("package.json");
  }
  for (const p of files.keys()) {
    if (basename(p) === ".npmrc") {
      keep.add(p);
    }
  }

  const pkg = parseJson(files.get("package.json"));
  const scripts =
    pkg && typeof pkg.scripts === "object" && pkg.scripts ? pkg.scripts : {};
  const seenScript = new Set();

  const runScript = (name, depth) => {
    if (
      depth > 5 ||
      seenScript.has(name) ||
      typeof scripts[name] !== "string"
    ) {
      return;
    }
    seenScript.add(name);
    scanNetwork(scripts[name], `the "${name}" script`);
    for (const seg of shellSegments(scripts[name])) {
      classifyCommand(words(seg), depth);
    }
  };

  const classifyCommand = (ws, depth) => {
    let i = 0;
    // Strip leading `ENV=val` assignments.
    while (i < ws.length && /^[A-Za-z_]\w*=/.test(ws[i])) {
      i++;
    }
    if (i >= ws.length) {
      return;
    }
    let cmd = ws[i];
    let args = ws.slice(i + 1);
    // Unwrap runner wrappers to the real command.
    while (RUNNERS.has(cmd) && args.length) {
      if (cmd === "cross-env") {
        let j = 0;
        while (j < args.length && /^[A-Za-z_]\w*=/.test(args[j])) {
          j++;
        }
        cmd = args[j];
        args = args.slice(j + 1);
      } else if (cmd === "node") {
        keepRef(args[0]); // node <script.js> - the build script is authored logic
        return;
      } else if (cmd === "bash" || cmd === "sh") {
        const key = keepRef(args[0]);
        if (key) {
          followShell(key, depth + 1);
        }
        return;
      } else if (cmd === "npm" || cmd === "pnpm" || cmd === "yarn") {
        const sub = args[0];
        if (sub === "run" || sub === "run-script") {
          runScript(args[1], depth + 1);
          return;
        }
        if (sub === "exec" || sub === "dlx") {
          cmd = args[1];
          args = args.slice(2);
        } else if (sub && !PM_SUBCOMMANDS.has(sub) && !sub.startsWith("-")) {
          runScript(sub, depth + 1); // `pnpm build` shorthand for `pnpm run build`
          return;
        } else {
          return; // install/ci/... - not a build-tool invocation
        }
      } else if (cmd === "npx") {
        cmd = args[0];
        args = args.slice(1);
      }
    }
    if (!cmd) {
      return;
    }
    if (SCRIPT_RUNNERS.has(cmd)) {
      for (const a of args) {
        if (!a.startsWith("-")) {
          runScript(a, depth + 1);
        }
      }
      return;
    }
    if (BUILD_TOOLS.has(cmd)) {
      resolved.add(cmd);
      for (const config of BUILD_TOOLS.get(cmd)) {
        if (files.has(config)) {
          keep.add(config);
        }
      }
      const cfg = configFlag(args);
      if (cfg) {
        keepRef(cfg);
      }
      return;
    }
    // A local path invoked directly (./scripts/build.sh, scripts/x.mjs).
    if (looksLikePath(cmd)) {
      const key = keepRef(cmd);
      if (key && key.endsWith(".sh")) {
        followShell(key, depth + 1);
      }
      return;
    }
    // An opaque, non-npm build orchestrator (make/gradle/...) cannot be followed, so the
    // build corpus is incomplete -> flag. Any OTHER unrecognized command (an npm CLI, a
    // custom bin from a declared dependency) is left alone: it runs from the declared
    // dependencies and the model still sees the invoking script in package.json.
    if (OPAQUE_TOOLS.has(cmd)) {
      flag("tool", cmd);
    }
  };

  // One level into a referenced shell script: recognize the tools it invokes (collect
  // their configs), collect the local files it names, and flag any network fetch. Bounded -
  // a build shell is small and we do not chase deeply.
  const followShell = (key, depth) => {
    if (depth > 5) {
      return;
    }
    const text = files.get(key)?.toString("utf8") ?? "";
    scanNetwork(text, key);
    for (const seg of shellSegments(text)) {
      const ws = words(seg);
      classifyCommand(ws, depth); // recognize `npx webpack`, follow `bash ./sub.sh`, ...
      for (const w of ws) {
        // Files an arbitrary command names (a `cp foo.js dist/`) that classifyCommand,
        // which only reads the command token, does not itself collect. keepRef skips a
        // named archive (a zip output).
        if (looksLikePath(w)) {
          keepRef(w);
        }
      }
    }
  };

  for (const name of Object.keys(scripts)) {
    runScript(name, 0);
  }

  return {
    corpus: [...keep],
    resolved: [...resolved],
    unresolved,
  };
}

/** JSON.parse a buffer, or null. */
function parseJson(buf) {
  if (!buf) {
    return null;
  }
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    return null;
  }
}

/** Split a script command on shell control operators (a shallow tokenizer, not a
 *  shell): `a && b | c ; d` -> ["a", "b", "c", "d"]. */
function shellSegments(cmd) {
  return cmd
    .split(/(?:&&|\|\||[;\n]|(?<!&)&(?!&)|(?<!\|)\|(?!\|))/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Split a segment into words, honoring simple single/double quotes. */
function words(seg) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(seg))) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

/** The value of a --config/-c flag among a tool's args, or null. */
function configFlag(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--config" || a === "-c") {
      return args[i + 1] ?? null;
    }
    const eq = a.match(/^--config=(.+)$/);
    if (eq) {
      return eq[1];
    }
  }
  return null;
}

/** A token that could be a repo-relative path (not a flag, not a bare tool name). */
function looksLikePath(w) {
  if (!w || w.startsWith("-") || w.startsWith("$")) {
    return false;
  }
  return (
    w.startsWith("./") ||
    w.startsWith("../") ||
    w.includes("/") ||
    /\.[a-z0-9]+$/i.test(w)
  );
}

/** Strip a trailing ?query/#hash or leading ./ so resolveRef sees a plain path. */
function stripPathArg(w) {
  return w.replace(/^\.\//, "").replace(/[?#].*$/, "");
}
