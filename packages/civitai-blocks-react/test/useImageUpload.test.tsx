import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  BlockGenerationSourceImageInfo,
  BlockInitPayload,
  BlockUploadedImageInfo,
} from '@civitai/app-sdk/blocks';

import { useImageUpload } from '../src/hooks/useImageUpload.js';
import { getTransport } from '../src/internal/singleton.js';
import { resetTransport } from '../src/testing.js';

/**
 * Host-mediated image-upload hook. Mirrors the useResourcePicker scaffold: drive
 * the iframe transport via window postMessage, assert the OUTBOUND
 * OPEN_IMAGE_UPLOAD message + that the hook resolves on the matching
 * IMAGE_UPLOAD_RESULT (by requestId), handles the cancelled (no `selected`) case,
 * and does not reject at the default ~30s timeout (upload is human-interactive).
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

const MODERATED: BlockUploadedImageInfo = {
  imageId: 987654,
  nsfwLevel: 1,
  contentRating: 'pg',
  url: 'https://image.civitai.com/x/original=true/pic.jpeg',
};

const GENERATION_SOURCE: BlockGenerationSourceImageInfo = {
  url: 'https://image.civitai.com/x/original=true/source.jpeg',
  width: 768,
  height: 1024,
};

describe('useImageUpload', () => {
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
    return postMessageMock.mock.calls[postMessageMock.mock.calls.length - 1]![0] as {
      type: string;
      payload: { requestId: string };
    };
  }

  function replyResult(requestId: string, selected?: unknown) {
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'IMAGE_UPLOAD_RESULT', payload: { requestId, selected } },
          origin: PARENT_ORIGIN,
        }),
      );
    });
  }

  it('open() sends OPEN_IMAGE_UPLOAD with a requestId and no extra payload', () => {
    const { result } = renderHook(() => useImageUpload());
    act(() => {
      result.current.open().catch(() => {});
    });
    const sent = lastSent();
    expect(sent.type).toBe('OPEN_IMAGE_UPLOAD');
    expect(typeof sent.payload.requestId).toBe('string');
    expect(Object.keys(sent.payload)).toEqual(['requestId']);
  });

  it("open() omits `purpose` for the default (display) mode — byte-compatible wire", () => {
    const { result } = renderHook(() => useImageUpload({ purpose: 'display' }));
    act(() => {
      result.current.open().catch(() => {});
    });
    const sent = lastSent() as { payload: { requestId: string; purpose?: string } };
    expect(sent.payload.purpose).toBeUndefined();
    expect(Object.keys(sent.payload)).toEqual(['requestId']);
  });

  it("open() sends purpose:'generationSource' when requested", () => {
    const { result } = renderHook(() => useImageUpload({ purpose: 'generationSource' }));
    act(() => {
      result.current.open().catch(() => {});
    });
    const sent = lastSent() as { payload: { requestId: string; purpose?: string } };
    expect(sent.type).toBe('OPEN_IMAGE_UPLOAD');
    expect(sent.payload.purpose).toBe('generationSource');
    expect(typeof sent.payload.requestId).toBe('string');
  });

  it('generationSource: resolves with the { url, width, height } source shape', async () => {
    const { result } = renderHook(() => useImageUpload({ purpose: 'generationSource' }));
    let pick!: Promise<BlockGenerationSourceImageInfo | null>;
    act(() => {
      pick = result.current.open();
    });
    replyResult(lastSent().payload.requestId, GENERATION_SOURCE);
    await expect(pick).resolves.toEqual(GENERATION_SOURCE);
  });

  it('generationSource: resolves to null when the user dismissed', async () => {
    const { result } = renderHook(() => useImageUpload({ purpose: 'generationSource' }));
    let pick!: Promise<BlockGenerationSourceImageInfo | null>;
    act(() => {
      pick = result.current.open();
    });
    replyResult(lastSent().payload.requestId); // cancelled — no `selected`
    await expect(pick).resolves.toBeNull();
  });

  it('resolves with the moderated image on the matching IMAGE_UPLOAD_RESULT', async () => {
    const { result } = renderHook(() => useImageUpload());
    let pick!: Promise<unknown>;
    act(() => {
      pick = result.current.open();
    });
    replyResult(lastSent().payload.requestId, MODERATED);
    await expect(pick).resolves.toEqual(MODERATED);
  });

  it('resolves to null when the user dismissed (no `selected`)', async () => {
    const { result } = renderHook(() => useImageUpload());
    let pick!: Promise<unknown>;
    act(() => {
      pick = result.current.open();
    });
    replyResult(lastSent().payload.requestId); // cancelled — no `selected`
    await expect(pick).resolves.toBeNull();
  });

  it('ignores an IMAGE_UPLOAD_RESULT with a mismatched requestId', async () => {
    const { result } = renderHook(() => useImageUpload());
    let pick!: Promise<unknown>;
    act(() => {
      pick = result.current.open();
    });
    const sent = lastSent();
    replyResult('some-other-id', MODERATED);
    let settled = false;
    void pick.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    replyResult(sent.payload.requestId, MODERATED);
    await expect(pick).resolves.toEqual(MODERATED);
  });

  it('does NOT reject at the default ~30s timeout (upload is human-interactive)', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useImageUpload());
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
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(settled).toBe(false);
      replyResult(sent.payload.requestId, MODERATED);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await expect(pick).resolves.toEqual(MODERATED);
    } finally {
      vi.useRealTimers();
    }
  });
});
