import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  openPickerOverlay,
  type PickerOverlayHandle,
} from '../src/internal/pickerOverlay.js';

/**
 * REAL-BROWSER perf harness for the `dev:live` resource-picker overlay.
 *
 * WHY THIS FILE EXISTS: the picker's catalog grid was shipping a string of
 * layout/perf bugs (family-filter starvation, image freeze, grid row-collapse,
 * video-cover mp4 downloads) that the happy-dom unit suite COULD NOT catch —
 * happy-dom does no layout, no image decode, and runs no
 * IntersectionObserver/`performance`/`PerformanceObserver`. This test mounts the
 * overlay in REAL headless Chromium (vitest browser mode) so that:
 *   - cards actually lay out (the grid-collapse regression is a height assertion),
 *   - `<img loading="lazy">` actually loads/decodes (lazy deferral is observable),
 *   - the real IntersectionObserver fires on scroll (infinite-scroll, not the seam),
 *   - main-thread cost is measurable (longtasks) so "choppy" becomes a number.
 *
 * HERMETIC, by design: the catalog is a mocked `fetchImpl` (no live backend —
 * deploy-independent) and thumbnails are an in-browser canvas → Blob object URL
 * (no `image.civitai.com` dependency → CI never touches the CDN). The trade-off
 * is documented at the metrics block: a tiny synthetic thumbnail UNDER-represents
 * a real 320px CDN decode, so the longtask number here mostly isolates
 * render/layout/observer cost, not CDN-image decode. That's the point: with
 * network + CDN mocked away, what's left is the client cost we control.
 *
 * ── BASELINE (captured 2026-06-28, headless Chromium 149 on NixOS via
 *    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(command -v chromium); viewport 800×600) ──
 *   OPEN:   cards 24 · fetchCalls 1 · minCardHeight 220.5px ·
 *           gridScrollHeight 1384 / clientHeight 404 (scrolls) ·
 *           imgsInDom 24 · imgsLoadedOnOpen 24 · imgResourceEntries 0 ·
 *           longTaskCount 0 · longTaskMs 0
 *   SCROLL: cardsAfterScroll 48 · fetchCallsAfterScroll 2 ·
 *           minAppendedHeight 220.5px · scrollLongTaskCount 0 · scrollLongTaskMs 0
 *
 * Thresholds are deliberately lenient around this so a real regression
 * (storm-load, row-collapse, decode blowup) trips the assertion while normal
 * jitter does not. See the per-metric comments.
 *
 * ── WHAT THE BASELINE PINS (the "why is it choppy" answer) ──
 *   ✓ NO page-load storm on open (fetchCalls 1) — the sentinel/observer behave;
 *     the grid-collapse-→-load-everything freeze is NOT present.
 *   ✓ Cards lay out non-collapsed (220px) and the grid scrolls — the
 *     row-collapse regression is fixed and now guarded.
 *   ✓ Real IntersectionObserver infinite-scroll appends a page on scroll (24→48).
 *   ✓ longTaskMs 0 — with the CDN decode mocked away, the picker's
 *     render/layout/observer cost is trivial. So the open/scroll choppiness is
 *     NOT in the overlay's own JS/layout — it is dominated by IMAGE work.
 *   ⚠ imgsLoadedOnOpen 24 (= ALL of them): every thumbnail loads on open even
 *     though only the top ~2 rows are visible in the 404px grid. With REAL 320px
 *     CDN thumbnails that is 24 concurrent fetch+decodes on open → the freeze.
 *     i.e. `loading="lazy"` is NOT deferring the off-screen thumbnails here.
 *     CAVEAT: these hermetic thumbnails are Blob object URLs, which are
 *     synchronously available, so this run cannot fully distinguish "lazy is
 *     ineffective inside the overflow:auto modal (Chromium keys lazy off the
 *     DOCUMENT viewport, and the whole modal is in-viewport)" from "blob URLs
 *     bypass lazy". imgResourceEntries 0 confirms blob loads don't surface in
 *     resource-timing. CONFIRMING which it is — and whether a real fix is needed
 *     (IntersectionObserver-gated <img src> swap, or capping decode concurrency)
 *     — needs a served HTTP image fixture; tracked as the follow-up, NOT a
 *     speculative pickerOverlay.ts edit (this harness exists so fixes are
 *     MEASURED, not eyeballed).
 */

const PAGE_SIZE = 24; // mirrors PICKER_PAGE_LIMIT
const TOTAL_PAGES = 5; // 5 pages × 24 = 120 models — enough to overflow + scroll

/** A real, decodable thumbnail generated in-browser (hermetic — no CDN). */
let imageUrl: string;

beforeAll(async () => {
  imageUrl = await makeThumbnailObjectUrl();
});

afterEach(() => {
  // Sweep any overlay the test left mounted so it can't leak into the next test.
  document
    .querySelectorAll('[data-live-picker-overlay]')
    .forEach((el) => el.parentNode?.removeChild(el));
});

describe('pickerOverlay perf (real Chromium)', () => {
  it('opens with laid-out, non-collapsed cards and no page-load storm', async () => {
    const { handle, fetchCalls, longTasks } = await openAndSettle();

    // ── Render correctness ────────────────────────────────────────────────
    // The first page renders fully (the family-starvation fix: server-filtered
    // page rendered as-is, no client narrowing).
    expect(handle.cards).toHaveLength(PAGE_SIZE);
    const cards = cardEls();
    expect(cards).toHaveLength(PAGE_SIZE);

    // ── Layout: grid-collapse regression guard (STRONG) ───────────────────
    // Each card must keep its content height. The collapse bug squished every
    // card to a few px (align-content:stretch on a flex-shrunk grid). The
    // THUMB aspect-ratio 1/1 alone reserves ~card-width of height, so a healthy
    // card is well over 120px; a collapsed one is < 20px.
    const heights = cards.map((c) => c.getBoundingClientRect().height);
    const minCardHeight = Math.min(...heights);
    expect(minCardHeight).toBeGreaterThan(120);

    // ── Layout: the grid scrolls (does not overflow the modal) ────────────
    const grid = cards[0]!.parentElement!;
    expect(grid.scrollHeight).toBeGreaterThan(grid.clientHeight);

    // ── No page-load storm on open (STRONG) ───────────────────────────────
    // With 24 cards overflowing the grid, the bottom sentinel sits beyond the
    // 400px prefetch margin → the IntersectionObserver must NOT auto-load more
    // pages on open. A storm (collapse → all rows in-viewport → every page +
    // every <img> at once) is the classic freeze; here it would show as
    // fetchCalls === TOTAL_PAGES.
    expect(fetchCalls.length).toBeLessThan(TOTAL_PAGES);
    expect(fetchCalls.length).toBeLessThanOrEqual(2); // ideally exactly 1

    // ── Lazy-load: off-screen thumbnails are deferred ─────────────────────
    const imgs = imgEls();
    const loadedOnOpen = imgs.filter((im) => im.complete && im.naturalWidth > 0).length;
    const imgResourceCount = performance
      .getEntriesByType('resource')
      .filter((e) => (e as PerformanceResourceTiming).initiatorType === 'img').length;

    // ── Main-thread cost (the "choppy" proxy) ─────────────────────────────
    const longTaskMs = longTasks.reduce((sum, e) => sum + e.duration, 0);

    // Lenient ceiling — with the CDN mocked away open should be cheap; this
    // only trips on a gross regression (a synchronous storm/decode blowup).
    expect(longTaskMs).toBeLessThan(500);

    // Surfaced for the diff/CI log (vitest browser run-mode buffers console, but
    // these print on failure and via `--disableConsoleIntercept`). The committed
    // baseline lives in the file header so a regression is visible in review.
    // eslint-disable-next-line no-console
    console.log(
      '[picker-perf:OPEN] ' +
        JSON.stringify({
          cards: handle.cards.length,
          fetchCalls: fetchCalls.length,
          minCardHeight: round(minCardHeight),
          gridScrollHeight: grid.scrollHeight,
          gridClientHeight: grid.clientHeight,
          imgsInDom: imgs.length,
          imgsLoadedOnOpen: loadedOnOpen,
          imgResourceEntries: imgResourceCount,
          longTaskCount: longTasks.length,
          longTaskMs: round(longTaskMs),
        }),
    );

    handle.dismiss();
  });

  it('infinite-scroll: the REAL IntersectionObserver loads more pages on scroll', async () => {
    const { handle, fetchCalls, beginLongTaskWindow } = await openAndSettle();
    const grid = cardEls()[0]!.parentElement!;
    const callsBeforeScroll = fetchCalls.length;

    const takeLongTasks = beginLongTaskWindow();
    // Scroll to the bottom → the sentinel enters the 400px prefetch margin →
    // the real IntersectionObserver fires loadNext (NOT the loadMore() seam).
    grid.scrollTop = grid.scrollHeight;

    await vi.waitFor(
      () => {
        expect(handle.cards.length).toBeGreaterThan(PAGE_SIZE);
      },
      { timeout: 5000, interval: 50 },
    );

    expect(fetchCalls.length).toBeGreaterThan(callsBeforeScroll);
    // The newly-appended cards are also laid out (no collapse on append).
    const minAppendedHeight = Math.min(...cardEls().map((c) => c.getBoundingClientRect().height));
    expect(minAppendedHeight).toBeGreaterThan(120);

    const scrollLongTasks = takeLongTasks();
    const scrollLongTaskMs = scrollLongTasks.reduce((s, e) => s + e.duration, 0);
    expect(scrollLongTaskMs).toBeLessThan(500);

    // eslint-disable-next-line no-console
    console.log(
      '[picker-perf:SCROLL] ' +
        JSON.stringify({
          cardsAfterScroll: handle.cards.length,
          fetchCallsAfterScroll: fetchCalls.length,
          minAppendedHeight: round(minAppendedHeight),
          scrollLongTaskCount: scrollLongTasks.length,
          scrollLongTaskMs: round(scrollLongTaskMs),
        }),
    );

    handle.dismiss();
  });

  it('loadMore() control seam loads the next page deterministically', async () => {
    const { handle, fetchCalls } = await openAndSettle();
    const before = handle.cards.length;
    const callsBefore = fetchCalls.length;

    await handle.loadMore();

    expect(handle.cards.length).toBe(before + PAGE_SIZE);
    expect(fetchCalls.length).toBe(callsBefore + 1);
    handle.dismiss();
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Card / image DOM queries scoped to the live overlay. */
const cardEls = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>('[data-live-picker-overlay] [data-picker-card]'),
  );
const imgEls = () =>
  Array.from(document.querySelectorAll<HTMLImageElement>('[data-live-picker-overlay] [data-picker-card] img'));

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Build a mocked authoritative `/api/v1/blocks/models` `fetchImpl` that paginates
 * TOTAL_PAGES pages of PAGE_SIZE models, each carrying the hermetic thumbnail.
 * Cursor encodes the page index. Records every requested URL for storm checks.
 */
function makeMockFetch() {
  const fetchCalls: string[] = [];
  const pageItems = (pageIdx: number) =>
    Array.from({ length: PAGE_SIZE }, (_, i) => {
      const n = pageIdx * PAGE_SIZE + i;
      return {
        id: 100_000 + n,
        name: `Perf Model ${n}`,
        type: 'Checkpoint',
        nsfw: false,
        modelVersions: [
          { id: 900_000 + n, name: 'v1', baseModel: 'SDXL 1.0', images: [{ url: imageUrl, type: 'image' }] },
        ],
      };
    });

  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fetchCalls.push(url);
    const cursor = new URL(url, 'http://localhost').searchParams.get('cursor');
    const pageIdx = cursor ? Number(cursor) : 0;
    const nextCursor = pageIdx + 1 < TOTAL_PAGES ? String(pageIdx + 1) : null;
    return {
      ok: true,
      status: 200,
      json: async () => ({ items: pageItems(pageIdx), metadata: { nextCursor } }),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  return { fetchImpl, fetchCalls };
}

/**
 * Open the overlay against the mock + hermetic thumbnails, wait for the first
 * page to load AND for layout/decode/observer to settle, and return the handle
 * plus the perf-measurement seams (recorded fetch calls + a longtask collector).
 */
async function openAndSettle() {
  const { fetchImpl, fetchCalls } = makeMockFetch();

  // Collect main-thread longtasks across the whole test (buffered catches any
  // that landed before observe()).
  const longTasks: PerformanceEntry[] = [];
  let windowStart = 0;
  const observer = new PerformanceObserver((list) => longTasks.push(...list.getEntries()));
  try {
    observer.observe({ type: 'longtask', buffered: true } as PerformanceObserverInit);
  } catch {
    // longtask unsupported — leave the array empty (assertions stay lenient).
  }

  const handle = await new Promise<PickerOverlayHandle>((resolve) => {
    openPickerOverlay({
      type: 'Checkpoint',
      baseUrl: '',
      token: 'PERF_TOK', // authoritative /api/v1/blocks/models path
      fetchImpl,
      document,
      onReady: (h) => resolve(h),
      onResolve: () => {},
    });
  });

  await settle();

  /** Start a longtask sub-window; the returned fn drains tasks since the start. */
  const beginLongTaskWindow = () => {
    windowStart = performance.now();
    return () => longTasks.filter((e) => e.startTime >= windowStart);
  };

  return { handle, fetchCalls, longTasks: longTasks.slice(), beginLongTaskWindow };
}

/** Two RAFs + a short timeout so layout, image decode, and any IO settle. */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setTimeout(resolve, 150)),
    );
  });
}

/**
 * Generate a real 320×320 JPEG thumbnail in-browser and hand back a Blob object
 * URL. Real decodable bytes (a gradient + tiles → non-trivial entropy) keep the
 * `<img>` load + decode path real, while staying hermetic (no network/CDN).
 * NOTE: tiny synthetic thumbnail ⇒ decode cost is far below a real CDN image;
 * the longtask metric here isolates render/layout/observer cost, not decode.
 */
async function makeThumbnailObjectUrl(): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 320;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 320, 320);
  grad.addColorStop(0, '#2f6f4f');
  grad.addColorStop(1, '#243a8a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 320, 320);
  for (let i = 0; i < 48; i++) {
    ctx.fillStyle = `hsl(${(i * 31) % 360}, 60%, 50%)`;
    ctx.fillRect((i * 37) % 300, (i * 53) % 300, 26, 26);
  }
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.85),
  );
  return URL.createObjectURL(blob);
}
