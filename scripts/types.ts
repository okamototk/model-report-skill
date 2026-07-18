// Shared types for collect-benchmark scripts.

export interface AAEvaluations {
  artificial_analysis_intelligence_index?: number | null;
  artificial_analysis_coding_index?: number | null;
  artificial_analysis_math_index?: number | null;
  mmlu_pro?: number | null;
  gpqa?: number | null;
  hle?: number | null;
  livecodebench?: number | null;
  scicode?: number | null;
  math_500?: number | null;
  aime?: number | null;
  aime_25?: number | null;
  tau2?: number | null;
  tau_banking?: number | null;
  terminalbench_v2_1?: number | null;
  terminalbench_hard?: number | null;
  ifbench?: number | null;
  lcr?: number | null;
  [k: string]: number | null | undefined;
}

export interface AAPricing {
  price_1m_input_tokens?: number | null;
  price_1m_output_tokens?: number | null;
  price_1m_blended_3_to_1?: number | null;
}

/** A single model record from the AA Data API (`data[]`). */
export interface AAModel {
  id: string;
  name: string;
  slug: string;
  model_creator?: { id?: string; name?: string; slug?: string };
  evaluations: AAEvaluations;
  pricing: AAPricing;
  median_output_tokens_per_second?: number | null;
  median_time_to_first_token_seconds?: number | null;
}

/**
 * Extra metrics that only exist in the static model-page HTML `__next_f`
 * payload (not in the free Data API): the Agentic / Omniscience indices,
 * cache-aware blended price, eval cost, params, context, license, region.
 */
export interface AAPageMetrics {
  name: string;
  intelligenceIndex?: number | null;
  codingIndex?: number | null;
  agenticIndex?: number | null;
  omniscience?: number | null;
  cacheHitPrice?: number | null;
  price1mInputTokens?: number | null;
  price1mOutputTokens?: number | null;
  price1mBlended7To2To1?: number | null;
  contextWindowTokens?: number | null;
  licenseName?: string | null;
  intelligenceIndexTimePerTask?: number | null;
  parameters?: number | null;
  inferenceParametersActiveBillions?: number | null;
  isOpenWeights?: boolean | null;
  releaseDate?: string | null;
  medianOutputSpeed?: number | null;
  evalCostTotal?: number | null;
}

/** A per-benchmark evaluation entry from the Stratix `/evaluations` endpoint. */
export interface SXEvaluation {
  dataset_name: string;
  accuracy: number;
  total_prompt_count?: number;
  average_duration?: number; // nanoseconds
  model_id?: string;
  model_name?: string;
}

/** A model record from the Stratix `/models` endpoint. */
export interface SXModel {
  id: string;
  key: string;
  name: string;
  company?: string;
  architecture_type?: string;
  parameters?: number;
  context_length?: number;
  max_tokens?: number;
  modality?: string;
  license?: string;
  open_weights?: boolean;
  cost_per_input_token?: number;
  cost_per_output_token?: number;
  sub_provider?: string;
}

/** Combined result for one model, merging AA (API + page) and SX. */
export interface CombinedMetrics {
  query: string;
  aa?: {
    api?: AAModel;
    page?: AAPageMetrics;
  };
  sx?: {
    model?: SXModel;
    evaluations?: SXEvaluation[];
  };
  notes: string[];
}
