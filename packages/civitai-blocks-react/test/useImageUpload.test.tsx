import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  BlockGenerationSourceImageInfo,
  BlockImageScanResult,
  BlockInitPayload,
  BlockPendingImageInfo,
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

  it('default (blocking) open() never sends asyncScan on the wire — byte-compat', () => {
    const { result } = renderHook(() => useImageUpload());
    act(() => {
      result.current.open().catch(() => {});
    });
    const sent = lastSent() as { payload: { requestId: string; asyncScan?: boolean } };
    expect(sent.payload.asyncScan).toBeUndefined();
    expect(Object.keys(sent.payload)).toEqual(['requestId']);
  });
});

/**
 * Non-blocking (asyncScan) display flow: open() early-resolves with a PENDING
 * handle on IMAGE_UPLOAD_RESULT, then scanStatus(handle) resolves the async
 * verdict streamed on the host→block IMAGE_SCAN_RESOLVED push (correlated by the
 * generated requestId + imageId). Drives the REAL IframeTransport via window
 * postMessage, mirroring the blocking suite above.
 */
describe('useImageUpload — asyncScan (non-blocking display)', () => {
  let postMessageMock: ReturnType<typeof vi.fn>;

  const PENDING = { status: 'pending', imageId: 4242, url: MODERATED.url } as const;

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
      payload: { requestId: string; asyncScan?: boolean; purpose?: string };
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

  function dispatchScan(requestId: string, imageId: number, result: BlockImageScanResult) {
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'IMAGE_SCAN_RESOLVED', payload: { requestId, imageId, result } },
          origin: PARENT_ORIGIN,
        }),
      );
    });
  }

  it("open() sends OPEN_IMAGE_UPLOAD {asyncScan:true} with no `purpose` (display byte-compat)", () => {
    const { result } = renderHook(() => useImageUpload({ asyncScan: true }));
    act(() => {
      result.current.open().catch(() => {});
    });
    const sent = lastSent();
    expect(sent.type).toBe('OPEN_IMAGE_UPLOAD');
    expect(sent.payload.asyncScan).toBe(true);
    expect(sent.payload.purpose).toBeUndefined();
    expect(Object.keys(sent.payload).sort()).toEqual(['asyncScan', 'requestId']);
  });

  it('open() early-resolves with the pending handle', async () => {
    const { result } = renderHook(() => useImageUpload({ asyncScan: true }));
    let pick!: Promise<BlockPendingImageInfo | null>;
    act(() => {
      pick = result.current.open();
    });
    replyResult(lastSent().payload.requestId, PENDING);
    await expect(pick).resolves.toEqual(PENDING);
  });

  it('scanStatus() resolves scanned when the verdict arrives AFTER the call', async () => {
    const { result } = renderHook(() => useImageUpload({ asyncScan: true }));
    let pick!: Promise<BlockPendingImageInfo | null>;
    act(() => {
      pick = result.current.open();
    });
    const requestId = lastSent().payload.requestId;
    replyResult(requestId, PENDING);
    const handle = (await pick)!;

    let verdict!: Promise<BlockImageScanResult>;
    act(() => {
      verdict = result.current.scanStatus!(handle);
    });
    // verdict streamed on a later tick
    dispatchScan(requestId, handle.imageId, { status: 'scanned', image: MODERATED });
    await expect(verdict).resolves.toEqual({ status: 'scanned', image: MODERATED });
  });

  it('scanStatus() resolves from the BUFFER when the verdict arrived BEFORE the call', async () => {
    const { result } = renderHook(() => useImageUpload({ asyncScan: true }));
    let pick!: Promise<BlockPendingImageInfo | null>;
    act(() => {
      pick = result.current.open();
    });
    const requestId = lastSent().payload.requestId;
    replyResult(requestId, PENDING);
    const handle = (await pick)!;

    // verdict lands before scanStatus is ever called → buffered by the hook
    dispatchScan(requestId, handle.imageId, { status: 'scanned', image: MODERATED });
    await expect(result.current.scanStatus!(handle)).resolves.toEqual({
      status: 'scanned',
      image: MODERATED,
    });
  });

  it('scanStatus() surfaces a blocked (terminal) verdict — no usable image', async () => {
    const { result } = renderHook(() => useImageUpload({ asyncScan: true }));
    let pick!: Promise<BlockPendingImageInfo | null>;
    act(() => {
      pick = result.current.open();
    });
    const requestId = lastSent().payload.requestId;
    replyResult(requestId, PENDING);
    const handle = (await pick)!;

    dispatchScan(requestId, handle.imageId, { status: 'blocked', reason: 'over the SFW ceiling' });
    const verdict = await result.current.scanStatus!(handle);
    expect(verdict).toEqual({ status: 'blocked', reason: 'over the SFW ceiling' });
    expect('image' in verdict).toBe(false);
  });

  it('scanStatus() surfaces a retryable error verdict', async () => {
    const { result } = renderHook(() => useImageUpload({ asyncScan: true }));
    let pick!: Promise<BlockPendingImageInfo | null>;
    act(() => {
      pick = result.current.open();
    });
    const requestId = lastSent().payload.requestId;
    replyResult(requestId, PENDING);
    const handle = (await pick)!;

    dispatchScan(requestId, handle.imageId, { status: 'error', message: 'poll timed out' });
    await expect(result.current.scanStatus!(handle)).resolves.toEqual({
      status: 'error',
      message: 'poll timed out',
    });
  });

  it('EVICTS a terminal verdict once consumed (bounded memory: L1)', async () => {
    // A long-lived block doing many uploads must not grow the internal scan map
    // unbounded. Once a TERMINAL verdict (scanned/blocked) has been handed to a
    // caller, its entry is dropped — a subsequent scanStatus() on the same handle
    // no longer finds it (the block never re-polls a terminal verdict anyway).
    const { result } = renderHook(() => useImageUpload({ asyncScan: true }));
    let pick!: Promise<BlockPendingImageInfo | null>;
    act(() => {
      pick = result.current.open();
    });
    const requestId = lastSent().payload.requestId;
    replyResult(requestId, PENDING);
    const handle = (await pick)!;

    dispatchScan(requestId, handle.imageId, { status: 'scanned', image: MODERATED });
    // First read gets the verdict…
    await expect(result.current.scanStatus!(handle)).resolves.toEqual({
      status: 'scanned',
      image: MODERATED,
    });
    // …and consuming it evicted the entry, so a second read no longer finds it.
    const again = await result.current.scanStatus!(handle);
    expect(again.status).toBe('error');
  });

  it('KEEPS a non-terminal (error) verdict entry — retry still works', async () => {
    // Contrast with eviction: a host-pushed `error` is retryable, so the entry is
    // NOT evicted and a re-call returns the (buffered) error rather than an
    // unknown-handle miss.
    const { result } = renderHook(() => useImageUpload({ asyncScan: true }));
    let pick!: Promise<BlockPendingImageInfo | null>;
    act(() => {
      pick = result.current.open();
    });
    const requestId = lastSent().payload.requestId;
    replyResult(requestId, PENDING);
    const handle = (await pick)!;

    dispatchScan(requestId, handle.imageId, { status: 'error', message: 'transient' });
    await expect(result.current.scanStatus!(handle)).resolves.toEqual({
      status: 'error',
      message: 'transient',
    });
    // Entry retained: a re-call still resolves to the same buffered error.
    await expect(result.current.scanStatus!(handle)).resolves.toEqual({
      status: 'error',
      message: 'transient',
    });
  });

  it('scanStatus() is re-callable: a late verdict after an error/timeout is picked up on retry', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useImageUpload({ asyncScan: true }));
      let pick!: Promise<BlockPendingImageInfo | null>;
      act(() => {
        pick = result.current.open();
      });
      const requestId = lastSent().payload.requestId;
      replyResult(requestId, PENDING);
      const handle = (await pick)!;

      // First call: no verdict yet → the generous hook backstop resolves 'error'.
      let first!: Promise<BlockImageScanResult>;
      act(() => {
        first = result.current.scanStatus!(handle);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(11 * 60_000); // past SCAN_STATUS_TIMEOUT_MS (10m)
      });
      await expect(first).resolves.toEqual({ status: 'error', message: 'scan status timed out' });

      // The real verdict arrives late; a retry returns it from the buffer.
      dispatchScan(requestId, handle.imageId, { status: 'scanned', image: MODERATED });
      await expect(result.current.scanStatus!(handle)).resolves.toEqual({
        status: 'scanned',
        image: MODERATED,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a forged/mismatched-requestId IMAGE_SCAN_RESOLVED (correlation guard)', async () => {
    const { result } = renderHook(() => useImageUpload({ asyncScan: true }));
    let pick!: Promise<BlockPendingImageInfo | null>;
    act(() => {
      pick = result.current.open();
    });
    const requestId = lastSent().payload.requestId;
    replyResult(requestId, PENDING);
    const handle = (await pick)!;

    let verdict!: Promise<BlockImageScanResult>;
    act(() => {
      verdict = result.current.scanStatus!(handle);
    });
    // Wrong requestId (right imageId): must be ignored — verdict stays pending.
    dispatchScan('forged-id', handle.imageId, { status: 'scanned', image: MODERATED });
    let settled = false;
    void verdict.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    // The genuine verdict (matching requestId) resolves it.
    dispatchScan(requestId, handle.imageId, { status: 'blocked', reason: 'nope' });
    await expect(verdict).resolves.toEqual({ status: 'blocked', reason: 'nope' });
  });

  it('open() returns null when the user dismissed (no `selected`)', async () => {
    const { result } = renderHook(() => useImageUpload({ asyncScan: true }));
    let pick!: Promise<BlockPendingImageInfo | null>;
    act(() => {
      pick = result.current.open();
    });
    replyResult(lastSent().payload.requestId); // dismissed
    await expect(pick).resolves.toBeNull();
  });

  it('compat: an OLD host that ignored asyncScan (returns a MODERATED image) → immediately-scanned', async () => {
    const { result } = renderHook(() => useImageUpload({ asyncScan: true }));
    let pick!: Promise<BlockPendingImageInfo | null>;
    act(() => {
      pick = result.current.open();
    });
    // Old host blocking-resolves the moderated image (no status:'pending').
    replyResult(lastSent().payload.requestId, MODERATED);
    const handle = (await pick)!;
    // The hook wrapped it in a pending-shaped handle carrying the same imageId/url…
    expect(handle).toEqual({ status: 'pending', imageId: MODERATED.imageId, url: MODERATED.url });
    // …and pre-buffered a scanned verdict, so scanStatus resolves with NO push.
    await expect(result.current.scanStatus!(handle)).resolves.toEqual({
      status: 'scanned',
      image: MODERATED,
    });
  });

  it('scanStatus() on an unknown/foreign handle resolves a retryable error (no hang)', async () => {
    const { result } = renderHook(() => useImageUpload({ asyncScan: true }));
    const stray: BlockPendingImageInfo = { status: 'pending', imageId: 999, url: 'https://x/y.jpg' };
    await expect(result.current.scanStatus!(stray)).resolves.toEqual({
      status: 'error',
      message: 'unknown or expired upload handle',
    });
  });
});
