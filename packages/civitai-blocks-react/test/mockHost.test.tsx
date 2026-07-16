import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppWorkflow } from '@civitai/app-sdk/blocks';

import { useBlockContext } from '../src/hooks/useBlockContext.js';
import { useBuzzWorkflow } from '../src/hooks/useBuzzWorkflow.js';
import { useResourcePicker } from '../src/hooks/useResourcePicker.js';
import { useRequestConsent } from '../src/hooks/useRequestConsent.js';
import { useBlockToken } from '../src/hooks/useBlockToken.js';
import { useAppWorkflows } from '../src/hooks/useAppWorkflows.js';
import { getTransport } from '../src/internal/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';

/**
 * Exercises `createMockHost` end-to-end against the REAL SDK hooks + transport.
 * The mock host fires its replies from `window.location.origin`, so the
 * transport's allowlist must include that origin (mirrors the dev-harness
 * requirement). Mirrors the useBuzzWorkflow / useResourcePicker scaffolds.
 */

// The mock host fires replies from window.location.origin, so the transport's
// allowlist must include it (mirrors the dev-harness requirement). Read it
// dynamically so the test isn't coupled to the happy-dom default.
const ORIGIN = window.location.origin;

const TEXT_BODY = {
  kind: 'textToImage' as const,
  modelId: 7,
  modelVersionId: 99,
  params: { prompt: 'cat' },
};

describe('createMockHost', () => {
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    // The transport must accept messages from the mock host's origin.
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });

  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = undefined;
    resetTransport();
  });

  it('delivers BLOCK_INIT with the configured viewer + page context', async () => {
    uninstall = createMockHost({ viewer: { id: 42, username: 'tester', status: 'active' } }).install();
    const { result } = renderHook(() => useBlockContext());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.context?.slotId).toBe('app.page');
    expect(result.current.viewer).toEqual({ id: 42, username: 'tester', status: 'active' });
  });

  it('delivers an anon BLOCK_INIT when viewer is null', async () => {
    uninstall = createMockHost({ viewer: null }).install();
    const { result } = renderHook(() => useBlockContext());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.viewer).toBeNull();
  });

  it('estimate→submit→poll resolves to a succeeded snapshot with image + cost', async () => {
    uninstall = createMockHost({ pollsUntilDone: 2, cost: 12 }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    // Wait for init so the transport flushes outbound to the mock host.
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    await act(async () => {
      await result.current.estimate(TEXT_BODY);
    });
    await waitFor(() => expect(result.current.status).toBe('confirming'));
    expect(result.current.result?.cost?.total).toBe(12);

    await act(async () => {
      await result.current.submit(TEXT_BODY);
    });
    await waitFor(() => expect(result.current.status).toBe('polling'));

    // First poll → processing (pollsUntilDone=2), second → succeeded.
    await act(async () => {
      await result.current.poll(result.current.result!.workflowId);
    });
    expect(result.current.status).toBe('polling');

    await act(async () => {
      await result.current.poll(result.current.result!.workflowId);
    });
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current.result?.cost?.total).toBe(12);
    expect(result.current.result?.imageUrls?.[0]).toContain('placehold.co');
  });

  it('failMode "all" returns an insufficient-Buzz failed snapshot on submit', async () => {
    uninstall = createMockHost({ failMode: 'all' }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let snap!: { status: string; error?: string };
    await act(async () => {
      snap = await result.current.submit(TEXT_BODY);
    });
    // A `failed` snapshot is terminal → status 'done', error carried on the result.
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(snap.status).toBe('failed');
    expect(result.current.result?.error).toMatch(/insufficient buzz/i);
  });

  it('OPEN_RESOURCE_PICKER returns the canned LoRA pick', async () => {
    uninstall = createMockHost().install();
    const { result } = renderHook(() => useResourcePicker());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let picked: unknown;
    await act(async () => {
      picked = await result.current.open({ resourceType: 'LORA' });
    });
    expect(picked).toMatchObject({ modelType: 'LORA', baseModel: 'SDXL 1.0' });
  });

  it('OPEN_RESOURCE_PICKER resolves null when the canned pick is dismissed', async () => {
    uninstall = createMockHost({ cannedPicks: { LORA: null } }).install();
    const { result } = renderHook(() => useResourcePicker());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let picked: unknown = 'unset';
    await act(async () => {
      picked = await result.current.open({ resourceType: 'LORA' });
    });
    expect(picked).toBeNull();
  });

  it('consent round-trip: REQUEST_CONSENT grants the scope + pushes a refreshed token', async () => {
    uninstall = createMockHost({ consentGranted: false }).install();
    const tokenHook = renderHook(() => useBlockToken());
    const consentHook = renderHook(() => useRequestConsent());

    // First token is minted WITHOUT the budgeted scope. useBlockToken spreads
    // the token fields directly (scopes/buzzBudget/raw/expiresAt + refresh()).
    await waitFor(() => expect(tokenHook.result.current.raw).toBeTruthy());
    expect(tokenHook.result.current.scopes).not.toContain('ai:write:budgeted');

    act(() => {
      consentHook.result.current.requestConsent({ scopes: ['ai:write:budgeted'] });
    });

    // The mock host grants + pushes TOKEN_REFRESH carrying the scope.
    await waitFor(() => expect(tokenHook.result.current.scopes).toContain('ai:write:budgeted'));
    expect(tokenHook.result.current.buzzBudget).toBe(200);
  });

  it('uninstall restores window.parent and is idempotent', async () => {
    const before = window.parent;
    const host = createMockHost();
    const teardown = host.install();
    expect(window.parent).not.toBe(before);
    teardown();
    teardown(); // idempotent
    expect(window.parent).toBe(before);
  });

  const APP_WFS: AppWorkflow[] = [
    {
      workflowId: 'wf_app_2',
      status: 'succeeded',
      images: [{ url: 'https://image.civitai.com/x/a.jpeg', width: 1024, height: 1024, nsfwLevel: 1 }],
      cost: 12,
      createdAt: '2026-07-14T12:00:00.000Z',
    },
    { workflowId: 'wf_app_1', status: 'processing', images: [], cost: null, createdAt: '2026-07-14T11:58:00.000Z' },
  ];

  it('QUERY_APP_WORKFLOWS returns the canned subqueue; CANCEL_APP_WORKFLOW flips + persists the row', async () => {
    uninstall = createMockHost({ appWorkflows: { workflows: APP_WFS, cursor: 'pg2' } }).install();
    const { result } = renderHook(() => useAppWorkflows());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.workflows).toEqual(APP_WFS);
    expect(result.current.cursor).toBe('pg2');
    expect(result.current.error).toBeNull();

    await act(async () => {
      await result.current.cancel('wf_app_1');
    });
    // Optimistically flipped in the hook.
    expect(result.current.workflows.find((w) => w.workflowId === 'wf_app_1')?.status).toBe('canceled');

    // …and the mock host persisted it: a refetch reflects the canceled status.
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.workflows.find((w) => w.workflowId === 'wf_app_1')?.status).toBe('canceled');
  });

  it('appWorkflowsError forces BOTH bridges to the error variant (read errors, cancel rejects)', async () => {
    uninstall = createMockHost({ appWorkflowsError: 'block lacks scope' }).install();
    const { result } = renderHook(() => useAppWorkflows());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('block lacks scope');

    await expect(result.current.cancel('wf_app_1')).rejects.toThrow('block lacks scope');
  });
});
