# webext-linter

Verifies Thunderbird WebExtensions against the [annotated WebExtension API
schemas](https://github.com/thunderbird/webext-annotated-schemas) and ATN review
policies. The tool will report API, manifest, permission, and bundled-code
issues. It does not modify the reviewed sources.

The schema verification works like
[`addons-linter`](https://github.com/mozilla/addons-linter) - parsing the
JavaScript, TypeScript and Vue source and matching `browser.*` / `messenger.*` /
`chrome.*` calls against the API surface - but uses Thunderbird's annotated
schema files.

Beyond the deterministic checks, a few review judgments that resist static
analysis can optionally be delegated to an LLM (Claude, ChatGPT, or a local
Ollama model). See the LLM checks under Review checks below.


## Usage

```sh
npm install
```

Show all options:

```sh
npm run help
```

Run the `node` script directly:

```sh
node verify.js <xpi|folder> [options]
```

Or install it as a command and run it from anywhere:

```sh
npm install -g .    # from a clone of this repo
webext-linter <xpi|folder> [options]
```

For development, use `npm link` instead of `npm install -g .` so the command
tracks your working copy. Once the package is published to npm,
`npm install -g webext-linter` and `npx webext-linter` work as well.

The schema review picks the matching schema **automatically** from the add-on's
own manifest — no channel flag. Two dimensions:

- **Manifest version**: `manifest_version` selects `mv2` vs `mv3`. An add-on that
  omits it (or has a missing/invalid manifest) is treated as MV2.
- **Channel** (`release`, `esr`, `beta`): chosen from the add-on's supported
  version range. The **upper bound** (`strict_max_version`) decides: an add-on
  capped at a channel's own Thunderbird major targets that train, so its schema is
  used — e.g. `strict_max_version: "140.*"` with ESR at 140 → the **ESR** schema
  (whose `version_added` entries reflect APIs backported into the ESR train). With
  no cap, or a cap that matches no cached train, it falls back to **release**; the
  `version_added` checks still flag genuinely unsupported APIs.

The options, grouped as in `--help`:

**Cache:** the schema, the library-hash DB and the allowed-experiments list are each
downloaded once and reused; the CDN lookup cache fills incrementally as a best-effort
side-channel.

| Option | Description |
| --- | --- |
| `--cache-clear` | Delete every cache directory below before the review, so all fetched sources (schema, library-hash DB, CDN lookups, allowed-experiments) are re-downloaded from scratch — as on a first run. It also wipes `.llm-model-cache/`, the one cache with no directory flag of its own (see [LLM configuration](#llm-configuration)). |
| `--cache-schema-dir <dir>` | Where the downloaded schema zips are cached (default `.schema-cache`). |
| `--cache-hash-db-dir <dir>` | Where the fetched library-hash database (the addons-linter "dispensary" `hashes.txt`, used by `missing-library` to identify a bundled library by its exact content hash) is cached (default `.lib-mozilla-hash-db-cache`). |
| `--cache-cdn-lookup-dir <dir>` | Where the jsDelivr CDN hash-lookup results are cached — best-effort, backing the optional `--cdn-lib-lookup` (default `.lib-cdn-lookup-cache`). |
| `--cache-experiments-dir <dir>` | Where the fetched allowed-experiments zip (the Thunderbird Draft-API list feeding the Experiment checks, e.g. `experiment-modified`) is cached (default `.experiments-cache`). |

The banned/unadvised library policy (`assets/library-blocks.yaml`, read by `banned-library`) is curated by hand from Mozilla's [addons-linter third-party library docs](https://github.com/mozilla/addons-linter/blob/master/docs/third-party-libraries.md), since Mozilla ships no machine-readable list; that page
is monitored and upstream changes are ported manually.

**Check selection:**

| Option | Description |
| --- | --- |
| `--checks-only <ids>` | Only run these checks (comma-separated). See the check list below. |
| `--checks-skip <ids>` | Skip these checks (comma-separated). See the check list below. |

**Report output:**

| Option | Description |
| --- | --- |
| `--report-format <text\|json>` | Report output format (default `text`). |
| `--report-out <file>` | Write the report to a file in addition to stdout. |

**LLM checks:**

| Option | Description |
| --- | --- |
| `--llm-review` | Run the AI review (the sole LLM on-switch, off by default): the model re-judges the "unsure" items other checks escalated, and a **"Summary of add-on"** section is added (plus a **"Summary of changes"** with `--diff-to`). The key is read from the `LLM_API_KEY` environment variable (see [LLM configuration](#llm-configuration)). |
| `--llm-list-models` | List the models your token can use, then exit. |

**Source code archive (SCA):**

| Option | Description |
| --- | --- |
| `--sca-root <folder\|zip>` | The source archive root (holds `package.json`/lock). Switches to SCA mode. The readable source is reviewed for code defects and its declared dependencies are audited for popularity + vulnerabilities; the built XPI (the positional path) is the shipped artifact - it supplies the manifest, experiments, file-completeness checks (bundled/web-accessible/unused), the `--diff-to` baseline, and the packaging summary (the behavioral `--llm-review` reviews the readable source). See [Source code archive (SCA) mode](#source-code-archive-sca-mode) below. |
| `--sca-source <path>` | The add-on code root, relative to `--sca-root` or an absolute path (e.g. `src` or `addon`). Optional; defaults to `.` (the whole `--sca-root` reviewed as the source - a flat layout with `manifest.json` at the root). Needs `--sca-root`. |
| `--sca-exp-source <path>` | The Experiment implementation folder, relative to `--sca-root` or an absolute path, and within `--sca-source` (e.g. `addon/experiment-api`). Its privileged, non-WebExtension files are excluded from the WebExtension API/permission/eval checks. Needs `--sca-root`; required when `--allow-experiments` is used in SCA mode. |

**Other:**

| Option | Description |
| --- | --- |
| `--allow-experiments` | Accept add-ons that use Experiment APIs, instead of rejecting them as unsupported. Off by default. |
| `--cdn-lib-lookup <true\|false>` | Identify an unrecognized bundled library (minified or readable) by a jsDelivr content-hash lookup (default `true`). Results are cached; an offline run simply finds no match. |
| `--diff-to <xpi\|folder>` | Previously published version, to diff against. With `--llm-review`, adds an AI **"Summary of changes"** section (how the add-on changed since this baseline). |
| `--eslint` | Run the ESLint `code-sanity` check on authored JS. Off by default. |
| `--verbose` | Verbose logging. |

**Exit codes:** `0` no errors · `1` one or more error-severity findings · `2`
tool failure.

### LLM configuration

The LLM checks are configured from the environment, and enabled via the `--llm-review` flag:

| Variable | Description |
| --- | --- |
| `LLM_API_TYPE` | Provider: `claude` (default), `chatgpt`, or `ollama` (local). |
| `LLM_API_KEY` | The provider API key. Required for `claude`/`chatgpt`, not used by `ollama`. |
| `LLM_API_MODEL` | Model for the LLM checks (default: the one named in `assets/llm/<type>.yaml`). |
| `LLM_API_URL` | Override the provider's API base URL (e.g. a proxy, or a remote Ollama host). |

```sh
# Claude (the default provider)
export LLM_API_KEY=sk-ant-...
node verify.js <xpi|folder> --llm-review

# ChatGPT
export LLM_API_TYPE=chatgpt
export LLM_API_KEY=sk-...
node verify.js <xpi|folder> --llm-review

# local Ollama - no API key
export LLM_API_TYPE=ollama
node verify.js <xpi|folder> --llm-review
```

**The model table (`assets/llm/<type>.yaml`).** Everything the tool knows about a
model lives in one hand-curated, read-only asset per `LLM_API_TYPE` —
`assets/llm/claude.yaml`, `assets/llm/chatgpt.yaml`, `assets/llm/ollama.yaml`.
Each holds a `default:` block (the model a run uses when `LLM_API_MODEL` is unset,
and `maxRequests`, the number of model requests one run may make before pausing)
and a `models:` list. A model entry is keyed by either `name:` (one exact model id)
or `match:` (a regex over the id), and carries the `endpoint:` that serves it plus
a `parameters:` map that is spread verbatim into the request body — the
output-token cap among them, so a new knob is a YAML edit rather than a code
change. (Anthropic serves every model from a single endpoint, so `claude.yaml`
declares none.) A model resolves against the `name:` entries first, then the
`match:` entries in file order, which makes the trailing `- match: .*` catch-all
the last resort.

That table is what lets the OpenAI models that are *not* served by
`/v1/chat/completions` work: a `gpt-5.1-codex-max` request goes to `/v1/responses`
with `max_output_tokens`, and a `gpt-5` / o-series reasoning model on chat is sent
`max_completion_tokens` instead of `max_tokens`. OpenAI publishes no
capability-discovery endpoint, so the table is a starting guess. When a server
rejects a request shape, the OpenAI adapter repairs it from the rejection itself —
renaming the token parameter, or moving the request to `/v1/responses` — and, once
the answer has actually been read, caches the **delta** (the endpoint and the
parameter rename, nothing else) in the gitignored `.llm-model-cache/` directory,
keyed by base URL and model. The next run sends the working shape straight away,
so the probe is paid once per server and model rather than once per run;
`--cache-clear` wipes what was learned. The shipped YAML is never written to, so a
hand edit still wins on everything the negotiation did not learn (a raised
output-token cap, `maxRequests`).

**Local model (Ollama).** With [Ollama](https://ollama.com) running, the checks
talk to its OpenAI-compatible endpoint at `http://localhost:11434/v1` — no API
key. Pull a tool-capable model first (the structured checks require tool calling),
e.g. `ollama pull llama3.1`. When the LLM is enabled, a Setup-step pre-flight
shows the chosen type and model and **fails hard** if Ollama is unreachable or the
model is not pulled. Point `LLM_API_URL` at a remote host to use a non-local Ollama.


### Source code archive (SCA) mode

Some add-ons are submitted as **both** a built XPI (minified, what users install)
and a **readable source archive**. Reviewing the minified XPI directly is noisy, so
SCA mode reviews the readable source instead while still treating the XPI as the
authoritative shipped artifact:

```
node verify.js built.xpi --sca-root ./source-archive --sca-source src
```

SCA only helps when the built XPI can't be read directly. If the shipped XPI's first-party
code is **not** minified or obfuscated, the source archive adds nothing: the review is
performed on the XPI directly (a plain XPI review) and `sca-not-required` (warning) is
reported. Submit only the XPI in that case — a source archive is needed only for a
minified/obfuscated build.

- `--sca-root` is the source archive (folder or zip) that holds `package.json` /
  the lock file; setting it switches on SCA mode. `--sca-source` is the add-on code
  root within it (relative to `--sca-root` or an absolute path, e.g. `src`); it is
  **optional and defaults to `.`** - the whole `--sca-root` reviewed as the source, for
  a flat layout with `manifest.json` at the root (`node verify.js built.xpi --sca-root
  ./source-archive`).
- The **readable source** is reviewed for code defects (the API/permission/eval/
  exfiltration checks run over every source file).
- The **declared dependencies** (`--sca-root`'s `package.json`) are audited: each
  must be a pinned npm package or a GitHub URL, and is gated on popularity
  (npm downloads / GitHub stars) and known vulnerabilities. Anything unpinned or
  from another source is rejected.
- The **build tooling** (everything in `--sca-root` outside `--sca-source` - build
  scripts, configs, `.npmrc`) is reviewed. Deterministic policy: the build must use
  **npm or pnpm** (a `yarn.lock` / `bun` build is rejected), must not commit a
  `node_modules` folder or a built archive (`.xpi` / `.zip` - both are build output,
  never shipped in a source submission), must not point the package registry elsewhere
  (an `.npmrc` `registry=` is rejected), and any `package.json` install hook
  (`postinstall`, …) is flagged. Then one setup model call classifies the build (over
  the files reached from `package.json`), and two checks gate on it: it must **not
  fetch code or a resource from an undeclared source** (a raw URL, `curl|sh`, an
  unpinned `git clone`, a CDN, a postinstall hook), and must be **built from the source**
  (not packaged from committed artifacts).
- The **built XPI** (the positional path) is the shipped artifact: it supplies the
  manifest, the experiments, the file-completeness checks (bundled / web-accessible
  / unused / locales), the `--diff-to` baseline, and the packaging summary. The
  behavioral `--llm-review` reviews the readable source instead (see below).
- `--sca-exp-source` names an Experiment implementation folder - relative to
  `--sca-root` (or absolute), and within `--sca-source` (e.g. `addon/experiment-api`)
  - so its privileged, non-WebExtension code is excluded from the WebExtension checks
  (required when `--allow-experiments` is used in SCA mode).
- Because a review spans two artifacts, each finding's `file:line` is prefixed with the
  artifact it lives in - `[XPI]` (the built XPI) or `[SCA]` (the readable source code
  archive) - so a reviewer knows which one to open; the Issues section closes with a
  legend, and the same prefix appears on the live activity feed. A plain XPI review
  (one artifact) adds no prefix.


## Review checks

Every check is declared in [assets/registry.yaml](assets/registry.yaml), and the
section it lives in **is** its phase: the orchestrator looks up the phases it runs,
in order. A section it never asks for is inert.

- **`invalid-experiment-phase`** - the single reject check. An Experiment bundling an
  unsupported API draft (without `--allow-experiments`) is rejected outright, and this
  phase runs ALONE - no other check, no LLM, no manual reminders.
- **`deterministic-phase`** - every case is decided in code, offline apart from the
  one-time vendor source fetch: the check itself never calls the model. Deterministic
  does not mean the phase is model-free, though - a check here may also escalate a
  case it cannot settle, and two of them (`unused-permission`,
  `missing-english-localization`) name a **recheck consumer** that re-judges those
  escalations with the model under `--llm-review`. A few checks are gated by review
  mode (`diff: true`/`false`, `sca: true`/`false`).
- **`llm-phase`** - a deterministic pre-flight always runs offline; only the ambiguous
  residue is delegated to an LLM (when one is configured) or routed to manual review.
- **`post-summary-phase`** - the `--llm-review` recheck **consumers**, which re-judge a
  producer's escalated items with the whole add-on in view. They run after the AI
  summary, which is what they read; a consumer is named by its producer's
  `post-summary-recheck:` field, and the producer may sit in either the deterministic
  or the llm phase.
- **`manual-checks`** - checks the tool can't make itself, surfaced as a todo list. Not
  a phase: the orchestrator never asks for this section.

The full flow - setup, the stores it computes, the orchestrator, and how one check of
each phase runs - is described in
[docs/check-flow.html](docs/check-flow.html) ("The review pipeline").

The tables below are an illustrative selection, not the full catalogue. For the
complete, registry-synced list of every check with its own page, see
[docs/index.html](docs/index.html).

### Deterministic checks

Each `deterministic-phase` entry links to a module in
[src/checks/rules/](src/checks/rules/) and supplies the severity for its
findings. A deterministic check decides each case in code - as a finding, or as an
escalation of a case it cannot settle. An escalation goes straight to manual review
(e.g. `vendor-unverified`, `native-messaging`), unless the check names a
post-summary recheck consumer (`unused-permission`,
`missing-english-localization`): under `--llm-review` those cases are re-judged by
the model instead, and only then fall back to manual review. The LLM checks
escalate only their ambiguous residue.

| Check | What it flags |
| --- | --- |
| `api-coverage` | Dynamic/aliased API access static analysis can't resolve (info). Files that fail to parse are `unparsable-file`. |
| `async-onmessage` | An async listener passed to `runtime.onMessage.addListener()`. |
| `background-module` | A background script (`background.scripts`/`service_worker`) that uses static ES module syntax (`import`/`export`) while the manifest's background is not declared `"type": "module"` - it won't load as a module (error). Background pages and content scripts are out of scope. |
| `bundled-files` | Referenced files that aren't packaged: `content_scripts`/`background`/popup/options manifest entries, and packaged-file paths passed to file-loading API calls (script registration, `setIcon`, `executeScript`/`insertCSS`, `getURL`, ...) - the same schema-derived loader set that fuels the reference graph, not a hardcoded list. |
| `cleartext-transmission` | Data transmitted to a remote host over an unencrypted scheme (`http://`/`ws://`/`ftp://`) by an overt API (`fetch`, XHR, WebSocket, `sendBeacon`) - any cleartext send, regardless of payload (error). Covert disguised channels are the `disguised-*` checks. |
| `code-sanity` | Opt-in (only runs with `--eslint`). ESLint-based code errors: `no-redeclare`, `no-shadow`, dupe/unreachable/self-* rules, empty blocks (`no-empty`, e.g. an error-swallowing empty `catch`) (info). Style/fixable rules (e.g. `prefer-const`) are excluded - the tool is read-only, so "rewrite this" is not a review concern. No `no-undef` (WebExtension scripts share a global scope). |
| `csp-unsafe-eval` | A `content_security_policy` that allows `'unsafe-eval'` - permits dynamic code execution (error). |
| `csp-unsafe-inline` | A `content_security_policy` that allows `'unsafe-inline'` - permits dynamic code execution via inline scripts (error). |
| `debugger-statement` | Unconditional `debugger` statements. |
| `default-locale-missing` | A packaged `_locales/` directory but no `default_locale` manifest key - Thunderbird refuses to load the add-on (error). |
| `default-locale-unused` | A `default_locale` manifest key but no packaged `_locales/` directory - Thunderbird refuses to load the add-on (error). |
| `deprecated-api` | Deprecated APIs (member or namespace level), and APIs whose `version_added` is newer than the target Thunderbird. |
| `disguised-navigation` | Data smuggled out through a page navigation (`location.assign`/`replace`) built with appended runtime data (error, regardless of consent). |
| `disguised-resource` | Data smuggled out through a resource-load URL (image/iframe/media `src`, `setAttribute`) built with appended runtime data (error, regardless of consent). |
| `disguised-stylesheet` | Data smuggled out through a stylesheet or CSS `url()` built with appended runtime data (error, regardless of consent). |
| `disguised-window` | Data smuggled out through a `window.open()` to a remote URL built with appended runtime data (error, regardless of consent). |
| `eval-call` | An `eval()` call in authored JS outside the WebExtension tree (Experiment/privileged code) - dynamic code execution (error). WebExtension code is exempt: it cannot run eval without a permissive CSP, which `csp-unsafe-eval` flags. |
| `experiment-manual-review` | Every reviewed Experiment (declares `experiment_apis`) - routed to manual review with a reminder that Experiments have full access to Thunderbird's internals and need a careful human code review. Fires for pristine, modified, and `--allow-experiments` submissions; silent for non-Experiments and outright-rejected ones. |
| `experiment-missing-strict-max-version` | An accepted Experiment (`--allow-experiments`) that sets no `strict_max_version` (error). Silent when experiments are disallowed, since `experiment-not-allowed` already rejects it. |
| `experiment-modified` | A bundled Experiment that is a recognised published Thunderbird API draft but a modified or outdated copy (error) - the submission stays on the normal review path but is rejected until the unmodified latest upstream copy is bundled. |
| `experiment-overrides-api` | An Experiment whose declared API path overrides or grafts onto a built-in Thunderbird API instead of adding a new namespace (error). |
| `function-constructor` | A `new Function(...)` (the Function constructor) in authored JS outside the WebExtension tree (Experiment/privileged code) - dynamic code execution (error). WebExtension code is exempt (CSP-gated, see `csp-unsafe-eval`). |
| `manifest-invalid-json` | manifest.json is present but is not valid JSON (error). |
| `manifest-missing` | No manifest.json at the add-on root (error). |
| `manifest-missing-key` | A required top-level manifest key (`manifest_version`/`name`/`version`) is absent (error). |
| `manifest-unknown-permission` | A declared permission value that is neither a known permission, a data-collection permission, nor a match pattern (error). |
| `manifest-version-mismatch` | `manifest_version` disagrees with the schema set being reviewed (error). |
| `minimize-host-permissions` | Broad (`<all_urls>` / `*` host) permissions requested as required (info). |
| `missing-english-localization` | User-facing text hardcoded in a non-English language while the add-on ships no English `_locales` (warning). Pre-flight: an English `_locales` directory (`en`, `en-US`, …) → pass; a `_locales` directory without one → a finding; no `_locales` at all → language-detect the visible HTML text plus the manifest name/description with `franc`, where a confident non-English verdict is the finding. Too little text, or a near-tie with English, escalates to the `missing-english-localization-recheck` consumer (under `--llm-review`), else to manual review. |
| `missing-library` | A bundled JS or CSS file (not in the VENDOR file) whose content hash matches a known third-party library release, named as `name version` (info). Identified by a fetched known-library hash database (Mozilla dispensary's `hashes.txt`), so the match is byte-exact; a file the database doesn't recognize is left to `minified-code`/`obfuscated-code` or scanned as the developer's own code. An identified library is also audited for known vulnerabilities (`vendor-vulnerable`), so an undeclared vulnerable bundle is still caught. |
| `missing-manifest-key` | A called API needs a manifest key (e.g. `action`) that is not declared (error). The manifest-key counterpart of `missing-permission`. |
| `missing-permission` | A permission required but not declared (error) - required by a called API, or implied by a declared script-injection manifest key (`compose_scripts` → `compose`, `message_display_scripts` → `messagesModify`). An API needing a manifest key is `missing-manifest-key`. |
| `missing-vendor-file` | A VENDOR entry (file + source URL) naming a file not present in the submission (warning). |
| `mistyped-manifest-value` | A known manifest key whose value has the wrong type, validated with ajv against a JSON Schema derived from the annotated schema (warning). Thunderbird misreads such values. |
| `native-messaging` | The `nativeMessaging` permission (in `permissions` or `optional_permissions`), which lets the add-on exchange messages with a native application outside Thunderbird - routed to manual review to confirm disclosure (No Surprises). |
| `non-experiment-strict-max-version` | A non-Experiment that pins `strict_max_version` (warning - it only blocks installs on newer Thunderbird). |
| `minified-code` | A JS file (not a recognized library, not obfuscated) shipped minified - by minified line geometry (a very long, dense line) (error). |
| `obfuscated-code` | A JS file (not a recognized library) shipped obfuscated - recognized by the AST structure of a known obfuscator family via the `obfuscation-detector` library. A strong-family match is an error finding; a weak-family-only match (a structure readable code also has) is instead judged by the LLM (`fail` -> finding, `unsure` -> manual, `pass` -> drop). High precision, partial recall - some obfuscators evade it. |
| `privacy-policy` | Data transmitted to a hardcoded remote host by an overt API - routed to manual review to confirm the listing carries a privacy policy disclosing the collection (the policy text is not part of the package). Complements `data-exfiltration` (which judges consent). |
| `strict-max-version-bump-only` | Diff check (needs `--diff-to`): fires (info) when a submission changes only the `version` and the gecko `strict_max_version` vs. the prior version - the developer could raise the max on ATN instead of resubmitting. Runs only with `--diff-to`. |
| `string-timer` | A code string passed to `setTimeout`/`setInterval` (it is eval'd) in authored JS outside the WebExtension tree (Experiment/privileged code) - dynamic code execution (error). WebExtension code is exempt (CSP-gated, see `csp-unsafe-eval`). |
| `sync-xhr` | Synchronous `XMLHttpRequest` (`open(..., false)`). |
| `trademark-violation` | Add-on name (resolved from `_locales` for a `__MSG__` name) using a Mozilla trademark - `Firefox`/`Mozilla`/`MZLA` anywhere, or `Thunderbird` other than as a trailing "for Thunderbird" (error, case-insensitive). The icon is a separate manual check. |
| `unknown-api` | Unknown namespaces, unknown members (incl. methods on property types like `storage.local.x`), and APIs marked `unsupported`. |
| `unparsable-file` | A JavaScript, TypeScript, or Vue `<script>` source that failed to parse, so its API checks were skipped (info). |
| `unpinned-dependency` | A `package.json` dependency declared as a version range with no lock file, so it can't be pinned to one release and verified (error). |
| `unpinned-vendor-source` | A VENDOR-declared file whose (trusted-host) source is not pinned to an immutable version/tag/commit, so its bytes can't be verified (error). |
| `unrecognized-manifest-key` | A top-level manifest key the schema does not define - Thunderbird ignores it (info). |
| `unsafe-html` | Any write to `innerHTML`/`outerHTML`/`srcdoc`/`insertAdjacentHTML`; only `Element.setHTML()` is sanctioned (an empty/null clear is exempt) (info). |
| `unused-permission` | A declared named permission (required or optional) that no reachable call provably requires (warning) - host patterns are `minimize-host-permissions`' concern. A permission is dropped as justified when an API call, a `navigator.*` Web/DOM call, or a script-injection manifest key proves it in use. It is a finding when the registry's permission prompt names its justifying usages as `tokens` and not one of them occurs anywhere in the live code (comments excluded) or the manifest - decided with no model involved, and only while the scan can see every usage. Everything else escalates: under `--llm-review` to the `unused-permission-recheck` consumer, which judges the located token sites one by one, else to manual review. |
| `vendor-modified` | A declared third-party file whose bytes don't match its pinned source (EOL-tolerant compare) - it appears modified from upstream (error). |
| `vendor-unparseable` | A VENDOR file is present but no block pairs a library file with a source URL that points to a file, so nothing can be verified (error). |
| `vendor-unverified` | Declarations that can't be settled automatically - an untrusted-host source, a library not confirmed widely used, or an unfetchable source - routed to manual review. |

### LLM checks

Each LLM check **always runs its deterministic pre-flight**, regardless if LLM support is enabled or not.
Cases the pre-flight can settle become findings directly, and only the
genuinely-ambiguous residue is escalated, per case. When LLM support is not enabled, unsure findings are added to the manual review queue. When LLM support *is* enabled
(`--llm-review`, with a configured provider), each escalated case is sent to the
model with the check's rubric and that case's evidence (e.g. the offending file's
source). The model returns a three-way verdict - **fail** / **pass** /
**unsure** - so a confident result is final. Any **unsure** finding is routed to manual review.

Four of these checks (`unused-files`, `minimize-web-accessible-resources`,
`data-exfiltration`, `disguised-transmission`) do not stop there: their unsure
residue is handed to a post-summary recheck consumer (below), where the whole-add-on
summary re-judges each item with full-add-on context - richer than the per-case
evidence of the first pass - so many resolve to a confident **pass**/**fail**
instead of staying on the manual-review list. The other three
(`strict-min-version-api`, `remote-resources`, `remote-eval`) name no consumer, so an
unsure case there goes to manual review directly.

| Check id (`check:`) | Pre-flight (always) + what the LLM judges |
| --- | --- |
| `strict-min-version-api` | Pre-flight: a call to a real, schema-resolved API added in a Thunderbird newer than the declared `strict_min_version`. An unguarded call is a finding straight away; a call carrying a guard signal (optional chaining, a `typeof`/existence test, a `getBrowserInfo` version gate) → the LLM judges, from the call's file, whether the guard really keeps it off the older versions. A non-existent API is `unknown-api`'s concern. |
| `remote-eval` | Pre-flight: the statically-undecidable `fetch()->eval` pattern (scanned only outside the WebExtension tree, like the other dynamic-execution checks - WebExtension code is CSP-gated) → the LLM judges (given the offending file) whether the executed code is fetched remotely. The definite dynamic-execution cases are the deterministic `eval-call`/`function-constructor`/`string-timer`/`csp-unsafe-eval`/`csp-unsafe-inline` checks. |
| `remote-resources` | Pre-flight: remote `<script>`/`<link>`/`@import`/`url()`/media/imports/`importScripts`/runtime injection/WASM, and a CSP permitting a remote script source → a finding. Statically-undecidable cases (non-literal URLs, inline `data:`/`blob:` script sources) → the LLM judges whether the source is remote. |
| `data-exfiltration` | Pre-flight: a normal transmission (`fetch`/XHR/WebSocket/EventSource/`sendBeacon`) to a remote/dynamic host → the LLM judges, given the file and the options page, whether user data is sent without an explicit opt-in. Covert channels are the separate `disguised-*` errors. |
| `disguised-transmission` | Pre-flight: the weak residue of the covert channels - a resource URL, a stylesheet `url()`, a `window.open()`, or a page navigation to a remote host built from a runtime value, with no user-data API call in it → the LLM judges whether it really smuggles user data out through that channel or is just legitimate dynamic URL building. The strong cases (a user-data call in the URL) are the deterministic `disguised-*` errors. |
| `minimize-web-accessible-resources` | Pre-flight: over-broad exposure (a resource pattern like `*`, or MV3 `matches` of `<all_urls>`/`*://*/*`) and concrete resources no content script/page loads → a finding. An ambiguous exposed resource (dynamic loaders, or name mentioned) → the LLM judges whether it is needlessly exposed. |
| `unused-files` | Pre-flight: hidden/junk by name, and files reachable from no manifest entry point (a reference graph over imports/`getURL`/HTML/CSS plus schema-derived file-loading APIs) - a clearly-unreferenced file is a finding. An ambiguous file (string-mentioned, or the add-on uses dynamic loaders) → the LLM judges whether it is unused. License/README/VENDOR/`_locales` are exempt. |

### Post-summary rechecks

A **recheck consumer** is the second look. A producer check - deterministic or LLM -
escalates the items it could not settle from its own narrow evidence and names a
consumer in its `post-summary-recheck:` field. Under `--llm-review` those items are
appended to the **"Summary of add-on"** pass, so the model re-judges them while
reading the whole, line-numbered add-on; the consumer then resolves each verdict:
**pass** → the item is dropped, **fail** → it becomes the consumer's finding, and
**unsure** (or no verdict at all) → manual review. Without `--llm-review` no summary
runs, nothing is handed over, and the producer's own escalation stands as a
manual-review reminder.

Each consumer is an ordinary check with its own id, severity and wording - so its
findings read like any other, and `--checks-only`/`--checks-skip` name it like any
other.

| Consumer (`check:`) | Producer | What the summary re-judges |
| --- | --- | --- |
| `unused-permission-recheck` | `unused-permission` | Each declared permission the producer could neither prove used nor deterministically prove unused. A permission whose usage `tokens` were located is judged **per site** (`file:line`), the model deciding at each one whether the permission is actually exercised there; a permission with no locatable site (e.g. `unlimitedStorage`) gets a single holistic verdict. The sites are then aggregated back to the permission: any site passing justifies it, every site failing flags it as unused (warning), anything else is manual. |
| `missing-english-localization-recheck` | `missing-english-localization` | The low-confidence language case (too little text, or a near-tie with English), re-judged by a model reading all of the add-on's user-facing text (warning). |
| `unused-files-recheck` | `unused-files` | Each packaged file that is reachable from no entry point and that no single site resolved to a loader - now judged against the whole add-on, including runtime-built paths that plausibly resolve to it (error). |
| `minimize-web-accessible-resources-recheck` | `minimize-web-accessible-resources` | Each `web_accessible_resources` entry no single referencing site could clear - now judged against the whole add-on: does anything *outside* the add-on (a content script, a web page, another extension) actually read it? (warning). |
| `data-exfiltration-recheck` | `data-exfiltration` | Each transmission site the first pass could not clear - now with every settings page, background flag and stored preference in view, so an opt-in defined outside the options page is visible (error). |
| `disguised-transmission-recheck` | `disguised-transmission` | Each covert-channel site the first pass could not clear - now judged against the whole add-on: user data smuggled out, or a legitimate dynamic URL? (error). |


### Manual checks

Some review steps can't be automated - they need hands-on testing or a human's
judgment over content the tool can't see (the store listing, screenshots, the
icon). These live under `manual-checks` in the yaml and are surfaced in the
report's **Standard manual review** to-do list.

| Check id (`check:`) | What the reviewer verifies |
| --- | --- |
| `check-submission-spam` | The listing and add-on for spam or inappropriate, misleading, or low-effort content. |
| `test-add-on` | Functionality in a test profile, fail if credentials or other info are needed to continue. |
| `no-surprises-policy` | The code diff for behavior not documented on the ATN listing that could surprise the user. |
| `missing-payment-disclosure` | Whether the add-on requires payment but the "needs payment" flag is not set on ATN. |
| `suitability-for-listing` | Whether the add-on targets a limited or non-public audience (better self-hosted than listed). |
| `acceptable-use-policy` | The name, summary, description, and screenshots against Mozilla's Acceptable Use Policy. |
| `icon-trademark-imitation` | The icon for imitation of the Thunderbird or Mozilla logo (an image the automated checks can't inspect). |
| `missing-atn-description` | The ATN listing page has usage instructions, entry points, and screenshots. |
| `missing-english-atn-localization` | The ATN listing page also has an English version. |
| `forked-add-on` | New-submission prompt (`diff: false`, skipped when reviewing against a `--diff-to` baseline): a forked add-on is clearly distinguished from the original and offers a significant difference in functionality and/or code. |


## Examples

```sh
# Review a submitted xpi against the matching schema (read-only - report only)
node verify.js ./submission.xpi

# Review an unpacked source folder
node verify.js ./my-addon

# machine-readable JSON output
node verify.js ./submission.xpi --report-format json

# Run the AI review (LLM checks + a Summary of the add-on)
export LLM_API_KEY=sk-…
node verify.js ./submission.xpi --llm-review

# Same, but use ChatGPT instead of the default (Claude)
export LLM_API_KEY=sk-… LLM_API_TYPE=chatgpt
node verify.js ./submission.xpi --llm-review

# List the models your token can use, then exit (needs a token)
export LLM_API_KEY=sk-…
node verify.js --llm-list-models
```

## Contributing

Requires Node `>=20` and `npm install` once. Before sending a change, run:

```sh
npm run lint          # ESLint over src/ and the root entry files
npm run format:check  # Prettier (run `npx prettier --write <glob>` to fix)
npm test              # add-on golden snapshots + the unit suite
```

Conventions:

- **Prettier-formatted and ESLint-clean** - double quotes, semicolons,
  `printWidth` 80.
- **The registry owns every model-facing string** - check rubrics, the LLM
  system intro, and prompts live in
  [`assets/registry.yaml`](assets/registry.yaml), never in `src/`.
- **Each source file opens with a header comment** stating what belongs in it,
  keep it accurate when you edit.
- **Golden tests are byte-exact** - regenerate intended report changes with
  `UPDATE_GOLDEN=1 npm test` and review the diff.

(See [tests/README.md](tests/README.md) for the test suite.)
