/**
 * `fetchGenerationSamplers` / `parseGenerationSamplers` / `resolveGenerationSampler`.
 *
 * The fixture is a real `GET /api/v1/blocks/generation-samplers` response from
 * civitai.com, captured 2026-11-13 with a block token. Expected values below are
 * literals read off the generator, not values derived from this module.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  GENERATION_SAMPLERS_API_PATH,
  GenerationSamplersError,
  fetchGenerationSamplers,
  parseGenerationSamplers,
  resolveGenerationSampler,
} from '../../src/blocks/index.js';
import type { GenerationSamplerCatalog } from '../../src/blocks/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_TEXT = readFileSync(
  join(HERE, '..', 'fixtures', 'generation-samplers.prod-2026-11-13.json'),
  'utf8',
);
const fixture = (): unknown => JSON.parse(FIXTURE_TEXT);

const SDXL_OPTIONS = [
  'Euler a',
  'Euler',
  'Heun',
  'LMS',
  'DDIM',
  'DPM++ 2M Karras',
  'DPM2',
  'DPM2 a',
].map((v) => ({ value: v, label: v }));

const ORIGIN = 'https://host.example';

function stubFetch(response: Response | Error) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

async function fetchError(response: Response | Error): Promise<GenerationSamplersError> {
  const { impl } = stubFetch(response);
  try {
    await fetchGenerationSamplers({ hostOrigin: ORIGIN, token: 't', fetch: impl });
  } catch (err) {
    expect(err).toBeInstanceOf(GenerationSamplersError);
    return err as GenerationSamplersError;
  }
  throw new Error('fetchGenerationSamplers resolved; expected it to throw');
}

describe('parseGenerationSamplers — contract against the real response', () => {
  it('keeps every family and base model of the real response, unchanged', () => {
    const catalog = parseGenerationSamplers(fixture());
    // Nothing dropped, nothing invented: a valid response round-trips.
    expect(JSON.parse(JSON.stringify(catalog))).toEqual(fixture());
    expect(Object.keys(catalog.ecosystems)).toHaveLength(45);
    expect(Object.keys(catalog.baseModels)).toHaveLength(56);
  });

  it('pins the values the on-site generator shows', () => {
    const { ecosystems, baseModels } = parseGenerationSamplers(fixture());
    expect(ecosystems.SDXL).toEqual({
      sampler: { options: SDXL_OPTIONS, default: 'Euler a' },
      byModelVersion: {},
    });
    expect(ecosystems.Flux1).toEqual({ sampler: null, byModelVersion: {} });
    // Anima's default is not its first option.
    expect(ecosystems.Anima?.sampler?.default).toBe('euler_ancestral');
    expect(ecosystems.Anima?.sampler?.options[0]?.value).toBe('er_sde');
    expect(ecosystems.HiDream).toEqual({
      sampler: null,
      byModelVersion: { '1772448': { options: [{ value: 'UniPC', label: 'UniPC' }], default: 'UniPC' } },
    });
    expect(baseModels['SDXL 1.0']).toBe('SDXL');
    expect(baseModels['Flux.1 D']).toBe('Flux1');
  });

  it('throws invalid-response when the body is not the catalog shape', () => {
    for (const body of [null, [], 'x', { ecosystems: {} }, { baseModels: {} }, { ecosystems: [], baseModels: {} }]) {
      expect(() => parseGenerationSamplers(body)).toThrow(
        expect.objectContaining({ code: 'invalid-response' }),
      );
    }
  });

  it('drops a malformed family so it reads as unknown, never as null', () => {
    const body = {
      ecosystems: {
        Good: { sampler: null, byModelVersion: {} },
        BadOptions: { sampler: { options: [{ value: 1, label: 'x' }], default: 'x' }, byModelVersion: {} },
        NoByVersion: { sampler: null },
        UndefinedSampler: { byModelVersion: {} },
        // One malformed override drops the whole family; otherwise that version
        // would fall through to the family's control.
        BadOverride: {
          sampler: { options: [{ value: 'a', label: 'a' }], default: 'a' },
          byModelVersion: { '5': { options: 'nope', default: 'a' } },
        },
      },
      baseModels: { G: 'Good', B: 'BadOverride', N: 7 },
    };
    const catalog = parseGenerationSamplers(body);
    expect(Object.keys(catalog.ecosystems)).toEqual(['Good']);
    expect(Object.keys(catalog.baseModels)).toEqual(['G', 'B']);
    expect(resolveGenerationSampler(catalog, { baseModel: 'B', modelVersionId: 5 })).toEqual({
      known: false,
      reason: 'family-not-in-catalog',
    });
    expect(resolveGenerationSampler(catalog, { baseModel: 'G' })).toEqual({
      known: true,
      sampler: null,
      ecosystem: 'Good',
      source: 'family',
    });
  });
});

describe('resolveGenerationSampler — precedence', () => {
  const catalog = parseGenerationSamplers(fixture());

  it('uses the per-version override first (HiDream Full)', () => {
    expect(resolveGenerationSampler(catalog, { baseModel: 'HiDream', modelVersionId: 1772448 })).toEqual({
      known: true,
      sampler: { options: [{ value: 'UniPC', label: 'UniPC' }], default: 'UniPC' },
      ecosystem: 'HiDream',
      source: 'modelVersion',
    });
  });

  it('falls back to the family when the version has no override', () => {
    expect(resolveGenerationSampler(catalog, { baseModel: 'HiDream', modelVersionId: 1 })).toEqual({
      known: true,
      sampler: null,
      ecosystem: 'HiDream',
      source: 'family',
    });
    expect(resolveGenerationSampler(catalog, { baseModel: 'SDXL 1.0', modelVersionId: 128078 })).toEqual({
      known: true,
      sampler: { options: SDXL_OPTIONS, default: 'Euler a' },
      ecosystem: 'SDXL',
      source: 'family',
    });
  });

  it('finds an override by version id alone', () => {
    expect(resolveGenerationSampler(catalog, { modelVersionId: 1772448 })).toMatchObject({
      known: true,
      ecosystem: 'HiDream',
      source: 'modelVersion',
      sampler: { default: 'UniPC' },
    });
  });

  const synthetic: GenerationSamplerCatalog = {
    ecosystems: {
      X: {
        sampler: { options: [{ value: 'x', label: 'X' }], default: 'x' },
        byModelVersion: { '7': { options: [{ value: 'x7', label: 'X7' }], default: 'x7' }, '9': null },
      },
      Y: { sampler: { options: [{ value: 'y', label: 'Y' }], default: 'y' }, byModelVersion: {} },
    },
    baseModels: { 'Base X': 'X', 'Base Y': 'Y' },
  };

  it('a null override means no sampler for that version; it does not fall through to the family', () => {
    expect(resolveGenerationSampler(synthetic, { baseModel: 'Base X', modelVersionId: 9 })).toEqual({
      known: true,
      sampler: null,
      ecosystem: 'X',
      source: 'modelVersion',
    });
    expect(resolveGenerationSampler(synthetic, { modelVersionId: 9 })).toEqual({
      known: true,
      sampler: null,
      ecosystem: 'X',
      source: 'modelVersion',
    });
  });

  it("the base model picks the family, so another family's override does not apply", () => {
    expect(resolveGenerationSampler(synthetic, { baseModel: 'Base Y', modelVersionId: 7 })).toEqual({
      known: true,
      sampler: { options: [{ value: 'y', label: 'Y' }], default: 'y' },
      ecosystem: 'Y',
      source: 'family',
    });
  });
});

describe('resolveGenerationSampler — unknown is not null', () => {
  const catalog = parseGenerationSamplers(fixture());

  it('a family with no sampler control is known, with sampler null', () => {
    const r = resolveGenerationSampler(catalog, { baseModel: 'Flux.1 D' });
    expect(r).toEqual({ known: true, sampler: null, ecosystem: 'Flux1', source: 'family' });
  });

  it('a base model the catalog does not map is unknown', () => {
    const r = resolveGenerationSampler(catalog, { baseModel: 'Some Future Model' });
    expect(r).toEqual({ known: false, reason: 'base-model-not-in-catalog' });
    expect('sampler' in r).toBe(false);
  });

  it('a base model whose family is absent is unknown', () => {
    const { Flux1: _dropped, ...rest } = catalog.ecosystems;
    const r = resolveGenerationSampler({ ...catalog, ecosystems: rest }, { baseModel: 'Flux.1 D' });
    expect(r).toEqual({ known: false, reason: 'family-not-in-catalog' });
    expect('sampler' in r).toBe(false);
  });

  it('a version id with no override and no base model is unknown', () => {
    expect(resolveGenerationSampler(catalog, { modelVersionId: 128078 })).toEqual({
      known: false,
      reason: 'base-model-required',
    });
    expect(resolveGenerationSampler(catalog, {})).toEqual({ known: false, reason: 'base-model-required' });
  });

  it('prototype names are ordinary keys', () => {
    // Both a parsed catalog and a plain-object one a caller built (or JSON.parse'd) itself.
    const plain = fixture() as GenerationSamplerCatalog;
    for (const c of [catalog, plain]) {
      for (const baseModel of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
        expect(resolveGenerationSampler(c, { baseModel })).toEqual({
          known: false,
          reason: 'base-model-not-in-catalog',
        });
      }
      expect(resolveGenerationSampler(c, { modelVersionId: 1, baseModel: 'SDXL 1.0' })).toMatchObject({
        known: true,
        source: 'family',
      });
    }
  });

  it('a "__proto__" key in the response survives parsing as a key', () => {
    const body = JSON.parse(
      '{"ecosystems":{"SDXL":{"sampler":null,"byModelVersion":{}}},"baseModels":{"__proto__":"SDXL"}}',
    );
    expect(resolveGenerationSampler(parseGenerationSamplers(body), { baseModel: '__proto__' })).toEqual({
      known: true,
      sampler: null,
      ecosystem: 'SDXL',
      source: 'family',
    });
  });
});

describe('fetchGenerationSamplers', () => {
  it('GETs the route on the host origin with the block token, and parses the catalog', async () => {
    const { impl, calls } = stubFetch(new Response(FIXTURE_TEXT, { status: 200 }));
    const catalog = await fetchGenerationSamplers({ hostOrigin: ORIGIN, token: 'tok', fetch: impl });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://host.example/api/v1/blocks/generation-samplers');
    expect(GENERATION_SAMPLERS_API_PATH).toBe('/api/v1/blocks/generation-samplers');
    expect(calls[0]!.init?.headers).toEqual({ Authorization: 'Bearer tok' });
    expect(catalog.ecosystems.SDXL?.sampler?.default).toBe('Euler a');
  });

  it('a platform without the route (404) throws unsupported-platform, never an empty catalog', async () => {
    // What civitai.com answers for a blocks route it does not have: 404 text/plain "Not Found".
    const err = await fetchError(new Response('Not Found', { status: 404 }));
    expect(err.code).toBe('unsupported-platform');
    expect(err.status).toBe(404);
    expect(err.message).toContain('does not serve the sampler catalog');
  });

  it('401 and 403 are unauthorized', async () => {
    for (const status of [401, 403]) {
      const err = await fetchError(new Response('{"error":"Block token required"}', { status }));
      expect(err.code).toBe('unauthorized');
      expect(err.status).toBe(status);
    }
  });

  it('another non-2xx is http-error', async () => {
    const err = await fetchError(new Response('oops', { status: 502 }));
    expect(err.code).toBe('http-error');
    expect(err.status).toBe(502);
  });

  it('a 2xx that is not JSON, or not the shape, is invalid-response', async () => {
    expect((await fetchError(new Response('<html>', { status: 200 }))).code).toBe('invalid-response');
    expect((await fetchError(new Response('{"items":[]}', { status: 200 }))).code).toBe('invalid-response');
  });

  it('a failed fetch is network-error', async () => {
    const err = await fetchError(new TypeError('fetch failed'));
    expect(err.code).toBe('network-error');
  });

  it('requires a host origin', async () => {
    const { impl } = stubFetch(new Response(FIXTURE_TEXT, { status: 200 }));
    await expect(fetchGenerationSamplers({ hostOrigin: '', token: 't', fetch: impl })).rejects.toThrow(
      'hostOrigin is required',
    );
  });
});
