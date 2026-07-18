#!/usr/bin/env -S npx tsx
// CLI: fetch AA + Stratix metrics for one or more model-name queries.
//
// Usage:
//   npx tsx fetch-metrics.ts "MiniMax M3" "DeepSeek V4 Flash"
//   npx tsx fetch-metrics.ts --aa-only "Nemotron 3 Ultra"
//   npx tsx fetch-metrics.ts --sx-only "MiMo-V2.5"
//   npx tsx fetch-metrics.ts --list "nemotron"   # show all matching candidates
//
// Env: AA_API_KEY (required for AA), LAYERLENS_STRATIX_API_KEY (optional for SX).
// Output: JSON (one CombinedMetrics object per query) to stdout.

import { fetchAAModels, findAAModels, fetchAAPageHtml, parsePageMetrics } from "./aa.ts";
import { fetchSXModels, findSXModels, fetchSXEvaluations } from "./stratix.ts";
import type { CombinedMetrics } from "./types.ts";

interface Args {
  queries: string[];
  aaOnly: boolean;
  sxOnly: boolean;
  list: boolean;
  aaKey?: string;
  sxKey?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { queries: [], aaOnly: false, sxOnly: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--aa-only") args.aaOnly = true;
    else if (a === "--sx-only") args.sxOnly = true;
    else if (a === "--list") args.list = true;
    else if (a === "--aa-key") args.aaKey = argv[++i];
    else if (a === "--sx-key") args.sxKey = argv[++i];
    else args.queries.push(a);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.queries.length === 0) {
    console.error(
      'Usage: fetch-metrics.ts [--aa-only|--sx-only] [--list] "Model Name" [...]',
    );
    process.exit(1);
  }

  // Fetch catalogs once, reuse across all queries.
  const aaModels = args.sxOnly ? [] : await fetchAAModels(args.aaKey).catch((e) => {
    console.error(`[AA] ${e.message}`);
    return [];
  });
  const sxModels = args.aaOnly ? [] : await fetchSXModels(args.sxKey).catch((e) => {
    console.error(`[SX] ${e.message}`);
    return [];
  });

  // Fetch one AA page HTML (contains ALL models' page metrics) once, lazily.
  let pageHtml: string | undefined;
  const results: CombinedMetrics[] = [];

  for (const query of args.queries) {
    const notes: string[] = [];
    const combined: CombinedMetrics = { query, notes };

    if (!args.sxOnly) {
      const aaCands = findAAModels(aaModels, query);
      if (args.list && aaCands.length) {
        notes.push(
          `AA candidates: ${aaCands.map((m) => `${m.name} [${m.slug}]`).join(" | ")}`,
        );
      }
      const aaApi = aaCands[0];
      if (aaApi) {
        if (!pageHtml && aaModels.length) {
          pageHtml = await fetchAAPageHtml(aaApi.slug).catch((e) => {
            notes.push(`AA page fetch failed: ${e.message}`);
            return undefined;
          });
        }
        const page = pageHtml ? parsePageMetrics(pageHtml, aaApi.name) : undefined;
        combined.aa = { api: aaApi, page };
      } else {
        notes.push(`No AA match for "${query}"`);
      }
    }

    if (!args.aaOnly) {
      const sxCands = findSXModels(sxModels, query);
      if (args.list && sxCands.length) {
        notes.push(
          `SX candidates: ${sxCands.map((m) => `${m.name} [${m.key}]`).join(" | ")}`,
        );
      }
      const sxModel = sxCands[0];
      if (sxModel) {
        const evaluations = await fetchSXEvaluations(sxModel.id, {
          apiKey: args.sxKey,
        }).catch((e) => {
          notes.push(`SX evaluations failed: ${e.message}`);
          return [];
        });
        combined.sx = { model: sxModel, evaluations };
      } else {
        notes.push(`No SX match for "${query}" (may be unlisted)`);
      }
    }

    results.push(combined);
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
