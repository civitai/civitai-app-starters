import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelSlotContext } from '@civitai/app-sdk/blocks';

import { useCheckpointPicker } from '../src/hooks/useCheckpointPicker.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';

/**
 * Coverage for the SET_USER_CHECKPOINT → USER_CHECKPOINT_SET mock backend in
 * `createMockHost`, exercised against the REAL `useCheckpointPicker` hook +
 * transport. Before this handler existed, `persist()` hung to its 30s timeout
 * under the mock host (the harness never answered the message).
 *
 * The answer depends on the slot, as it does in production: the page host
 * refuses every request, the model-slot host persists. The page strings below
 * are civitai's own (`PageBlockHost.tsx`), typed out here on purpose — a test
 * that imported the constant could not see it change.
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

type Wire = { type?: string; payload?: Record<string, unknown> };

describe('createMockHost — SET_USER_CHECKPOINT', () => {
  let host: ReturnType<typeof createMockHost> | undefined;
  let uninstall: (() => void) | undefined;
  let inbound: Wire[];
  let listener: (e: MessageEvent) => void;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
    inbound = [];
    listener = (e) => inbound.push(e.data as Wire);
    window.addEventListener('message', listener);
  });
  afterEach(() => {
    window.removeEventListener('message', listener);
    cleanup();
    uninstall?.();
    uninstall = host = undefined;
    resetTransport();
  });

  async function ready() {
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
  }

  /** The `USER_CHECKPOINT_SET` payloads the host sent, minus the generated id. */
  function checkpointReplies() {
    return inbound
      .filter((m) => m.type === 'USER_CHECKPOINT_SET')
      .map((m) => {
        const { requestId, ...rest } = m.payload ?? {};
        expect(typeof requestId).toBe('string');
        return rest;
      });
  }

  describe('on a model slot', () => {
    it('persist(versionId) resolves (does not hang) under the mock host', async () => {
      host = createMockHost({ context: MODEL_SLOT });
      uninstall = host.install();
      const { result } = renderHook(() => useCheckpointPicker());
      await ready();

      await expect(result.current.persist(4242)).resolves.toBeUndefined();
      expect(checkpointReplies()).toEqual([{ ok: true }]);
    });

    it('persist(null) resolves (clears the override)', async () => {
      host = createMockHost({ context: MODEL_SLOT });
      uninstall = host.install();
      const { result } = renderHook(() => useCheckpointPicker());
      await ready();

      await expect(result.current.persist(null)).resolves.toBeUndefined();
      expect(checkpointReplies()).toEqual([{ ok: true }]);
    });

    it('a versionId that is neither a number nor null is refused as bad input', async () => {
      host = createMockHost({ context: MODEL_SLOT });
      uninstall = host.install();
      renderHook(() => useCheckpointPicker());
      await ready();

      window.parent.postMessage(
        { type: 'SET_USER_CHECKPOINT', payload: { requestId: 'r-bad', versionId: 'nope' } },
        ORIGIN,
      );
      await waitFor(() => expect(checkpointReplies()).toHaveLength(1));
      expect(checkpointReplies()).toEqual([
        { ok: false, error: 'versionId must be a number or null' },
      ]);
    });
  });

  describe('on a page — refused, as the page host refuses it', () => {
    it('the DEFAULT context is a page: persist(versionId) rejects with the host error', async () => {
      host = createMockHost({});
      uninstall = host.install();
      const { result } = renderHook(() => useCheckpointPicker());
      await ready();

      await expect(result.current.persist(4242)).rejects.toThrow(
        'page blocks cannot persist a checkpoint override (no model binding)',
      );
      expect(checkpointReplies()).toEqual([
        {
          ok: false,
          error: 'page blocks cannot persist a checkpoint override (no model binding)',
        },
      ]);
    });

    it('persist(null) is refused too — clearing is a write the page cannot make', async () => {
      host = createMockHost({});
      uninstall = host.install();
      const { result } = renderHook(() => useCheckpointPicker());
      await ready();

      await expect(result.current.persist(null)).rejects.toThrow(
        'page blocks cannot persist a checkpoint override (no model binding)',
      );
    });

    it('an explicit page context is refused the same way', async () => {
      host = createMockHost({
        context: { slotId: 'app.page', slug: 'my-app', subPath: 'a/b', viewerUserId: 7 },
      });
      uninstall = host.install();
      const { result } = renderHook(() => useCheckpointPicker());
      await ready();

      await expect(result.current.persist(4242)).rejects.toThrow(
        'page blocks cannot persist a checkpoint override (no model binding)',
      );
    });

    it('a malformed versionId gets the PAGE refusal, not the bad-input one', async () => {
      // The page host does not read `versionId` at all, so the model-slot
      // host's `versionId must be a number or null` never appears on a page.
      host = createMockHost({});
      uninstall = host.install();
      renderHook(() => useCheckpointPicker());
      await ready();

      window.parent.postMessage(
        { type: 'SET_USER_CHECKPOINT', payload: { requestId: 'r-bad', versionId: 'nope' } },
        ORIGIN,
      );
      await waitFor(() => expect(checkpointReplies()).toHaveLength(1));
      expect(checkpointReplies()).toEqual([
        {
          ok: false,
          error: 'page blocks cannot persist a checkpoint override (no model binding)',
        },
      ]);
    });
  });
});

describe('createMockHost — a type outside the protocol', () => {
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = undefined;
    resetTransport();
  });

  it('gets no reply even with a requestId, as on the real host', async () => {
    // INVARIANT GUARD, green before and after this file's change. The real
    // host's `unsupported on this host` reply is built only for a request type
    // its inventory declares; an undeclared type gets nothing, so the mock
    // sending one would invent a reply production does not send.
    const inbound: Wire[] = [];
    const listener = (e: MessageEvent) => inbound.push(e.data as Wire);
    window.addEventListener('message', listener);
    try {
      uninstall = createMockHost({ context: MODEL_SLOT }).install();
      await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
      const before = inbound.length;

      window.parent.postMessage(
        { type: 'NOT_A_PROTOCOL_MESSAGE', payload: { requestId: 'r-unknown' } },
        ORIGIN,
      );
      // POSITIVE CONTROL, posted AFTER it: a declared request is answered, so
      // the silence above is the host's decision and not a dead harness.
      window.parent.postMessage(
        { type: 'SET_USER_CHECKPOINT', payload: { requestId: 'r-known', versionId: 1 } },
        ORIGIN,
      );
      await waitFor(() =>
        expect(inbound.some((m) => m.payload?.requestId === 'r-known')).toBe(true),
      );

      expect(inbound.slice(before).map((m) => [m.type, m.payload?.requestId])).toEqual([
        ['USER_CHECKPOINT_SET', 'r-known'],
      ]);
    } finally {
      window.removeEventListener('message', listener);
    }
  });
});
