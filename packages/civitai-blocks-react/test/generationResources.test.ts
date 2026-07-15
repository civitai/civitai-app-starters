import { describe, expect, it } from 'vitest';

import {
  GENERATION_RESOURCES_API_BASE,
  MAX_GENERATION_RESOURCE_IDS,
  buildGenerationResourcesUrl,
  responseToResources,
} from '../src/api/generationResources.js';

/**
 * Pure unit coverage for the generation-resources REST client (the rehydrate-by-
 * versionId endpoint). URL builder (sanitize / dedupe / ≤30 cap) + the
 * response→BlockResourceInfo mapper (widened projection, tolerant of junk). No
 * network — the React hook layers fetch on top of these.
 */

const BASE = 'https://civitai.com';

describe('buildGenerationResourcesUrl', () => {
  const ids = (url: string) => new URL(url, BASE).searchParams.get('ids');

  it('emits ?ids=csv on the default base', () => {
    const url = buildGenerationResourcesUrl([1, 2, 3]);
    expect(url.startsWith(GENERATION_RESOURCES_API_BASE)).toBe(true);
    expect(ids(url)).toBe('1,2,3');
  });

  it('accepts a custom base', () => {
    const url = buildGenerationResourcesUrl([9], 'https://civitai.com/api/v1/blocks/generation-resources');
    expect(new URL(url).pathname).toBe('/api/v1/blocks/generation-resources');
    expect(ids(url)).toBe('9');
  });

  it('drops non-positive / non-integer / junk ids', () => {
    expect(ids(buildGenerationResourcesUrl([1, 0, -5, 2.5, Number.NaN, 3]))).toBe('1,3');
  });

  it('de-dupes while preserving first-seen order', () => {
    expect(ids(buildGenerationResourcesUrl([5, 5, 2, 5, 2, 8]))).toBe('5,2,8');
  });

  it(`caps at MAX_GENERATION_RESOURCE_IDS (${MAX_GENERATION_RESOURCE_IDS})`, () => {
    const many = Array.from({ length: 50 }, (_, i) => i + 1);
    const got = ids(buildGenerationResourcesUrl(many))!.split(',');
    expect(got).toHaveLength(MAX_GENERATION_RESOURCE_IDS);
    expect(got[0]).toBe('1');
    expect(got[MAX_GENERATION_RESOURCE_IDS - 1]).toBe(String(MAX_GENERATION_RESOURCE_IDS));
  });

  it('caps AFTER de-duping (30 unique, not 30 raw)', () => {
    const withDupes = [1, ...Array.from({ length: 40 }, (_, i) => i + 2), 1, 2, 3];
    const got = ids(buildGenerationResourcesUrl(withDupes))!.split(',');
    expect(got).toHaveLength(MAX_GENERATION_RESOURCE_IDS);
    expect(new Set(got).size).toBe(MAX_GENERATION_RESOURCE_IDS); // all unique
  });

  it('empty id list → ids= (empty), never throws', () => {
    expect(ids(buildGenerationResourcesUrl([]))).toBe('');
  });
});

describe('responseToResources', () => {
  const RAW = {
    items: [
      {
        versionId: 9001,
        modelId: 100,
        modelName: 'Awesome XL',
        versionName: 'v2.0',
        baseModel: 'SDXL 1.0',
        modelType: 'Checkpoint',
        strength: 1,
        minStrength: -1,
        maxStrength: 2,
        trainedWords: ['awesome'],
        clipSkip: 2,
      },
      {
        versionId: 9002,
        modelId: 200,
        modelName: 'Flux LoRA',
        versionName: 'v1',
        baseModel: 'Flux.1 D',
        modelType: 'LORA',
        strength: 0.8,
        minStrength: 0,
        maxStrength: 1.5,
        trainedWords: [],
        clipSkip: null,
      },
    ],
    maturity: { browsingLevel: 3, sfwOnly: true },
  };

  it('maps items to the WIDENED BlockResourceInfo projection', () => {
    const out = responseToResources(RAW);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      versionId: 9001,
      modelId: 100,
      modelName: 'Awesome XL',
      versionName: 'v2.0',
      baseModel: 'SDXL 1.0',
      modelType: 'Checkpoint',
      strength: 1,
      minStrength: -1,
      maxStrength: 2,
      trainedWords: ['awesome'],
      clipSkip: 2,
    });
    // clipSkip:null is carried through (a resource legitimately has none).
    expect(out[1]!.clipSkip).toBeNull();
    expect(out[1]!.trainedWords).toEqual([]);
  });

  it('skips rows without a usable versionId', () => {
    const out = responseToResources({
      items: [
        { modelId: 1, modelName: 'no version id' },
        { versionId: 'x' as unknown as number, modelId: 2 },
        { versionId: 42, modelId: 3, modelName: 'ok' },
      ],
    });
    expect(out.map((r) => r.versionId)).toEqual([42]);
  });

  it('omits absent optional fields rather than defaulting them', () => {
    const out = responseToResources({ items: [{ versionId: 7, modelId: 1 }] });
    expect(out[0]).toEqual({
      versionId: 7,
      modelId: 1,
      modelName: '',
      versionName: '',
      baseModel: '',
      modelType: '',
    });
    expect('strength' in out[0]!).toBe(false);
    expect('clipSkip' in out[0]!).toBe(false);
  });

  it('is total on empty / malformed payloads', () => {
    expect(responseToResources(null)).toEqual([]);
    expect(responseToResources(undefined)).toEqual([]);
    expect(responseToResources({})).toEqual([]);
    expect(responseToResources({ items: 'nope' as unknown as [] })).toEqual([]);
    expect(responseToResources({ items: [null, undefined, {}] as never })).toEqual([]);
  });
});
