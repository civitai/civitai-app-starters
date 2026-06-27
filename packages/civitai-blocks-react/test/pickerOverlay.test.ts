import { describe, expect, it, vi } from 'vitest';

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

/** Decode a recorded request URL's query params. */
const params = (url: unknown) => new URL(String(url), BASE).searchParams;

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
    // …at a full page limit (toward the server cap), not the old 24 default.
    expect(params(calls[0]).get('limit')).toBe('100');
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
