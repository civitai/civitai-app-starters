import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import {
  IMAGE_PICKER_MULTIPLE_MAX,
  IMAGE_PICKER_NO_LIST_ERROR,
  useImagePicker,
} from '../src/hooks/useImagePicker.js';
import { getTransport } from '../src/transport/singleton.js';
import { resetTransport } from '../src/testing.js';

/**
 * The viewer's-own-images picker hook. Same scaffold as useResourcePicker: drive
 * the iframe transport through window postMessage, assert the OUTBOUND
 * OPEN_IMAGE_PICKER message, and assert what the hook does with each
 * IMAGE_PICKER_RESULT shape the host can answer with.
 */

const PARENT_ORIGIN = 'https://civitai.com';

function buildInit(): BlockInitPayload {
  return {
    blockInstanceId: 'i',
    blockId: 'b',
    appId: 'app_test',
    token: { raw: 'jwt', scopes: [], expiresAt: new Date(Date.now() + 60_000).toISOString() },
    context: { slotId: 's' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: null,
    theme: 'light',
    renderMode: 'iframe',
  };
}

// Every field differs between the three, and none of the dimensions is a value
// the hook or the validator names, so a mixed-up or hardcoded field shows.
const POSTED = {
  source: 'posted',
  url: 'https://image.civitai.com/x/original=true/posted-a.jpeg',
  width: 832,
  height: 1216,
  nsfwLevel: 1,
  imageId: 7001,
};
const GENERATED = {
  source: 'generated',
  url: 'https://image.civitai.com/x/original=true/generated-b.jpeg',
  width: 1024,
  height: 768,
  nsfwLevel: 2,
};
const POSTED_2 = {
  source: 'posted',
  url: 'https://image.civitai.com/x/original=true/posted-c.jpeg',
  width: 640,
  height: 960,
  nsfwLevel: 4,
  imageId: 7003,
};

describe('useImagePicker', () => {
  let postMessageMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    postMessageMock = vi.fn();
    Object.defineProperty(window, 'parent', {
      value: { postMessage: postMessageMock },
      configurable: true,
      writable: true,
    });
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'BLOCK_INIT', payload: buildInit() },
        origin: PARENT_ORIGIN,
      }),
    );
    postMessageMock.mockClear();
  });

  afterEach(() => {
    resetTransport();
  });

  function lastSent() {
    return postMessageMock.mock.calls[postMessageMock.mock.calls.length - 1][0] as {
      type: string;
      payload: { requestId: string } & Record<string, unknown>;
    };
  }

  /** Post the RAW reply payload, so a test sends exactly what a host would. */
  function replyRaw(payload: Record<string, unknown>) {
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'IMAGE_PICKER_RESULT', payload },
          origin: PARENT_ORIGIN,
        }),
      );
    });
  }

  it('open() with no arguments sends OPEN_IMAGE_PICKER carrying only a requestId', () => {
    const { result } = renderHook(() => useImagePicker());
    act(() => {
      // Swallow the never-resolved pending promise — resetTransport() rejects it
      // on dispose; only the OUTBOUND message is asserted here.
      result.current.open().catch(() => {});
    });
    const sent = lastSent();
    expect(sent.type).toBe('OPEN_IMAGE_PICKER');
    const { requestId, ...rest } = sent.payload;
    expect(typeof requestId).toBe('string');
    expect(requestId.length).toBeGreaterThan(0);
    // The whole payload, pinned: no `sources`, no `multiple`.
    expect(rest).toStrictEqual({});
  });

  it('open({}) also omits both optional keys', () => {
    const { result } = renderHook(() => useImagePicker());
    act(() => {
      result.current.open({}).catch(() => {});
    });
    const { requestId: _requestId, ...rest } = lastSent().payload;
    expect(rest).toStrictEqual({});
  });

  it('sends `sources` as given and still no `multiple`', () => {
    const { result } = renderHook(() => useImagePicker());
    act(() => {
      result.current.open({ sources: ['generated'] }).catch(() => {});
    });
    const { requestId: _requestId, ...rest } = lastSent().payload;
    expect(rest).toStrictEqual({ sources: ['generated'] });
  });

  it('resolves with the chosen image on the matching IMAGE_PICKER_RESULT', async () => {
    const { result } = renderHook(() => useImagePicker());
    let pick!: Promise<unknown>;
    act(() => {
      pick = result.current.open();
    });
    replyRaw({ requestId: lastSent().payload.requestId, selected: POSTED });
    await expect(pick).resolves.toEqual({
      source: 'posted',
      url: 'https://image.civitai.com/x/original=true/posted-a.jpeg',
      width: 832,
      height: 1216,
      nsfwLevel: 1,
      imageId: 7001,
    });
  });

  it('a generated pick resolves with no imageId', async () => {
    const { result } = renderHook(() => useImagePicker());
    let pick!: Promise<unknown>;
    act(() => {
      pick = result.current.open({ sources: ['generated'] });
    });
    replyRaw({ requestId: lastSent().payload.requestId, selected: GENERATED });
    const image = (await pick) as Record<string, unknown>;
    expect(image).toEqual(GENERATED);
    expect(image).not.toHaveProperty('imageId');
  });

  it('resolves to null when the viewer dismissed (no `selected`)', async () => {
    const { result } = renderHook(() => useImagePicker());
    let pick!: Promise<unknown>;
    act(() => {
      pick = result.current.open();
    });
    replyRaw({ requestId: lastSent().payload.requestId });
    await expect(pick).resolves.toBeNull();
  });

  it('ignores an IMAGE_PICKER_RESULT with a mismatched requestId', async () => {
    const { result } = renderHook(() => useImagePicker());
    let pick!: Promise<unknown>;
    act(() => {
      pick = result.current.open();
    });
    const sent = lastSent();

    // A stray result for a DIFFERENT request must not resolve this promise.
    replyRaw({ requestId: 'some-other-id', selected: POSTED_2 });

    let settled = false;
    void pick.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    replyRaw({ requestId: sent.payload.requestId, selected: GENERATED });
    await expect(pick).resolves.toEqual(GENERATED);
  });

  it('drops a result whose selected image is malformed, then resolves on a good one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useImagePicker());
      let pick!: Promise<unknown>;
      act(() => {
        pick = result.current.open();
      });
      const requestId = lastSent().payload.requestId;
      let settled = false;
      void pick.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      // A string imageId is malformed and must not reach the caller.
      replyRaw({ requestId, selected: { ...POSTED, imageId: '7001' } });
      await Promise.resolve();
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('IMAGE_PICKER_RESULT'));

      replyRaw({ requestId, selected: POSTED });
      await expect(pick).resolves.toEqual(POSTED);
    } finally {
      warn.mockRestore();
    }
  });

  it('open() does NOT reject at the default ~30s timeout (a picker is human-interactive)', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useImagePicker());
      let pick!: Promise<unknown>;
      act(() => {
        pick = result.current.open();
      });
      const sent = lastSent();
      let settled = false;
      void pick.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      // Well past the 30s default request timeout.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(settled).toBe(false);
      replyRaw({ requestId: sent.payload.requestId, selected: POSTED });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await expect(pick).resolves.toEqual(POSTED);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not cross concurrent requests — each open() resolves its own result', async () => {
    const { result } = renderHook(() => useImagePicker());
    let pickA!: Promise<unknown>;
    let pickB!: Promise<unknown>;
    act(() => {
      pickA = result.current.open({ sources: ['posted'] });
    });
    const sentA = lastSent();
    act(() => {
      pickB = result.current.open({ sources: ['generated'] });
    });
    const sentB = lastSent();
    expect(sentA.payload.requestId).not.toBe(sentB.payload.requestId);

    // Answered in the opposite order to the one they were asked in.
    replyRaw({ requestId: sentB.payload.requestId, selected: GENERATED });
    replyRaw({ requestId: sentA.payload.requestId, selected: POSTED });

    await expect(pickA).resolves.toEqual(POSTED);
    await expect(pickB).resolves.toEqual(GENERATED);
  });

  // ── Refusals on the SINGLE path ─────────────────────────────────────────────
  //
  // A refusal carries no `selected`. Without the error check it would resolve
  // `null` and be indistinguishable from the viewer dismissing.
  it("single pick: rejects with the host's message when the host refuses", async () => {
    const { result } = renderHook(() => useImagePicker());
    let pick!: Promise<unknown>;
    act(() => {
      pick = result.current.open();
    });
    const settled = pick.then(
      (value) => ({ resolved: value }),
      (err: Error) => ({ rejected: err.message }),
    );
    replyRaw({ requestId: lastSent().payload.requestId, error: 'unsupported on this host' });
    await expect(settled).resolves.toEqual({ rejected: 'unsupported on this host' });
  });

  it('single pick: an EMPTY error string still rejects, with readable copy', async () => {
    const { result } = renderHook(() => useImagePicker());
    let pick!: Promise<unknown>;
    act(() => {
      pick = result.current.open();
    });
    const settled = pick.then(
      (value) => ({ resolved: value }),
      (err: Error) => ({ rejected: err.message }),
    );
    replyRaw({ requestId: lastSent().payload.requestId, error: '' });
    await expect(settled).resolves.toEqual({
      rejected: 'The host refused the image picker request.',
    });
  });

  it('single pick: an error wins over a `selected` sent beside it', async () => {
    const { result } = renderHook(() => useImagePicker());
    let pick!: Promise<unknown>;
    act(() => {
      pick = result.current.open();
    });
    const settled = pick.then(
      (value) => ({ resolved: value }),
      (err: Error) => ({ rejected: err.message }),
    );
    replyRaw({ requestId: lastSent().payload.requestId, error: 'host says no', selected: POSTED });
    await expect(settled).resolves.toEqual({ rejected: 'host says no' });
  });

  // ── `sources` validation (before anything is sent) ──────────────────────────
  it('rejects an empty `sources` without sending anything', async () => {
    const { result } = renderHook(() => useImagePicker());
    await expect(result.current.open({ sources: [] })).rejects.toThrow(
      "useImagePicker: `sources` must be a non-empty array of 'posted' and/or 'generated'. Omit it to offer both.",
    );
    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it('rejects a `sources` that is not an array without sending anything', async () => {
    const { result } = renderHook(() => useImagePicker());
    await expect(result.current.open({ sources: 'posted' as never })).rejects.toThrow(
      "useImagePicker: `sources` must be a non-empty array of 'posted' and/or 'generated'. Omit it to offer both.",
    );
    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it.each([
    [['uploaded'], 'uploaded'],
    [['posted', 'video'], 'video'],
    [['Posted'], 'Posted'],
    [[7], '7'],
  ])('rejects sources %j (unknown member) without sending anything', async (sources, named) => {
    const { result } = renderHook(() => useImagePicker());
    await expect(result.current.open({ sources: sources as never })).rejects.toThrow(
      `useImagePicker: unknown \`sources\` entry "${named}". The picker offers 'posted' and 'generated'.`,
    );
    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it('the plain-Error refusals are not a subclass (nothing to instanceof against)', async () => {
    const { result } = renderHook(() => useImagePicker());
    const err = await result.current.open({ sources: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).constructor).toBe(Error);
  });

  it('sends both known sources as given', () => {
    const { result } = renderHook(() => useImagePicker());
    act(() => {
      result.current.open({ sources: ['generated', 'posted'] }).catch(() => {});
    });
    expect(lastSent().payload.sources).toEqual(['generated', 'posted']);
  });

  // ── Multi pick (`multiple: { max }`) ────────────────────────────────────────
  describe('multiple', () => {
    it('the cap is 20', () => {
      expect(IMAGE_PICKER_MULTIPLE_MAX).toBe(20);
    });

    it('sends `multiple: { max }` and omits `sources` when it was not given', () => {
      const { result } = renderHook(() => useImagePicker());
      act(() => {
        result.current.open({ multiple: { max: 3 } }).catch(() => {});
      });
      const sent = lastSent();
      expect(sent.type).toBe('OPEN_IMAGE_PICKER');
      const { requestId, ...rest } = sent.payload;
      expect(typeof requestId).toBe('string');
      expect(rest).toStrictEqual({ multiple: { max: 3 } });
    });

    it('sends `sources` beside `multiple`', () => {
      const { result } = renderHook(() => useImagePicker());
      act(() => {
        result.current.open({ sources: ['posted'], multiple: { max: 7 } }).catch(() => {});
      });
      const { requestId: _requestId, ...rest } = lastSent().payload;
      expect(rest).toStrictEqual({ sources: ['posted'], multiple: { max: 7 } });
    });

    it('resolves with the picked list in the order the host sent it', async () => {
      const { result } = renderHook(() => useImagePicker());
      let pick!: Promise<unknown>;
      act(() => {
        pick = result.current.open({ multiple: { max: 3 } });
      });
      replyRaw({
        requestId: lastSent().payload.requestId,
        selectedImages: [POSTED_2, GENERATED, POSTED],
      });
      await expect(pick).resolves.toEqual([POSTED_2, GENERATED, POSTED]);
    });

    it('resolves with an EMPTY list when the viewer dismissed', async () => {
      const { result } = renderHook(() => useImagePicker());
      let pick!: Promise<unknown>;
      act(() => {
        pick = result.current.open({ multiple: { max: 2 } });
      });
      replyRaw({ requestId: lastSent().payload.requestId, selectedImages: [] });
      await expect(pick).resolves.toEqual([]);
    });

    it('clamps a max above 20 to 20 on the wire', () => {
      const { result } = renderHook(() => useImagePicker());
      act(() => {
        result.current.open({ multiple: { max: 37 } }).catch(() => {});
      });
      expect(lastSent().payload.multiple).toEqual({ max: 20 });
    });

    it('sends a max of exactly 20 unchanged, and one below it unchanged', () => {
      const { result } = renderHook(() => useImagePicker());
      act(() => {
        result.current.open({ multiple: { max: 20 } }).catch(() => {});
      });
      expect(lastSent().payload.multiple).toEqual({ max: 20 });
      act(() => {
        result.current.open({ multiple: { max: 19 } }).catch(() => {});
      });
      expect(lastSent().payload.multiple).toEqual({ max: 19 });
    });

    it('never returns more than `max`, keeping the first picks', async () => {
      const { result } = renderHook(() => useImagePicker());
      let pick!: Promise<unknown>;
      act(() => {
        pick = result.current.open({ multiple: { max: 2 } });
      });
      replyRaw({
        requestId: lastSent().payload.requestId,
        selectedImages: [POSTED_2, GENERATED, POSTED],
      });
      await expect(pick).resolves.toEqual([POSTED_2, GENERATED]);
    });

    it('a clamped request is also cut to the clamp, not to what was asked for', async () => {
      const { result } = renderHook(() => useImagePicker());
      let pick!: Promise<unknown>;
      act(() => {
        pick = result.current.open({ multiple: { max: 37 } });
      });
      const twentyThree = Array.from({ length: 23 }, (_, i) => ({ ...POSTED, imageId: 9000 + i }));
      replyRaw({ requestId: lastSent().payload.requestId, selectedImages: twentyThree });
      const images = (await pick) as Array<{ imageId: number }>;
      expect(images).toHaveLength(20);
      expect(images[0].imageId).toBe(9000);
      expect(images[19].imageId).toBe(9019);
    });

    it.each([[0], [-1], [2.5], [Number.NaN], ['3' as unknown as number]])(
      'rejects multiple.max = %s without sending anything',
      async (max) => {
        const { result } = renderHook(() => useImagePicker());
        await expect(result.current.open({ multiple: { max } })).rejects.toThrow(
          'useImagePicker: `multiple.max` must be a whole number of at least 1 (values above 20 are clamped to 20).',
        );
        expect(postMessageMock).not.toHaveBeenCalled();
      },
    );

    it('checks `sources` on the multi path too', async () => {
      const { result } = renderHook(() => useImagePicker());
      await expect(
        result.current.open({ sources: [], multiple: { max: 2 } }),
      ).rejects.toThrow('useImagePicker: `sources` must be a non-empty array');
      expect(postMessageMock).not.toHaveBeenCalled();
    });

    it("rejects with the host's message when the host refuses the request", async () => {
      const { result } = renderHook(() => useImagePicker());
      let pick!: Promise<unknown>;
      act(() => {
        pick = result.current.open({ multiple: { max: 2 } });
      });
      const settled = pick.then(
        () => 'resolved',
        (err: Error) => err.message,
      );
      replyRaw({ requestId: lastSent().payload.requestId, error: 'host says no' });
      await expect(settled).resolves.toBe('host says no');
    });

    // A multi pick is always answered with a list. A reply that passes the
    // validator but carries none is malformed: it rejects, and is never read as
    // "nothing picked" or turned into a one-item list.
    it.each([
      ['a single-pick `selected` only', { selected: GENERATED }],
      ['nothing but the requestId', {}],
    ])('rejects a multi reply carrying %s', async (_, extra) => {
      const { result } = renderHook(() => useImagePicker());
      let pick!: Promise<unknown>;
      act(() => {
        pick = result.current.open({ multiple: { max: 3 } });
      });
      const settled = pick.then(
        (value) => ({ resolved: value }),
        (err: Error) => ({ rejected: err.message }),
      );
      replyRaw({ requestId: lastSent().payload.requestId, ...extra });
      await expect(settled).resolves.toEqual({ rejected: 'the host returned no image list' });
      expect(IMAGE_PICKER_NO_LIST_ERROR).toBe('the host returned no image list');
    });

    // A `multiple` decided at runtime: `undefined` is a single pick, with no
    // `multiple` key on the wire.
    it('open({ multiple: undefined }) is a single pick', async () => {
      const { result } = renderHook(() => useImagePicker());
      const toggle = undefined as { max: number } | undefined;
      let pick!: Promise<unknown>;
      act(() => {
        pick = result.current.open({ multiple: toggle });
      });
      const { requestId, ...rest } = lastSent().payload;
      expect(rest).toStrictEqual({});
      replyRaw({ requestId, selected: POSTED });
      await expect(pick).resolves.toEqual(POSTED);
    });

    it('drops a list reply with ONE malformed entry rather than returning the rest', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const { result } = renderHook(() => useImagePicker());
        let pick!: Promise<unknown>;
        act(() => {
          pick = result.current.open({ multiple: { max: 3 } });
        });
        const requestId = lastSent().payload.requestId;
        let settled = false;
        void pick.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );
        replyRaw({ requestId, selectedImages: [POSTED, { ...GENERATED, width: 0 }] });
        await Promise.resolve();
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('IMAGE_PICKER_RESULT'));

        replyRaw({ requestId, selectedImages: [POSTED] });
        await expect(pick).resolves.toEqual([POSTED]);
      } finally {
        warn.mockRestore();
      }
    });

    it('a multi pick does NOT reject at the default ~30s timeout either', async () => {
      vi.useFakeTimers();
      try {
        const { result } = renderHook(() => useImagePicker());
        let pick!: Promise<unknown>;
        act(() => {
          pick = result.current.open({ multiple: { max: 2 } });
        });
        const sent = lastSent();
        let settled = false;
        void pick.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );
        await act(async () => {
          await vi.advanceTimersByTimeAsync(60_000);
        });
        expect(settled).toBe(false);
        replyRaw({ requestId: sent.payload.requestId, selectedImages: [GENERATED] });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
        await expect(pick).resolves.toEqual([GENERATED]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('a single pick still resolves to the image, never a list', async () => {
      const { result } = renderHook(() => useImagePicker());
      let pick!: Promise<unknown>;
      act(() => {
        pick = result.current.open();
      });
      replyRaw({ requestId: lastSent().payload.requestId, selected: POSTED_2 });
      await expect(pick).resolves.toEqual(POSTED_2);
    });
  });
});
