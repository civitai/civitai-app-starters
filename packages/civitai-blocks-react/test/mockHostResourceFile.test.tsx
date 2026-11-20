import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockResourceFile } from '@civitai/app-sdk/blocks';

import { ResourceFileError, useResourceFile } from '../src/hooks/useResourceFile.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';

/**
 * `createMockHost`'s `GET_RESOURCE_FILE` handler (civitai/civitai-app-starters#664,
 * phase 2), driven through the REAL hook and transport: the canned reply, the
 * `resourceFile` override, and the `resourceFileError` override.
 *
 * What this cannot prove: the real host's file choice, caps and access gates
 * live in civitai. The mock returns whatever it was configured with.
 */

const ORIGIN = window.location.origin;

const CUSTOM_FILE: BlockResourceFile = {
  meta: {
    modelId: 7001,
    modelVersionId: 7002,
    fileId: 7003,
    fileName: 'pack.zip',
    modelName: 'Two graphs',
    versionName: 'v1',
    creatorUsername: null,
  },
  entries: [
    { path: 'a.json', format: 'ui', graph: { nodes: [{ id: 1 }], links: [] } },
    { path: 'b.json', format: 'unknown', graph: { hello: 'world' } },
  ],
  truncated: true,
};

describe('createMockHost — GET_RESOURCE_FILE', () => {
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

  it('answers with a canned file by default: one UI-format graph, not truncated', async () => {
    uninstall = createMockHost({}).install();
    const { result } = renderHook(() => useResourceFile(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    const file = result.current.file!;
    expect(file).not.toBeNull();
    expect(file.truncated).toBe(false);
    expect(file.entries).toHaveLength(1);
    expect(file.entries[0]!.format).toBe('ui');
    expect(file.entries[0]!.path).toBe(file.meta.fileName);
    // A UI-format graph is the one with a `nodes` array — the shape the host's
    // detector reports as `ui`.
    expect(Array.isArray((file.entries[0]!.graph as { nodes?: unknown }).nodes)).toBe(true);
    expect(Number.isInteger(file.meta.fileId) && file.meta.fileId > 0).toBe(true);
  });

  it('answers with the configured `resourceFile`', async () => {
    uninstall = createMockHost({ resourceFile: CUSTOM_FILE }).install();
    const { result } = renderHook(() => useResourceFile(7002, 7003));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.file).toEqual(CUSTOM_FILE);
  });

  it('answers with the `resourceFileError` code instead of a file, even when a file is configured', async () => {
    uninstall = createMockHost({ resourceFile: CUSTOM_FILE, resourceFileError: 'rate-limited' }).install();
    const { result } = renderHook(() => useResourceFile(7002));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.file).toBeNull();
    expect(result.current.error).toBeInstanceOf(ResourceFileError);
    expect((result.current.error as ResourceFileError).code).toBe('rate-limited');
  });

  it('setScenario arms an error, swaps the file, and clears the error again', async () => {
    const host = createMockHost({});
    uninstall = host.install();
    const { result } = renderHook(() => useResourceFile(7002));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.file).not.toEqual(CUSTOM_FILE);

    host.setScenario({ resourceFileError: 'busy' });
    act(() => result.current.refetch());
    await waitFor(() => expect((result.current.error as ResourceFileError | null)?.code).toBe('busy'));

    // `undefined` CLEARS the forced error (the key is present in the patch).
    host.setScenario({ resourceFileError: undefined, resourceFile: CUSTOM_FILE });
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.file).toEqual(CUSTOM_FILE));
    expect(result.current.error).toBeNull();
  });
});
