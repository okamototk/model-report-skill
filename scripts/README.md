# collect-benchmark scripts

TypeScript helpers that fetch model metrics from **Artificial Analysis (AA)** and
**LayerLens Stratix (SX)**. Run with `tsx` (or any TS-aware Node runner).

## Files

| File | Purpose |
|------|---------|
| `types.ts` | Shared interfaces (`AAModel`, `AAPageMetrics`, `SXModel`, `SXEvaluation`, `CombinedMetrics`). |
| `aa.ts` | AA fetchers: `fetchAAModels` (Data API), `fetchAAPageHtml` + `parsePageMetrics` (static-page indices: agentic/omniscience/eval-cost/etc.), `findAAModels`, `getAAMetrics`. |
| `stratix.ts` | SX fetchers: `fetchSXModels`, `findSXModels`, `fetchSXEvaluations`, `getSXMetrics`. |
| `fetch-metrics.ts` | CLI that resolves one or more model-name queries and prints combined AA+SX JSON. |

## Environment

- `AA_API_KEY` — required for the AA Data API (free key at <https://artificialanalysis.ai/login>).
- `LAYERLENS_STRATIX_API_KEY` (or `STRATIX_API_KEY`) — optional; unlocks the full SX catalog. Public access works without it for a smaller catalog.

## Usage

```bash
# Combined AA + SX for one or more models
npx tsx fetch-metrics.ts "MiniMax M3" "DeepSeek V4 Flash" "Nemotron 3 Ultra"

# Only one platform
npx tsx fetch-metrics.ts --aa-only "Nemotron 3 Ultra"
npx tsx fetch-metrics.ts --sx-only "MiMo-V2.5"

# List all matching candidates (disambiguate variants like Reasoning/Non-reasoning)
npx tsx fetch-metrics.ts --list "deepseek v4 flash"

# Override keys on the command line
npx tsx fetch-metrics.ts --aa-key <k> --sx-key <k> "MiniMax M3"
```

Output is a JSON array of `CombinedMetrics` (one per query) on stdout, with a
`notes[]` field recording any missing matches or fetch failures.

## Matching

Model resolution is **separator-insensitive**: `"minimax m3"`, `"MiniMax-M3"`,
and `"minimax_m3"` all resolve to the same model. When several variants match
(e.g. Reasoning / Non-reasoning / High Effort), the **first** candidate is used —
pass `--list` first to see all variants and refine the query.

## Notes

- The AA Data API returns **all** models in one call; the scripts fetch it once
  and filter locally. Rate limit: 1,000 req/day.
- One AA model page's `__next_f` payload contains page metrics for **every**
  model, so `fetch-metrics.ts` fetches a single page and reuses it across
  queries (no Playwright required).
- The SX API base URL is hard-coded in `stratix.ts`; if SX changes it, intercept
  the `/models` network call on <https://stratix.layerlens.ai/models> and update.
- Attribution to Artificial Analysis (<https://artificialanalysis.ai/>) is
  required when using AA data.
