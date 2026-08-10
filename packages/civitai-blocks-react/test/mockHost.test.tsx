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

  /**
   * The refusal path. Until `consentGrantable` existed the mock ALWAYS granted,
   * so a block author could not reach a `CONSENT_UNAVAILABLE` handler in
   * `pnpm dev` at all — and "untestable locally" is exactly how the
   * contradictory-messages bug this message fixes reached production.
   *
   * Subscribes through the REAL transport (`getTransport().onMessage`), which is
   * how a block consumes it, so these assert delivery end-to-end and not just
   * that the host called `dispatchToBlock`.
   */
  describe('consentGrantable: false — the un-grantable refusal', () => {
    it('pushes CONSENT_UNAVAILABLE naming the refused scopes, and grants NO token', async () => {
      uninstall = createMockHost({ consentGranted: false, consentGrantable: false }).install();
      const tokenHook = renderHook(() => useBlockToken());
      const consentHook = renderHook(() => useRequestConsent());
      await waitFor(() => expect(tokenHook.result.current.raw).toBeTruthy());
      const rawBefore = tokenHook.result.current.raw;

      const received: unknown[] = [];
      const off = getTransport().onMessage('CONSENT_UNAVAILABLE', (p) => received.push(p));

      act(() => {
        consentHook.result.current.requestConsent({
          scopes: ['ai:write:budgeted', 'buzz:read:self'],
        });
      });

      await waitFor(() => expect(received).toHaveLength(1));
      expect(received[0]).toEqual({
        reason: 'ungrantable',
        scopes: ['ai:write:budgeted', 'buzz:read:self'],
      });
      // The refusal is not a grant: no scope appeared and no new token was minted.
      expect(tokenHook.result.current.scopes).not.toContain('ai:write:budgeted');
      expect(tokenHook.result.current.raw).toBe(rawBefore);
      off();
    });

    it('🔴 still refuses — with scopes: [] — when every requested name is unknown', async () => {
      // The trap. The un-grantable set is the TRIGGER as well as the payload, so
      // filtering the trigger by the vocabulary would produce NO message here —
      // the exact silent dead end this whole path removes. The refusal is the
      // signal; the names are advisory.
      uninstall = createMockHost({ consentGranted: false, consentGrantable: false }).install();
      renderHook(() => useBlockContext());
      const consentHook = renderHook(() => useRequestConsent());
      await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

      const received: unknown[] = [];
      const off = getTransport().onMessage('CONSENT_UNAVAILABLE', (p) => received.push(p));

      act(() => {
        consentHook.result.current.requestConsent({
          scopes: ['<img src=x onerror=alert(1)>', 'not:a:real:scope', 'A'.repeat(5000)],
        });
      });

      await waitFor(() => expect(received).toHaveLength(1));
      expect(received[0]).toEqual({ reason: 'ungrantable', scopes: [] });
      off();
    });

    it('stays SILENT when the block re-requests a scope it ALREADY holds', async () => {
      // The benign case. A refusal here would render a permission-unavailable
      // state over a permission that actually works.
      uninstall = createMockHost({ consentGranted: true, consentGrantable: false }).install();
      const tokenHook = renderHook(() => useBlockToken());
      const consentHook = renderHook(() => useRequestConsent());
      await waitFor(() =>
        expect(tokenHook.result.current.scopes).toContain('ai:write:budgeted'),
      );

      const received: unknown[] = [];
      const off = getTransport().onMessage('CONSENT_UNAVAILABLE', (p) => received.push(p));

      act(() => {
        consentHook.result.current.requestConsent({ scopes: ['ai:write:budgeted'] });
      });
      // POSITIVE CONTROL for the zero below: an un-grantable scope on the SAME
      // host + SAME listener DOES arrive, so `received.length === 0` above is a
      // real silence and not a listener wired to nothing.
      act(() => {
        consentHook.result.current.requestConsent({ scopes: ['apps:storage:read'] });
      });
      await waitFor(() => expect(received).toHaveLength(1));
      expect(received[0]).toEqual({ reason: 'ungrantable', scopes: ['apps:storage:read'] });
      off();
    });

    it('stays SILENT when REQUEST_CONSENT carries no scopes hint', async () => {
      // With no hint the host cannot tell "already granted" from "clamped", and
      // guessing is what produced the contradictory two-message screen.
      uninstall = createMockHost({ consentGranted: false, consentGrantable: false }).install();
      const consentHook = renderHook(() => useRequestConsent());
      await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

      const received: unknown[] = [];
      const off = getTransport().onMessage('CONSENT_UNAVAILABLE', (p) => received.push(p));

      act(() => {
        consentHook.result.current.requestConsent();
      });
      act(() => {
        consentHook.result.current.requestConsent({});
      });
      // Positive control (same reason as above).
      act(() => {
        consentHook.result.current.requestConsent({ scopes: ['buzz:read:self'] });
      });
      await waitFor(() => expect(received).toHaveLength(1));
      expect(received[0]).toEqual({ reason: 'ungrantable', scopes: ['buzz:read:self'] });
      off();
    });

    it('DEFAULT (consentGrantable omitted) still grants and pushes NO refusal', async () => {
      // Purely additive: the existing lazy-consent round-trip is untouched for
      // every caller that does not opt in.
      uninstall = createMockHost({ consentGranted: false }).install();
      const tokenHook = renderHook(() => useBlockToken());
      const consentHook = renderHook(() => useRequestConsent());
      await waitFor(() => expect(tokenHook.result.current.raw).toBeTruthy());

      const received: unknown[] = [];
      const off = getTransport().onMessage('CONSENT_UNAVAILABLE', (p) => received.push(p));

      act(() => {
        consentHook.result.current.requestConsent({ scopes: ['ai:write:budgeted'] });
      });
      await waitFor(() => expect(tokenHook.result.current.scopes).toContain('ai:write:budgeted'));
      expect(received).toEqual([]);
      off();
    });

    it('setScenario({ consentGrantable: false }) flips it live, without re-installing', async () => {
      // A harness UI has to be able to toggle "this preview can never grant"
      // mid-session — re-installing would tear down the block's mounted state,
      // which is the state you are trying to observe.
      const host = createMockHost({ consentGranted: false });
      uninstall = host.install();
      const consentHook = renderHook(() => useRequestConsent());
      await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

      const received: unknown[] = [];
      const off = getTransport().onMessage('CONSENT_UNAVAILABLE', (p) => received.push(p));

      host.setScenario({ consentGrantable: false });
      act(() => {
        consentHook.result.current.requestConsent({ scopes: ['apps:storage:write'] });
      });
      await waitFor(() => expect(received).toHaveLength(1));
      expect(received[0]).toEqual({ reason: 'ungrantable', scopes: ['apps:storage:write'] });
      off();
    });
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
