/**
 * In-harness resource-picker overlay for the LIVE host.
 *
 * On the real platform, `OPEN_CHECKPOINT_PICKER` / `OPEN_RESOURCE_PICKER` open
 * civitai's OWN model-picker modal. `dev:live` has no civitai chrome, so the
 * live host opens THIS — a small, self-contained DOM overlay (a searchable grid
 * of model cards backed by {@link fetchCatalog}). The dev clicks a card → the
 * host replies with a PROTOCOL-IDENTICAL `BlockCheckpointInfo` /
 * `BlockResourceInfo`. Dismiss → no selection. Protocol fidelity, not chrome
 * fidelity: the block code is byte-identical to production.
 *
 * Why a hand-rolled DOM overlay and NOT a React root: the live host is a
 * non-React `install()` (it patches `window.parent.postMessage`), and
 * `@civitai/blocks-react` has NO runtime dependency on `react-dom` (it's a
 * devDependency only; the package ships hooks for blocks that bring their own
 * React). Mounting a React root here would force a `react-dom` runtime dep onto
 * every consumer. A ~self-contained DOM overlay keeps the package dependency
 * surface unchanged and tears down deterministically.
 *
 * MONEY-SAFETY: a pick is DISCOVERY ONLY — the catalog browse and the resulting
 * id are HINTS. The server re-validates + prices every id at estimate/submit.
 * Nothing the dev clicks here is trusted or spends Buzz.
 *
 * The overlay exposes a small TEST SEAM ({@link PickerOverlayHandle}) so tests
 * (and the live host) can drive selection/dismissal programmatically without
 * synthesizing DOM clicks: `selectFirst()`, `selectByVersionId()`, `dismiss()`,
 * and `onReady` (fired once the first catalog page has loaded).
 */

import {
  cardToCheckpoint,
  cardToResource,
  fetchCatalog,
  type CatalogCard,
  type CatalogModelType,
  type CatalogResult,
} from './catalog.js';
import type { BlockCheckpointInfo, BlockResourceInfo } from '@civitai/app-sdk/blocks';

/** What the overlay resolves with — the production picker's `selected` shape. */
export type PickerSelection =
  | { kind: 'Checkpoint'; selected: BlockCheckpointInfo }
  | { kind: 'LORA'; selected: BlockResourceInfo };

export interface OpenPickerOptions {
  /** Which model type the picker is filtered to. */
  type: CatalogModelType;
  /** Backend origin the catalog resolves against (live host's `baseUrl`). */
  baseUrl: string;
  /** The dev block token — authoritative `/blocks/models` read (page token can read it). */
  token?: string | null;
  /** Injectable `fetch` — the live host's `fetchImpl`. */
  fetchImpl: typeof fetch;
  /**
   * Optional family hint — passed to the catalog as the SERVER-SIDE `baseModels`
   * filter so the server returns a full page of the requested family (not a
   * generic page narrowed client-side, which starved the grid to ~2 cards).
   * Typically a baseModel NAME ('SDXL 1.0', 'Flux.1 D'); an ecosystem KEY
   * ('Flux1'/'SDXL') that matches no name triggers fetchCatalog's empty-family
   * retry (generic page rather than a blank picker).
   */
  baseModelGroup?: string;
  /** Currently-selected versionId so the overlay can pre-highlight it. */
  currentVersionId?: number;
  /** Advisory-SFW for the PUBLIC fallback read. Defaults true (fail-closed SFW). */
  anonSfwOnly?: boolean;
  /** The document to mount into. Defaults to `globalThis.document`. */
  document?: Document;
  /**
   * Called once the first catalog page has loaded (or errored). A TEST SEAM:
   * tests use it to drive a deterministic selection without DOM clicks.
   */
  onReady?: (handle: PickerOverlayHandle) => void;
  /**
   * Resolve the picker. Called EXACTLY ONCE with the selection, or `null` for a
   * dismissal. The host maps this to the picker-result message.
   */
  onResolve: (selection: PickerSelection | null) => void;
}

/** Programmatic control surface returned by {@link openPickerOverlay}. */
export interface PickerOverlayHandle {
  /** All cards accumulated across loaded pages (the server-filtered result). Empty until ready. */
  readonly cards: readonly CatalogCard[];
  /** Pick the first available card (no-op if none). Resolves + tears down. */
  selectFirst(): void;
  /** Pick the card with this versionId (no-op if absent). Resolves + tears down. */
  selectByVersionId(versionId: number): void;
  /** Dismiss without a selection. Resolves `null` + tears down. */
  dismiss(): void;
  /** Force teardown (host teardown path). Resolves `null` if not already resolved. */
  close(): void;
  /** True once the overlay has resolved (selection or dismissal). */
  readonly resolved: boolean;
  /**
   * Load the NEXT catalog page now (the infinite-scroll trigger), as if the
   * scroll sentinel had intersected. A TEST SEAM: jsdom/happy-dom don't run
   * layout so a real IntersectionObserver never fires — tests call this to drive
   * the load-more path deterministically. No-op when already loading, when the
   * result is exhausted (`done`), or after resolve. Returns a promise that
   * settles once the page has loaded + appended (or immediately for a no-op).
   */
  loadMore(): Promise<void>;
  /** True once there is no further page to load (nextCursor === null). */
  readonly done: boolean;
}

const Z_INDEX = 2_147_483_000; // above the dev harness log (9999) and most chrome.

/**
 * Catalog page size for the picker — now the size of EACH page, not the whole
 * result. The overlay paginates with infinite scroll: it renders this many cards
 * initially, then appends another page as the dev scrolls near the bottom. 24 per
 * page keeps the DOM small and the lazy thumbnails few; rendering all ~50 at once
 * was laggy. `fetchCatalog`/`buildCatalogUrl` clamp to [1,100] anyway.
 */
const PICKER_PAGE_LIMIT = 24;

/**
 * IntersectionObserver prefetch margin: start loading the next page when the
 * scroll sentinel is within this distance of the grid's viewport, so the next
 * page is usually ready before the dev reaches the very bottom.
 */
const PICKER_SCROLL_ROOT_MARGIN = '400px';

/** SVG namespace for the inline play icon (createElementNS — not HTML createElement). */
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Muted grey for the video-tile icon — matches the card meta colour. */
const VIDEO_ICON_COLOR = '#8b919b';

/**
 * Build the labeled VIDEO tile for a video-only card: a square neutral tile
 * (same {@link THUMB_STYLE} dimensions + `#1c2128` bg as the placeholder, so it
 * doesn't collapse and matches the grid) with a centered inline-SVG play icon
 * (a filmstrip rectangle + a play triangle, zero-dep, muted grey, aria-hidden).
 * Carries `data-picker-video-tile` as a stable test/clarity hook. Pure DOM —
 * happy-dom-testable, no <video>, no network.
 */
function buildVideoTile(doc: Document): HTMLElement {
  const tile = doc.createElement('div');
  tile.setAttribute('data-picker-video-tile', '');
  Object.assign(tile.style, THUMB_STYLE);
  Object.assign(tile.style, VIDEO_TILE_STYLE);

  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '30');
  svg.setAttribute('height', '30');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');

  // Filmstrip / video frame (rounded rect outline).
  const frame = doc.createElementNS(SVG_NS, 'rect');
  frame.setAttribute('x', '2');
  frame.setAttribute('y', '4');
  frame.setAttribute('width', '20');
  frame.setAttribute('height', '16');
  frame.setAttribute('rx', '3');
  frame.setAttribute('stroke', VIDEO_ICON_COLOR);
  frame.setAttribute('stroke-width', '1.6');
  svg.appendChild(frame);

  // Centered play triangle (filled).
  const play = doc.createElementNS(SVG_NS, 'path');
  play.setAttribute('d', 'M10 9.2l5 2.8-5 2.8z');
  play.setAttribute('fill', VIDEO_ICON_COLOR);
  svg.appendChild(play);

  tile.appendChild(svg);
  return tile;
}

/**
 * Open the in-harness picker overlay. Mounts a modal into the document, loads
 * the catalog (filtered to `type` + family hint), and resolves via `onResolve`
 * on the dev's pick or dismissal. Returns a {@link PickerOverlayHandle} for
 * programmatic control (tests + host teardown). Idempotent resolve: only the
 * first of pick/dismiss/close/teardown wins.
 */
export function openPickerOverlay(opts: OpenPickerOptions): PickerOverlayHandle {
  const doc = opts.document ?? (globalThis as { document?: Document }).document;
  let resolved = false;
  let cards: CatalogCard[] = [];

  // --- Pagination state (infinite scroll). ---
  // `cards` ACCUMULATES across pages. `nextCursor` is the cursor for the next
  // page (null once exhausted). `query` is the active search string (a new search
  // resets pagination). `isLoading` guards against overlapping fetches.
  let query = '';
  let nextCursor: string | null = null;
  let done = false;
  let isLoading = false;

  // --- DOM scaffold (created even without a document so the handle is total). ---
  let root: HTMLElement | null = null;
  let grid: HTMLElement | null = null;
  let statusEl: HTMLElement | null = null;
  let searchEl: HTMLInputElement | null = null;
  let sentinel: HTMLElement | null = null;
  let observer: IntersectionObserver | null = null;

  /** Disconnect + drop the scroll observer (idempotent). */
  const disconnectObserver = () => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    sentinel = null;
  };

  const teardown = () => {
    disconnectObserver();
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
    grid = null;
    statusEl = null;
    searchEl = null;
  };

  const resolve = (selection: PickerSelection | null) => {
    if (resolved) return;
    resolved = true;
    teardown();
    opts.onResolve(selection);
  };

  const selectCard = (card: CatalogCard) => {
    if (opts.type === 'Checkpoint') {
      resolve({ kind: 'Checkpoint', selected: cardToCheckpoint(card) });
    } else {
      resolve({ kind: 'LORA', selected: cardToResource(card, opts.type) });
    }
  };

  const handle: PickerOverlayHandle = {
    get cards() {
      return cards;
    },
    get resolved() {
      return resolved;
    },
    selectFirst() {
      const first = cards[0];
      if (first) selectCard(first);
    },
    selectByVersionId(versionId: number) {
      const found = cards.find((c) => c.versionId === versionId);
      if (found) selectCard(found);
    },
    dismiss() {
      resolve(null);
    },
    close() {
      resolve(null);
    },
    get done() {
      return done;
    },
    loadMore() {
      return loadNext();
    },
  };

  // No document (pure-node smoke test): still load the catalog so onReady fires
  // and the handle is drivable; just skip the DOM.

  /** Build ONE card cell. Shared by the initial render + the append-on-scroll path. */
  const buildCard = (card: CatalogCard): HTMLElement | null => {
    if (!doc) return null;
    const cell = doc.createElement('button');
    cell.type = 'button';
    cell.setAttribute('data-picker-card', String(card.versionId));
    cell.setAttribute('aria-label', `${card.modelName} (${card.baseModel || 'unknown base'})`);
    Object.assign(cell.style, CARD_STYLE);
    if (opts.currentVersionId != null && card.versionId === opts.currentVersionId) {
      cell.style.outline = '2px solid #5ec8a0';
    }

    // Lazy <img> thumbnail (mirrors civitai's native ResourceSelectCard, which
    // uses <EdgeMedia loading="lazy" />). A CSS background-image CANNOT lazy-load,
    // so the old approach fetched + decoded all ~100 thumbnails at once → froze
    // the main thread. The browser now defers off-screen images. The src is
    // already a 320px edge image (catalog.ts edgeThumb), not a full original.
    // Pagination + lazy compose: fewer cards in the DOM AND off-screen images deferred.
    if (card.thumbnailUrl) {
      const thumb = doc.createElement('img');
      Object.assign(thumb.style, THUMB_STYLE);
      thumb.loading = 'lazy';
      thumb.decoding = 'async';
      thumb.alt = ''; // decorative — the cell already carries an aria-label
      thumb.src = card.thumbnailUrl;
      cell.appendChild(thumb);
    } else if (card.isVideoOnly) {
      // Video-only model: civitai's SFW media for this version is all video, so
      // there's NO image to thumbnail (a video cover in an <img> downloads the
      // full mp4 and renders nothing — see catalog.ts isVideoMedia). Render a
      // labeled VIDEO tile — the same square neutral tile but with a centered
      // play icon — so the card reads as an intentional video, not a broken/blank
      // cell. We deliberately do NOT mount a <video> (no cheap static poster from
      // the CDN; <video> is heavy/codec-dependent).
      cell.appendChild(buildVideoTile(doc));
    } else {
      // No media at all — render the neutral placeholder tile (NOT an <img> with
      // an empty src, which would show a broken-image icon).
      const placeholder = doc.createElement('div');
      Object.assign(placeholder.style, THUMB_STYLE);
      cell.appendChild(placeholder);
    }

    const name = doc.createElement('div');
    Object.assign(name.style, NAME_STYLE);
    name.textContent = card.modelName;
    cell.appendChild(name);

    const meta = doc.createElement('div');
    Object.assign(meta.style, META_STYLE);
    meta.textContent = [card.baseModel, card.versionName].filter(Boolean).join(' · ');
    cell.appendChild(meta);

    cell.addEventListener('click', () => selectCard(card));
    return cell;
  };

  /**
   * Reposition the scroll sentinel as the LAST child of the grid (after every
   * card) and (re)wire the IntersectionObserver. Called after each append so the
   * sentinel stays at the bottom. When the result is exhausted, the sentinel is
   * removed + the observer disconnected (no more triggers / no leak).
   */
  const refreshSentinel = () => {
    if (!grid || !doc) return;
    if (done) {
      // Nothing more to load — drop the sentinel + observer entirely.
      if (sentinel && sentinel.parentNode) sentinel.parentNode.removeChild(sentinel);
      disconnectObserver();
      return;
    }
    if (!sentinel) {
      sentinel = doc.createElement('div');
      sentinel.setAttribute('data-picker-sentinel', '');
      Object.assign(sentinel.style, SENTINEL_STYLE);
    }
    // Move it to the end (appendChild re-parents if already present).
    grid.appendChild(sentinel);

    // Resolve IntersectionObserver from the grid's own window (live host passes a
    // real document; happy-dom exposes one too — but it won't FIRE without layout,
    // which is why `loadMore()` is the deterministic test seam).
    const IO =
      (doc.defaultView as { IntersectionObserver?: typeof IntersectionObserver } | null)
        ?.IntersectionObserver ??
      (globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
    if (!observer && typeof IO === 'function') {
      observer = new IO(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              void loadNext();
              break;
            }
          }
        },
        { root: grid, rootMargin: PICKER_SCROLL_ROOT_MARGIN },
      );
    }
    if (observer && sentinel) observer.observe(sentinel);
  };

  /** Append just the NEW page's cards (keeps already-loaded cells + images). */
  const appendCards = (newCards: CatalogCard[]) => {
    if (!grid || !doc) return;
    for (const card of newCards) {
      const cell = buildCard(card);
      if (cell) {
        // Insert before the sentinel so it stays last (else just append).
        if (sentinel && sentinel.parentNode === grid) grid.insertBefore(cell, sentinel);
        else grid.appendChild(cell);
      }
    }
    refreshSentinel();
  };

  /** Clear + rebuild the whole grid (initial load / a NEW search query). */
  const renderCards = () => {
    if (!grid || !doc) return;
    grid.innerHTML = '';
    sentinel = null; // innerHTML cleared the old node
    if (cards.length === 0) {
      disconnectObserver();
      return;
    }
    for (const card of cards) {
      const cell = buildCard(card);
      if (cell) grid.appendChild(cell);
    }
    refreshSentinel();
  };

  const setStatus = (text: string) => {
    if (statusEl) statusEl.textContent = text;
  };

  const noun = () => (opts.type === 'LORA' ? 'LoRAs' : 'checkpoints');

  /** Status reflecting the current accumulated count + whether more is coming. */
  const settledStatus = () => {
    if (cards.length === 0) {
      setStatus('No matches');
      return;
    }
    // `done` → show the total; otherwise hint that more will load on scroll.
    setStatus(done ? `${cards.length} ${noun()}` : `${cards.length} ${noun()} — scroll for more`);
  };

  let reqId = 0;

  /**
   * Fetch one page. `reset` true = a NEW query (page 1): clear accumulated cards +
   * cursor, rebuild the grid. `reset` false = the next page: APPEND. The `reqId`
   * race-guard ensures a stale page from a superseded query can't land.
   */
  const fetchPage = (reset: boolean, firstLoad: boolean): Promise<void> => {
    // An APPEND is guarded against overlap + exhaustion. A RESET (new query) is
    // NOT blocked by an in-flight append — it must always proceed and bump `reqId`
    // so the stale append is invalidated (the race guard). Bumping `reqId` here
    // means the in-flight append's `id !== reqId` check drops its late page.
    if (!reset && (isLoading || done)) return Promise.resolve();
    isLoading = true;
    const id = ++reqId;
    setStatus(reset ? 'Loading…' : 'Loading more…');
    const cursor = reset ? undefined : (nextCursor ?? undefined);
    return fetchCatalog(
      {
        types: opts.type,
        query,
        // Server-side family filter (the real constraint). An ecosystem-key value
        // that matches no baseModel name falls back to a generic page inside
        // fetchCatalog (empty-family retry) rather than blanking the picker.
        baseModels: opts.baseModelGroup,
        // One PAGE per fetch — infinite scroll appends the next page on demand.
        limit: PICKER_PAGE_LIMIT,
        ...(cursor != null ? { cursor } : {}),
      },
      {
        fetch: opts.fetchImpl,
        baseUrl: opts.baseUrl,
        token: opts.token ?? undefined,
        anonSfwOnly: opts.anonSfwOnly,
      },
    ).then((res) => {
      // Race-guard: a late page from an old query (or a resolved overlay) is dropped
      // BEFORE it can append. `isLoading` is only cleared for the LIVE request so a
      // superseded fetch can't unlock a fresh one mid-flight.
      if (id !== reqId || resolved) return;
      isLoading = false;

      if (res.kind === 'ok') {
        const page = res.page.cards;
        nextCursor = res.page.nextCursor;
        done = nextCursor === null;
        if (reset) {
          // The server already filtered by family — render the full page directly.
          cards = page;
          renderCards();
        } else {
          cards = cards.concat(page);
          appendCards(page);
        }
        settledStatus();
      } else if (res.kind === 'empty') {
        // No (further) results. On a reset that's an empty grid; on an append it
        // just means we've reached the end.
        nextCursor = null;
        done = true;
        if (reset) {
          cards = [];
          renderCards();
          setStatus('No results');
        } else {
          settledStatus();
          refreshSentinel(); // tears the sentinel/observer down (done === true)
        }
      } else {
        // Error. On a reset, surface it + clear; on an append, keep what we have
        // and stop paginating (don't wipe already-loaded cards over a transient).
        if (reset) {
          cards = [];
          nextCursor = null;
          done = true;
          renderCards();
        }
        setStatus(`Catalog error: ${res.message}`);
      }

      if (firstLoad) opts.onReady?.(handle);
    });
  };

  /** Reset pagination + load page 1 of the active `query` (initial load / new search). */
  const load = (q: string, firstLoad: boolean): Promise<void> => {
    query = q;
    nextCursor = null;
    done = false;
    cards = [];
    return fetchPage(true, firstLoad);
  };

  /** Load the next page (infinite-scroll trigger). No-op when loading / done. */
  const loadNext = (): Promise<void> => {
    if (isLoading || done || resolved) return Promise.resolve();
    return fetchPage(false, false);
  };

  // --- Build the DOM (when a document exists). ---
  if (doc) {
    root = doc.createElement('div');
    root.setAttribute('data-live-picker-overlay', opts.type);
    Object.assign(root.style, BACKDROP_STYLE);
    // Backdrop click = dismiss.
    root.addEventListener('click', (e) => {
      if (e.target === root) resolve(null);
    });

    const modal = doc.createElement('div');
    Object.assign(modal.style, MODAL_STYLE);
    modal.addEventListener('click', (e) => e.stopPropagation());

    // Header: title + close.
    const header = doc.createElement('div');
    Object.assign(header.style, HEADER_STYLE);
    const title = doc.createElement('div');
    Object.assign(title.style, TITLE_STYLE);
    title.textContent =
      opts.type === 'LORA' ? 'Pick a LoRA (dev:live)' : 'Pick a checkpoint (dev:live)';
    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close picker');
    closeBtn.textContent = '✕';
    Object.assign(closeBtn.style, CLOSE_STYLE);
    closeBtn.addEventListener('click', () => resolve(null));
    header.appendChild(title);
    header.appendChild(closeBtn);

    // Sub-line: discovery-only money-safety note + family hint.
    const sub = doc.createElement('div');
    Object.assign(sub.style, SUB_STYLE);
    const familyNote = opts.baseModelGroup ? ` · family≈${opts.baseModelGroup}` : '';
    sub.textContent = `Discovery only — re-priced & re-validated at submit${familyNote}`;

    // Search.
    searchEl = doc.createElement('input');
    searchEl.type = 'search';
    searchEl.placeholder =
      opts.type === 'LORA' ? 'Search LoRAs…' : 'Search checkpoints…';
    searchEl.setAttribute('aria-label', 'Search the catalog');
    Object.assign(searchEl.style, SEARCH_STYLE);
    let debounce: ReturnType<typeof setTimeout> | undefined;
    searchEl.addEventListener('input', () => {
      if (debounce) clearTimeout(debounce);
      const q = searchEl?.value ?? '';
      debounce = setTimeout(() => load(q, false), 300);
    });

    // Status line.
    statusEl = doc.createElement('div');
    Object.assign(statusEl.style, STATUS_STYLE);

    // Grid.
    grid = doc.createElement('div');
    Object.assign(grid.style, GRID_STYLE);

    modal.appendChild(header);
    modal.appendChild(sub);
    modal.appendChild(searchEl);
    modal.appendChild(statusEl);
    modal.appendChild(grid);
    root.appendChild(modal);

    // Escape = dismiss.
    root.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape') resolve(null);
    });

    (doc.body ?? doc.documentElement).appendChild(root);
  }

  // Kick off the initial popular load (fires onReady on completion).
  load('', true);

  return handle;
}

// ---------------------------------------------------------------------------
// Styles — minimal, dark, tasteful dev chrome. Inline so the package ships no
// CSS file and the overlay needs no stylesheet injection.
// ---------------------------------------------------------------------------

const BACKDROP_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'fixed',
  inset: '0',
  zIndex: String(Z_INDEX),
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(8,10,13,0.72)',
  backdropFilter: 'blur(2px)',
};

const MODAL_STYLE: Partial<CSSStyleDeclaration> = {
  width: 'min(880px, 94vw)',
  maxHeight: '86vh',
  display: 'flex',
  flexDirection: 'column',
  background: '#15181d',
  color: '#e6e9ee',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '10px',
  boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  padding: '14px 16px 16px',
};

const HEADER_STYLE: Partial<CSSStyleDeclaration> = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const TITLE_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: '15px',
  fontWeight: '600',
};

const CLOSE_STYLE: Partial<CSSStyleDeclaration> = {
  background: 'transparent',
  border: 'none',
  color: '#9aa0aa',
  fontSize: '16px',
  cursor: 'pointer',
  lineHeight: '1',
  padding: '4px 6px',
};

const SUB_STYLE: Partial<CSSStyleDeclaration> = {
  marginTop: '2px',
  fontSize: '11px',
  color: '#7c828c',
};

const SEARCH_STYLE: Partial<CSSStyleDeclaration> = {
  marginTop: '10px',
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  background: '#0e1116',
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: '6px',
  color: '#e6e9ee',
  fontSize: '13px',
};

const STATUS_STYLE: Partial<CSSStyleDeclaration> = {
  marginTop: '8px',
  fontSize: '11px',
  color: '#9aa0aa',
  minHeight: '14px',
};

const GRID_STYLE: Partial<CSSStyleDeclaration> = {
  marginTop: '8px',
  // Scroll WITHIN the 86vh flex-column modal. `flex:1 1 auto` lets the grid take
  // the remaining space; `minHeight:0` is the classic flexbox fix that lets a flex
  // child shrink below its content height so `overflow:auto` actually scrolls
  // (without it the grid overflows the modal instead).
  flex: '1 1 auto',
  minHeight: '0',
  overflow: 'auto',
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
  // A `display:grid` element that is flex-shrunk via `flex:1 1 auto; min-height:0`
  // will, with the DEFAULT `align-content` (stretch), squish its auto-rows to fit
  // the shrunken track box INSTEAD of overflowing — collapsing every card to a few
  // px and clipping their thumbnails + titles (the cards' `overflow:hidden`), while
  // stacking all 50 into the viewport so every lazy <img> loads at once (lag).
  // `align-content:start` + `grid-auto-rows:max-content` pin rows to their content
  // height and let the grid actually scroll (overflow:auto) instead of squishing.
  alignContent: 'start',
  gridAutoRows: 'max-content',
  gap: '10px',
  paddingRight: '4px',
};

const SENTINEL_STYLE: Partial<CSSStyleDeclaration> = {
  // A zero-height marker spanning the full grid row. The IntersectionObserver
  // (root = the scroll container, rootMargin prefetch) watches it; when it nears
  // the viewport the next page loads. It carries no content and never collapses a
  // row (height 0, grid-column: 1 / -1 so it doesn't occupy a card slot).
  gridColumn: '1 / -1',
  height: '1px',
};

const CARD_STYLE: Partial<CSSStyleDeclaration> = {
  display: 'flex',
  flexDirection: 'column',
  textAlign: 'left',
  background: '#0e1116',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '8px',
  padding: '0',
  cursor: 'pointer',
  color: '#e6e9ee',
  overflow: 'hidden',
};

const THUMB_STYLE: Partial<CSSStyleDeclaration> = {
  display: 'block',
  width: '100%',
  aspectRatio: '1 / 1',
  objectFit: 'cover',
  // Neutral tile shown before/while the lazy <img> loads (and for no-thumb cells).
  background: '#1c2128',
};

const VIDEO_TILE_STYLE: Partial<CSSStyleDeclaration> = {
  // Centre the play icon within the square neutral tile (flex). Layered ON TOP of
  // THUMB_STYLE (same square dims + #1c2128 bg) so the tile matches the grid.
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const NAME_STYLE: Partial<CSSStyleDeclaration> = {
  padding: '6px 8px 0',
  fontSize: '12px',
  fontWeight: '600',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const META_STYLE: Partial<CSSStyleDeclaration> = {
  padding: '2px 8px 8px',
  fontSize: '10px',
  color: '#8b919b',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
