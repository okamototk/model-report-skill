---
name: collect-benchmark
description: Collect AI model benchmark data from Artificial Analysis and LayerLens Stratix. Prefers the official Artificial Analysis Data API (x-api-key) for Intelligence/Coding/Math indices and pricing, falls back to web scraping; uses the Stratix REST API for per-benchmark scores. Basic specs (parameters, license/open-weights, context, release) are cross-checked against the model developer's official site, which is authoritative on conflict. Model name is the only required input. Use when the user asks for benchmark data, model scores, model comparison, or evaluation results for a specific model.
---

# Collect Model Benchmark Data

Collect benchmark data for a given AI model from two independent evaluation platforms: **Artificial Analysis** (`artificialanalysis.ai`) and **LayerLens Stratix** (`stratix.layerlens.ai`).

## Quick start — use the TypeScript scripts

The metric-fetching logic is packaged as TypeScript scripts under [`scripts/`](scripts/) (see [`scripts/README.md`](scripts/README.md)). **Prefer these scripts over ad-hoc `curl`/parsing** — they handle AA Data API + static-page index extraction (agentic/omniscience/eval-cost) and the Stratix REST API, with separator-insensitive model matching.

```bash
# Combined AA + SX metrics for one or more models (JSON on stdout)
npx tsx scripts/fetch-metrics.ts "MiniMax M3" "DeepSeek V4 Flash" "Nemotron 3 Ultra"

# Disambiguate variants (Reasoning / Non-reasoning / High Effort ...) first
npx tsx scripts/fetch-metrics.ts --list "deepseek v4 flash"

# One platform only
npx tsx scripts/fetch-metrics.ts --aa-only "Nemotron 3 Ultra"
npx tsx scripts/fetch-metrics.ts --sx-only "MiMo-V2.5"
```

- Env: `AA_API_KEY` (required for AA), `LAYERLENS_STRATIX_API_KEY` (optional for the full SX catalog).
- Output: a JSON array of `CombinedMetrics` — `{ query, aa: { api, page }, sx: { model, evaluations }, notes[] }`.
- The scripts expose reusable functions too (`getAAMetrics`, `getSXMetrics`, `parsePageMetrics`, …) — import them from `scripts/aa.ts` / `scripts/stratix.ts` for custom pipelines.

Steps 1–2 below document the underlying data sources and field mappings (used by the scripts, and as a manual fallback when Node/`tsx` is unavailable). **Step 2.6 is a mandatory cross-check of basic specs (parameters, license/open-weights, context, release, modality) against the model developer's official site — the official source wins on conflict.** Steps 3–5 cover how to combine, compare, and visualize the collected data.

## Parameters

- **Model name** (required): The name of the AI model to look up (e.g., `GPT-4o`, `Claude Sonnet 4`, `Gemini 2.5 Flash`, `DeepSeek V4 Pro`).
- **Artificial Analysis API Key** (optional but recommended): If available, pass via `x-api-key` header to the AA Data API for reliable Intelligence/Coding/Math indices and pricing without scraping.
- **LayerLens API Key** (optional): If available, pass via `x-api-key` header to the Stratix API for full model catalog access (233 models vs 168 public).

## Step 1 — Search Artificial Analysis

> Implemented by [`scripts/aa.ts`](scripts/aa.ts) (`fetchAAModels`, `fetchAAPageHtml`, `parsePageMetrics`, `getAAMetrics`). The subsections below document the sources those functions use; run the script rather than reproducing the `curl`/regex by hand unless Node is unavailable.

Artificial Analysis provides Intelligence Index scores, speed (tokens/s), pricing, latency, per-benchmark breakdowns, and **evaluation cost data**.

### Find the model

Use one of the following approaches, **preferring the official API (A)** when a key is available:

**A) Official AA Data API (recommended)** — Artificial Analysis offers a free Data API that returns the **Coding Index and other indices as structured JSON** (no JS rendering / scraping needed). This is the most reliable and cleanest way to get `artificial_analysis_coding_index`. (Note: the Coding Index — and the Agentic Index — are ALSO present in the static model-page HTML payload, see approach C; the API is simply the tidiest source and the only one that also gives the Math Index cleanly.)

```
curl -X GET https://artificialanalysis.ai/api/v2/data/llms/models \
     -H "x-api-key: {AA_API_KEY}"
```

- Endpoint: `GET https://artificialanalysis.ai/api/v2/data/llms/models`
- Auth: `x-api-key` header. Get a free key by creating an account at `https://artificialanalysis.ai/login` and generating a key. Without a key the endpoint returns `401 {"error":"API key is required"}`.
- Rate limit: 1,000 requests/day. The endpoint returns **all models** in one call — fetch once and cache/filter locally by `id` / `slug` / `name` (prefer the stable `id`). Do not put the key in client-side code.
- Attribution to `https://artificialanalysis.ai/` is required when using this data.
- Response shape (per model in `data[]`):
  ```json
  {
    "id": "...", "name": "o3-mini", "slug": "o3-mini",
    "model_creator": { "id": "...", "name": "OpenAI", "slug": "openai" },
    "evaluations": {
      "artificial_analysis_intelligence_index": 62.9,
      "artificial_analysis_coding_index": 55.8,
      "artificial_analysis_math_index": 87.2,
      "mmlu_pro": 0.791, "gpqa": 0.748, "hle": 0.087,
      "livecodebench": 0.717, "scicode": 0.399, "math_500": 0.973, "aime": 0.77
    },
    "pricing": { "price_1m_blended_3_to_1": 1.925, "price_1m_input_tokens": 1.1, "price_1m_output_tokens": 4.4 },
    "median_output_tokens_per_second": 153.831,
    "median_time_to_first_token_seconds": 14.939
  }
  ```
- **AA Coding Index** = `evaluations.artificial_analysis_coding_index`. **AA Intelligence Index** = `evaluations.artificial_analysis_intelligence_index`. **Math Index** = `evaluations.artificial_analysis_math_index`.
- **AA Agentic Index — not in the free API, but available in the static model-page HTML.** The free Data API's `evaluations` object exposes intelligence / coding / math indices and per-benchmark scores, but does **not** include an `artificial_analysis_agentic_index` field. However, the **Agentic Index (and Coding/Intelligence Index) IS in the static HTML** of any model page inside the Next.js `self.__next_f` payload (`"agenticIndex":<num>`), so a plain `curl`/WebFetch is sufficient — see approach C. Do not fabricate the value.
- Note: the API's blended price is `price_1m_blended_3_to_1` (3:1 input:output). For the cache-aware 7:2:1 blended price used elsewhere in this skill, use the model-page value `price1mBlended7To2To1` or compute it (see Pricing notes).

**B) Leaderboard** — Fetch `https://artificialanalysis.ai/leaderboards/models`. Search for the model row to extract Intelligence Index, blended price, speed, latency, context window, and the model slug.

**C) Model detail page (static HTML — no JS/Playwright needed)** — Fetch `https://artificialanalysis.ai/models/{slug}` where `{slug}` is derived from the model name by removing parenthetical variants, lowercasing, and replacing spaces/special chars with hyphens (e.g., `GPT-4o` → `gpt-4o`).

**Key finding: the Coding Index and Agentic Index ARE present in the static HTML** (contrary to earlier belief). The React page ships all model data inside Next.js streaming payloads (`self.__next_f`) as escaped JSON. A plain `curl` / `WebFetch` of the page contains, for **every** model (~570+ records in one page), objects like:

```
..."name":"GPT-5.6 Sol (max)",...,"intelligenceIndex":58.8898...,"codingIndex":77.3880...,"agenticIndex":54.0035...,"omniscience":21.7,...
```

So **Playwright is NOT required** for Intelligence / Coding / Agentic indices — a single static fetch of any one model page yields all models' indices. Playwright is only a last-resort fallback.

Extraction recipe (from the raw HTML, no browser):

1. Fetch the page HTML (`curl -s` or WebFetch). Note the page is large (~3 MB) and contains ~570 model records; WebFetch output may be truncated — prefer `curl` to a file, or delegate parsing to the explore agent via Grep on the saved WebFetch output file.
2. Unescape `\"` → `"` in the HTML text.
3. For each target, locate `"name":"{model full name}"` and, within the next ~1200 chars, read `"intelligenceIndex":<num>`, `"codingIndex":<num>`, `"agenticIndex":<num>` (values are already on the 0–100 index scale; `null` if not evaluated).
4. Match the exact model variant name (e.g., `GPT-5.6 Sol (max)`, `GLM-5.2 (max)`, `Claude Fable 5 (Adaptive Reasoning, Max Effort, Opus 4.8 Fallback)`). There is also a `schema.org` JSON-LD `<script type="application/ld+json">` block, but it only lists the chart's top ~11 entries for one index — the `__next_f` payload is the complete source.

Only if the static payload cannot be parsed, fall back to Playwright: use headless Chromium, click the `role=tab` for the index, and read the tab panel (ids ending `-content-agentic-index` etc.) or its embedded JSON-LD. TLS/lib caveats: pass `--ignore-certificate-errors` + `ignore_https_errors=True` behind an intercepting proxy; if `libasound.so.2` is missing and you lack sudo, `apt-get download libasound2t64`, `dpkg-deb -x`, and set `LD_LIBRARY_PATH`.


### Data to collect

Prefer the **API fields (approach A)** where available; fall back to page text (approach B/C) when no key is present.

| Metric | API field (approach A) | Page text (approach B/C) |
|--------|------------------------|--------------------------|
| Intelligence Index | `evaluations.artificial_analysis_intelligence_index` | #N ranking + score in model summary section |
| **Coding Index** | `evaluations.artificial_analysis_coding_index` | `"codingIndex":<num>` in static HTML `__next_f` payload (curl/WebFetch) |
| **Math Index** | `evaluations.artificial_analysis_math_index` | Math Index tab / model-page payload |
| **Agentic Index** | *(not in free API)* | `"agenticIndex":<num>` in static HTML `__next_f` payload (curl/WebFetch; no Playwright needed) |
| **AA-Omniscience Index** (Knowledge primary) | *(not in free API)* | `"omniscience":<num>` in static HTML `__next_f` payload (curl/WebFetch; no Playwright needed) |
| **GPQA Diamond** (Reasoning primary) | `evaluations.gpqa` (0–1 scale ×100 for %) | GPQA row in evals table |
| **τ-Bench** (Agent supplement) | `evaluations.tau2` / `evaluations.tau_banking` (0–1 ×100) | τ-Bench evaluation page |
| **Terminal-Bench 2.1** (Agent supplement) | `evaluations.terminalbench_v2_1` / `terminalbench_hard` (0–1 ×100) | Terminal-Bench evaluation page |
| Output Speed | `median_output_tokens_per_second` | Tokens/s in model summary |
| Latency (TTFT) | `median_time_to_first_token_seconds` | Seconds in model summary / FAQ |
| Input / Output Price | `pricing.price_1m_input_tokens` / `price_1m_output_tokens` | USD per 1M tokens in model summary |
| Blended Price | `pricing.price_1m_blended_3_to_1` (3:1) | `price1mBlended7To2To1` (7:2:1, cache-aware) on page |
| Per-benchmark scores | `evaluations.{mmlu_pro,gpqa,hle,livecodebench,scicode,math_500,aime}` (0–1 scale ×100 for %) | Individual `/evaluations/{eval-name}` pages |
| Context Window | *(not in this endpoint)* | Tokens in technical specs |
| Cache Price | *(not in this endpoint)* | USD per 1M tokens in model summary |
| Reasoning flag | *(not in this endpoint)* | Yes/No in technical specs |
| **Total / Active params** | *(not in this endpoint)* | Total: `parameters`; Active: `inferenceParametersActiveBillions` (per-token active for MoE; equals total for dense). Report as `{total}B / {active}B` |
| Provider & Release Date | `model_creator` / *(release on page)* | Top of page |
| **Total Eval Cost** | *(not in free API)* | "In total, it cost $X to evaluate {model} on the Intelligence Index" in the Comparison Summary paragraph |
| **Total Output Tokens (Index)** | *(not in free API)* | From the Intelligence Index evals summary — total output tokens across all evaluations |

## Step 2 — Search LayerLens Stratix

> Implemented by [`scripts/stratix.ts`](scripts/stratix.ts) (`fetchSXModels`, `findSXModels`, `fetchSXEvaluations`, `getSXMetrics`). The subsections below document the endpoints those functions call.

LayerLens Stratix provides per-benchmark evaluation scores for 233+ models across 158+ benchmarks via a REST API.

### Discover the API base

1. Open `https://stratix.layerlens.ai/models` in Playwright.
2. Intercept `response` events — the API calls go to:
   ```
   https://4sejpcfoxa.execute-api.us-east-1.amazonaws.com/prod//api/v1/dgklmnr
   ```
3. Search for the model: `GET {API_BASE}/models?search={model-name}&page_size=100`
4. Find the model's `id` and `key` in the response.

### Get evaluation scores

```
GET {API_BASE}/evaluations?status=success&model_id={model_id}&order=desc&sort_by=accuracy&unique=true&nolimit=true
```

Returns per-benchmark accuracy, total_prompt_count, average_duration, latency metrics.

### Get model details

The model listing at `{API_BASE}/models?nolimit=true` includes pricing, context window, architecture, modality, and licensing for every model.

### Authentication

The public API works without auth for a limited model catalog (168 models). For full access (233 models), pass an API key:

```
x-api-key: {your_key}
```

The API key can be obtained from the Stratix Premium account settings.

### Data to collect

| Metric | API Field |
|--------|-----------|
| Provider | `company` |
| Architecture | `architecture_type` |
| **Total / Active params** | Total: `parameters` (billions; Stratix exposes **total only**). Active: not in Stratix — use AA `inferenceParametersActiveBillions` (see Step 1). Always report as `{total}B / {active}B`. |
| Context Length | `context_length` |
| Max Output Tokens | `max_tokens` |
| Modality | `modality` (e.g., "text+image+file->text") |
| Licensing | `license` / `open_weights` |
| Input Price | `cost_per_input_token` (convert: multiply by 1,000,000 for per-1M) |
| Output Price | `cost_per_output_token` |
| Per-benchmark accuracy | `accuracy` in each evaluation entry |
| Prompt count | `total_prompt_count` |
| Average duration | `average_duration` (nanoseconds; divide by 1e9 for seconds) |
| Sub-provider | `sub_provider` (e.g., "openai/flex") |

> **Parameters — Total vs Active:** Always report parameters as **Total / Active** (e.g., `744B / 40B`). Stratix's `parameters` field is the **total** parameter count only. The **active** (per-token) parameter count for MoE models must come from **Artificial Analysis** (`inferenceParametersActiveBillions`, see Step 1). If only one platform has a value, fill the other side with `非公開` / `N/A`. For dense (non-MoE) models, total and active are the same — report as `{n}B / {n}B (dense)`.

## Step 2.5 — Collect API Hosting Region, Retention, and No Training Policy

For each model, collect the **official first-party API hosting region**, the data retention policy, and whether the provider trains on API data. These are not available on benchmark platforms — search provider documentation, privacy policy / terms of service pages, API reference pages, or gateway listing sites (e.g., `requesty.ai/models/{provider}/{model}`, `vercel.com/ai-gateway/models/{model}`, `llmgateway.io/providers/{provider}`). Gateway sites often display "Data retention" and "Used for training" fields in their spec tables; the **hosting region** usually comes only from the provider's official privacy policy / data-processing / terms pages.

### Data to collect

| Policy | How to find |
|--------|-------------|
| **Developer (company) & country** | The organization that developed the model (AA `model_creator.name`) and its home country. This is a sovereignty signal separate from the API hosting region — keep both. E.g., Tencent / China, Xiaomi / China, DeepSeek / China, MiniMax / China. |
| **API hosting region** (a.k.a. "APIホストリージョン") | The country / region where the official first-party API stores and processes data. From the provider's privacy policy / ToS / data-processing addendum (look for "data center," "servers located in," "cross-border," "storage location"). Common patterns: single region (e.g., "US data center", "PRC servers"), configurable (customer selects PRC or overseas), or split by platform (e.g., international `.io` vs mainland site). Note the operating entity and governing law if given. If not published, state "not published." For open-weight models, note that **self-hosting lets the region be chosen freely**. |
| **Default retention** | Provider privacy policy or data retention page. Common values: 30 days (abuse monitoring), 7 days, 0 days (ZDR default), or "as long as necessary" / account-lifetime (no fixed numeric window — state this explicitly rather than inventing a number). |
| **ZDR (Zero Data Retention)** | Whether ZDR is available on request, on Enterprise plans, or as default. Note any exceptions (e.g., "Covered Models" excluded from ZDR, non-ZDR-eligible features like extended prompt caching). |
| **Other retention tiers** | List all retention periods that apply: e.g., flagged content (2yr), classifier metadata (7yr), feedback (5yr), Activity Feed (6yr), fine-tuning data (until deleted +30d), log data (3mo), account data (~30d post-deletion), extended KV cache retention. |
| **No Training** | Whether the provider trains on API data by default. Confirm if opt-out is available, opt-in only, or explicitly "no training." Note if open-weight self-hosting eliminates the concern entirely. If not published, state "not published." |

### Common provider policies (reference)

| Provider | API Hosting Region | Default Retention | ZDR Available | Other Tiers | No Training |
|----------|-------------------|:-----------------:|:-------------:|-------------|:-----------:|
| **OpenAI** | US (global infra) | 30 days | Yes (on request) | 24h KV cache (non-ZDR), fine-tune: until deleted +30d | Yes (API, since Mar 2023) |
| **Anthropic** | US | 30 days (7d post-Sep 2025) | Yes (Enterprise) | Flagged: 2yr, classifier: 7yr, feedback: 5yr, Activity Feed: 6yr. Some "Covered Models" excluded from ZDR. | Yes (API by default) |
| **Google (Vertex AI)** | Configurable (region-selectable) | Configurable | Configurable | Varies by region/agreement | Yes (API by default) |
| **Z.AI** | China / self-host | 0 days (ZDR default) | Default | N/A — open-weight (MIT) enables self-host | Yes |
| **Moonshot AI** | China / self-host | 30 days | Yes (via gateway) | Self-host via open weights (Modified MIT) | Claimed (API); self-host eliminates |
| **Mistral** | EU | 30 days | Yes (Scale plan, on request) | Stateful features excluded from ZDR | Yes (API by default) |
| **DeepSeek** | China (PRC servers) | Account lifetime / "as necessary" (no fixed window) | Not published | Logs "as necessary" | Trains by default; opt-out via email |
| **Tencent (Hunyuan)** | Configurable: PRC or overseas (SG/HK; EU controller in NL) | For duration of service; logs 3mo; account data ~30d post-deletion | Not published | — | Not published |
| **Xiaomi (MiMo)** | Overseas: Netherlands + Singapore; PRC separate | "As long as necessary" (no fixed window) | Not published | — | **No (explicitly stated)** |
| **MiniMax** | US (intl `.io`); mainland `minimaxi.com` differs | "As long as necessary" (no fixed window) | Not published | Cloned voices auto-deleted after 7d | Not published (only "no profiling/ad-targeting") |

When data conflicts across sources, prefer the provider's official documentation. Note the source of each policy value. For the hosting region, always distinguish the **official-API region** from the **self-host** case (open-weight models let the operator choose the region).

## Step 2.6 — Verify Basic Specs Against the Model's Official Site (mandatory)

Benchmark platforms (Artificial Analysis, LayerLens Stratix) frequently carry **stale, rounded, or wrong basic-spec metadata** — especially for models released within the last few weeks. Their `parameters`, `license` / `open_weights`, `context_length`, release date, and modality fields are entered manually and often **disagree with the model developer's own documentation** (e.g., a model listed as `Proprietary` on a platform while the developer's site announces it as open-source; a total-parameter count that differs by hundreds of billions between AA and SX).

**Therefore, for every model, you MUST cross-check the following "basic spec" fields against the developer's official site/docs and prefer the official value when they conflict.** This is not optional — the official developer source is the authority for basic specs.

### Fields that MUST be verified against the official site

| Field | Why verify | Typical official source |
|-------|-----------|-------------------------|
| **Total parameters** | AA (`parameters`) and SX (`parameters`) often disagree (e.g., 2500B vs 2800B). | Model card / technical blog / release announcement |
| **Active parameters (MoE)** | Platforms rarely expose per-token active params; the developer may state the expert config (e.g., "activates 16 of 896 experts"). | Technical report / architecture section |
| **License / Open Weights (OWM)** | Platforms may mislabel a just-released open model as `Proprietary`, or vice-versa. This directly changes the **Sovereignty (local deployment)** verdict. | License page / model card / "open-source" claim on blog |
| **Context window** | Rounding differs (e.g., 1,000,000 vs 1,048,576); some platforms cap or truncate. | API docs / model card |
| **Release date** | Preview vs GA dates are often confused. | Announcement / changelog |
| **Modality** | Text-only vs multimodal (image/video) may be out of date. | API docs / model card |
| **Weights availability date** | For open models not yet released, note the scheduled weights-release date. | Blog / announcement |

### How to find the official source

1. **Identify the developer** from AA `model_creator.name` (Step 1) — e.g., Moonshot AI, OpenAI, Anthropic, Google, Z.AI, Meta.
2. **Fetch the official model page/docs** with WebFetch. Preferred order:
   - The developer's **platform/API docs** (e.g., `platform.<vendor>.ai/docs`, `platform.<vendor>.ai/docs/llms.txt` if present — a `llms.txt` index lists all doc pages).
   - The **model card / quickstart / "introducing <model>" technical blog** (often linked from the docs or the developer's homepage).
   - The **license page** and **release announcement / changelog**.
3. **Extract the basic-spec fields** listed above from that official text.
4. **Compare with the AA and SX values** collected in Steps 1–2.

### Conflict-resolution rule

- **The developer's official documentation is authoritative for basic specs.** When the official value conflicts with AA/SX, **use the official value** as the displayed number.
- **Always record the discrepancy in a footnote**, e.g. `2800B (official) / 2500B (SX) / 2800B (AA)` or a note like `\* SX/AA list Proprietary, but the developer announced it as open-source (weights due YYYY-MM-DD); OWM=Yes per official`.
- If the official site is unreachable or does not state a field, **fall back to AA, then SX**, and mark the value's source accordingly (never fabricate).
- A conflict on **License / Open Weights** is high-impact: it changes the **Sovereignty (local deployment)** section and the OWM row. Re-evaluate those after correcting the value.

### Recording sources

Add a **Basic-spec source** note per model (e.g., in the Appendix "Data sources & notes") citing the official URL and the date checked, and list every field where the official value overrode a platform value.

## Step 3 — Combine and present

Present the combined report in two sections:

1. **Model overview table** — specs, pricing, and key metrics with a Source column.
2. **Per-benchmark table** — each benchmark with accuracy, cost (where available), and source.

### Report template

```
## Benchmark Data: {Model Name}

### Overview

| Metric | Value | Source |
|--------|-------|--------|
| Provider | {name} | Artificial Analysis |
| Release | {YYYY-MM-DD} | Artificial Analysis |
| License | {type} | Artificial Analysis |
| Total / Active params | {total}B / {active}B | Artificial Analysis (active) / LayerLens (total) |
| Context Window | {tokens} | Artificial Analysis / LayerLens |
| Reasoning | Yes / No | Artificial Analysis |
| AA Intelligence Index | {score} (#N / total) | Artificial Analysis |
| AA Coding Index | {score} | Artificial Analysis |
| AA Agentic Index | {score} | Artificial Analysis |
| Output Speed | {tokens/s} | Artificial Analysis |
| Latency (TTFT) | {seconds}s | Artificial Analysis |
| Input Price | $X.XX / 1M tokens | Artificial Analysis |
| Output Price | $X.XX / 1M tokens | Artificial Analysis |
| Cache Hit Price | $X.XX / 1M tokens | Artificial Analysis |
| Blended Price (input:output:cache = 7:2:1) | $X.XX / 1M tokens | Artificial Analysis |
| Total Eval Cost (AA Intelligence Index) | ${cost} | Artificial Analysis |
| Time per Task | {seconds}s ({min}min) | Artificial Analysis |
| Total Output Tokens (Index) | {tokens} | Artificial Analysis |
| OWM (Open Weights Model) | Yes / No | Artificial Analysis |
| API Hosting Region | {region / country} | Provider docs |
| Retention (API default) | {days / "as necessary"} | Provider docs / gateway |
| Retention (API ZDR) | Available / Not available / Default | Provider docs / gateway |
| Retention (other tiers) | {list of policies} | Provider docs / gateway |
| No Training (API) | Yes / No / Claimed / Not published | Provider docs / gateway |

### Per-Benchmark Scores

| Benchmark | Accuracy | Avg Time | Cost (est.) | Source |
|-----------|:--------:|:--------:|:-----------:|--------|
| {benchmark} | {score}% | {s}s | — | LayerLens Stratix |
| GDPval-AA v2 Elo | {elo} | — | — | Artificial Analysis |
```

### Notes on cost

- **Artificial Analysis** reports a single total cost to run the full Intelligence Index evaluation (composite of 9 benchmarks). This is found in the model summary paragraph: "In total, it cost ${X} to evaluate {model} on the Intelligence Index."
- **LayerLens Stratix** does not expose per-evaluation cost or token usage via their API. Only model-level pricing ($/token) is available. To estimate, multiply prompt count × estimated tokens per prompt × model pricing.
- Individual benchmark cost comparison charts are available on Artificial Analysis model pages (under "Cost per Task" / "Evaluation Breakdown") but are rendered as charts, not exposed as raw data.

## Step 4 — Compare Models by Capability

When comparing multiple models, organize benchmarks into five capability categories. For each category, designate a **primary benchmark** (most representative) and supplement with 2-3 additional benchmarks when data is sparse.

### Capability Categories with Prioritized Benchmarks

| Category | Primary Benchmark | Supplements (2-3) | What It Measures |
|----------|-------------------|-------------------|------------------|
| **Reasoning** | GPQA Diamond | HLE (Humanity's Last Exam), AIME 2025/2026, MATH-500, Big Bench Hard | Frontier science/math, logic, multi-step reasoning |
| **Coding** | AA Coding Index | SWE-bench Verified, SWE-bench Lite, SWE-bench Pro, Terminal-Bench 2.1 | Real-world software engineering, agentic coding |
| **Knowledge** | AA-Omniscience Index | MMLU Pro, AGIEval English, General Purpose QA | Broad factual knowledge, low hallucination, academic recall |
| **Agent** | AA Agentic Index | τ-Bench (Tau-Bench / tau2), Terminal-Bench 2.1, GDPval-AA v2 (Elo) | Tool use, multi-turn agentic tasks, real-world workflows |
| **RAG** | BrowseComp | General Purpose QA, AGIEval English, MMLU Pro | Web browsing, information retrieval, evidence synthesis |

### Supplement Rule

If any model lacks data for the primary benchmark in a category, add 2-3 supplementary benchmarks from that category's supplement list. Present the primary first, then supplements below.

**Coding category — primary is AA Coding Index.** The primary benchmark for Coding is the **AA Coding Index** (`evaluations.artificial_analysis_coding_index` from the AA Data API — approach A; an AA composite score, higher is better). **Fetch it via the official AA Data API** (cleanest), or from the **static model-page HTML** (`"codingIndex":<num>` in the `__next_f` payload — approach C; a plain `curl`/WebFetch works, no Playwright needed). Display it as the first, bolded row and decide the Coding **Verdict** by it. Then list the SWE-bench variants (Verified → Lite → Pro) and Terminal-Bench 2.1 as supplements below, using their SX values (see Source Precedence). Only if neither the API nor the static payload is available, fall back to **SWE-bench Verified** as the primary and clearly note the substitution.

**Reasoning category — primary is GPQA Diamond.** The primary benchmark for Reasoning is **GPQA Diamond** (`evaluations.gpqa` from the AA Data API — approach A; graduate-level science QA, 0–1 scale, multiply by 100 for %). Fetch it via the AA Data API. Display it as the first, bolded row and decide the Reasoning **Verdict** by it. List HLE, AIME 2025/2026, MATH-500, and Big Bench Hard as supplements below. When both AA (`gpqa`) and SX report a benchmark, follow the Source Precedence rule. If a model lacks GPQA, fall back to **HLE** as the primary and note the substitution.

**Agent category — primary is AA Agentic Index.** The primary benchmark for Agent is the **AA Agentic Index** (an AA composite of GDPval-AA v2 + 𝜏³-Banking; higher is better). It is **not** in the free AA Data API, but **is available in the static model-page HTML** (`"agenticIndex":<num>` in the Next.js `__next_f` payload — a plain `curl`/WebFetch is enough; see approach C). Order of preference: (1) static HTML payload parse (no browser); (2) AA **commercial API** if available; (3) Playwright as a last resort. Mark its source and never fabricate it. Only if none of these work, **fall back to τ-Bench (Tau-Bench / `tau2`)** as the primary, and if that is also missing, **Terminal-Bench 2.1** (`terminalbench_v2_1`) — clearly noting the substitution. Decide the Agent **Verdict** by whichever primary was actually used.

**Knowledge category — primary is AA-Omniscience Index.** The primary benchmark for Knowledge is the **AA-Omniscience Index** (AA's broad-knowledge / low-hallucination composite; higher is better). It is **not** in the free AA Data API, but **is available in the static model-page HTML** as `"omniscience":<num>` in the Next.js `__next_f` payload (a plain `curl`/WebFetch is enough; see approach C — same records that hold `codingIndex`/`agenticIndex`). Order of preference: (1) static HTML payload parse (no browser); (2) AA **commercial API** if available; (3) Playwright as a last resort. Mark its source and never fabricate it. Display it as the first, bolded row and decide the Knowledge **Verdict** by it. List MMLU Pro, AGIEval English, and General Purpose QA as supplements below (SX values). If the AA-Omniscience Index cannot be obtained, **fall back to MMLU Pro** as the primary and clearly note the substitution.

### Comparison Format

Present each category as a table:

```
### {Category} (Primary: {Benchmark})

| Benchmark | Model A | Model B | Model C |
|-----------|---------|---------|---------|
| **{Primary}** (primary) | {score} | {score} | {score} |
| {Supplement 1} | {score} | {score} | {score} |
| {Supplement 2} | {score} | {score} | {score} |
```

Bold the winner in each row. Add a **Verdict** line after each category. End with an overall winner table.

Example for the Coding category (primary = AA Coding Index, source AA; supplements from SX):

```
### Coding (Primary: AA Coding Index)

| Benchmark | Model A | Model B | Model C | Source |
|-----------|---------|---------|---------|--------|
| **AA Coding Index** (primary) | {score} | {score} | {score} | AA |
| SWE-bench Verified | {score}% | {score}% | {score}% | SX |
| SWE-bench Lite | {score}% | {score}% | {score}% | SX |
| Terminal-Bench 2.1 | {score}% | {score}% | {score}% | SX |
```

Example for the Reasoning category (primary = GPQA Diamond, source AA; supplements from AA/SX):

```
### Reasoning (Primary: GPQA Diamond)

| Benchmark | Model A | Model B | Model C | Source |
|-----------|---------|---------|---------|--------|
| **GPQA Diamond** (primary) | {score}% | {score}% | {score}% | AA |
| HLE | {score}% | {score}% | {score}% | SX |
| AIME 2025 | {score}% | {score}% | {score}% | SX |
| MATH-500 | {score}% | {score}% | {score}% | SX |
```

Example for the Agent category (primary = AA Agentic Index if obtainable, else τ-Bench):

```
### Agent (Primary: AA Agentic Index)

| Benchmark | Model A | Model B | Model C | Source |
|-----------|---------|---------|---------|--------|
| **AA Agentic Index** (primary) | {score} | {score} | {score} | AA (static HTML) |
| τ-Bench (tau2) | {score}% | {score}% | {score}% | AA/SX |
| Terminal-Bench 2.1 | {score}% | {score}% | {score}% | SX |
| SWE-bench Pro | {score}% | {score}% | {score}% | SX |
```

If the AA Agentic Index cannot be obtained, relabel the header as `### Agent (Primary: τ-Bench — AA Agentic Index unavailable)` and bold the winner by τ-Bench.

Example for the Knowledge category (primary = AA-Omniscience Index, source AA static HTML; supplements from SX):

```
### Knowledge (Primary: AA-Omniscience Index)

| Benchmark | Model A | Model B | Model C | Source |
|-----------|---------|---------|---------|--------|
| **AA-Omniscience Index** (primary) | {score} | {score} | {score} | AA (static HTML) |
| MMLU Pro | {score}% | {score}% | {score}% | SX |
| AGIEval English | {score}% | {score}% | {score}% | SX |
| General Purpose QA | {score}% | {score}% | {score}% | SX |
```

If the AA-Omniscience Index cannot be obtained, relabel the header as `### Knowledge (Primary: MMLU Pro — AA-Omniscience Index unavailable)` and bold the winner by MMLU Pro.

### Source Precedence (AA vs SX for the same benchmark)

Some benchmarks are reported by **both** Artificial Analysis (AA) and LayerLens Stratix (SX) — commonly **HLE (Humanity's Last Exam)** and **Terminal-Bench**. Because each platform uses a different evaluation harness, their scores often differ significantly and are **not directly comparable**.

Rule: **when a benchmark value exists on both AA and SX, prefer the SX value** (SX exposes the explicit harness — e.g. `Terminal-Bench 2.1 (Terminus-2)`, `mini-swe-agent` for SWE-bench — and is more reproducible). Use the SX value as the primary/displayed number and mark the row source as `SX`.

- Keep the AA value as a **parenthetical reference** next to the SX value or in a footnote (e.g. `SX（AA参考: 80.90/80.52/77.90%）`), never as the ranked/bolded number.
- If a model has the benchmark only on AA (not on SX), keep the AA value but add a footnote that the harness differs and it is **not directly comparable** to the SX-based scores in the same row.
- Winners (bold) and Verdicts must be decided using the SX values for these dual-source benchmarks.
- Benchmarks available on only one platform (e.g. SWE-bench variants → SX only; GDPval-AA / AA-Omniscience / Coding & Agentic Index → AA only) are used as-is with their single source.

### Basic Information Tables (Overall Comparison)

When comparing multiple models end-to-end, present a **Basic Information** section organized into the following grouped tables. Split into separate tables (not one large table) so each dimension is easy to scan. Bold the best value in each row where a clear "better" direction exists.

**Model Attributes**

```
| Item | Model A | Model B | Model C |
|------|:---:|:---:|:---:|
| Provider | {name} | {name} | {name} |
| Release | {YYYY-MM-DD} | ... | ... |
| License | {type} | ... | ... |
| Total / Active params | {total}B / {active}B | ... | ... |
| Context | {tokens} | ... | ... |
| Reasoning | Yes / No | ... | ... |
```

**Pricing**

```
| Item | Model A | Model B | Model C |
|------|:---:|:---:|:---:|
| Input price (/1M) | $X.XX | ... | ... |
| Output price (/1M) | $X.XX | ... | ... |
| Cache hit price (/1M) | $X.XX | ... | ... |
| Blended price (input:output:cache = 7:2:1) | $X.XX | ... | ... |
```

The **Cache hit price** row is mandatory in the Pricing table. The **Blended price** is a cache-aware weighted average of the three per-1M prices at the ratio **input : output : cache = 7 : 2 : 1**; always spell out the ratio in the row label (do not abbreviate to just "Blended price"). Compute as `0.7 × input + 0.2 × output + 0.1 × cache_hit` when the AA field is unavailable.

**Benchmarks (Artificial Analysis)**

```
| Item | Model A | Model B | Model C |
|------|:---:|:---:|:---:|
| AA Intelligence Index | {score} | ... | ... |
| AA Coding Index | {score} | ... | ... |
| AA Agentic Index | {score} | ... | ... |
```

**Cost & Speed**

```
| Item | Model A | Model B | Model C |
|------|:---:|:---:|:---:|
| Total Eval Cost | ${cost} | ... | ... |
| Time per Task | {s}s ({min}min) | ... | ... |
```

In the **HTML slide deck**, render these two Cost & Speed rows (**Total Eval Cost** and **Time per Task**) as extra rows on the **Basic Spec & Pricing** slide (below the Pricing block), not as a separate slide — keeping the concise cost summary next to the specs while the detailed cost-efficiency breakdown stays in the Appendix.

**Sovereignty**

```
| Item | Model A | Model B | Model C |
|------|:---:|:---:|:---:|
| Developer (company) | {company} | ... | ... |
| Developer country | {country} | ... | ... |
| OWM (Open Weights Model) | Yes / No | ... | ... |
| API Hosting Region (APIホストリージョン) | {region / country} | ... | ... |
| Retention (API default) | {days / "as necessary"} | ... | ... |
| Retention (API ZDR) | Available / Default / On request / Enterprise / — | ... | ... |
| No Training (API) | Yes / No / Claimed / Not published | ... | ... |
```

Field notes for the Basic Information tables:

- **Total / Active params**: **always report as `{total}B / {active}B`** (two values separated by ` / `). Total comes from AA `parameters` or Stratix `parameters`; active comes from AA `inferenceParametersActiveBillions`. For MoE models the two differ (e.g., `744B / 40B`); for dense models they are equal (`{n}B / {n}B (dense)`). If a value is undisclosed, fill that side with `非公開` / `N/A` (e.g., `非公開 / 非公開` for closed proprietary models, or `2500B / 非公開` when only total is known). Never collapse to a single number. **Verify the total (and, where stated, the active/expert config) against the developer's official site per Step 2.6, and prefer the official value on conflict** — AA and SX frequently disagree on parameter counts; footnote the discrepancy (e.g., `2800B (official) / 2500B (SX)`).
- **License / OWM (Open Weights)**: **verify against the developer's official site per Step 2.6, and prefer the official value on conflict.** Benchmark platforms often mislabel a just-released open model as `Proprietary` (or the reverse). A correction here changes the OWM row and the **Sovereignty (local deployment)** verdict, so re-evaluate those after correcting. If weights are announced but not yet released, note the scheduled release date (e.g., `open-source (weights due YYYY-MM-DD)`).
- **Cache hit price**: AA `cacheHitPrice` (mandatory row in the Pricing table). **Blended price**: AA `price1mBlended7To2To1` — a **cache-aware** weighted average at the ratio **input : output : cache = 7 : 2 : 1**. Always show the ratio in the label. If the AA field is missing, compute it as `0.7 × input_price + 0.2 × output_price + 0.1 × cache_hit_price`.
- **AA Intelligence / Coding / Agentic Index**: AA `intelligenceIndex` / `codingIndex` / `agenticIndex`.
- **Total Eval Cost**: prefer AA official `intelligenceIndexCost.total`. If the model is **not present** in the AA cost dataset, compute an approximation as `input_tokens × input_price + output_tokens × output_price` (cache not considered) from `canonicalIntelligenceIndexTokenCount`, and clearly mark it as an approximation (e.g., `≈$X (approx)`). If neither the official value nor an approximation can be obtained (e.g., pricing not published, as for a free preview), **use `0`** for the Total Eval Cost and mark it (e.g., `$0 (n/a)`), so downstream calculations (bubble-size scaling) remain well-defined.
- **Time per Task**: AA `intelligenceIndexTimePerTask` (seconds; also show minutes). This is a computed value (output tokens per task ÷ output speed, weighted), excluding TTFT/overhead.
- **OWM**: Yes if `isOpenWeights` is true. Note that open-weight models (self-hostable) can eliminate retention/training concerns entirely.
- **Developer (company) / Developer country**: the organization that developed/released the model and its home country (e.g., Tencent / China, Xiaomi / China, DeepSeek / China, MiniMax / China, OpenAI / USA, Mistral / France). From AA `model_creator.name` (company) and provider docs / general knowledge (country). Show the country with a flag emoji or name when useful. This is a sovereignty signal distinct from the API hosting region — a model can be developed in one country but served from another (e.g., a Chinese-developed model whose international API is hosted in the US).
- **API Hosting Region** (label it **"APIホストリージョン"** in Japanese decks): the country/region where the official first-party API stores/processes data (from provider docs — see Step 2.5). Distinguish the **official-API region** from the **self-host** case; for open-weight models note that self-hosting lets the operator choose the region freely. Use "configurable" when the provider lets customers select, and "not published" when undisclosed.
- **Retention / No Training**: from provider docs / gateway listings (see Step 2.5). Optionally add a **Retention (other tiers)** row when relevant. When a provider only offers "as long as necessary" / account-lifetime with no fixed numeric window, state that verbatim rather than inventing a day-count.
- Add a footnote for any provider-specific pricing quirks (e.g., per-search surcharge) and cite sources under each section.

Optionally follow with a **Speed & Latency supplement** table (`Output Speed tok/s`, `TTFT`) using AA `medianOutputSpeed` and `medianTimeToFirstAnswerToken` / TTFT.

Add **two Sovereignty rows** to the overall winner table (in place of a single "Retention & Privacy Verdict" row), evaluating the sovereignty posture under both deployment modes separately:

- **Sovereignty (API use)** — evaluate the *official first-party API* posture: prefer the model that most clearly protects data (e.g., explicitly states "no training on inputs", 0-day / ZDR retention, favorable hosting region). Name the winner and, in the rationale, briefly contrast the others (who trains by default, who is unpublished).
- **Sovereignty (local deployment)** — because open-weight models can be self-hosted (0-day retention, no training regardless of provider policy), **list all locally-deployable models rather than picking one winner**, and highlight those whose license permits **unrestricted commercial use** (no revenue cap, no MAU cap, no separate-permission requirement, no mandatory branding). Separate the "unrestricted commercial" models (e.g., Apache 2.0 / MIT / OpenMDW) from any that are "commercial with conditions" (e.g., community licenses with revenue thresholds or branding requirements).

**In the rationale cell of both Sovereignty rows, append each model's developer company and developer country** (e.g., `Hy3=Tencent(China) / MiMo=Xiaomi(China) / DeepSeek=DeepSeek(China) / M3=MiniMax(China) / Nemotron=NVIDIA(USA)`), since the country of the developer is a key sovereignty signal distinct from the API hosting region. The strongest overall posture is: open-weight + permissive/unrestricted-commercial license + self-host (0-day retention, no training).

### Report Structure (Main Body vs Appendix)

Organize the comparison report into a **main body** and an **Appendix**, so the most decision-relevant content is up front and supporting detail is moved to the back.

**Main body** (in this order):

1. Basic Information tables (the grouped tables above: Model Attributes, Pricing, Benchmarks, Cost & Speed, Sovereignty)
2. Capability-by-category comparison (Reasoning / Coding / Knowledge / Agent / RAG)
3. Overall winner table (with the two Sovereignty rows: API use + local deployment, each citing developer company/country)

**Appendix** (introduce with a top-level `# Appendix` heading, larger than the section headings):

- **Cost efficiency detail** — the full cost-efficiency table (Total Eval Cost, Cost per Task, total tokens, Time per Task, E2E response time) and the **per-evaluation cost breakdown** (`weightedCostPerTask`). This detail belongs in the Appendix, *after* the `# Appendix` heading, not in the main body.
- **Retention & Privacy detail** — the full per-provider table (API hosting region, retention tiers, ZDR, training policy) and verdict, with source URLs for each policy value.
- **Data sources & notes** — sources, harness-difference caveats, approximation notes, missing-data footnotes, and the **per-model basic-spec source note** from Step 2.6 (official URL + date checked + every field where the official value overrode a platform value).

Rules:

- The `# Appendix` heading must be a top-level heading (`#`), visually larger than the `##` section headings used elsewhere.
- Keep the Basic Information tables' concise Cost & Speed summary (Total Eval Cost, Time per Task) in the main body; move the **detailed** cost-efficiency breakdown and per-evaluation cost table into the Appendix.
- You may label Appendix subsections with letters (e.g., `## A. Cost Efficiency`) or keep the original numbering — but they must appear under the `# Appendix` heading.

### HTML Slide Deck Layout (when rendering the report as a slide deck)

When the comparison report is turned into an HTML slide deck (e.g., via the slidekit-create skill), use the following **slide allocation and chart mapping**. Each capability category gets its own slide with a chart — do not combine two categories on one slide.

| Slide | Content | Chart type |
|-------|---------|------------|
| Cover | Title + model names | — |
| Agenda | Section list | — |
| Executive Summary | Verdict + per-model cards | — |
| **Basic Spec & Pricing** | Attributes + pricing table (incl. cache row, blended ratio label) **+ Cost & Speed rows (Total Eval Cost, Time per Task)** | Table |
| **Sovereignty & Privacy** (immediately after Basic Spec & Pricing) | Developer company & country, OWM, APIホストリージョン, retention, ZDR, self-host, no-training | Table + notes |
| **Intelligence & Cost** | Left: AA Intelligence Index bar. Right: bubble chart (Intelligence vs Time per Task, size = Total Eval Cost) | Bar + Bubble |
| **Reasoning** (own slide) | Left: GPQA Diamond bar (primary). Right: bubble chart | Bar + Bubble |
| **Knowledge** (own slide) | Left: AA-Omniscience Index bar (primary). Right: bubble chart | Bar + Bubble |
| **Coding** (own slide) | Left: AA Coding Index bar (primary). Right: bubble chart | Bar + Bubble |
| **Agent** (own slide) | Left: AA Agentic Index bar (primary; τ-Bench fallback). Right: bubble chart | Bar + Bubble |
| Overall Verdict | Winner-by-dimension (incl. two Sovereignty rows: API use + local deployment, with developer company/country) + use-case recommendations | Table |
| Closing | Key stats | — |

Chart & ordering rules:

- **Intelligence & Cost slide:** use the **same two-pane layout as the capability slides** (left bar + right bubble), so the whole deck's score slides are visually consistent. **Do not use a grouped/dual-axis bar chart or a line chart** for this slide.
  - **Left pane:** a horizontal bar chart of the **AA Intelligence Index** (`intelligenceIndex`) across all models, one distinct per-model color (the same palette as the capability slides).
  - **Right pane:** a **bubble chart with the identical axes/encoding as the capability bubble charts** — **X = Time per Task** (AA `intelligenceIndexTimePerTask`, seconds, lower is better), **Y = AA Intelligence Index**, **bubble size = Total Eval Cost** (AA `intelligenceIndexCost.total`, USD, `r = cost > 0 ? sqrt(cost)/K : 2`). One bubble per model, top legend, tooltip `{model}: {score}, {time}s, Eval ${cost}`. Read as "top-left + small bubble = best" (high intelligence, fast, cheap).
  - Use **Total Eval Cost** (not cost-per-task or speed) as the bubble-size/cost encoding. If it can only be approximated, mark it `≈$X (approx)`; **if it cannot be obtained at all (e.g., unpriced preview), use `0` — never `null`/`undefined`/a gap** — and plot the bubble at the minimum radius (`2`) with a solid colored border, noting in the caption that the size is a placeholder ("cost unavailable"), not a real cost.
  - Speed & latency (tok/s, TTFT) do not go on this slide's charts; keep them in the Basic Spec "Cost & Speed" rows or the Appendix.
- **Reasoning and Knowledge are separate slides**, each shown as a chart (bar / grouped bar per benchmark). Do not put reasoning and knowledge tables on the same slide. Reasoning's primary series is **GPQA Diamond** (AA `evaluations.gpqa`); HLE / AIME / MATH-500 are supplements. Knowledge's primary series is the **AA-Omniscience Index** (AA `"omniscience"`, static HTML); MMLU Pro / AGIEval / General QA are supplements.
- **Coding and Agent are separate slides**, each shown as a chart. Do not combine coding and agent on one slide. Coding's primary series is the **AA Coding Index**; SWE-bench variants are supplements. Agent's primary series is the **AA Agentic Index**; if it cannot be obtained (not in the free API), fall back to **τ-Bench** and note the substitution, with Terminal-Bench 2.1 as a supplement.
- **Sovereignty & Privacy** must be placed **immediately after** the Basic Spec & Pricing slide (moved up from the cost/appendix area). For each model show the **developer company and its home country** (e.g., Tencent / China) and a per-model **API hosting region** field (labeled **"APIホストリージョン"** in Japanese decks; from Step 2.5) alongside OWM, retention, ZDR, and no-training — and note that self-hosting an open-weight model lets the region be chosen freely. Keep the developer country distinct from the API hosting region (a model may be developed in one country but served from another).
- **Each capability slide (Reasoning / Knowledge / Coding / Agent) uses a two-pane layout:** the **left pane** is a horizontal bar chart of that category's **primary index** across all models; the **right pane** is a **bubble chart** (same on every capability slide). Supplementary benchmarks (HLE/AIME/MATH, MMLU Pro/AGIEval, SWE-bench variants, Terminal-Bench/τ-Bench) move out of a second bar chart into the verdict card / footnote to make room for the bubble.
- **Capability bubble chart spec (identical axes on all four capability slides):**
  - **X-axis** = **Time per Task** (seconds; AA `intelligenceIndexTimePerTask`, lower is better). Use the same value for all four slides since AA reports one Index-level time-per-task per model.
  - **Y-axis** = that slide's **primary index score** (GPQA Diamond % / AA-Omniscience Index / AA Coding Index / AA Agentic Index).
  - **Bubble size** = **Total Eval Cost** (AA `intelligenceIndexCost.total`, USD). Scale radius as `r = sqrt(cost)/K` (area ∝ cost; pick K, e.g. 6, so the largest bubble fits). **When Total Eval Cost is `0` (unavailable/unpriced), set the radius to a small but clearly visible minimum (e.g., `2`)** — never `0` (a radius of `0` is invisible) — so the model still appears on the chart. Additionally, give the zero-cost bubble a solid colored **border** (e.g., `borderWidth: 4`, same color) so it reads as a distinct marker, and note in the caption that its size is a placeholder (cost unavailable), not a real cost. Implementation: `r = cost > 0 ? sqrt(cost)/K : 2`.
  - One bubble per model, one distinct color per model (consistent across all slides), a top legend, and a tooltip showing `{model}: {score}, {time}s, Eval ${cost}`.
  - Chart.js `type:'bubble'`; label the axes ("Time per Task (s) · lower is better" / the index name). Read the bubble as "top-left + small = best" (high score, fast, cheap).
  - If a model lacks Time per Task, omit its bubble (keep it in the left bar) and note the omission. If it only lacks Eval Cost, still plot it with radius `1` (per the rule above) rather than omitting it.
- Missing data (e.g., a model with no Stratix per-benchmark scores) is shown as `—` in the chart legend/labels with a footnote.

### Data Sources

| Data Source | What It Provides |
|-------------|-----------------|
| **Stratix API** (`GET /evaluations`) | Per-benchmark accuracy% for AIME, MATH-500, BBH, SWE-bench variants, HLE, MMLU Pro, AGIEval, GPQA, Terminal-Bench, τ-Bench |
| **Artificial Analysis** (AA model pages) | Intelligence Index, pricing, speed, latency, context, GDPval-AA v2 Elo, eval cost |
| **AA Leaderboard** (`/leaderboards/models`) | Intel Index rank among all models |
| **AA Evaluation pages** (`/evaluations/{name}`) | Per-evaluation leaderboards (GDPval-AA, BrowseComp, τ-Bench, etc.) |
| **BenchLM.ai** | BrowseComp scores, MMLU Pro scores, HLE scores, τ-Bench scores |
| **Taubench.com** | τ-Bench scores per model |
| **LLM-Stats.com** | Cross-model comparison pages with BrowseComp, SWE-bench, τ-Bench data |
| **Vendor model cards** | Self-reported scores (verify against independent sources) |
| **Developer official site / docs** (Step 2.6) | **Authoritative for basic specs** — total/active parameters, license/open-weights, context window, release date, modality. Prefer over AA/SX when they conflict. Look for `platform.<vendor>.ai/docs` (and `llms.txt`), the model card / "introducing <model>" blog, license page, and changelog. |

### Handling Missing Data

- Mark missing data as `—` in tables.
- Add footnotes explaining the gap (e.g., "\* no published score; using predecessor model score as proxy", "† different eval harness — not directly comparable").
- When using a predecessor's score as a proxy, note this clearly.
- Batch additional web searches to fill gaps before presenting.
- For Retention and No Training data, if provider docs are unclear, note the uncertainty and source (e.g., "\* inferred from gateway listing; verify with provider").

## Step 5 — Create Bubble Chart (Speed vs SWE Capability)

Generate a bubble chart comparing models by speed and SWE capability, with bubble size representing cost efficiency.

> Note: this Step-5 bubble chart (X = **speed tok/s**, Y = **SWE-bench Verified %**, size = **Cost per Task**) is a **standalone matplotlib figure** for the report/appendix. It is **distinct** from the per-capability slide bubble charts described in the "HTML Slide Deck Layout" section (which use X = **Time per Task (s)**, Y = **the slide's primary index**, size = **Total Eval Cost**, rendered with Chart.js). Keep the two separate; do not merge their axis definitions.

### Data Sources

| Axis | Metric | Source |
|------|--------|--------|
| **X-axis** | Speed (tokens/s) | AA model summary ("Output tokens per second") |
| **Y-axis** | SWE Capability | SWE-bench Verified % (Stratix `/evaluations` or AA/Stratix model data) |
| **Bubble size** | Cost per Intelligence Index Task | AA model page — "Cost per Task" ranking table (weighted avg USD per Intelligence Index task) |

### Extracting Cost per Task

On each AA model page, find the **Cost per Task** ranking table (rendered as text after Playwright renders the page). It lists models ordered by cost ascending with a single dollar value per row:

```
Cost per Task
Weighted average cost (USD) per Intelligence Index task · Lower is better
DeepSeek V4 Pro (max)
gpt-oss-120b (high)
MiniMax-M3
GPT-5.6 Luna (max)
...
$0.04
$0.06
$0.12
$0.21
```

Match model position in the list to the corresponding dollar value. The number of models and prices should be equal.

### Chart Specification

- **Tool**: Python with `matplotlib`
- **Canvas**: `figsize=(10, 7)`
- **Bubble scaling**: `sizes = [cost * 300 for cost in cost_per_task]` (adjust multiplier as needed). If a model's cost is `0` (unavailable/unpriced), use a small but clearly visible marker size instead of `0` (matplotlib `s` is area in points²; a value like `1` is invisible) — e.g., `sizes = [(cost * 300) if cost > 0 else 10 for cost in cost_per_task]`, and give that point a colored edge so it reads as a placeholder marker.
- **Colors**: one distinct color per model (use hex codes)
- **Labels**: model name annotated with offset (`xytext`) + white bbox
- **Legend**: bubble size legend showing 3 reference values (e.g., $0.20 / $0.30 / $0.50)
- **Grid**: enabled with `alpha=0.3`
- **Spines**: hide top and right
- **Output**: save as `bubble_chart.png` at 150 DPI

### Example Plot

```python
import matplotlib.pyplot as plt

models = ['Model A', 'Model B', 'Model C']
speed = [91, 210, 150]
swe = [73.3, 71.6, 78.0]
cost_per_task = [0.27, 0.21, 0.47]

fig, ax = plt.subplots(figsize=(10, 7))
ax.scatter(speed, swe, s=[c * 300 for c in cost_per_task], alpha=0.7, edgecolors='black', linewidths=1.2, zorder=3)

for i, model in enumerate(models):
    ax.annotate(model, (speed[i], swe[i]), textcoords='offset points', fontweight='bold',
                bbox=dict(boxstyle='round,pad=0.3', fc='white', ec='gray', alpha=0.8))
```

### Handle Missing Data

- If a model's Cost per Task is not visible on its own page, search for it in any other model's ranking table — the ranking shows the same global list.
- If SWE-bench data is missing for a model, check both the reasoning and non-reasoning variants on Stratix.
- For cost, fall back to **Intelligence Index Total Cost** (total eval cost on AA) if Cost per Task cannot be found.

## Notes

- Artificial Analysis is server-rendered but uses React hydration. Use Playwright for reliable text extraction.
- Stratix is a Next.js SPA — data loads via a Lambda REST API. Intercept network requests to find the API base URL (may change).
- Some model variants (e.g., "max", "high", "medium", "low", "xhigh") have separate pages on Artificial Analysis. Try the base model first, then specific variants.
- Stratix evaluation results include accuracy, prompt count, duration, and latency. No direct cost per eval.
- If the model is not found on either platform, report that it was not found and suggest checking the exact model name spelling.
- For reasoning models and their non-reasoning variants, check Stratix for both — the reasoning variant often has fewer evals but higher scores.
- Cost per Task values on AA are in the "Cost per Task" section inside a simple ranking table (not the stacked bar chart). Use Playwright to render the page and extract all text lines, then match model names sequentially to dollar values.
