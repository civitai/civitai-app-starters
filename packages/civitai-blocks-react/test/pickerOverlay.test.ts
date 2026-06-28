import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  openPickerOverlay,
  type PickerOverlayHandle,
  type PickerSelection,
} from '../src/testing.js';

/**
 * Coverage for the in-harness picker overlay's catalog wiring — specifically the
 * `dev:live` family-starvation fix: the overlay now passes `baseModelGroup` as
 * the SERVER-SIDE `baseModels` filter and renders the FULL returned page (no
 * client-side `filterCardsByFamily` narrowing that starved the grid to ~2 cards).
 *
 * Driven via the injectable `fetchImpl` seam + the `onReady` test hook so a
 * deterministic selection is made without synthesizing DOM clicks. Pure node —
 * no document is passed, so the overlay loads the catalog + fires onReady while
 * skipping the DOM (the handle stays fully drivable).
 */

const BASE = 'https://civitai.com';

function res(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** N Checkpoint models all in one baseModel family. */
function familyPage(n: number, baseModel = 'SDXL 1.0') {
  const items = Array.from({ length: n }, (_, i) => ({
    id: 1000 + i,
    name: `Model ${i}`,
    type: 'Checkpoint',
    nsfw: false,
    modelVersions: [{ id: 9000 + i, name: 'v1', baseModel, images: [] }],
  }));
  return { items, metadata: { nextCursor: null } };
}

/**
 * N Checkpoint models, each with a first image so the catalog derives a
 * (320px edge) `thumbnailUrl`. `withImage=false` for a given index leaves that
 * model imageless (thumbnailUrl === null) so the placeholder path is exercised.
 */
function familyPageWithImages(n: number, opts: { firstImageless?: boolean } = {}) {
  const items = Array.from({ length: n }, (_, i) => {
    const imageless = opts.firstImageless && i === 0;
    return {
      id: 1000 + i,
      name: `Model ${i}`,
      type: 'Checkpoint',
      nsfw: false,
      modelVersions: [
        {
          id: 9000 + i,
          name: 'v1',
          baseModel: 'SDXL 1.0',
          images: imageless
            ? []
            : [{ url: `https://image.civitai.com/img-${i}.jpeg`, nsfwLevel: 1 }],
        },
      ],
    };
  });
  return { items, metadata: { nextCursor: null } };
}

/** Decode a recorded request URL's query params. */
const params = (url: unknown) => new URL(String(url), BASE).searchParams;

/** The card cells rendered into the live document by the overlay. */
function renderedCells(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-live-picker-overlay] [data-picker-card]'),
  );
}

describe('openPickerOverlay — server-side family filter (no client narrowing)', () => {
  it('renders the FULL returned page for a baseModelGroup (not narrowed to ~2)', async () => {
    const N = 40;
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      // Server already filtered by family — answer with a full family page
      // regardless; the overlay must render ALL of it.
      return res(200, familyPage(N));
    }) as unknown as typeof fetch;

    const handle = await new Promise<PickerOverlayHandle>((resolve) => {
      openPickerOverlay({
        type: 'Checkpoint',
        baseUrl: BASE,
        token: 'TOK',
        fetchImpl,
        baseModelGroup: 'SDXL 1.0',
        onReady: (h) => resolve(h),
        onResolve: () => {},
      });
    });

    // FULL page rendered — NOT a client-narrowed subset.
    expect(handle.cards).toHaveLength(N);
    // The family hint went out as the SERVER-SIDE baseModels filter…
    expect(params(calls[0]).get('baseModels')).toBe('SDXL 1.0');
    // …at a sizeable page limit (50 lazy-loaded cards), not the old 24 default.
    expect(params(calls[0]).get('limit')).toBe('50');
    // …on the authoritative endpoint (token present).
    expect(String(calls[0])).toContain('/api/v1/blocks/models');
    handle.dismiss();
  });

  it('an ecosystem-key group that the server matches as empty falls back to the generic page', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      // Ecosystem KEY 'Flux1' matches no baseModel NAME → empty; the cleared
      // retry returns a generic page so the picker is never blank.
      if (params(url).get('baseModels')) return res(200, { items: [] });
      return res(200, familyPage(12, 'Flux.1 D'));
    }) as unknown as typeof fetch;

    const handle = await new Promise<PickerOverlayHandle>((resolve) => {
      openPickerOverlay({
        type: 'Checkpoint',
        baseUrl: BASE,
        token: 'TOK',
        fetchImpl,
        baseModelGroup: 'Flux1',
        onReady: (h) => resolve(h),
        onResolve: () => {},
      });
    });

    expect(handle.cards).toHaveLength(12); // generic page, not blank
    expect(calls).toHaveLength(2);
    expect(params(calls[0]).get('baseModels')).toBe('Flux1');
    expect(params(calls[1]).get('baseModels')).toBeNull();
    handle.dismiss();
  });

  it('currentVersionId still pre-selects (selectByVersionId resolves that card)', async () => {
    const fetchImpl = vi.fn(async () => res(200, familyPage(20))) as unknown as typeof fetch;

    let selection: PickerSelection | null = null;
    const handle = await new Promise<PickerOverlayHandle>((resolve) => {
      openPickerOverlay({
        type: 'Checkpoint',
        baseUrl: BASE,
        token: 'TOK',
        fetchImpl,
        baseModelGroup: 'SDXL 1.0',
        currentVersionId: 9007,
        onReady: (h) => resolve(h),
        onResolve: (s) => {
          selection = s;
        },
      });
    });

    // The pre-highlighted version is present in the full page and selectable.
    expect(handle.cards.some((c) => c.versionId === 9007)).toBe(true);
    handle.selectByVersionId(9007);
    expect(selection).not.toBeNull();
    expect(selection!.kind).toBe('Checkpoint');
    expect(selection!.selected.versionId).toBe(9007);
  });

  it('no baseModelGroup → no baseModels param, still a full page', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      return res(200, familyPage(30));
    }) as unknown as typeof fetch;

    const handle = await new Promise<PickerOverlayHandle>((resolve) => {
      openPickerOverlay({
        type: 'Checkpoint',
        baseUrl: BASE,
        token: 'TOK',
        fetchImpl,
        onReady: (h) => resolve(h),
        onResolve: () => {},
      });
    });

    expect(handle.cards).toHaveLength(30);
    expect(params(calls[0]).has('baseModels')).toBe(false);
    handle.dismiss();
  });
});

/**
 * DOM-rendering coverage for the `dev:live` picker performance fix: thumbnails
 * are now lazy <img> elements (a CSS background-image cannot lazy-load → all
 * ~100 decoded at once → froze the page), and a no-thumbnail card renders the
 * neutral placeholder <div> (NOT an <img> with an empty src → broken-image icon).
 * These mount into the live happy-dom `document` and query the rendered cells.
 */
describe('openPickerOverlay — lazy <img> thumbnails (perf fix)', () => {
  afterEach(() => {
    document
      .querySelectorAll('[data-live-picker-overlay]')
      .forEach((el) => el.parentNode?.removeChild(el));
  });

  it('renders each thumbnail as a lazy, async <img> whose src is the card thumbnailUrl', async () => {
    const N = 6;
    const fetchImpl = vi.fn(async () =>
      res(200, familyPageWithImages(N)),
    ) as unknown as typeof fetch;

    const handle = await new Promise<PickerOverlayHandle>((resolve) => {
      openPickerOverlay({
        type: 'Checkpoint',
        baseUrl: BASE,
        token: 'TOK',
        fetchImpl,
        baseModelGroup: 'SDXL 1.0',
        document,
        onReady: (h) => resolve(h),
        onResolve: () => {},
      });
    });

    const cells = renderedCells();
    expect(cells).toHaveLength(N);
    expect(handle.cards).toHaveLength(N);

    cells.forEach((cell) => {
      const versionId = Number(cell.getAttribute('data-picker-card'));
      const card = handle.cards.find((c) => c.versionId === versionId)!;
      expect(card.thumbnailUrl).toBeTruthy(); // these all have an image

      const img = cell.querySelector('img');
      expect(img).not.toBeNull();
      // A REAL lazy <img>, not a CSS background-image (which cannot lazy-load).
      expect(img!.loading).toBe('lazy');
      expect(img!.decoding).toBe('async');
      // src is the card's (already-320px edge) thumbnailUrl — not a full original.
      expect(img!.getAttribute('src')).toBe(card.thumbnailUrl);
      // Decorative — the cell carries the aria-label, so the img has none.
      expect(img!.getAttribute('alt')).toBe('');
    });

    handle.dismiss();
  });

  it('renders the placeholder (no <img>, no broken image) for a card without a thumbnailUrl', async () => {
    const fetchImpl = vi.fn(async () =>
      res(200, familyPageWithImages(4, { firstImageless: true })),
    ) as unknown as typeof fetch;

    const handle = await new Promise<PickerOverlayHandle>((resolve) => {
      openPickerOverlay({
        type: 'Checkpoint',
        baseUrl: BASE,
        token: 'TOK',
        fetchImpl,
        baseModelGroup: 'SDXL 1.0',
        document,
        onReady: (h) => resolve(h),
        onResolve: () => {},
      });
    });

    const cells = renderedCells();
    expect(cells).toHaveLength(4);

    // No card ANYWHERE renders an <img> with an empty/missing src (broken image).
    document
      .querySelectorAll<HTMLImageElement>('[data-live-picker-overlay] img')
      .forEach((img) => {
        expect(img.getAttribute('src')).toBeTruthy();
      });

    // The imageless first card (versionId 9000) has no <img> — a placeholder div.
    const imageless = handle.cards.find((c) => c.thumbnailUrl == null)!;
    expect(imageless.versionId).toBe(9000);
    const cell = cells.find(
      (c) => Number(c.getAttribute('data-picker-card')) === imageless.versionId,
    )!;
    expect(cell.querySelector('img')).toBeNull();
    // …but it still has a (placeholder) child tile.
    expect(cell.querySelector('div')).not.toBeNull();

    handle.dismiss();
  });

  it('applies align-content:start + grid-auto-rows:max-content to the grid (no row-collapse)', async () => {
    // The `display:grid` grid is flex-shrunk inside the 86vh flex-column modal
    // (`flex:1 1 auto; min-height:0`). With the DEFAULT align-content it squishes
    // its auto-rows to fit the shrunken track box instead of overflowing — every
    // card collapses to a few px (thumbnails + titles clipped) and all 50 stack
    // into the viewport so every lazy <img> loads at once (lag). `align-content:
    // start` + `grid-auto-rows:max-content` pin rows to content height and let the
    // grid scroll. jsdom/happy-dom don't compute layout, so we can only assert the
    // style is APPLIED — the actual no-collapse layout was verified in a real
    // browser (Chromium, 50 cards: 213px cards, 0 collapsed, grid scrolls).
    const fetchImpl = vi.fn(async () =>
      res(200, familyPageWithImages(6)),
    ) as unknown as typeof fetch;

    await new Promise<PickerOverlayHandle>((resolve) => {
      openPickerOverlay({
        type: 'Checkpoint',
        baseUrl: BASE,
        token: 'TOK',
        fetchImpl,
        baseModelGroup: 'SDXL 1.0',
        document,
        onReady: (h) => resolve(h),
        onResolve: () => {},
      });
    });

    // The grid is the overlay element with display:grid (the card container).
    const grid = Array.from(
      document.querySelectorAll<HTMLElement>('[data-live-picker-overlay] *'),
    ).find((el) => el.style.display === 'grid');
    expect(grid).toBeDefined();
    expect(grid!.style.alignContent).toBe('start');
    expect(grid!.style.gridAutoRows).toBe('max-content');
  });

  it('currentVersionId outlines its rendered card in the DOM', async () => {
    const fetchImpl = vi.fn(async () =>
      res(200, familyPageWithImages(5)),
    ) as unknown as typeof fetch;

    const handle = await new Promise<PickerOverlayHandle>((resolve) => {
      openPickerOverlay({
        type: 'Checkpoint',
        baseUrl: BASE,
        token: 'TOK',
        fetchImpl,
        baseModelGroup: 'SDXL 1.0',
        currentVersionId: 9002,
        document,
        onReady: (h) => resolve(h),
        onResolve: () => {},
      });
    });

    const cells = renderedCells();
    const selected = cells.find(
      (c) => Number(c.getAttribute('data-picker-card')) === 9002,
    )!;
    expect(selected.style.outline).toContain('#5ec8a0');
    // The non-selected cards carry no outline.
    cells
      .filter((c) => Number(c.getAttribute('data-picker-card')) !== 9002)
      .forEach((c) => expect(c.style.outline).toBe(''));

    handle.dismiss();
  });
});
