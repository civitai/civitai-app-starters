import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useCheckpointPicker } from '../src/hooks/useCheckpointPicker.js';
import { getTransport } from '../src/internal/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';

/**
 * Coverage for the SET_USER_CHECKPOINT → USER_CHECKPOINT_SET mock backend in
 * `createMockHost`, exercised against the REAL `useCheckpointPicker` hook +
 * transport. Before this handler existed, `persist()` hung to its 30s timeout
 * under the mock host (the harness never answered the message).
 */

const ORIGIN = window.location.origin;

describe('createMockHost — SET_USER_CHECKPOINT', () => {
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

  async function ready() {
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
  }

  it('persist(versionId) resolves (does not hang) under the mock host', async () => {
    host = createMockHost({});
    uninstall = host.install();
    const { result } = renderHook(() => useCheckpointPicker());
    await ready();

    await expect(result.current.persist(4242)).resolves.toBeUndefined();
  });

  it('persist(null) resolves (clears the override)', async () => {
    host = createMockHost({});
    uninstall = host.install();
    const { result } = renderHook(() => useCheckpointPicker());
    await ready();

    await expect(result.current.persist(null)).resolves.toBeUndefined();
  });
});
