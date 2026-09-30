import type { SiteClient } from '@civitai/sdk';

import { SITE_URL } from '../config.js';

export interface ModelDetails {
  href: string;
  name?: string;
  versions?: { id: number; name: string }[];
  image?: string;
  creator?: string;
  kind?: string;
}

interface SiteModel {
  name?: string;
  type?: string;
  creator?: { username?: string };
  modelVersions?: { id?: number; name?: string; baseModel?: string; images?: { url?: string; nsfwLevel?: number; type?: string }[] }[];
}

const TYPE_WORDS: Record<string, string> = { LORA: 'LoRA', TextualInversion: 'Embedding', Checkpoint: 'Model' };

/** Model search returns names and ids; the card's picture and creator come from the public API. */
export class ModelDirectory {
  #cache = new Map<number, Promise<ModelDetails>>();
  #site: SiteClient;
  #allowMature: () => boolean;

  constructor(site: SiteClient, allowMature: () => boolean) {
    this.#site = site;
    this.#allowMature = allowMature;
  }

  get(id: number): Promise<ModelDetails> {
    let pending = this.#cache.get(id);
    if (!pending) {
      pending = this.#load(id).catch(() => ({ href: `${SITE_URL}/models/${id}` }));
      this.#cache.set(id, pending);
    }
    return pending;
  }

  async #load(id: number): Promise<ModelDetails> {
    const model = await this.#site.get<SiteModel>(`models/${id}`);
    const version = model.modelVersions?.[0];
    const image = version?.images?.find((img) => img.type !== 'video' && (this.#allowMature() || (img.nsfwLevel ?? 1) <= 1))?.url;
    const type = model.type ? (TYPE_WORDS[model.type] ?? model.type) : undefined;
    return {
      href: `${SITE_URL}/models/${id}`,
      name: model.name,
      versions: (model.modelVersions ?? []).flatMap((v) => (typeof v.id === 'number' && v.name ? [{ id: v.id, name: v.name }] : [])),
      image,
      creator: model.creator?.username,
      kind: [type, version?.baseModel].filter(Boolean).join(' · ') || undefined,
    };
  }
}
