import { describe, expect, it, vi } from 'vitest';

import {
  buildCatalogUrl,
  fetchCatalog,
  modelToCard,
  responseToPage,
  edgeThumb,
  cardToCheckpoint,
  cardToResource,
  filterCardsByFamily,
  CATALOG_API_BASE,
  CATALOG_API_BASE_BLOCKS,
  DEFAULT_LIMIT,
  type CatalogCard,
} from '../src/testing.js';

/**
 * Unit coverage for the SDK-internal catalog client backing the live host's
 * in-harness picker overlay. All pure (URL/param builders + response→option
 * mappers) and the injectable-fetch client (success / empty / non-OK / throw /
 * fallback). No real network.
 */

const BASE = 'https://civitai.com';

/** Build a fetch Response-like (the shape the live host's fetchImpl returns). */
function res(status: number, body: unknown, opts?: { throwJson?: boolean }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (opts?.throwJson) throw new Error('bad JSON');
      return body;
    },
  } as unknown as Response;
}

const RAW_PAGE = {
  items: [
    {
      id: 100,
      name: 'Awesome XL',
      type: 'Checkpoint',
      nsfw: false,
      modelVersions: [
        {
          id: 9001,
          name: 'v2.0',
          baseModel: 'SDXL 1.0',
          images: [{ url: 'https://image.civitai.com/abc/original=true/thing.jpeg' }],
        },
      ],
    },
    {
      id: 200,
      name: 'Flux Thing',
      type: 'Checkpoint',
      nsfw: false,
      modelVersions: [{ id: 9002, name: 'v1', baseModel: 'Flux.1 D', images: [] }],
    },
  ],
  metadata: { nextCursor: 'CURSOR2' },
};

describe('buildCatalogUrl', () => {
  it('sets the types filter from the query (Checkpoint / LORA)', () => {
    expect(buildCatalogUrl({ types: 'Checkpoint' })).toContain('types=Checkpoint');
    expect(buildCatalogUrl({ types: 'LORA' })).toContain('types=LORA');
  });

  it('omits an empty/whitespace query, includes a real one (encoded)', () => {
    expect(buildCatalogUrl({ types: 'Checkpoint', query: '   ' })).not.toContain('query=');
    expect(buildCatalogUrl({ types: 'Checkpoint', query: 'anime girl' })).toContain(
      'query=anime+girl',
    );
  });

  it('clamps limit to [1,100] and defaults sanely', () => {
    expect(buildCatalogUrl({ types: 'Checkpoint' })).toContain(`limit=${DEFAULT_LIMIT}`);
    expect(buildCatalogUrl({ types: 'Checkpoint', limit: 0 })).toContain('limit=1');
    expect(buildCatalogUrl({ types: 'Checkpoint', limit: 9999 })).toContain('limit=100');
    expect(buildCatalogUrl({ types: 'Checkpoint', limit: Number.NaN })).toContain(
      `limit=${DEFAULT_LIMIT}`,
    );
  });

  it('uses the public base by default and the blocks base when requested', () => {
    expect(buildCatalogUrl({ types: 'Checkpoint' }).startsWith(CATALOG_API_BASE)).toBe(true);
    expect(
      buildCatalogUrl({ types: 'LORA' }, { base: CATALOG_API_BASE_BLOCKS }).startsWith(
        CATALOG_API_BASE_BLOCKS,
      ),
    ).toBe(true);
  });

  it('appends nsfw=false only when sfwOnly is set', () => {
    expect(buildCatalogUrl({ types: 'Checkpoint' }, { sfwOnly: true })).toContain('nsfw=false');
    expect(buildCatalogUrl({ types: 'Checkpoint' }, { sfwOnly: false })).not.toContain('nsfw=');
  });

  it('passes the cursor through', () => {
    expect(buildCatalogUrl({ types: 'Checkpoint', cursor: 'XYZ' })).toContain('cursor=XYZ');
  });

  it('emits baseModels (server-side family filter) when set, on BOTH bases', () => {
    const pub = new URL(buildCatalogUrl({ types: 'Checkpoint', baseModels: 'SDXL 1.0' }), BASE);
    expect(pub.searchParams.get('baseModels')).toBe('SDXL 1.0');
    const blocks = new URL(
      buildCatalogUrl({ types: 'Checkpoint', baseModels: 'Flux.1 D' }, { base: CATALOG_API_BASE_BLOCKS }),
      BASE,
    );
    expect(blocks.pathname).toBe('/api/v1/blocks/models');
    expect(blocks.searchParams.get('baseModels')).toBe('Flux.1 D');
  });

  it('omits baseModels when absent / empty / whitespace (and trims)', () => {
    expect(buildCatalogUrl({ types: 'Checkpoint' })).not.toContain('baseModels=');
    expect(buildCatalogUrl({ types: 'Checkpoint', baseModels: '' })).not.toContain('baseModels=');
    expect(buildCatalogUrl({ types: 'Checkpoint', baseModels: '   ' })).not.toContain('baseModels=');
    const trimmed = new URL(buildCatalogUrl({ types: 'Checkpoint', baseModels: '  SDXL 1.0  ' }), BASE);
    expect(trimmed.searchParams.get('baseModels')).toBe('SDXL 1.0');
  });
});

describe('edgeThumb', () => {
  it('rewrites original=true → width transform', () => {
    expect(edgeThumb('https://image.civitai.com/a/original=true/b.jpeg', 320)).toContain(
      '/width=320,optimized=true/',
    );
  });
  it('rewrites an existing width segment', () => {
    expect(edgeThumb('https://image.civitai.com/a/width=99/b.jpeg', 320)).toContain('width=320');
  });
  it('is total on garbage input', () => {
    expect(edgeThumb('')).toBe('');
    expect(edgeThumb('not-a-url')).toBe('not-a-url');
  });
});

describe('modelToCard / responseToPage', () => {
  it('maps a good model to a card using its first version + first image', () => {
    const card = modelToCard(RAW_PAGE.items[0]);
    expect(card).toMatchObject({
      modelId: 100,
      versionId: 9001,
      modelName: 'Awesome XL',
      versionName: 'v2.0',
      baseModel: 'SDXL 1.0',
      modelType: 'Checkpoint',
      nsfw: false,
    });
    expect(card!.thumbnailUrl).toContain('width=');
  });

  it('returns null for a row with no version id (never throws)', () => {
    expect(modelToCard({ id: 1, name: 'x', modelVersions: [] })).toBeNull();
    expect(modelToCard(null)).toBeNull();
    expect(modelToCard(undefined)).toBeNull();
    expect(modelToCard({} as never)).toBeNull();
  });

  it('synthesizes a name when missing + tolerates missing image', () => {
    const card = modelToCard({ id: 5, modelVersions: [{ id: 77 }] });
    expect(card!.modelName).toContain('Model #5');
    expect(card!.thumbnailUrl).toBeNull();
    // No media at all → neutral placeholder, NOT a video tile.
    expect(card!.isVideoOnly).toBe(false);
  });

  it('an image-only version → isVideoOnly:false', () => {
    const card = modelToCard({
      id: 6,
      name: 'Image Only',
      type: 'Checkpoint',
      modelVersions: [
        {
          id: 600,
          name: 'v1',
          baseModel: 'SDXL 1.0',
          images: [{ type: 'image', url: 'https://image.civitai.com/a/original=true/pic.jpeg' }],
        },
      ],
    });
    expect(card!.thumbnailUrl).toBe(
      edgeThumb('https://image.civitai.com/a/original=true/pic.jpeg'),
    );
    expect(card!.isVideoOnly).toBe(false);
  });

  it('skips a video cover (type:video) and selects the first IMAGE media', () => {
    const card = modelToCard({
      id: 7,
      name: 'Has Video Cover',
      type: 'Checkpoint',
      modelVersions: [
        {
          id: 700,
          name: 'v1',
          baseModel: 'SDXL 1.0',
          images: [
            { type: 'video', url: 'https://image.civitai.com/a/original=true/clip.mp4' },
            { type: 'image', url: 'https://image.civitai.com/a/original=true/still.jpeg' },
          ],
        },
      ],
    });
    expect(card!.thumbnailUrl).toBe(
      edgeThumb('https://image.civitai.com/a/original=true/still.jpeg'),
    );
    // The video url must NOT have leaked into the thumbnail.
    expect(card!.thumbnailUrl).not.toContain('.mp4');
    // A usable image alternate WAS found → not a video-only card.
    expect(card!.isVideoOnly).toBe(false);
  });

  it('a version whose ONLY media is a video → thumbnailUrl is null (placeholder)', () => {
    const card = modelToCard({
      id: 8,
      name: 'Video Only',
      type: 'Checkpoint',
      modelVersions: [
        {
          id: 800,
          name: 'v1',
          baseModel: 'SDXL 1.0',
          images: [{ type: 'video', url: 'https://image.civitai.com/a/original=true/only.mp4' }],
        },
      ],
    });
    expect(card!.versionId).toBe(800);
    expect(card!.thumbnailUrl).toBeNull();
    // No image alternate but the version HAD a video → labeled video tile.
    expect(card!.isVideoOnly).toBe(true);
  });

  it('treats a .mp4 url as video even when type is ABSENT (belt-and-suspenders)', () => {
    const card = modelToCard({
      id: 9,
      name: 'Typeless Video',
      type: 'Checkpoint',
      modelVersions: [
        {
          id: 900,
          name: 'v1',
          baseModel: 'SDXL 1.0',
          images: [
            { url: 'https://image.civitai.com/a/original=true/notype.mp4' },
            { url: 'https://image.civitai.com/a/original=true/good.jpeg' },
          ],
        },
      ],
    });
    expect(card!.thumbnailUrl).toBe(
      edgeThumb('https://image.civitai.com/a/original=true/good.jpeg'),
    );
    expect(card!.thumbnailUrl).not.toContain('.mp4');
  });

  it('responseToPage maps items + nextCursor, skipping unusable rows', () => {
    const page = responseToPage(RAW_PAGE);
    expect(page.cards.map((c) => c.versionId)).toEqual([9001, 9002]);
    expect(page.nextCursor).toBe('CURSOR2');
  });

  it('responseToPage is total on empty/malformed payloads', () => {
    expect(responseToPage(null)).toEqual({ cards: [], nextCursor: null });
    expect(responseToPage({})).toEqual({ cards: [], nextCursor: null });
    expect(responseToPage({ items: 'nope' } as never)).toEqual({ cards: [], nextCursor: null });
    expect(responseToPage({ items: [null, undefined, {}] as never })).toEqual({
      cards: [],
      nextCursor: null,
    });
  });
});

describe('cardToCheckpoint / cardToResource', () => {
  const card: CatalogCard = {
    modelId: 100,
    versionId: 9001,
    modelName: 'Awesome XL',
    versionName: 'v2.0',
    baseModel: 'SDXL 1.0',
    modelType: 'Checkpoint',
    thumbnailUrl: null,
    isVideoOnly: false,
    nsfw: false,
  };

  it('cardToCheckpoint matches the BlockCheckpointInfo shape (no extra fields)', () => {
    expect(cardToCheckpoint(card)).toEqual({
      versionId: 9001,
      modelId: 100,
      modelName: 'Awesome XL',
      versionName: 'v2.0',
      baseModel: 'SDXL 1.0',
    });
  });

  it('cardToResource matches BlockResourceInfo, preferring the REST type', () => {
    expect(cardToResource(card, 'LORA')).toEqual({
      versionId: 9001,
      modelId: 100,
      modelName: 'Awesome XL',
      versionName: 'v2.0',
      baseModel: 'SDXL 1.0',
      modelType: 'Checkpoint', // card.modelType wins over the requested type
    });
  });

  it('cardToResource falls back to the requested type when the card has none', () => {
    expect(cardToResource({ ...card, modelType: '' }, 'LORA').modelType).toBe('LORA');
  });
});

describe('filterCardsByFamily', () => {
  const cards = responseToPage(RAW_PAGE).cards;

  it('returns all cards when no group hint is given', () => {
    expect(filterCardsByFamily(cards, undefined)).toHaveLength(2);
    expect(filterCardsByFamily(cards, '  ')).toHaveLength(2);
  });

  it('narrows to the matching family (loose token match)', () => {
    const sdxl = filterCardsByFamily(cards, 'SDXL');
    expect(sdxl.map((c) => c.versionId)).toEqual([9001]);
    const flux = filterCardsByFamily(cards, 'Flux1');
    expect(flux.map((c) => c.versionId)).toEqual([9002]);
  });

  it('falls back to the full set when the hint matches nothing (never empties the grid)', () => {
    expect(filterCardsByFamily(cards, 'Pony6')).toHaveLength(2);
  });
});

describe('fetchCatalog — fetch client', () => {
  it('no token → PUBLIC endpoint with advisory SFW, returns ok page', async () => {
    const fetchImpl = vi.fn(async () => res(200, RAW_PAGE)) as unknown as typeof fetch;
    const r = await fetchCatalog({ types: 'Checkpoint' }, { fetch: fetchImpl, baseUrl: BASE });
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.authoritative).toBe(false);
      expect(r.page.cards).toHaveLength(2);
    }
    const url = String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain('/api/v1/models');
    expect(url).toContain('nsfw=false');
  });

  it('with token → AUTHORITATIVE /blocks/models with Bearer, no nsfw param', async () => {
    const fetchImpl = vi.fn(async () => res(200, RAW_PAGE)) as unknown as typeof fetch;
    const r = await fetchCatalog(
      { types: 'LORA' },
      { fetch: fetchImpl, baseUrl: BASE, token: 'TOK' },
    );
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.authoritative).toBe(true);
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(call[0])).toContain('/api/v1/blocks/models');
    expect(String(call[0])).not.toContain('nsfw=');
    expect((call[1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer TOK' });
  });

  it('empty items → kind:empty', async () => {
    const fetchImpl = vi.fn(async () => res(200, { items: [] })) as unknown as typeof fetch;
    const r = await fetchCatalog({ types: 'Checkpoint' }, { fetch: fetchImpl, baseUrl: BASE });
    expect(r.kind).toBe('empty');
  });

  it('non-OK on the PUBLIC path is a hard error (no fallback loop)', async () => {
    const fetchImpl = vi.fn(async () => res(500, null)) as unknown as typeof fetch;
    const r = await fetchCatalog({ types: 'Checkpoint' }, { fetch: fetchImpl, baseUrl: BASE });
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.status).toBe(500);
  });

  it('a thrown fetch on the PUBLIC path → kind:error (never throws)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('CORS blocked');
    }) as unknown as typeof fetch;
    const r = await fetchCatalog({ types: 'Checkpoint' }, { fetch: fetchImpl, baseUrl: BASE });
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.message).toMatch(/CORS blocked/);
  });

  it('malformed JSON (json() throws) → kind:error', async () => {
    const fetchImpl = vi.fn(async () =>
      res(200, null, { throwJson: true }),
    ) as unknown as typeof fetch;
    const r = await fetchCatalog({ types: 'Checkpoint' }, { fetch: fetchImpl, baseUrl: BASE });
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.message).toMatch(/bad JSON/);
  });

  it('AUTHORITATIVE 404 → falls back to PUBLIC (advisory SFW), fires onFallback', async () => {
    const calls: string[] = [];
    const onFallback = vi.fn();
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('/blocks/models')) return res(404, null);
      return res(200, RAW_PAGE);
    }) as unknown as typeof fetch;
    const r = await fetchCatalog(
      { types: 'Checkpoint' },
      { fetch: fetchImpl, baseUrl: BASE, token: 'TOK', onFallback },
    );
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.authoritative).toBe(false); // served by public
    expect(onFallback).toHaveBeenCalledWith({ status: 404 });
    expect(calls[0]).toContain('/blocks/models');
    expect(calls[1]).toContain('/api/v1/models');
    expect(calls[1]).toContain('nsfw=false'); // fallback is fail-closed SFW
  });

  it('AUTHORITATIVE network throw → falls back to PUBLIC, fires onFallback{network}', async () => {
    const onFallback = vi.fn();
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/blocks/models')) throw new TypeError('reset');
      return res(200, RAW_PAGE);
    }) as unknown as typeof fetch;
    const r = await fetchCatalog(
      { types: 'Checkpoint' },
      { fetch: fetchImpl, baseUrl: BASE, token: 'TOK', onFallback },
    );
    expect(r.kind).toBe('ok');
    expect(onFallback).toHaveBeenCalledWith({ reason: 'network' });
  });

  it('AUTHORITATIVE 500 (non-fallback status) is surfaced, NOT fallen back', async () => {
    const fetchImpl = vi.fn(async () => res(500, null)) as unknown as typeof fetch;
    const r = await fetchCatalog(
      { types: 'Checkpoint' },
      { fetch: fetchImpl, baseUrl: BASE, token: 'TOK' },
    );
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.status).toBe(500);
    // Only one call — a 500 is NOT a deploy-order fallback status.
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

describe('fetchCatalog — server-side family filter + empty-family retry', () => {
  /** Decode a recorded request URL's query params (assert via params, not substring). */
  const params = (url: unknown) => new URL(String(url), BASE).searchParams;

  it('threads baseModels onto the AUTHORITATIVE request (full family page, no narrowing)', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      return res(200, RAW_PAGE);
    }) as unknown as typeof fetch;
    const r = await fetchCatalog(
      { types: 'Checkpoint', baseModels: 'SDXL 1.0' },
      { fetch: fetchImpl, baseUrl: BASE, token: 'TOK' },
    );
    expect(r.kind).toBe('ok');
    // BOTH raw cards returned — no client-side narrowing to the matching family.
    if (r.kind === 'ok') expect(r.page.cards.map((c) => c.versionId)).toEqual([9001, 9002]);
    expect(calls).toHaveLength(1); // non-empty → no retry
    expect(params(calls[0]).get('baseModels')).toBe('SDXL 1.0');
    expect(String(calls[0])).toContain('/api/v1/blocks/models');
  });

  it('threads baseModels onto the PUBLIC request (no token)', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      return res(200, RAW_PAGE);
    }) as unknown as typeof fetch;
    const r = await fetchCatalog(
      { types: 'Checkpoint', baseModels: 'Illustrious' },
      { fetch: fetchImpl, baseUrl: BASE },
    );
    expect(r.kind).toBe('ok');
    expect(calls).toHaveLength(1);
    expect(params(calls[0]).get('baseModels')).toBe('Illustrious');
    expect(String(calls[0])).toContain('/api/v1/models');
  });

  it('AUTHORITATIVE empty family page → retries ONCE without baseModels, returns generic page', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      // First (family-filtered) call empty; the cleared retry returns items.
      if (params(url).get('baseModels')) return res(200, { items: [] });
      return res(200, RAW_PAGE);
    }) as unknown as typeof fetch;
    const r = await fetchCatalog(
      { types: 'Checkpoint', baseModels: 'Flux1' },
      { fetch: fetchImpl, baseUrl: BASE, token: 'TOK' },
    );
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.authoritative).toBe(true); // retry stays on the authoritative path
      expect(r.page.cards).toHaveLength(2);
    }
    expect(calls).toHaveLength(2);
    expect(params(calls[0]).get('baseModels')).toBe('Flux1'); // first: filtered
    expect(params(calls[1]).get('baseModels')).toBeNull(); // retry: cleared
    expect(String(calls[1])).toContain('/api/v1/blocks/models');
  });

  it('PUBLIC empty family page → retries ONCE without baseModels (no token)', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      if (params(url).get('baseModels')) return res(200, { items: [] });
      return res(200, RAW_PAGE);
    }) as unknown as typeof fetch;
    const r = await fetchCatalog(
      { types: 'Checkpoint', baseModels: 'SDXL' },
      { fetch: fetchImpl, baseUrl: BASE },
    );
    expect(r.kind).toBe('ok');
    expect(calls).toHaveLength(2);
    expect(params(calls[0]).get('baseModels')).toBe('SDXL');
    expect(params(calls[1]).get('baseModels')).toBeNull();
    expect(String(calls[1])).toContain('/api/v1/models');
  });

  it('empty family AND empty without it → stays empty, retries exactly once (no loop)', async () => {
    const fetchImpl = vi.fn(async () => res(200, { items: [] })) as unknown as typeof fetch;
    const r = await fetchCatalog(
      { types: 'Checkpoint', baseModels: 'Nonexistent' },
      { fetch: fetchImpl, baseUrl: BASE, token: 'TOK' },
    );
    expect(r.kind).toBe('empty');
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it('no family filter + empty → does NOT retry (single call)', async () => {
    const fetchImpl = vi.fn(async () => res(200, { items: [] })) as unknown as typeof fetch;
    const r = await fetchCatalog(
      { types: 'Checkpoint' },
      { fetch: fetchImpl, baseUrl: BASE, token: 'TOK' },
    );
    expect(r.kind).toBe('empty');
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('AUTHORITATIVE 404 with family → falls back to PUBLIC, which retries the empty family itself', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      if (String(url).includes('/blocks/models')) return res(404, null);
      // Public: family-filtered empty, then cleared returns items.
      if (params(url).get('baseModels')) return res(200, { items: [] });
      return res(200, RAW_PAGE);
    }) as unknown as typeof fetch;
    const r = await fetchCatalog(
      { types: 'Checkpoint', baseModels: 'Flux1' },
      { fetch: fetchImpl, baseUrl: BASE, token: 'TOK' },
    );
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.authoritative).toBe(false); // served by public
    // auth(404) → public(family, empty) → public(cleared, ok) = 3 calls, one retry on public.
    expect(calls).toHaveLength(3);
    expect(String(calls[0])).toContain('/blocks/models');
    expect(params(calls[1]).get('baseModels')).toBe('Flux1');
    expect(params(calls[2]).get('baseModels')).toBeNull();
  });
});
