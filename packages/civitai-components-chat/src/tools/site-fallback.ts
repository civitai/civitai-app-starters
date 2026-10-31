import type { SiteClient } from '@civitai/sdk';

import type { ModelRecommendation } from '../types.js';

const ECOSYSTEMS: Record<string, string> = {
  'SD 1.5': 'sd1',
  'SD 1.4': 'sd1',
  'SDXL 1.0': 'sdxl',
  Pony: 'sdxl',
  Illustrious: 'sdxl',
  NoobAI: 'sdxl',
  'Flux.1 D': 'flux1',
  'Flux.1 S': 'flux1',
  'Flux.1 Krea': 'flux1',
};

const AIR_TYPES: Record<string, string> = {
  Checkpoint: 'checkpoint',
  LORA: 'lora',
  LoCon: 'lora',
  DoRA: 'lora',
  TextualInversion: 'embedding',
};

export function buildAir(baseModel: string | undefined, type: string | undefined, modelId: number, versionId: number): string | undefined {
  const ecosystem = baseModel ? ECOSYSTEMS[baseModel] : undefined;
  const airType = type ? AIR_TYPES[type] : undefined;
  return ecosystem && airType ? `urn:air:${ecosystem}:${airType}:civitai:${modelId}@${versionId}` : undefined;
}

interface SiteModel {
  id: number;
  name: string;
  type?: string;
  creator?: { username?: string };
  tags?: string[];
  modelVersions?: { id: number; name?: string; baseModel?: string; trainedWords?: string[] }[];
}

export const FALLBACK_SEARCH_SCHEMA = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'What to look for, e.g. "anime portrait" or "watercolor landscape"' },
    type: { type: 'string', enum: ['Checkpoint', 'LORA', 'TextualInversion'], description: 'Kind of model' },
    baseModel: { type: 'string', description: 'Base model, e.g. "SDXL 1.0", "Illustrious", "Flux.1 D"' },
    limit: { type: 'integer', minimum: 1, maximum: 20, default: 8 },
  },
  required: ['query'],
  additionalProperties: false,
} as const;

export interface FallbackSearchArgs {
  query: string;
  type?: string;
  baseModel?: string;
  limit?: number;
}

/** The public model search, for when the site MCP cannot be reached from the browser. */
export async function searchModelsViaApi(site: SiteClient, args: FallbackSearchArgs, signal?: AbortSignal): Promise<{ text: string; models: ModelRecommendation[] }> {
  const page = await site.get<{ items?: SiteModel[] }>('models', {
    query: {
      query: args.query,
      types: args.type,
      baseModels: args.baseModel,
      limit: Math.min(Math.max(args.limit ?? 8, 1), 20),
      supportsGeneration: 'true',
    },
    signal,
  });
  const items = page.items ?? [];
  const models: ModelRecommendation[] = items.map((item) => {
    const version = item.modelVersions?.[0];
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      air: version ? buildAir(version.baseModel, item.type, item.id, version.id) : undefined,
    };
  });
  const lines = items.map((item, i) => {
    const version = item.modelVersions?.[0];
    const triggers = version?.trainedWords?.length ? `\n   Triggers: ${version.trainedWords.join(', ')}` : '';
    return `${i + 1}. ${item.name} (ID: ${item.id})\n   Type: ${item.type ?? '?'} | Base: ${version?.baseModel ?? '?'} | Creator: ${item.creator?.username ?? '?'}${triggers}\n   Tags: ${(item.tags ?? []).slice(0, 6).join(', ')}`;
  });
  return { text: items.length ? `Found ${items.length} model(s):\n\n${lines.join('\n\n')}` : 'No models found.', models };
}
