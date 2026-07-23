// The SCA build review's ONE analysis, run in the setup phase (like resolveVendor for
// dependencies): it selects the build corpus (selectBuildCorpus), asks the model to
// CLASSIFY the build into one category, and stores the verdict on addon.buildFiles.buildReview
// so the input:build checks read it deterministically - three distinct rejection reasons, one
// LLM call. The classification (single, prioritised):
//   - "remote-fetch"    the build fetches code/resources from an undeclared external source
//                       (curl/wget/git clone/CDN). Only `npm ci` from node_modules is allowed.
//   - "not-from-source" the build does not build; it packages files already in the submission
//                       into the XPI (phantom artifacts not derived from the reviewed source).
//   - "ok"              a genuine build that pulls only from the declared dependencies.
//   - "none"            no package.json entry point to follow (nothing to review).
//   - null              the model could not run (offline / no token) or its reply did not parse;
//                       the build is routed to human review.
// The deterministic `unresolved` signals from selectBuildCorpus (a network fetch / an opaque
// orchestrator the linter could not follow) ride along and are given to the model as context.
//
// Belongs here: running the analysis and shaping the stored verdict. Does NOT belong here: the
// corpus policy (-> ./corpus.js), the finding/manual wording (-> the input:build checks +
// registry), or the low-level transport (-> src/llm/provider.js).

import { selectBuildCorpus } from "./corpus.js";
import { newNonce, framing, wrapFile } from "../lib/untrusted.js";
import { getProvider } from "../llm/provider.js";
import { progress, FEED, llmErrorText } from "../util/log.js";
import { red } from "../util/color.js";

const CLASSIFICATIONS = new Set(["ok", "remote-fetch", "not-from-source"]);

/**
 * @typedef {object} BuildReview
 * @property {"ok"|"remote-fetch"|"not-from-source"|"none"|null} classification
 * @property {string} reason  One-line model explanation (for the finding {{explanation}}).
 * @property {string} buildInstructions  How to build the XPI (for the manual note).
 * @property {{kind: string, detail: string}[]} unresolved  Deterministic build-corpus signals.
 * @property {boolean} analyzed  True only when the model classified the build.
 * @property {?string} anchor  The file the findings/notes anchor at (package.json if present).
 */

/**
 * Classify the SCA build once. Mirrors resolveVendor: LLM-optional, offline-safe, budget-capped.
 * @param {object} params
 * @param {{files: Map<string, Buffer>}} params.build  The build files (addon.buildFiles).
 * @param {string} [params.analysisPrompt]  The registry `build-analysis` prompt.
 * @param {boolean} [params.enabled]  Whether the LLM is enabled for this run.
 * @param {string} [params.token] @param {string} [params.model] @param {string} [params.url]
 * @param {string} [params.type]  LLM provider type.
 * @param {Function} [params.callText]  Injectable transport (else the provider default).
 * @param {import("../../llm/budget.js").LlmBudget} [params.budget]  Run-wide model-request cap.
 * @returns {Promise<BuildReview>}
 */
export async function analyzeBuild({
  build,
  analysisPrompt,
  enabled = false,
  token,
  model,
  url,
  type,
  callText = getProvider(type).callText,
  budget,
}) {
  const files = build?.files ?? new Map();
  const { corpus, unresolved } = selectBuildCorpus(build);
  const anchor = files.has("package.json")
    ? "package.json"
    : (corpus[0] ?? null);
  const base = {
    classification: null,
    reason: "",
    buildInstructions: "",
    unresolved,
    analyzed: false,
    anchor,
  };
  // No entry point to follow -> no npm build to review.
  if (!corpus.length) {
    return { ...base, classification: "none" };
  }
  // One model request, counted against the run-wide cap; skip it (route to manual review)
  // once that is spent or the LLM is off. Gated on enabled, not on a token (Ollama is keyless).
  if (enabled && analysisPrompt && (!budget || (await budget.consume()))) {
    try {
      const verdict = await llmClassify({
        files,
        corpus,
        unresolved,
        analysisPrompt,
        token,
        model,
        url,
        callText,
      });
      if (verdict) {
        return { ...base, ...verdict, analyzed: true };
      }
    } catch (err) {
      progress(
        red(`build analysis: LLM classification failed - ${llmErrorText(err)}`),
        FEED.STEP
      );
    }
  }
  return base;
}

/**
 * One model request classifying the build corpus. The corpus files are untrusted data, wrapped
 * in nonce markers; the deterministic linter signals and the rubric are on the trusted side.
 * @returns {Promise<?{classification: string, reason: string, buildInstructions: string}>}
 */
async function llmClassify({
  files,
  corpus,
  unresolved,
  analysisPrompt,
  token,
  model,
  url,
  callText,
}) {
  const nonce = newNonce();
  const lines = [];
  if (unresolved.length) {
    lines.push(
      "LINTER SIGNALS (build steps the linter could not statically follow):"
    );
    for (const u of unresolved) {
      lines.push(`- ${u.kind}: ${u.detail}`);
    }
    lines.push("");
  }
  lines.push(`FILES (${corpus.length} untrusted data block(s)):`);
  for (const p of corpus) {
    lines.push(wrapFile(nonce, p, files.get(p)?.toString("utf8") ?? ""));
  }
  const reply = await callText({
    token,
    model,
    baseURL: url,
    system: `${framing(nonce)}\n\n${analysisPrompt}`,
    prompt: lines.join("\n"),
  });
  return parseVerdict(reply);
}

/**
 * Parse the model's JSON object, keeping only a valid classification. A missing/unknown
 * classification or unparseable reply -> null (the caller routes to manual review).
 * @param {string} reply
 * @returns {?{classification: string, reason: string, buildInstructions: string}}
 */
function parseVerdict(reply) {
  const m = String(reply).match(/\{[\s\S]*\}/);
  if (!m) {
    return null;
  }
  let v;
  try {
    v = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (!CLASSIFICATIONS.has(v?.classification)) {
    return null;
  }
  return {
    classification: v.classification,
    reason: typeof v.reason === "string" ? v.reason : "",
    buildInstructions:
      typeof v.buildInstructions === "string" ? v.buildInstructions : "",
  };
}
