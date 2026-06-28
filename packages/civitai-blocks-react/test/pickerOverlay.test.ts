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

/**
 * N Checkpoint models whose FIRST card is video-only (its only media is a video
 * → catalog derives `thumbnailUrl: null` + `isVideoOnly: true`), the rest images.
 * Drives the labeled video-tile render path.
 */
function familyPageVideoFirst(n: number) {
  const items = Array.from({ length: n }, (_, i) => {
    const videoOnly = i === 0;
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
          images: videoOnly
            ? [{ type: 'video', url: `https://image.civitai.com/clip-${i}.mp4` }]
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

// Tests that pass NO `document` still render into the shared global `document`
// (the overlay falls back to `globalThis.document`). If such a test fails BEFORE
// it can `dismiss()`, its overlay would leak into the next test's DOM queries —
// so sweep the global document after every test, file-wide.
afterEach(() => {
  document
    .querySelectorAll('[data-live-picker-overlay]')
    .forEach((el) => el.parentNode?.removeChild(el));
});

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

    // FULL first page rendered — NOT a client-narrowed subset. (The mock answers
    // a 40-card page with nextCursor:null, so there's only one page; the overlay
    // renders all of it.)
    expect(handle.cards).toHaveLength(N);
    // The family hint went out as the SERVER-SIDE baseModels filter…
    expect(params(calls[0]).get('baseModels')).toBe('SDXL 1.0');
    // …at the per-PAGE limit (24, infinite-scroll paginates) — not 50/all-at-once.
    expect(params(calls[0]).get('limit')).toBe('24');
    // …and the initial load carries NO cursor (page 1).
    expect(params(calls[0]).has('cursor')).toBe(false);
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

  it('renders each thumbnail as a lazy, async <img> whose URL is wired (data-src until visible)', async () => {
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
      // The (already-320px edge) thumbnailUrl is WIRED to the img — but parked on
      // `data-src` and only promoted to `src` once the card nears the grid's
      // viewport (the IntersectionObserver-gated lazy load; native loading="lazy"
      // doesn't defer inside the inner scroll container). happy-dom never lays out
      // → the IO never fires → src stays empty + the url stays on data-src here.
      // (The no-layout fallback path instead sets src directly, so accept either.)
      expect(img!.dataset.src ?? img!.getAttribute('src')).toBe(card.thumbnailUrl);
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

    // No card ANYWHERE renders a blank/broken <img>: every img has its URL wired
    // (deferred on data-src until visible, or eager on src in the no-layout
    // fallback). An <img> is only created when there IS a thumbnail.
    document
      .querySelectorAll<HTMLImageElement>('[data-live-picker-overlay] img')
      .forEach((img) => {
        expect(img.dataset.src ?? img.getAttribute('src')).toBeTruthy();
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

/**
 * Labeled video-tile coverage: a video-only card (catalog derives
 * `thumbnailUrl: null` + `isVideoOnly: true`) renders a `[data-picker-video-tile]`
 * div containing a play `<svg>` — an intentional video marker, NOT a blank
 * placeholder and NOT an <img>. Image cards still render the lazy <img>; a
 * genuinely-imageless card (no video) still renders the neutral placeholder.
 */
describe('openPickerOverlay — labeled video tile (video-only cards)', () => {
  afterEach(() => {
    document
      .querySelectorAll('[data-live-picker-overlay]')
      .forEach((el) => el.parentNode?.removeChild(el));
  });

  it('renders the video tile (svg, no <img>) for a video-only card and the lazy <img> for image cards', async () => {
    const N = 4;
    const fetchImpl = vi.fn(async () =>
      res(200, familyPageVideoFirst(N)),
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

    // The first card is video-only.
    const videoCard = handle.cards.find((c) => c.isVideoOnly)!;
    expect(videoCard.versionId).toBe(9000);
    expect(videoCard.thumbnailUrl).toBeNull();

    const videoCell = cells.find(
      (c) => Number(c.getAttribute('data-picker-card')) === videoCard.versionId,
    )!;
    const tile = videoCell.querySelector('[data-picker-video-tile]');
    expect(tile).not.toBeNull();
    // It carries a centered inline <svg> play icon, and is NOT an <img>.
    expect(tile!.querySelector('svg')).not.toBeNull();
    expect(videoCell.querySelector('img')).toBeNull();

    // The image cards still render the lazy <img> (regression) + no video tile.
    handle.cards
      .filter((c) => !c.isVideoOnly)
      .forEach((card) => {
        const cell = cells.find(
          (c) => Number(c.getAttribute('data-picker-card')) === card.versionId,
        )!;
        const img = cell.querySelector('img');
        expect(img).not.toBeNull();
        // URL wired via data-src (deferred) or src (no-layout fallback).
        expect(img!.dataset.src ?? img!.getAttribute('src')).toBe(card.thumbnailUrl);
        expect(cell.querySelector('[data-picker-video-tile]')).toBeNull();
      });

    // Every image <img> carries its URL (deferred on data-src, or eager on src) —
    // never a blank/broken image. (No <img> is even created for video/placeholder.)
    document
      .querySelectorAll<HTMLImageElement>('[data-live-picker-overlay] img')
      .forEach((img) => expect(img.dataset.src ?? img.getAttribute('src')).toBeTruthy());

    handle.dismiss();
  });

  it('renders the neutral placeholder (no video tile, no svg) for a card with NO media', async () => {
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
    // The imageless card is NOT video-only → neutral placeholder, no video tile.
    const imageless = handle.cards.find((c) => c.thumbnailUrl == null)!;
    expect(imageless.isVideoOnly).toBe(false);
    const cell = cells.find(
      (c) => Number(c.getAttribute('data-picker-card')) === imageless.versionId,
    )!;
    expect(cell.querySelector('[data-picker-video-tile]')).toBeNull();
    expect(cell.querySelector('svg')).toBeNull();
    expect(cell.querySelector('img')).toBeNull();
    // …but it still has a (placeholder) child tile so the cell doesn't collapse.
    expect(cell.querySelector('div')).not.toBeNull();

    handle.dismiss();
  });
});

/**
 * Infinite-scroll pagination coverage: the overlay loads ONE page (24) initially
 * and appends the next page when the scroll sentinel intersects. happy-dom never
 * fires a real IntersectionObserver (no layout), so we drive the load-more path
 * deterministically via the `loadMore()` test seam on the handle.
 */
describe('openPickerOverlay — infinite-scroll pagination', () => {
  /** A page of `n` checkpoint models numbered from `start`, with the given nextCursor. */
  function page(start: number, n: number, nextCursor: string | null) {
    const items = Array.from({ length: n }, (_, i) => {
      const k = start + i;
      return {
        id: 1000 + k,
        name: `Model ${k}`,
        type: 'Checkpoint',
        nsfw: false,
        modelVersions: [
          {
            id: 9000 + k,
            name: 'v1',
            baseModel: 'SDXL 1.0',
            images: [{ url: `https://image.civitai.com/img-${k}.jpeg`, nsfwLevel: 1 }],
          },
        ],
      };
    });
    return { items, metadata: { nextCursor } };
  }

  it('initial load renders the first page (24), not 50, and carries no cursor', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      return res(200, page(0, 24, 'cursor-2'));
    }) as unknown as typeof fetch;

    const handle = await new Promise<PickerOverlayHandle>((resolve) => {
      openPickerOverlay({
        type: 'Checkpoint',
        baseUrl: BASE,
        token: 'TOK',
        fetchImpl,
        document,
        onReady: (h) => resolve(h),
        onResolve: () => {},
      });
    });

    expect(handle.cards).toHaveLength(24);
    expect(renderedCells()).toHaveLength(24);
    expect(params(calls[0]).get('limit')).toBe('24');
    expect(params(calls[0]).has('cursor')).toBe(false);
    // More to come → not done.
    expect(handle.done).toBe(false);
    handle.dismiss();
  });

  it('loadMore APPENDS the next page without rebuilding the first page cells', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      const cursor = params(url).get('cursor');
      if (cursor === 'cursor-2') return res(200, page(24, 24, null));
      return res(200, page(0, 24, 'cursor-2'));
    }) as unknown as typeof fetch;

    const handle = await new Promise<PickerOverlayHandle>((resolve) => {
      openPickerOverlay({
        type: 'Checkpoint',
        baseUrl: BASE,
        token: 'TOK',
        fetchImpl,
        document,
        onReady: (h) => resolve(h),
        onResolve: () => {},
      });
    });

    // Snapshot the first page's actual DOM nodes BEFORE loading more.
    const firstPageCells = renderedCells();
    expect(firstPageCells).toHaveLength(24);
    const firstNode = firstPageCells[0];

    await handle.loadMore();

    // The grid now has BOTH pages (24 + 24) …
    const after = renderedCells();
    expect(after).toHaveLength(48);
    expect(handle.cards).toHaveLength(48);
    // … and the first page's cells were NOT torn down + rebuilt (same node refs).
    expect(after[0]).toBe(firstNode);
    // The second page fetch carried the cursor from page 1's nextCursor.
    expect(params(calls[1]).get('cursor')).toBe('cursor-2');
    // Page 2 returned nextCursor null → exhausted.
    expect(handle.done).toBe(true);
    handle.dismiss();
  });

  it('when nextCursor is null no further fetch happens (done)', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      // Single, terminal page.
      return res(200, page(0, 10, null));
    }) as unknown as typeof fetch;

    const handle = await new Promise<PickerOverlayHandle>((resolve) => {
      openPickerOverlay({
        type: 'Checkpoint',
        baseUrl: BASE,
        token: 'TOK',
        fetchImpl,
        document,
        onReady: (h) => resolve(h),
        onResolve: () => {},
      });
    });

    expect(handle.done).toBe(true);
    expect(calls).toHaveLength(1);

    // loadMore is a no-op once done — no second fetch.
    await handle.loadMore();
    expect(calls).toHaveLength(1);
    expect(handle.cards).toHaveLength(10);
    handle.dismiss();
  });

  it('a new search RESETS: clears the grid and loads page 1 of the new query (no cursor)', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      const p = params(url);
      if (p.get('query') === 'anime') {
        return res(200, page(100, 5, null)); // different cards for the new query
      }
      if (p.get('cursor') === 'cursor-2') return res(200, page(24, 24, null));
      return res(200, page(0, 24, 'cursor-2'));
    }) as unknown as typeof fetch;

    const handle = await new Promise<PickerOverlayHandle>((resolve) => {
      openPickerOverlay({
        type: 'Checkpoint',
        baseUrl: BASE,
        token: 'TOK',
        fetchImpl,
        document,
        onReady: (h) => resolve(h),
        onResolve: () => {},
      });
    });

    // Load a 2nd page first so there's accumulated state to reset.
    await handle.loadMore();
    expect(handle.cards).toHaveLength(48);

    // Now type a search by driving the search box (mirrors a real keystroke).
    const search = document.querySelector<HTMLInputElement>(
      '[data-live-picker-overlay] input[type="search"]',
    )!;
    search.value = 'anime';
    search.dispatchEvent(new Event('input'));
    // Wait out the 300ms debounce + the fetch.
    await new Promise((r) => setTimeout(r, 360));

    // The new query reset to page 1: only the new query's 5 cards remain.
    expect(handle.cards).toHaveLength(5);
    const cells = renderedCells();
    expect(cells).toHaveLength(5);
    // Old cards (versionId 9000..) are GONE; the new ones (9100..) are present.
    const ids = cells.map((c) => Number(c.getAttribute('data-picker-card')));
    expect(ids.every((id) => id >= 9100)).toBe(true);
    // The search fetch carried the new query + NO cursor (page 1).
    const searchCall = calls.find((u) => params(u).get('query') === 'anime')!;
    expect(searchCall).toBeTruthy();
    expect(params(searchCall).has('cursor')).toBe(false);
    handle.dismiss();
  });

  it('reqId race guard: a late page from a superseded query does not append', async () => {
    // First query's next-page fetch is SLOW; a new search supersedes it. When the
    // slow page finally resolves it must be DROPPED (not appended) — the reqId no
    // longer matches.
    let resolveSlow: ((v: Response) => void) | null = null;
    const fetchImpl = vi.fn(async (url: string) => {
      const p = params(url);
      if (p.get('query') === 'fresh') {
        return res(200, page(200, 3, null));
      }
      if (p.get('cursor') === 'cursor-2') {
        // The slow page-2 of the ORIGINAL query — hold it open.
        return new Promise<Response>((r) => {
          resolveSlow = r;
        });
      }
      return res(200, page(0, 24, 'cursor-2'));
    }) as unknown as typeof fetch;

    const handle = await new Promise<PickerOverlayHandle>((resolve) => {
      openPickerOverlay({
        type: 'Checkpoint',
        baseUrl: BASE,
        token: 'TOK',
        fetchImpl,
        document,
        onReady: (h) => resolve(h),
        onResolve: () => {},
      });
    });

    expect(handle.cards).toHaveLength(24);

    // Kick off the slow page-2 (does not resolve yet).
    const slowLoad = handle.loadMore();

    // Supersede with a new search (resets reqId) — resolves quickly.
    const search = document.querySelector<HTMLInputElement>(
      '[data-live-picker-overlay] input[type="search"]',
    )!;
    search.value = 'fresh';
    search.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 360));

    // New query landed: 3 cards.
    expect(handle.cards).toHaveLength(3);

    // NOW let the stale page-2 resolve — it must NOT append onto the fresh result.
    resolveSlow?.(res(200, page(24, 24, null)));
    await slowLoad;
    await new Promise((r) => setTimeout(r, 10));

    expect(handle.cards).toHaveLength(3);
    expect(renderedCells()).toHaveLength(3);
    handle.dismiss();
  });
});
