import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { BlockPickedImageInfo, ModelSlotContext } from '@civitai/app-sdk/blocks';

import { useImagePicker } from '../src/hooks/useImagePicker.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';

/**
 * The OPEN_IMAGE_PICKER → IMAGE_PICKER_RESULT mock backend in `createMockHost`,
 * exercised against the REAL `useImagePicker` hook + transport + validator.
 * The mock has no picker UI: it answers at once from `cannedImagePicks`,
 * filtered by the requested `sources` and cut to `max`.
 */

const ORIGIN = window.location.origin;

const MODEL_SLOT: ModelSlotContext = {
  slotId: 'model.sidebar_top',
  modelId: 11,
  modelVersionId: 22,
  modelName: 'Fixture model',
  modelType: 'Checkpoint',
  modelNsfwLevel: 1,
};

// A library that ALTERNATES sources, so a filter that does nothing, a filter
// that keeps the wrong half, and a cut taken before the filter each produce a
// different list. Ids are not ascending, so a sort shows too.
const LIBRARY: BlockPickedImageInfo[] = [
  { source: 'generated', url: 'https://image.civitai.com/t/g1.jpeg', width: 1024, height: 768, nsfwLevel: 2 },
  { source: 'posted', url: 'https://image.civitai.com/t/p1.jpeg', width: 832, height: 1216, nsfwLevel: 1, imageId: 903 },
  { source: 'generated', url: 'https://image.civitai.com/t/g2.jpeg', width: 640, height: 960, nsfwLevel: 1 },
  { source: 'posted', url: 'https://image.civitai.com/t/p2.jpeg', width: 1536, height: 1024, nsfwLevel: 4, imageId: 901 },
  { source: 'posted', url: 'https://image.civitai.com/t/p3.jpeg', width: 512, height: 512, nsfwLevel: 1, imageId: 902 },
];

describe('createMockHost — image picker', () => {
  let host: ReturnType<typeof createMockHost> | undefined;
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = host = undefined;
    resetTransport();
  });

  async function mount(options: Parameters<typeof createMockHost>[0] = {}) {
    host = createMockHost(options);
    uninstall = host.install();
    const hook = renderHook(() => useImagePicker());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    return hook.result;
  }

  /** Post a RAW request (one the hook would refuse to send) and read the raw reply. */
  async function rawRequest(payload: Record<string, unknown>): Promise<unknown> {
    const replies: unknown[] = [];
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; payload?: unknown };
      if (d?.type === 'IMAGE_PICKER_RESULT') replies.push(d.payload);
    };
    window.addEventListener('message', onMessage);
    try {
      window.parent.postMessage({ type: 'OPEN_IMAGE_PICKER', payload }, '*');
      await waitFor(() => expect(replies).toHaveLength(1));
      return replies[0];
    } finally {
      window.removeEventListener('message', onMessage);
    }
  }

  // ── Defaults ────────────────────────────────────────────────────────────────
  it('default single pick resolves with the default POSTED image (it has an imageId)', async () => {
    const result = await mount();
    await expect(result.current.open()).resolves.toEqual({
      source: 'posted',
      url: 'https://image.civitai.com/mock/width=832/dev-posted-image.jpeg',
      width: 832,
      height: 1216,
      nsfwLevel: 1,
      imageId: 12345801,
    });
  });

  it('the default GENERATED image has no imageId', async () => {
    const result = await mount();
    const image = await result.current.open({ sources: ['generated'] });
    expect(image).toEqual({
      source: 'generated',
      url: 'https://image.civitai.com/mock/original=true/dev-generated-image.jpeg',
      width: 1024,
      height: 768,
      nsfwLevel: 2,
    });
    expect(image).not.toHaveProperty('imageId');
  });

  it('default multi pick returns one image per library', async () => {
    const result = await mount();
    const images = await result.current.open({ multiple: { max: 5 } });
    expect(images.map((image) => image.source)).toEqual(['posted', 'generated']);
  });

  // ── Source filtering ────────────────────────────────────────────────────────
  it('single pick answers with the first image of the requested source, not the first image', async () => {
    const result = await mount({ cannedImagePicks: LIBRARY });
    await expect(result.current.open()).resolves.toEqual(LIBRARY[0]);
    await expect(result.current.open({ sources: ['posted'] })).resolves.toEqual(LIBRARY[1]);
    await expect(result.current.open({ sources: ['generated'] })).resolves.toEqual(LIBRARY[0]);
  });

  it('multi pick filters by source BEFORE cutting to max, keeping list order', async () => {
    const result = await mount({ cannedImagePicks: LIBRARY });
    // Unfiltered: the first two, whatever their source.
    await expect(result.current.open({ multiple: { max: 2 } })).resolves.toEqual([
      LIBRARY[0],
      LIBRARY[1],
    ]);
    // 'posted' only: entries 1, 3, 4 — cut to 2. A cut taken before the filter
    // would yield just [LIBRARY[1]].
    await expect(
      result.current.open({ sources: ['posted'], multiple: { max: 2 } }),
    ).resolves.toEqual([LIBRARY[1], LIBRARY[3]]);
    await expect(
      result.current.open({ sources: ['generated'], multiple: { max: 7 } }),
    ).resolves.toEqual([LIBRARY[0], LIBRARY[2]]);
    await expect(
      result.current.open({ sources: ['posted', 'generated'], multiple: { max: 7 } }),
    ).resolves.toEqual(LIBRARY);
  });

  it('a source with nothing in it answers as a dismiss: null, and [] for a multi pick', async () => {
    const result = await mount({ cannedImagePicks: [LIBRARY[0], LIBRARY[2]] });
    await expect(result.current.open({ sources: ['posted'] })).resolves.toBeNull();
    await expect(
      result.current.open({ sources: ['posted'], multiple: { max: 3 } }),
    ).resolves.toEqual([]);
  });

  it('a repeated source is harmless', async () => {
    await mount({ cannedImagePicks: LIBRARY });
    expect(
      await rawRequest({ requestId: 'raw-dupes', sources: ['posted', 'posted'], multiple: { max: 9 } }),
    ).toEqual({ requestId: 'raw-dupes', selectedImages: [LIBRARY[1], LIBRARY[3], LIBRARY[4]] });
  });

  // ── Cap ─────────────────────────────────────────────────────────────────────
  it('caps a multi pick at 20 even when more are canned and asked for', async () => {
    const many: BlockPickedImageInfo[] = Array.from({ length: 23 }, (_, i) => ({
      source: 'posted',
      url: `https://image.civitai.com/t/many-${i}.jpeg`,
      width: 832,
      height: 1216,
      nsfwLevel: 1,
      imageId: 5000 + i,
    }));
    await mount({ cannedImagePicks: many });
    // Raw, so the mock's OWN clamp is what is measured (the hook clamps first).
    const reply = (await rawRequest({ requestId: 'raw-cap', multiple: { max: 37 } })) as {
      selectedImages: BlockPickedImageInfo[];
    };
    expect(reply.selectedImages).toHaveLength(20);
    expect(reply.selectedImages[19].imageId).toBe(5019);
  });

  // ── Dismiss ─────────────────────────────────────────────────────────────────
  it.each([
    ['null', { cannedImagePicks: null }],
    ['an empty list', { cannedImagePicks: [] }],
  ])('cannedImagePicks: %s simulates a viewer who dismisses', async (_, options) => {
    const result = await mount(options);
    await expect(result.current.open()).resolves.toBeNull();
    await expect(result.current.open({ multiple: { max: 4 } })).resolves.toEqual([]);
  });

  it('a single-pick reply carries `selected` only, a multi reply `selectedImages` only', async () => {
    await mount({ cannedImagePicks: LIBRARY });
    expect(await rawRequest({ requestId: 'raw-single' })).toEqual({
      requestId: 'raw-single',
      selected: LIBRARY[0],
    });
    expect(await rawRequest({ requestId: 'raw-multi', multiple: { max: 1 } })).toEqual({
      requestId: 'raw-multi',
      selectedImages: [LIBRARY[0]],
    });
    host!.setScenario({ cannedImagePicks: null });
    expect(await rawRequest({ requestId: 'raw-dismiss' })).toEqual({ requestId: 'raw-dismiss' });
    expect(await rawRequest({ requestId: 'raw-dismiss-multi', multiple: { max: 2 } })).toEqual({
      requestId: 'raw-dismiss-multi',
      selectedImages: [],
    });
  });

  // ── Refusals (the host's own) ───────────────────────────────────────────────
  it.each([
    ['an empty array', []],
    ['not an array', 'posted'],
    ['null', null],
    ['an unknown member', ['posted', 'video']],
    ['a wrong-case member', ['Generated']],
  ])('refuses sources that are %s with an error', async (_, sources) => {
    await mount({ cannedImagePicks: LIBRARY });
    // Matched on behaviour, not on the host's exact wording: an error naming
    // `sources`, and no pick.
    expect(await rawRequest({ requestId: 'raw-src', sources })).toStrictEqual({
      requestId: 'raw-src',
      error: expect.stringMatching(/sources must be/),
    });
  });

  it.each([[0], [-1], [2.5], ['3'], [null]])(
    'refuses multiple.max = %s with an error',
    async (max) => {
      await mount({ cannedImagePicks: LIBRARY });
      expect(await rawRequest({ requestId: 'raw-max', multiple: { max } })).toStrictEqual({
        requestId: 'raw-max',
        error: expect.stringMatching(/multiple\.max must be/),
      });
    },
  );

  // Any PRESENT `multiple` asks for a multi pick. `null` in particular is
  // refused, as the host refuses it: it is never read as "no `multiple`" and
  // answered with a single pick.
  it.each([
    ['null', null],
    ['a number', 3],
    ['an empty object', {}],
  ])('refuses a `multiple` that is %s with an error, never a single pick', async (_, multiple) => {
    await mount({ cannedImagePicks: LIBRARY });
    expect(await rawRequest({ requestId: 'raw-multiple', multiple })).toStrictEqual({
      requestId: 'raw-multiple',
      error: expect.stringMatching(/multiple\.max must be/),
    });
  });

  it('a bad `sources` is reported before a bad `multiple`', async () => {
    await mount({ cannedImagePicks: LIBRARY });
    expect(
      await rawRequest({ requestId: 'raw-both', sources: [], multiple: { max: 0 } }),
    ).toStrictEqual({ requestId: 'raw-both', error: expect.stringMatching(/sources must be/) });
  });

  // ── What the host does to a pick before it reaches the app ──────────────────
  it('drops an imageId canned on a GENERATED pick, single and multi, and keeps a posted one', async () => {
    const result = await mount({
      cannedImagePicks: [{ ...LIBRARY[0], imageId: 4141 }, LIBRARY[1]],
    });
    const single = await result.current.open({ sources: ['generated'] });
    expect(single).toStrictEqual(LIBRARY[0]);
    expect(single).not.toHaveProperty('imageId');
    const many = await result.current.open({ multiple: { max: 5 } });
    expect(many).toStrictEqual([LIBRARY[0], LIBRARY[1]]);
    expect(many[0]).not.toHaveProperty('imageId');
    expect(many[1]!.imageId).toBe(903);
  });

  it('sends only the contract fields of a canned pick', async () => {
    await mount({
      cannedImagePicks: [{ ...LIBRARY[1], postId: 77, meta: { prompt: 'x' } } as never],
    });
    expect(await rawRequest({ requestId: 'raw-fields' })).toStrictEqual({
      requestId: 'raw-fields',
      selected: LIBRARY[1],
    });
  });

  it('offers a repeated image (same source and url) once, keeping the first', async () => {
    const twin = { ...LIBRARY[1], nsfwLevel: 16, imageId: 999 };
    // Same url under the OTHER source is a different image and is kept.
    const otherSource = { ...LIBRARY[0], url: LIBRARY[1]!.url };
    const result = await mount({
      cannedImagePicks: [LIBRARY[1]!, twin, LIBRARY[3]!, otherSource, LIBRARY[1]!],
    });
    await expect(result.current.open({ multiple: { max: 9 } })).resolves.toStrictEqual([
      LIBRARY[1],
      LIBRARY[3],
      otherSource,
    ]);
    // The repeat does not use up a slot: max 2 still reaches the second image.
    await expect(result.current.open({ multiple: { max: 2 } })).resolves.toStrictEqual([
      LIBRARY[1],
      LIBRARY[3],
    ]);
  });

  it('the default posted pick is a resized rendition url, not the original file', async () => {
    const result = await mount();
    const image = await result.current.open({ sources: ['posted'] });
    expect(image!.url).not.toContain('original=true');
    expect(image!.url).toContain(`width=${image!.width}`);
  });

  it('hands back whatever nsfwLevel a canned pick carries (a pick can be mature)', async () => {
    const result = await mount({ cannedImagePicks: [{ ...LIBRARY[1]!, nsfwLevel: 16 }] });
    expect((await result.current.open())!.nsfwLevel).toBe(16);
  });

  it('on a model-slot context the picker is unsupported: the hook REJECTS, single and multi', async () => {
    const result = await mount({ context: MODEL_SLOT, cannedImagePicks: LIBRARY });
    const single = await result.current.open().then(
      (value) => ({ resolved: value }),
      (err: Error) => ({ rejected: err.message }),
    );
    expect(single).toEqual({ rejected: 'unsupported on this host' });
    const multi = await result.current.open({ multiple: { max: 2 } }).then(
      (value) => ({ resolved: value }),
      (err: Error) => ({ rejected: err.message }),
    );
    expect(multi).toEqual({ rejected: 'unsupported on this host' });
  });

  // ── setScenario ─────────────────────────────────────────────────────────────
  it('setScenario swaps the library mid-session, to dismissed, and back to the defaults', async () => {
    const result = await mount();
    expect((await result.current.open())?.imageId).toBe(12345801);

    host!.setScenario({ cannedImagePicks: [LIBRARY[3]] });
    await expect(result.current.open()).resolves.toEqual(LIBRARY[3]);

    host!.setScenario({ cannedImagePicks: null });
    await expect(result.current.open()).resolves.toBeNull();

    // An unrelated patch leaves the picker setting alone.
    host!.setScenario({ cannedImageUpload: null });
    await expect(result.current.open()).resolves.toBeNull();

    host!.setScenario({ cannedImagePicks: undefined });
    expect((await result.current.open())?.imageId).toBe(12345801);
  });

  it('hands the block a copy: mutating a pick does not change the next answer', async () => {
    const result = await mount({ cannedImagePicks: [{ ...LIBRARY[1] }] });
    const first = await result.current.open();
    first!.url = 'https://example.invalid/tampered.jpeg';
    await expect(result.current.open()).resolves.toEqual(LIBRARY[1]);
  });
});
