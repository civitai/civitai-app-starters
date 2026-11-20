import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useResourcePicker } from '../src/hooks/useResourcePicker.js';
import { getTransport } from '../src/transport/singleton.js';
import { resetTransport } from '../src/testing.js';

/**
 * PAGE resource picker hook (Design 1 — host-chrome). Mirrors the
 * useBuzzWorkflow test scaffold: drive the iframe transport via window
 * postMessage, assert the OUTBOUND OPEN_RESOURCE_PICKER message + that the hook
 * resolves on the matching RESOURCE_PICKER_RESULT (by requestId), handles the
 * cancelled (no `selected`) case, and ignores a mismatched requestId.
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

describe('useResourcePicker', () => {
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
      payload: { requestId: string; resourceType: string; baseModelGroup?: string };
    };
  }

  function replyResult(requestId: string, selected?: unknown) {
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'RESOURCE_PICKER_RESULT', payload: { requestId, selected } },
          origin: PARENT_ORIGIN,
        }),
      );
    });
  }

  it('open() sends OPEN_RESOURCE_PICKER with the requested type + family hint', () => {
    const { result } = renderHook(() => useResourcePicker());
    act(() => {
      // Swallow the never-resolved pending promise — resetTransport() rejects it
      // on dispose; we only assert the OUTBOUND message here.
      result.current.open({ resourceType: 'Checkpoint', baseModelGroup: 'Flux1' }).catch(() => {});
    });
    const sent = lastSent();
    expect(sent.type).toBe('OPEN_RESOURCE_PICKER');
    expect(sent.payload.resourceType).toBe('Checkpoint');
    expect(sent.payload.baseModelGroup).toBe('Flux1');
    expect(typeof sent.payload.requestId).toBe('string');
  });

  it('omits baseModelGroup from the message when not provided', () => {
    const { result } = renderHook(() => useResourcePicker());
    act(() => {
      result.current.open({ resourceType: 'LORA' }).catch(() => {});
    });
    const sent = lastSent();
    expect(sent.payload.resourceType).toBe('LORA');
    expect(sent.payload).not.toHaveProperty('baseModelGroup');
  });

  it('resolves with the chosen resource on the matching RESOURCE_PICKER_RESULT', async () => {
    const { result } = renderHook(() => useResourcePicker());
    let pick!: Promise<unknown>;
    act(() => {
      pick = result.current.open({ resourceType: 'Checkpoint' });
    });
    const sent = lastSent();
    const selected = { versionId: 9001, modelId: 700, baseModel: 'Flux.1 D', modelType: 'Checkpoint' };
    replyResult(sent.payload.requestId, selected);
    await expect(pick).resolves.toEqual(selected);
  });

  it('resolves to null when the user dismissed (no `selected`)', async () => {
    const { result } = renderHook(() => useResourcePicker());
    let pick!: Promise<unknown>;
    act(() => {
      pick = result.current.open({ resourceType: 'LORA' });
    });
    const sent = lastSent();
    replyResult(sent.payload.requestId); // cancelled — no `selected`
    await expect(pick).resolves.toBeNull();
  });

  it('ignores a RESOURCE_PICKER_RESULT with a mismatched requestId', async () => {
    const { result } = renderHook(() => useResourcePicker());
    let pick!: Promise<unknown>;
    act(() => {
      pick = result.current.open({ resourceType: 'Checkpoint' });
    });
    const sent = lastSent();

    // A stray result for a DIFFERENT request must not resolve this promise.
    replyResult('some-other-id', { versionId: 1, modelId: 1, baseModel: 'X', modelType: 'LORA' });

    let settled = false;
    void pick.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    // The correct requestId resolves it.
    const mine = { versionId: 42, modelId: 7, baseModel: 'SDXL 1.0', modelType: 'Checkpoint' };
    replyResult(sent.payload.requestId, mine);
    await expect(pick).resolves.toEqual(mine);
  });

  it('drops a result whose selected.versionId is malformed (money-adjacent guard)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useResourcePicker());
      let pick!: Promise<unknown>;
      act(() => {
        pick = result.current.open({ resourceType: 'Checkpoint' });
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
      // versionId is the id the block feeds into a workflow body — a string is
      // genuinely malformed and MUST be dropped (not handed to the caller).
      replyResult(sent.payload.requestId, { versionId: '9001', modelId: 700, baseModel: 'X', modelType: 'LORA' });
      await Promise.resolve();
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('RESOURCE_PICKER_RESULT'));

      // A well-formed reply on the same requestId still resolves the pending pick.
      const good = { versionId: 9001, modelId: 700, baseModel: 'Flux.1 D', modelType: 'Checkpoint' };
      replyResult(sent.payload.requestId, good);
      await expect(pick).resolves.toEqual(good);
    } finally {
      warn.mockRestore();
    }
  });

  it('open() does NOT reject at the default ~30s timeout (a picker is human-interactive)', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useResourcePicker());
      let pick!: Promise<unknown>;
      act(() => {
        pick = result.current.open({ resourceType: 'LORA' });
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
      // Advance WELL past the 30s default request timeout: the old code rejected
      // here ("timed out after 30000ms"); the picker timeout must keep it pending.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(settled).toBe(false);
      // A real pick still resolves it.
      const picked = { versionId: 9, modelId: 1, baseModel: 'SDXL 1.0', modelType: 'LORA' };
      replyResult(sent.payload.requestId, picked);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await expect(pick).resolves.toEqual(picked);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not cross concurrent requests — each open() resolves its own result', async () => {
    const { result } = renderHook(() => useResourcePicker());
    let pickA!: Promise<unknown>;
    let pickB!: Promise<unknown>;
    act(() => {
      pickA = result.current.open({ resourceType: 'Checkpoint' });
    });
    const sentA = lastSent();
    act(() => {
      pickB = result.current.open({ resourceType: 'LORA' });
    });
    const sentB = lastSent();
    expect(sentA.payload.requestId).not.toBe(sentB.payload.requestId);

    const resB = { versionId: 222, modelId: 22, baseModel: 'SDXL 1.0', modelType: 'LORA' };
    const resA = { versionId: 111, modelId: 11, baseModel: 'Flux.1 D', modelType: 'Checkpoint' };
    replyResult(sentB.payload.requestId, resB);
    replyResult(sentA.payload.requestId, resA);

    await expect(pickA).resolves.toEqual(resA);
    await expect(pickB).resolves.toEqual(resB);
  });

  // ── Multi-select (`multiple: { max }`) ──────────────────────────────────────
  //
  // Reply helpers post the RAW payload, so a test can send exactly what a given
  // host generation would: `selectedResources` (a host that knows multi-select),
  // `selected` / nothing (one that predates it), or `error` (a refusal).
  function replyRaw(payload: Record<string, unknown>) {
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'RESOURCE_PICKER_RESULT', payload },
          origin: PARENT_ORIGIN,
        }),
      );
    });
  }
  const LORA_A = { versionId: 303, modelId: 33, modelName: 'C', versionName: 'v3', baseModel: 'SDXL 1.0', modelType: 'LORA' };
  const LORA_B = { versionId: 101, modelId: 11, modelName: 'A', versionName: 'v1', baseModel: 'SDXL 1.0', modelType: 'LORA' };
  const LORA_C = { versionId: 202, modelId: 22, modelName: 'B', versionName: 'v2', baseModel: 'SDXL 1.0', modelType: 'LORA' };

  describe('multiple', () => {
    it('sends `multiple: { max }` beside the usual fields', () => {
      const { result } = renderHook(() => useResourcePicker());
      act(() => {
        result.current
          .open({ resourceType: 'LORA', baseModelGroup: 'Flux.1 D', multiple: { max: 3 } })
          .catch(() => {});
      });
      const sent = lastSent();
      expect(sent.type).toBe('OPEN_RESOURCE_PICKER');
      const { requestId, ...rest } = sent.payload as Record<string, unknown>;
      expect(typeof requestId).toBe('string');
      expect(rest).toEqual({ resourceType: 'LORA', baseModelGroup: 'Flux.1 D', multiple: { max: 3 } });
    });

    it('a request WITHOUT `multiple` puts no `multiple` key on the wire', () => {
      const { result } = renderHook(() => useResourcePicker());
      act(() => {
        result.current.open({ resourceType: 'LORA', baseModelGroup: 'Flux.1 D' }).catch(() => {});
      });
      const { requestId: _requestId, ...rest } = lastSent().payload as Record<string, unknown>;
      // The whole payload, pinned: exactly what this hook has always sent.
      expect(rest).toEqual({ resourceType: 'LORA', baseModelGroup: 'Flux.1 D' });
    });

    it('resolves with the picked list IN THE ORDER the host sent it', async () => {
      const { result } = renderHook(() => useResourcePicker());
      let pick!: Promise<unknown>;
      act(() => {
        pick = result.current.open({ resourceType: 'LORA', multiple: { max: 3 } });
      });
      // Ids deliberately not ascending — a sort anywhere on the path shows.
      replyRaw({ requestId: lastSent().payload.requestId, selectedResources: [LORA_A, LORA_B, LORA_C] });
      await expect(pick).resolves.toEqual([
        { versionId: 303, modelId: 33, modelName: 'C', versionName: 'v3', baseModel: 'SDXL 1.0', modelType: 'LORA' },
        { versionId: 101, modelId: 11, modelName: 'A', versionName: 'v1', baseModel: 'SDXL 1.0', modelType: 'LORA' },
        { versionId: 202, modelId: 22, modelName: 'B', versionName: 'v2', baseModel: 'SDXL 1.0', modelType: 'LORA' },
      ]);
    });

    it('resolves with an EMPTY list when the viewer dismissed', async () => {
      const { result } = renderHook(() => useResourcePicker());
      let pick!: Promise<unknown>;
      act(() => {
        pick = result.current.open({ resourceType: 'LORA', multiple: { max: 2 } });
      });
      replyRaw({ requestId: lastSent().payload.requestId, selectedResources: [] });
      await expect(pick).resolves.toEqual([]);
    });

    it('clamps a max above 5 to 5 on the wire', () => {
      const { result } = renderHook(() => useResourcePicker());
      act(() => {
        result.current.open({ resourceType: 'LORA', multiple: { max: 12 } }).catch(() => {});
      });
      expect((lastSent().payload as Record<string, unknown>).multiple).toEqual({ max: 5 });
    });

    it('never returns more than `max`, keeping the first picks', async () => {
      const { result } = renderHook(() => useResourcePicker());
      let pick!: Promise<unknown>;
      act(() => {
        pick = result.current.open({ resourceType: 'LORA', multiple: { max: 2 } });
      });
      replyRaw({ requestId: lastSent().payload.requestId, selectedResources: [LORA_A, LORA_B, LORA_C] });
      await expect(pick).resolves.toEqual([LORA_A, LORA_B]);
    });

    it.each([[0], [-1], [2.5], [Number.NaN], ['3' as unknown as number]])(
      'rejects multiple.max = %s without sending anything',
      async (max) => {
        const { result } = renderHook(() => useResourcePicker());
        await expect(
          result.current.open({ resourceType: 'LORA', multiple: { max } }),
        ).rejects.toThrow(
          'useResourcePicker: `multiple.max` must be a whole number of at least 1 (values above 5 are clamped to 5).',
        );
        expect(postMessageMock).not.toHaveBeenCalled();
      },
    );

    it('rejects `multiple` with a Checkpoint without sending anything', async () => {
      const { result } = renderHook(() => useResourcePicker());
      await expect(
        // The overload makes this a TYPE error too — the cast is the JS caller.
        result.current.open({ resourceType: 'Checkpoint', multiple: { max: 2 } } as never),
      ).rejects.toThrow(
        'useResourcePicker: `multiple` is only supported for LoRA picks, not resourceType "Checkpoint". Call open() without `multiple` for a single pick.',
      );
      expect(postMessageMock).not.toHaveBeenCalled();
    });

    it('rejects with the host\'s message when the host refuses the request', async () => {
      const { result } = renderHook(() => useResourcePicker());
      let pick!: Promise<unknown>;
      act(() => {
        pick = result.current.open({ resourceType: 'LORA', multiple: { max: 2 } });
      });
      const settled = pick.then(
        () => 'resolved',
        (err: Error) => err.message,
      );
      replyRaw({ requestId: lastSent().payload.requestId, error: 'host says no' });
      await expect(settled).resolves.toBe('host says no');
    });

    // A host that predates multi-select never reads `multiple`: it opens the
    // single-pick picker and answers `{ requestId, selected }` — or a bare
    // `{ requestId }` on dismiss. The caller asked for a list and gets one.
    it('OLD HOST: a single-pick `selected` reply is normalised to a one-item list', async () => {
      const { result } = renderHook(() => useResourcePicker());
      let pick!: Promise<unknown>;
      act(() => {
        pick = result.current.open({ resourceType: 'LORA', multiple: { max: 3 } });
      });
      replyRaw({ requestId: lastSent().payload.requestId, selected: LORA_B });
      await expect(pick).resolves.toEqual([
        { versionId: 101, modelId: 11, modelName: 'A', versionName: 'v1', baseModel: 'SDXL 1.0', modelType: 'LORA' },
      ]);
    });

    it('OLD HOST: a bare dismiss reply is normalised to an empty list', async () => {
      const { result } = renderHook(() => useResourcePicker());
      let pick!: Promise<unknown>;
      act(() => {
        pick = result.current.open({ resourceType: 'LORA', multiple: { max: 3 } });
      });
      replyRaw({ requestId: lastSent().payload.requestId });
      await expect(pick).resolves.toEqual([]);
    });

    it('drops a list reply with ONE malformed entry rather than returning the rest', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const { result } = renderHook(() => useResourcePicker());
        let pick!: Promise<unknown>;
        act(() => {
          pick = result.current.open({ resourceType: 'LORA', multiple: { max: 3 } });
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
        replyRaw({ requestId, selectedResources: [LORA_A, { ...LORA_B, versionId: '101' }] });
        await Promise.resolve();
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('RESOURCE_PICKER_RESULT'));

        replyRaw({ requestId, selectedResources: [LORA_A] });
        await expect(pick).resolves.toEqual([LORA_A]);
      } finally {
        warn.mockRestore();
      }
    });

    // Invariant guard (green before and after): a single pick is untouched by
    // a host reply that ALSO happens to carry a list.
    it('a single pick still resolves to the resource, never a list', async () => {
      const { result } = renderHook(() => useResourcePicker());
      let pick!: Promise<unknown>;
      act(() => {
        pick = result.current.open({ resourceType: 'LORA' });
      });
      replyRaw({ requestId: lastSent().payload.requestId, selected: LORA_C });
      await expect(pick).resolves.toEqual({
        versionId: 202, modelId: 22, modelName: 'B', versionName: 'v2', baseModel: 'SDXL 1.0', modelType: 'LORA',
      });
    });
  });
});
