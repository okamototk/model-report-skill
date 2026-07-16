---
name: collect-benchmark
description: Collect AI model benchmark data from Artificial Analysis and LayerLens Stratix. Uses web scraping for Artificial Analysis and the Stratix REST API (with optional API key). Model name is the only required input. Use when the user asks for benchmark data, model scores, model comparison, or evaluation results for a specific model.
---

# Collect Model Benchmark Data

Collect benchmark data for a given AI model from two independent evaluation platforms: **Artificial Analysis** (`artificialanalysis.ai`) and **LayerLens Stratix** (`stratix.layerlens.ai`).

## Parameters

- **Model name** (required): The name of the AI model to look up (e.g., `GPT-4o`, `Claude Sonnet 4`, `Gemini 2.5 Flash`, `DeepSeek V4 Pro`).
- **LayerLens API Key** (optional): If available, pass via `x-api-key` header to the Stratix API for full model catalog access (233 models vs 168 public).

## Step 1 — Search Artificial Analysis

Artificial Analysis provides Intelligence Index scores, speed (tokens/s), pricing, latency, per-benchmark breakdowns, and **evaluation cost data**.

### Find the model

Use either approach:

**A) Leaderboard** — Fetch `https://artificialanalysis.ai/leaderboards/models`. Search for the model row to extract Intelligence Index, blended price, speed, latency, context window, and the model slug.

**B) Model detail page** — Fetch `https://artificialanalysis.ai/models/{slug}` where `{slug}` is derived from the model name by removing parenthetical variants, lowercasing, and replacing spaces/special chars with hyphens (e.g., `GPT-4o` → `gpt-4o`).

For B, use Playwright (headless Chromium) to handle the React-rendered page. Wait for `networkidle` then extract from rendered text.

### Data to collect

| Metric | How to find |
|--------|-------------|
| Intelligence Index | #N ranking + score in model summary section |
| Output Speed | Tokens/s in model summary |
| Input / Output / Cache Price | USD per 1M tokens in model summary |
| Context Window | Tokens in technical specs |
| Latency (TTFT) | Seconds in model summary / FAQ |
| End-to-End Response | Seconds for 500 tokens in model summary |
| Reasoning flag | Yes/No in technical specs |
| Provider & Release Date | Top of page |
| **Total Eval Cost** | From "In total, it cost $X to evaluate {model} on the Intelligence Index" in the Comparison Summary paragraph |
| **Total Output Tokens (Index)** | From the Intelligence Index evals summary — total output tokens across all 9 evaluations in the benchmark (often listed alongside Total Eval Cost) |
| Per-benchmark scores | Individual evaluation pages at `/evaluations/{eval-name}` (e.g., `/evaluations/gdpval-aa` for GDPval-AA v2 leaderboard) |

## Step 2 — Search LayerLens Stratix

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

## Step 2.5 — Collect Retention and No Training Policy

For each model, collect data retention policy and whether the provider trains on API data. These are not available on benchmark platforms — search provider documentation, API reference pages, or gateway listing sites (e.g., `requesty.ai/models/{provider}/{model}`, `vercel.com/ai-gateway/models/{model}`, `llmgateway.io/providers/{provider}`). Gateway sites often display "Data retention" and "Used for training" fields in their spec tables.

### Data to collect

| Policy | How to find |
|--------|-------------|
| **Default retention** | Provider privacy policy or data retention page. Common values: 30 days (abuse monitoring), 7 days, 0 days (ZDR default). |
| **ZDR (Zero Data Retention)** | Whether ZDR is available on request, on Enterprise plans, or as default. Note any exceptions (e.g., "Covered Models" excluded from ZDR, non-ZDR-eligible features like extended prompt caching). |
| **Other retention tiers** | List all retention periods that apply: e.g., flagged content (2yr), classifier metadata (7yr), feedback (5yr), Activity Feed (6yr), fine-tuning data (until deleted +30d), extended KV cache retention. |
| **No Training** | Whether the provider trains on API data by default. Confirm if opt-out is available or if training is opt-in only. Note if open-weight self-hosting eliminates the concern entirely. |

### Common provider policies (reference)

| Provider | Default Retention | ZDR Available | Other Tiers | No Training |
|----------|:-----------------:|:-------------:|-------------|:-----------:|
| **OpenAI** | 30 days | Yes (on request) | 24h KV cache (non-ZDR), fine-tune: until deleted +30d | Yes (API, since Mar 2023) |
| **Anthropic** | 30 days (7d post-Sep 2025) | Yes (Enterprise) | Flagged: 2yr, classifier: 7yr, feedback: 5yr, Activity Feed: 6yr. Some "Covered Models" excluded from ZDR. | Yes (API by default) |
| **Google (Vertex AI)** | Configurable | Configurable | Varies by region/agreement | Yes (API by default) |
| **Z.AI** | 0 days (ZDR default) | Default | N/A — open-weight (MIT) enables self-host | Yes |
| **Moonshot AI** | 30 days | Yes (via gateway) | Self-host via open weights (Modified MIT) | Claimed (API); self-host eliminates |
| **Mistral** | 30 days | Yes (Scale plan, on request) | Stateful features excluded from ZDR | Yes (API by default) |

When data conflicts across sources, prefer the provider's official documentation. Note the source of each policy value.

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
| Intelligence Index | {score} (#N / total) | Artificial Analysis |
| Output Speed | {tokens/s} | Artificial Analysis |
| Latency (TTFT) | {seconds}s | Artificial Analysis |
| Input Price | $X.XX / 1M tokens | Artificial Analysis |
| Output Price | $X.XX / 1M tokens | Artificial Analysis |
| Context Window | {tokens} | Artificial Analysis / LayerLens |
| Reasoning | Yes / No | Artificial Analysis |
| Total Eval Cost (AA Intelligence Index) | ${cost} | Artificial Analysis |
| Total Output Tokens (Index) | {tokens} | Artificial Analysis |
| Retention (default) | {days} | Provider docs / gateway |
| Retention (ZDR) | Available / Not available / Default | Provider docs / gateway |
| Retention (other tiers) | {list of policies} | Provider docs / gateway |
| No Training | Yes / No / Claimed | Provider docs / gateway |

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
| **Reasoning** | HLE (Humanity's Last Exam) | AIME 2025/2026, MATH-500, Big Bench Hard | Frontier math, logic, multi-step reasoning |
| **Coding** | SWE-bench Verified | SWE-bench Lite, SWE-bench Pro, Terminal-Bench 2.1 | Real-world software engineering, agentic coding |
| **Knowledge** | MMLU Pro | AGIEval English, General Purpose QA | Graduate-level academic knowledge, fact recall |
| **Agent** | τ-Bench (Tau-Bench) | Terminal-Bench 2.1, GDPval-AA v2 (Elo) | Tool use, multi-turn agentic tasks, real-world workflows |
| **RAG** | BrowseComp | General Purpose QA, AGIEval English, MMLU Pro | Web browsing, information retrieval, evidence synthesis |

### Supplement Rule

If any model lacks data for the primary benchmark in a category, add 2-3 supplementary benchmarks from that category's supplement list. Present the primary first, then supplements below.

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

### Overall Comparison Table

When comparing multiple models end-to-end, include this summary table covering specs, pricing, retention, and training policy:

```
| Metric | Model A | Model B | Model C |
|--------|---------|---------|---------|
| Provider | {name} | {name} | {name} |
| License | {type} | {type} | {type} |
| Context | {tokens} | {tokens} | {tokens} |
| Reasoning | Yes / No | Yes / No | Yes / No |
| Speed | {tok/s} | {tok/s} | {tok/s} |
| Input Price | $X/M | $X/M | $X/M |
| Output Price | $X/M | $X/M | $X/M |
| Total Output Tokens | {tokens} | {tokens} | {tokens} |
| Retention (default) | {days} | {days} | {days} |
| Retention (ZDR) | Available / Default / — | Available / Default / — | Available / Default / — |
| Retention (other) | {list} | {list} | {list} |
| No Training | Yes / No / Claimed | Yes / No / Claimed | Yes / No / Claimed |
```

Add a **Retention & Privacy Verdict** row to the overall winner table highlighting which model has the most favorable privacy posture.

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

### Handling Missing Data

- Mark missing data as `—` in tables.
- Add footnotes explaining the gap (e.g., "\* no published score; using predecessor model score as proxy", "† different eval harness — not directly comparable").
- When using a predecessor's score as a proxy, note this clearly.
- Batch additional web searches to fill gaps before presenting.
- For Retention and No Training data, if provider docs are unclear, note the uncertainty and source (e.g., "\* inferred from gateway listing; verify with provider").

## Step 5 — Create Bubble Chart (Speed vs SWE Capability)

Generate a bubble chart comparing models by speed and SWE capability, with bubble size representing cost efficiency.

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
- **Bubble scaling**: `sizes = [cost * 300 for cost in cost_per_task]` (adjust multiplier as needed)
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
