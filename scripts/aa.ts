// Artificial Analysis (AA) metric fetchers.
//
// Two data sources:
//   A) The free AA Data API (needs an x-api-key) — clean JSON for the
//      Intelligence / Coding / Math indices, per-benchmark scores, pricing.
//   C) The static model-page HTML — the Next.js `__next_f` payload embeds the
//      Agentic Index, Omniscience Index, cache-aware blended price, eval cost,
//      params, context window, license, release date, etc. for EVERY model in
//      a single page (no Playwright needed).
//
// See SKILL.md "Step 1" for the full explanation.

import type { AAModel, AAPageMetrics } from "./types.ts";

const AA_API_URL = "https://artificialanalysis.ai/api/v2/data/llms/models";
const AA_PAGE_URL = (slug: string) =>
  `https://artificialanalysis.ai/models/${slug}`;

/** Read the AA API key from env (AA_API_KEY), or accept an explicit override. */
export function getAAKey(explicit?: string): string | undefined {
  return explicit ?? process.env.AA_API_KEY ?? undefined;
}

/**
 * Approach A — fetch every model from the AA Data API in one call.
 * Returns the full `data[]` array (cache and filter locally by id/slug/name).
 * Throws on missing key or non-200.
 */
export async function fetchAAModels(apiKey?: string): Promise<AAModel[]> {
  const key = getAAKey(apiKey);
  if (!key) {
    throw new Error(
      "AA_API_KEY not set. Export AA_API_KEY or pass --aa-key. " +
        "Get a free key at https://artificialanalysis.ai/login",
    );
  }
  const res = await fetch(AA_API_URL, { headers: { "x-api-key": key } });
  if (!res.ok) {
    throw new Error(`AA Data API HTTP ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { data?: AAModel[] } | AAModel[];
  const data = Array.isArray(body) ? body : (body.data ?? []);
  return data;
}

/** Normalize for matching: lowercase, collapse spaces/hyphens/underscores. */
export function normalize(s: string): string {
  return (s ?? "").toLowerCase().replace(/[\s._-]+/g, " ").trim();
}

/**
 * Case-insensitive, separator-insensitive substring match on name/slug.
 * So "minimax m3" matches "MiniMax-M3", and "deepseek-v4-flash" matches
 * "DeepSeek V4 Flash". Returns all candidates.
 */
export function findAAModels(models: AAModel[], query: string): AAModel[] {
  const q = normalize(query);
  return models.filter(
    (m) =>
      normalize(m.name ?? "").includes(q) ||
      normalize(m.slug ?? "").includes(q),
  );
}

/** Turn a model name into an AA page slug (best-effort; try candidates too). */
export function toSlug(name: string): string {
  return name
    .replace(/\([^)]*\)/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Fields we pull out of the static page payload per model record.
const PAGE_FIELDS: (keyof AAPageMetrics)[] = [
  "intelligenceIndex",
  "codingIndex",
  "agenticIndex",
  "omniscience",
  "cacheHitPrice",
  "price1mInputTokens",
  "price1mOutputTokens",
  "price1mBlended7To2To1",
  "contextWindowTokens",
  "licenseName",
  "intelligenceIndexTimePerTask",
  "parameters",
  "inferenceParametersActiveBillions",
  "isOpenWeights",
  "releaseDate",
  "medianOutputSpeed",
];

/**
 * Approach C — fetch one AA model page and parse the `__next_f` payload.
 * A single page contains records for ALL models, so `parsePageMetrics` can
 * extract any target by exact name. Returns the raw unescaped HTML text.
 */
export async function fetchAAPageHtml(slug: string): Promise<string> {
  const res = await fetch(AA_PAGE_URL(slug), {
    headers: { "user-agent": "Mozilla/5.0 collect-benchmark" },
  });
  if (!res.ok) {
    throw new Error(`AA page HTTP ${res.status} for slug "${slug}"`);
  }
  const raw = await res.text();
  return raw.replace(/\\"/g, '"'); // unescape the streamed JSON
}

/**
 * Extract page-only metrics for an exact model name from unescaped page HTML.
 * Picks the richest occurrence (the record with the most fields nearby).
 */
export function parsePageMetrics(
  html: string,
  exactName: string,
): AAPageMetrics | undefined {
  const needle = `"name":"${exactName}"`;
  const idxs: number[] = [];
  let i = html.indexOf(needle);
  while (i !== -1) {
    idxs.push(i);
    i = html.indexOf(needle, i + 1);
  }
  if (idxs.length === 0) return undefined;

  // Choose the occurrence whose following window mentions the most Price/Index keys.
  let best = idxs[0];
  let bestScore = -1;
  for (const at of idxs) {
    const seg = html.slice(at, at + 8000);
    const score =
      (seg.match(/Price/g)?.length ?? 0) +
      (seg.match(/Index/g)?.length ?? 0) +
      (seg.match(/contextWindow/g)?.length ?? 0);
    if (score > bestScore) {
      bestScore = score;
      best = at;
    }
  }

  const seg = html.slice(best, best + 8000);
  const out: AAPageMetrics = { name: exactName };
  for (const field of PAGE_FIELDS) {
    const re = new RegExp(
      `"${field}":\\s*(null|true|false|-?[0-9.]+|"[^"]{0,80}")`,
    );
    const m = seg.match(re);
    if (!m) continue;
    const raw = m[1];
    if (raw === "null") {
      (out as Record<string, unknown>)[field] = null;
    } else if (raw === "true" || raw === "false") {
      (out as Record<string, unknown>)[field] = raw === "true";
    } else if (raw.startsWith('"')) {
      (out as Record<string, unknown>)[field] = raw.slice(1, -1);
    } else {
      (out as Record<string, unknown>)[field] = Number(raw);
    }
  }

  // intelligenceIndexCost.total (eval cost) lives in a nested object.
  const costMatch = seg.match(
    /"intelligenceIndexCost":\s*\{[^}]*?"total":\s*([0-9.]+)/,
  );
  out.evalCostTotal = costMatch ? Number(costMatch[1]) : null;

  return out;
}

/**
 * Convenience: given the AA API model list + a page HTML blob, return both the
 * API record and the parsed page metrics for a resolved model.
 */
export async function getAAMetrics(
  query: string,
  opts: { apiKey?: string; pageHtml?: string } = {},
): Promise<{ api?: AAModel; page?: AAPageMetrics; candidates: AAModel[] }> {
  const models = await fetchAAModels(opts.apiKey);
  const candidates = findAAModels(models, query);
  const api = candidates[0];
  let page: AAPageMetrics | undefined;
  if (api) {
    const html = opts.pageHtml ?? (await fetchAAPageHtml(api.slug));
    page = parsePageMetrics(html, api.name);
  }
  return { api, page, candidates };
}
