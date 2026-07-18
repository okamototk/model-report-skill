// LayerLens Stratix (SX) metric fetchers.
//
// Stratix is a Next.js SPA backed by a Lambda REST API. The base URL below is
// the currently-observed endpoint (intercept /models network calls if it
// changes). The public API works without a key for ~168 models; pass a key
// (LAYERLENS_STRATIX_API_KEY) for the full ~233-model catalog.
//
// See SKILL.md "Step 2" for details.

import type { SXEvaluation, SXModel } from "./types.ts";

const SX_BASE =
  "https://4sejpcfoxa.execute-api.us-east-1.amazonaws.com/prod//api/v1/dgklmnr";

/** Read the Stratix key from env, or accept an explicit override. */
export function getSXKey(explicit?: string): string | undefined {
  return (
    explicit ??
    process.env.LAYERLENS_STRATIX_API_KEY ??
    process.env.STRATIX_API_KEY ??
    undefined
  );
}

function headers(apiKey?: string): Record<string, string> {
  const key = getSXKey(apiKey);
  return key ? { "x-api-key": key } : {};
}

/**
 * Fetch the entire Stratix model catalog. The `search` query param is
 * effectively ignored by the API (it returns the full list), so we fetch all
 * and filter locally.
 */
export async function fetchSXModels(apiKey?: string): Promise<SXModel[]> {
  const res = await fetch(`${SX_BASE}/models?nolimit=true`, {
    headers: headers(apiKey),
  });
  if (!res.ok) {
    throw new Error(`Stratix /models HTTP ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as
    | { data?: SXModel[]; models?: SXModel[] }
    | SXModel[];
  if (Array.isArray(body)) return body;
  return body.data ?? body.models ?? [];
}

/** Normalize for matching: lowercase, collapse spaces/hyphens/underscores. */
export function normalize(s: string): string {
  return (s ?? "").toLowerCase().replace(/[\s._-]+/g, " ").trim();
}

/** Case-insensitive, separator-insensitive substring match on name/key. */
export function findSXModels(models: SXModel[], query: string): SXModel[] {
  const q = normalize(query);
  return models.filter(
    (m) =>
      normalize(m.name ?? "").includes(q) ||
      normalize(m.key ?? "").includes(q),
  );
}

/**
 * Fetch per-benchmark evaluation scores for a model id.
 * `unique=true` returns one (best) row per benchmark; set it false to get all.
 */
export async function fetchSXEvaluations(
  modelId: string,
  opts: { apiKey?: string; unique?: boolean } = {},
): Promise<SXEvaluation[]> {
  const unique = opts.unique ?? true;
  const url =
    `${SX_BASE}/evaluations?status=success&model_id=${modelId}` +
    `&order=desc&sort_by=accuracy&unique=${unique}&nolimit=true`;
  const res = await fetch(url, { headers: headers(opts.apiKey) });
  if (!res.ok) {
    throw new Error(
      `Stratix /evaluations HTTP ${res.status}: ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { evaluations?: SXEvaluation[] };
  return body.evaluations ?? [];
}

/**
 * Convenience: resolve a model by query and return its record + evaluations.
 * Returns `undefined` model if not found in the catalog (e.g., unlisted model).
 */
export async function getSXMetrics(
  query: string,
  opts: { apiKey?: string; unique?: boolean } = {},
): Promise<{ model?: SXModel; evaluations?: SXEvaluation[]; candidates: SXModel[] }> {
  const models = await fetchSXModels(opts.apiKey);
  const candidates = findSXModels(models, query);
  const model = candidates[0];
  const evaluations = model
    ? await fetchSXEvaluations(model.id, opts)
    : undefined;
  return { model, evaluations, candidates };
}
