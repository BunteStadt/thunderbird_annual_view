// Central configuration: the tool's behavior defaults and deliberate policy
// toggles, kept in one easy-to-find place rather than scattered across deep
// modules. CLI flags override the defaults at runtime. The toggles have no flag
// and are changed here, where each records why it has its value.

/** Directory where fetched schema zips are cached (--cache-schema-dir default). */
export const DEFAULT_CACHE = ".schema-cache";

/**
 * The upstream repository of allowed Thunderbird Experiments. An add-on that
 * bundles one of these UNCHANGED is auto-accepted (not treated as an invalid
 * Experiment). See src/experiments/*.
 */
export const EXPERIMENTS_REPO = "thunderbird/webext-experiments";

/** Branch of EXPERIMENTS_REPO to fetch for the allow-list. */
export const EXPERIMENTS_BRANCH = "main";

/**
 * Directory where the fetched experiments zip is cached (--cache-experiments-dir).
 */
export const EXPERIMENTS_CACHE = ".experiments-cache";

/**
 * The upstream known-library hash database: Mozilla dispensary's generated
 * hashes.txt (one "<sha256> <name>.<version>.<file>" line per library release).
 * Fetched and cached so the library classifier can identify a bundled library by
 * the raw SHA-256 of its bytes. See src/lib/library-hashes.js.
 */
export const LIBRARY_HASHES_URL =
  "https://raw.githubusercontent.com/mozilla/dispensary/master/src/hashes.txt";

/**
 * Directory where the fetched library hashes are cached (--cache-hash-db-dir).
 * The internal names (LIBRARY_HASHES_*, library-hashes.js) keep the accurate
 * "Mozilla dispensary hashes.txt" description; the user-facing --cache-* flag is
 * the discoverable label, mapped to the internal opts once, in cli.js.
 */
export const LIBRARY_HASHES_CACHE = ".lib-mozilla-hash-db-cache";

/**
 * Timeout for the MANDATORY setup downloads that back the caches above - the schema
 * zip, the allowed-experiments zip, the library-hash DB (src/util/net.js
 * fetchWithTimeout). The artifacts are small (~80-220 KB), so 60s never fails a
 * legitimately slow link (~11s even at 20 KB/s) while still bounding a half-open hang.
 * On timeout the review fails loud (exit 2) rather than hanging, because it cannot
 * proceed without these inputs.
 */
export const SETUP_FETCH_TIMEOUT_MS = 60000;

/**
 * jsDelivr's content-addressed reverse lookup: GET <CDN_LOOKUP_URL><sha256-hex>
 * returns `{type, name, version, file}` for a file whose exact bytes are published
 * on the CDN, or 404 when nothing matches. A second-tier library identifier (after
 * the Mozilla hash DB above) for bundled files that DB does not list. See
 * src/lib/cdn-lookup.js.
 */
export const CDN_LOOKUP_URL = "https://data.jsdelivr.com/v1/lookup/hash/";

/** Directory where CDN hash-lookup results are cached (--cache-cdn-lookup-dir). */
export const CDN_LOOKUP_CACHE = ".lib-cdn-lookup-cache";

/**
 * Minimum size (bytes) for a READABLE file to earn a CDN identification attempt - a
 * library shipped un-minified (e.g. pdf.mjs) is large, while the developer's own files
 * are typically small, so this targets likely libraries and avoids a CDN lookup (and a
 * content fingerprint) for every authored file. 16 KB comfortably clears a typical
 * authored module while catching un-minified library builds (pdf.mjs is ~810 KB). A
 * MINIFIED file is always eligible regardless of size. See src/lib/cdn-lookup.js.
 */
export const CDN_LOOKUP_READABLE_MIN_BYTES = 16384;

// The model knowledge is NOT here: it lives in assets/llm/<LLM_API_TYPE>.yaml, read
// by src/llm/settings.js - which model a run defaults to, how many requests it may
// make, and, per model, the endpoint and the request parameters (the output-token
// cap among them). It is a hand-curated asset rather than constants here because a
// reviewer must be able to point the tool at a new model without touching code.

/**
 * Directory where the LLM adapters cache what they negotiated with a server: the
 * endpoint and parameter name a model actually accepted, when the shipped table
 * guessed wrong (see src/llm/negotiated.js). Unlike the caches above it takes no
 * --cache-*-dir flag - it is read by the adapters, which are handed a token and a
 * model, not the pipeline's options - but --cache-clear wipes it with the rest.
 */
export const LLM_MODEL_CACHE = ".llm-model-cache";

/**
 * How long one LLM request may run, and how many times the SDK retries it, before
 * the review gives up. These bound a client that connects but never answers -
 * without them a hung server blocks the whole run (the SDK defaults are 10 min x 3
 * attempts). Client transport, not model knowledge, so they live here rather than in
 * the YAML tables; both the OpenAI and Anthropic SDK constructors accept them.
 * 5 minutes is deliberately generous - a batched verdict call finishes in well under
 * a minute normally, but a max-reasoning model can legitimately take minutes, so this
 * bounds a true hang without clipping a live call. Lower it for faster models.
 */
export const LLM_REQUEST_TIMEOUT_MS = 300000;
export const LLM_MAX_RETRIES = 2;

/**
 * Max distinct add-on files an LLM check sends in one batched request. A check
 * collects all its candidates (each an id pointing at a file:line site) and asks
 * the model for a verdict per id in one call. The corpus is the union of the
 * files those candidates need. When that union would exceed this many files the
 * candidates are split across several calls (a single candidate whose own corpus
 * is larger still gets its own call). The bound is files, not bytes, because the
 * files are the real work the model reads. A call that still overruns the
 * context window errors and its candidates fall back to manual review. Tunable.
 */
export const MAX_FILES_PER_BATCH = 12;

/** Max characters of a truncated display label (e.g. a long URL). */
export const DISPLAY_TRUNCATE_LENGTH = 80;

/**
 * Display cap: the most location lines a single grouped report entry lists (an
 * Issues or Manual-review entry with many "- file:line" locations). Beyond this,
 * the rest are replaced by one "... more, excluded from this list" marker. This
 * is a rendering limit only (see src/report/format.js) - the summary counts,
 * JSON output, and LLM logic still see every finding.
 */
export const MAX_ENTRIES_PER_CATEGORY = 25;

/**
 * Whether the reference graph (reachability) skips "non-authored" JS - library,
 * minified, obfuscated, or VENDOR.md-declared files (see nonAuthoredJs in
 * src/lib/bundled.js) - when extracting outgoing edges.
 *
 * FALSE (default): reachability parses EVERY file for edges. The source-level
 * finding scanners (the eval checks, unsafe-html, remote-resources, code-sanity)
 * still skip those files on purpose - a bundled library legitimately uses
 * eval/innerHTML/sync-XHR, so scanning its internals is noise, and minified or
 * obfuscated code is rejected and re-reviewed as original source anyway. But
 * reachability must NOT skip them: dropping a file's loader edges
 * (import/getURL/executeScript/...) makes every file it loads look unreachable,
 * so a genuinely-used asset gets reported as unused - a wrong result. So the
 * graph follows edges everywhere.
 */
export const REACHABILITY_SKIPS_NON_AUTHORED = false;

// Vendor verification (src/vendor/verify.js) is the only stage that makes
// outbound network requests. It runs once, before the review, and the checks
// read its result.

/**
 * The only hosts vendor verification fetches a declared source from. A source
 * on any other host is sent to manual review, never requested. All three pin an
 * immutable version or tag, so a byte comparison is stable. A
 * github.com/.../blob URL is rewritten to raw.githubusercontent.com first.
 */
export const VENDOR_TRUSTED_HOSTS = [
  "unpkg.com",
  "cdn.jsdelivr.net",
  "raw.githubusercontent.com",
  "registry.npmjs.org",
];

/**
 * "Broadly used" thresholds - the bar a declared library must clear to be
 * auto-trusted (else manual review): npm monthly downloads, or GitHub stars.
 */
export const VENDOR_NPM_MIN_DOWNLOADS = 1000;
export const VENDOR_GITHUB_MIN_STARS = 100;

/**
 * GitHub orgs whose repos are trusted by provenance (first-party sources), so a
 * vendored file pinned to one is accepted WITHOUT meeting the stars bar above.
 * The bundled bytes are still compared to upstream, so a modified copy is still
 * reported. Owner match is exact + case-insensitive. It covers every github
 * source form (github.com blob, raw.githubusercontent, jsDelivr gh) since all
 * classify to kind "github" with this owner. Thunderbird's own add-on helper
 * repos (e.g. thunderbird/webext-support) live here but are below the generic
 * bar.
 */
export const VENDOR_TRUSTED_GITHUB_ORGS = ["thunderbird"];

/** Limits when fetching an (untrusted, submission-declared) vendor source. */
export const VENDOR_FETCH_TIMEOUT_MS = 10000;
export const VENDOR_FETCH_MAX_BYTES = 12 * 1024 * 1024;

/**
 * Decompressed-size cap when extracting an npm-registry tarball source, to bound a
 * decompression bomb (the compressed download is already capped by
 * VENDOR_FETCH_MAX_BYTES). gunzip aborts past this.
 */
export const VENDOR_TARBALL_MAX_UNPACKED_BYTES = 64 * 1024 * 1024;

/**
 * Decompressed-size cap when unpacking a submitted add-on (.xpi/.zip or folder),
 * to bound a decompression bomb: a small archive can inflate to gigabytes and
 * exhaust memory before any check runs. Sits well above a real Thunderbird add-on
 * (tens of MB unpacked) while stopping a bomb long before RAM is exhausted.
 */
export const ADDON_MAX_UNPACKED_BYTES = 128 * 1024 * 1024;

/**
 * OSV vulnerability database query endpoint (https://osv.dev). A pinned
 * package.json dependency (name@version, exact or lock-resolved) is POSTed here
 * to learn whether the bundled version has known advisories. No API token is
 * needed. OSV ingests the GitHub Advisory DB, so it covers `npm audit`'s npm
 * data and more. Best-effort: a failed lookup just skips (no finding).
 */
export const VENDOR_OSV_API = "https://api.osv.dev/v1/query";
