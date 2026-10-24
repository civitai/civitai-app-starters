/**
 * Using ANY public hook connects the block to its host — at MOUNT, with no user
 * action.
 *
 * 🔴 THE BUG THIS PINS. The host gives an iframe app 10 s to answer its
 * handshake, then shows "This app didn't load in time", auto-retries twice and
 * gives up. The answer — `BLOCK_HELLO` on construction, `BLOCK_READY` on the
 * first valid `BLOCK_INIT` — is sent by the `IframeTransport` CONSTRUCTOR, and
 * the transport is a lazy singleton: nothing is sent until something calls
 * `getTransport()`. `useBlockContext` calls it during render, so any app using
 * it connected. `useBuzzWorkflow` (and every other request-only hook) called it
 * only inside its callbacks — so an app whose only SDK use was
 * `useBuzzWorkflow` rendered fine, posted ZERO messages, and was torn down by
 * the host before anyone could click anything. `bootSkeleton` hides the cover
 * but does not lift that deadline.
 *
 * 🔴 THE TEST NEVER CALLS `getTransport()` ITSELF BEFORE RENDER. That is the
 * whole point: the only thing allowed to construct the transport is the hook
 * under test. The allowlist arrives through the build-time env var, exactly as
 * in a production block, so no explicit construction is needed.
 *
 * 🔴 THE HOOK SET IS A LEDGER, NOT A SAMPLE. `CASES` must cover EVERY `use*`
 * export of `src/index.ts` — the first test fails when a hook is exported
 * without an entry here (set grows) or an entry outlives its hook (set
 * shrinks). A new hook therefore cannot ship without being shown to connect.
 */
import { cleanup, render, waitFor } from '@testing-library/react';
import { createRef, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import * as entry from '../src/index.js';
import { resetTransport } from '../src/testing.js';

const PARENT_ORIGIN = 'https://civitai.com';

/** Calls one hook with whatever arguments it requires, discarding the result. */
type HookCall = () => unknown;

const CASES: Record<string, HookCall> = {
  useAppStorage: () => entry.useAppStorage(),
  useAppWorkflows: () => entry.useAppWorkflows(),
  useBatchEstimate: () => entry.useBatchEstimate(),
  useBlockAnalytics: () => entry.useBlockAnalytics(),
  useBlockBreakpoint: () => entry.useBlockBreakpoint(),
  useBlockContext: () => entry.useBlockContext(),
  useBlockResize: () => entry.useBlockResize(createRef<HTMLElement>()),
  useBlockSettings: () => entry.useBlockSettings(),
  useBlockTheme: () => entry.useBlockTheme(),
  useBlockToken: () => entry.useBlockToken(),
  useBuzzAccounts: () => entry.useBuzzAccounts(),
  useBuzzBalance: () => entry.useBuzzBalance(),
  useBuzzPurchase: () => entry.useBuzzPurchase(),
  useBuzzTransactions: () => entry.useBuzzTransactions(),
  useBuzzWorkflow: () => entry.useBuzzWorkflow(),
  useCheckpointPicker: () => entry.useCheckpointPicker(),
  useCivitaiNavigate: () => entry.useCivitaiNavigate(),
  useCivitaiRoute: () => entry.useCivitaiRoute(),
  useCollectionFollow: () => entry.useCollectionFollow(),
  useConsentUnavailable: () => entry.useConsentUnavailable(),
  useCreatePostFromApp: () => entry.useCreatePostFromApp(),
  useDailyCompensation: () => entry.useDailyCompensation({ date: '2026-01-01' }),
  useDirectLoad: () => entry.useDirectLoad(),
  useDomainMaturity: () => entry.useDomainMaturity(),
  useEntitlements: () => entry.useEntitlements(),
  useGatedImages: () => entry.useGatedImages(),
  useGenerationResources: () => entry.useGenerationResources(),
  useGoodPurchase: () => entry.useGoodPurchase(),
  useHostOrigin: () => entry.useHostOrigin(),
  useImagePicker: () => entry.useImagePicker(),
  useImageUpload: () => entry.useImageUpload(),
  useMediaUpload: () => entry.useMediaUpload(),
  useNestedDocument: () => entry.useNestedDocument(),
  usePublishGenerationOutputs: () => entry.usePublishGenerationOutputs(),
  useReactions: () => entry.useReactions('image', [], { tickets: {} }),
  useRequestConsent: () => entry.useRequestConsent(),
  useRequestSignIn: () => entry.useRequestSignIn(),
  useResourcePicker: () => entry.useResourcePicker(),
  useRunConfirmedStep: () => entry.useRunConfirmedStep(),
  useRunTraining: () => entry.useRunTraining(),
  useSaveImage: () => entry.useSaveImage(),
  useSharedStorage: () => entry.useSharedStorage(),
  useTip: () => entry.useTip(),
  useTipAllowance: () => entry.useTipAllowance(),
  useUploadImageBytes: () => entry.useUploadImageBytes(),
  useViewer: () => entry.useViewer(),
  // `0` on purpose: an invalid id takes the hook's no-fetch path, so a mount-time
  // request cannot be what connects it. A valid id would read green even if the
  // hook stopped connecting on its own.
  useWildcardPack: () => entry.useWildcardPack(0),
  useWorkflowBatch: () => entry.useWorkflowBatch([]),
};

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

function typesPosted(mock: ReturnType<typeof vi.fn>): string[] {
  return mock.mock.calls.map((call) => (call[0] as { type?: string } | undefined)?.type ?? '');
}

describe('every public hook connects the block at mount', () => {
  it('CASES covers exactly the `use*` exports of the package entry', () => {
    const exported = Object.keys(entry)
      .filter((name) => /^use[A-Z]/.test(name))
      .sort();
    expect(Object.keys(CASES).sort()).toEqual(exported);
    // Positive control on the enumeration itself: an empty or truncated entry
    // read would make the equality above trivially satisfiable.
    expect(exported.length).toBeGreaterThanOrEqual(40);
  });

  describe.each(Object.keys(CASES).sort())('%s', (name) => {
    let postMessageMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      resetTransport();
      postMessageMock = vi.fn();
      Object.defineProperty(window, 'parent', {
        value: { postMessage: postMessageMock },
        configurable: true,
        writable: true,
      });
      // The production path: the allowlist comes from the build-time env, so
      // nothing but the hook needs to construct the transport.
      vi.stubEnv('VITE_BLOCK_ALLOWED_PARENT_ORIGINS', PARENT_ORIGIN);
    });

    afterEach(() => {
      // 🔴 UNMOUNT FIRST. This config has no vitest `globals`, so RTL does not
      // auto-clean: a probe left mounted re-renders into the NEXT case and its
      // own `getTransport()` constructs that case's transport — a green earned
      // by the previous hook (measured: two request-only hooks read green that
      // way before this line existed).
      cleanup();
      resetTransport();
      vi.unstubAllEnvs();
    });

    it('posts BLOCK_HELLO on mount and BLOCK_READY after BLOCK_INIT, with no user action', async () => {
      const call = CASES[name]!;
      function Probe(): ReactElement | null {
        call();
        return null;
      }

      render(<Probe />);

      // HELLO: sent by the transport constructor, aimed at the allowlisted parent.
      await waitFor(() => {
        expect(postMessageMock).toHaveBeenCalledWith({ type: 'BLOCK_HELLO' }, PARENT_ORIGIN);
      });

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'BLOCK_INIT', payload: buildInit() },
          origin: PARENT_ORIGIN,
        }),
      );

      await waitFor(() => {
        expect(typesPosted(postMessageMock)).toContain('BLOCK_READY');
      });
      const ready = postMessageMock.mock.calls.find(
        (c) => (c[0] as { type?: string }).type === 'BLOCK_READY',
      )!;
      expect(ready[1]).toBe(PARENT_ORIGIN);
    });
  });

  // The connection is ADDITIVE: a block with no parent allowlist configured used
  // to render and fail only on its first bridge call. It must not now crash on
  // mount instead — the failure is logged once, and the bridge call still throws.
  //
  // 🔴 RUN TWICE, ON PURPOSE. The once-only latch lives beside the transport and
  // is cleared by `resetTransport()`. With a latch that outlived the reset, only
  // the FIRST misconfigured case in a worker would ever see its log, so a single
  // case passes for the wrong reason: it is green only because nothing tripped
  // the latch before it. The second run is the one that proves the reset.
  it.each(['first', 'second'])(
    'a block with no allowlist still renders; the failure is logged once, not thrown (%s run)',
    async () => {
      resetTransport();
      vi.stubEnv('VITE_BLOCK_ALLOWED_PARENT_ORIGINS', '');
      vi.stubEnv('NEXT_PUBLIC_BLOCK_ALLOWED_PARENT_ORIGINS', '');
      vi.stubEnv('PUBLIC_BLOCK_ALLOWED_PARENT_ORIGINS', '');
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      let api: ReturnType<typeof entry.useBuzzWorkflow> | undefined;
      function Probe(): ReactElement {
        api = entry.useBuzzWorkflow();
        return <span>rendered</span>;
      }
      try {
        const first = render(<Probe />);
        const second = render(<Probe />);
        expect(first.getAllByText('rendered').length).toBeGreaterThan(0);
        expect(second.getAllByText('rendered').length).toBeGreaterThan(0);
        const connectLogs = errorSpy.mock.calls.filter((c) =>
          String(c[0]).includes('could not connect to the host at mount'),
        );
        expect(connectLogs).toHaveLength(1);
        expect(String(connectLogs[0]![1])).toContain(
          'allowedParentOrigins must contain at least one entry',
        );
        // Unchanged behaviour: the first bridge call surfaces the same error.
        await expect(api!.cancel('wf')).rejects.toThrow(/allowedParentOrigins/);
      } finally {
        cleanup();
        errorSpy.mockRestore();
        vi.unstubAllEnvs();
        resetTransport();
      }
    },
  );
});
