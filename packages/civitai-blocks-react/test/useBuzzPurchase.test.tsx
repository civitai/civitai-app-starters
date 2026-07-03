import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useBuzzPurchase } from '../src/hooks/useBuzzPurchase.js';
import { getTransport } from '../src/internal/singleton.js';
import { resetTransport } from '../src/testing.js';

/**
 * OPEN_BUZZ_PURCHASE → BUZZ_PURCHASE_RESULT request/reply hook (the
 * insufficient-budget recovery path for useBuzzWorkflow). Mirrors the
 * useResourcePicker scaffold: drive the iframe transport via postMessage, assert
 * the OUTBOUND message + resolution on the matching reply (by requestId).
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

describe('useBuzzPurchase', () => {
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
      payload: { requestId: string; suggestedAmount?: number };
    };
  }

  function replyResult(requestId: string, payload: Record<string, unknown>) {
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'BUZZ_PURCHASE_RESULT', payload: { requestId, ...payload } },
          origin: PARENT_ORIGIN,
        }),
      );
    });
  }

  it('openPurchaseModal() sends OPEN_BUZZ_PURCHASE carrying the suggestedAmount', () => {
    const { result } = renderHook(() => useBuzzPurchase());
    act(() => {
      result.current.openPurchaseModal(500).catch(() => {});
    });
    const sent = lastSent();
    expect(sent.type).toBe('OPEN_BUZZ_PURCHASE');
    expect(sent.payload.suggestedAmount).toBe(500);
    expect(typeof sent.payload.requestId).toBe('string');
  });

  it('resolves with { purchased, newBalance } on a matching BUZZ_PURCHASE_RESULT', async () => {
    const { result } = renderHook(() => useBuzzPurchase());
    let pending!: Promise<{ purchased: boolean; newBalance?: number }>;
    act(() => {
      pending = result.current.openPurchaseModal(1000);
    });
    const sent = lastSent();
    replyResult(sent.payload.requestId, { purchased: true, newBalance: 4200 });
    await expect(pending).resolves.toEqual({ purchased: true, newBalance: 4200 });
  });

  it('resolves purchased:false (user closed without buying) — newBalance omitted', async () => {
    const { result } = renderHook(() => useBuzzPurchase());
    let pending!: Promise<{ purchased: boolean; newBalance?: number }>;
    act(() => {
      pending = result.current.openPurchaseModal();
    });
    const sent = lastSent();
    // Called with no amount → suggestedAmount rides as undefined.
    expect(sent.payload.suggestedAmount).toBeUndefined();
    replyResult(sent.payload.requestId, { purchased: false });
    await expect(pending).resolves.toEqual({ purchased: false, newBalance: undefined });
  });

  it('ignores a BUZZ_PURCHASE_RESULT with a mismatched requestId', async () => {
    const { result } = renderHook(() => useBuzzPurchase());
    let pending!: Promise<{ purchased: boolean; newBalance?: number }>;
    act(() => {
      pending = result.current.openPurchaseModal(100);
    });
    const sent = lastSent();

    replyResult('some-other-id', { purchased: true, newBalance: 999 });
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    replyResult(sent.payload.requestId, { purchased: false });
    await expect(pending).resolves.toEqual({ purchased: false, newBalance: undefined });
  });
});
