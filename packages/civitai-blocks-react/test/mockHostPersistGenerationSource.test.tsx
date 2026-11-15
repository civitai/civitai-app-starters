import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockPersistedGenerationSource } from '@civitai/app-sdk/blocks';

import { usePersistGenerationSource } from '../src/hooks/usePersistGenerationSource.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';

/**
 * `createMockHost`'s `PERSIST_GENERATION_SOURCE` handler (HQ task
 * app_blocks_sdk_x7dw), driven through the REAL hook and transport: the canned
 * `ready: true` reply, a configured `ready: false` source, and the forced error.
 *
 * What this cannot prove: the real host's ownership check, its save, its scan
 * wait, and the `source-scan-pending` refusal of a generation using a pending
 * source all live in civitai. The mock returns whatever it was configured with.
 */

const ORIGIN = window.location.origin;

const PENDING: BlockPersistedGenerationSource = {
  url: 'https://image.civitai.com/x/original=true/pending.jpeg',
  width: 896,
  height: 1152,
  imageId: 7401,
  ready: false,
};

describe('createMockHost — PERSIST_GENERATION_SOURCE', () => {
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = undefined;
    resetTransport();
    vi.restoreAllMocks();
  });

  it('answers with a canned, scanned (`ready: true`) source by default', async () => {
    uninstall = createMockHost({}).install();
    const { result } = renderHook(() => usePersistGenerationSource());
    const src = await result.current.persist({ workflowId: 'wf_mock_1', imageIndex: 0 });

    expect(src.ready).toBe(true);
    expect(src.url).toMatch(/^https:\/\//);
    expect(Number.isInteger(src.width) && src.width > 0).toBe(true);
    expect(Number.isInteger(src.height) && src.height > 0).toBe(true);
    expect(Number.isInteger(src.imageId) && src.imageId > 0).toBe(true);
    // Exactly the contract's five fields.
    expect(Object.keys(src).sort()).toEqual(['height', 'imageId', 'ready', 'url', 'width']);
  });

  it('answers with a configured `ready: false` source (scan still pending)', async () => {
    uninstall = createMockHost({ persistedGenerationSource: PENDING }).install();
    const { result } = renderHook(() => usePersistGenerationSource());
    await expect(result.current.persist({ workflowId: 'wf_mock_1', imageIndex: 3 })).resolves.toEqual(PENDING);
  });

  it('rejects with the `persistGenerationSourceError` message, even when a source is configured', async () => {
    uninstall = createMockHost({
      persistedGenerationSource: PENDING,
      persistGenerationSourceError: 'iframe hosts do not persist generation sources',
    }).install();
    const { result } = renderHook(() => usePersistGenerationSource());
    await expect(result.current.persist({ workflowId: 'wf_mock_1', imageIndex: 0 })).rejects.toThrow(
      /^iframe hosts do not persist generation sources$/,
    );
  });

  it('`persistGenerationSourceError: true` rejects with a default, non-empty message', async () => {
    uninstall = createMockHost({ persistGenerationSourceError: true }).install();
    const { result } = renderHook(() => usePersistGenerationSource());
    const err = await result.current
      .persist({ workflowId: 'wf_mock_1', imageIndex: 0 })
      .then(() => null, (e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect(err!.message.length).toBeGreaterThan(0);
  });

  it('setScenario arms an error, swaps the source, and clears the error again', async () => {
    const host = createMockHost({});
    uninstall = host.install();
    const { result } = renderHook(() => usePersistGenerationSource());

    const first = await result.current.persist({ workflowId: 'wf_mock_1', imageIndex: 0 });
    expect(first.ready).toBe(true);

    host.setScenario({ persistGenerationSourceError: 'busy' });
    await expect(result.current.persist({ workflowId: 'wf_mock_1', imageIndex: 0 })).rejects.toThrow(/^busy$/);

    // `undefined` CLEARS the forced error (the key is present in the patch).
    host.setScenario({ persistGenerationSourceError: undefined, persistedGenerationSource: PENDING });
    await expect(result.current.persist({ workflowId: 'wf_mock_1', imageIndex: 0 })).resolves.toEqual(PENDING);
  });
});
