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
  /** The cards currently rendered (the server-filtered page). Empty until ready. */
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
}

const Z_INDEX = 2_147_483_000; // above the dev harness log (9999) and most chrome.

/**
 * Catalog page size for the picker. The server-side family filter already gives
 * the right coverage and the search box narrows further, so 50 lazy-loaded cards
 * is plenty and snappy — 100 froze the main thread (every thumbnail decoded at
 * once). `fetchCatalog`/`buildCatalogUrl` clamp to [1,100] anyway.
 */
const PICKER_PAGE_LIMIT = 50;

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

  // --- DOM scaffold (created even without a document so the handle is total). ---
  let root: HTMLElement | null = null;
  let grid: HTMLElement | null = null;
  let statusEl: HTMLElement | null = null;
  let searchEl: HTMLInputElement | null = null;

  const teardown = () => {
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
  };

  // No document (pure-node smoke test): still load the catalog so onReady fires
  // and the handle is drivable; just skip the DOM.
  const renderCards = () => {
    if (!grid || !doc) return;
    grid.innerHTML = '';
    if (cards.length === 0) return;
    for (const card of cards) {
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
      if (card.thumbnailUrl) {
        const thumb = doc.createElement('img');
        Object.assign(thumb.style, THUMB_STYLE);
        thumb.loading = 'lazy';
        thumb.decoding = 'async';
        thumb.alt = ''; // decorative — the cell already carries an aria-label
        thumb.src = card.thumbnailUrl;
        cell.appendChild(thumb);
      } else {
        // No thumbnail — render the neutral placeholder tile (NOT an <img> with an
        // empty src, which would show a broken-image icon).
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
      grid.appendChild(cell);
    }
  };

  const setStatus = (text: string) => {
    if (statusEl) statusEl.textContent = text;
  };

  const applyResult = (res: CatalogResult) => {
    if (res.kind === 'ok') {
      // The server already filtered by family (the `baseModels` param) — render
      // the full returned page directly. No client-side narrowing (that starved
      // the grid to ~2 of a generic page); the server is the real constraint.
      cards = res.page.cards;
      setStatus(
        cards.length > 0
          ? `${cards.length} ${opts.type === 'LORA' ? 'LoRAs' : 'checkpoints'}`
          : 'No matches',
      );
    } else if (res.kind === 'empty') {
      cards = [];
      setStatus('No results');
    } else {
      cards = [];
      setStatus(`Catalog error: ${res.message}`);
    }
    renderCards();
  };

  let reqId = 0;
  const load = (query: string, firstLoad: boolean) => {
    const id = ++reqId;
    setStatus('Loading…');
    void fetchCatalog(
      {
        types: opts.type,
        query,
        // Server-side family filter (the real constraint). An ecosystem-key value
        // that matches no baseModel name falls back to a generic page inside
        // fetchCatalog (empty-family retry) rather than blanking the picker.
        baseModels: opts.baseModelGroup,
        // Pull a sizeable page so the dev sees many options (the old default of
        // 24 + a client narrow left ~2 cards); lazy-loaded thumbnails keep it snappy.
        limit: PICKER_PAGE_LIMIT,
      },
      {
        fetch: opts.fetchImpl,
        baseUrl: opts.baseUrl,
        token: opts.token ?? undefined,
        anonSfwOnly: opts.anonSfwOnly,
      },
    ).then((res) => {
      if (id !== reqId || resolved) return;
      applyResult(res);
      if (firstLoad) opts.onReady?.(handle);
    });
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
