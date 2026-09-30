import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useBuzzWorkflow, WorkflowSubmitError } from '../src/hooks/useBuzzWorkflow.js';
import { useConsentUnavailable } from '../src/hooks/useConsentUnavailable.js';
import { useCreatePostFromApp } from '../src/hooks/useCreatePostFromApp.js';
import { useTip } from '../src/hooks/useTip.js';
import { getTransport } from '../src/transport/singleton.js';
import { resetTransport } from '../src/testing.js';

/**
 * The SDK's automatic consent prompt-and-retry (`internal/withConsentRetry.ts`).
 *
 * 🔴 THE HEADLINE PROPERTY UNDER TEST IS A MONEY PROPERTY: the retry re-sends
 * the FIRST attempt's `idempotencyKey`, so one logical submit is one Buzz
 * reservation however many times it is attempted. That is asserted on the
 * LITERAL VALUE of both wire messages — not on "a key was present", not on the
 * hook's internal state — because the only thing that makes a retry safe is the
 * two values being equal, and only comparing them can see that.
 *
 * Driven through the REAL `IframeTransport` with a `postMessage` spy and
 * hand-dispatched `MessageEvent`s (the pattern `useRequestConsent.test.tsx`
 * uses), rather than through `createMockHost`. Two reasons, both necessary here:
 * the spy is what lets the assertions read the exact bytes that went out, and a
 * hand-rolled host can hold a message back — a real host always answers, so
 * "the viewer ignored the dialog" is unreachable against one.
 */

const PARENT_ORIGIN = 'https://civitai.com';
const BUDGETED = 'ai:write:budgeted';
const POSTS_WRITE = 'posts:write:self';

/** A logged-in viewer whose token was minted WITHOUT any consent-gated scope. */
function buildInit(scopes: string[] = []): BlockInitPayload {
  return {
    blockInstanceId: 'inst-1',
    blockId: 'b',
    appId: 'app_test',
    token: { raw: 'jwt-1', scopes, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    context: { slotId: 'model.sidebar_top', modelId: 42 },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: { id: 7, username: 'viewer', status: 'active' },
    theme: 'light',
    renderMode: 'iframe',
  };
}

const BODY = {
  kind: 'textToImage',
  modelId: 7,
  modelVersionId: 99,
  params: { prompt: 'cat' },
} as const;

/** A failure-shaped, cost-less reply — the host's own synthesised-exception arm. */
const FAILED_SNAPSHOT = { workflowId: 'failed', status: 'failed' } as const;
/** A real, usable outcome. */
const OK_SNAPSHOT = { workflowId: 'wf-9', status: 'succeeded', cost: { total: 42 } } as const;

describe('withConsentRetry — automatic consent prompt-and-retry', () => {
  let postMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    postMessage = vi.fn();
    Object.defineProperty(window, 'parent', {
      value: { postMessage },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    resetTransport();
    vi.useRealTimers();
  });

  function prime(scopes: string[] = []): void {
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'BLOCK_INIT', payload: buildInit(scopes) },
          origin: PARENT_ORIGIN,
        }),
      );
    });
    postMessage.mockClear();
  }

  function dispatch(data: unknown): void {
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data, origin: PARENT_ORIGIN }));
    });
  }

  /** Every outbound message of `type`, in order. */
  function sentOfType(type: string): Array<Record<string, unknown>> {
    return postMessage.mock.calls
      .map((c) => c[0] as { type?: string; payload?: Record<string, unknown> })
      .filter((m) => m?.type === type)
      .map((m) => m.payload ?? {});
  }

  /** Reply to the Nth (0-based) SUBMIT_WORKFLOW with `snapshot`. */
  function replyToSubmit(index: number, snapshot: unknown): void {
    const submits = sentOfType('SUBMIT_WORKFLOW');
    expect(submits.length).toBeGreaterThan(index);
    dispatch({
      type: 'WORKFLOW_SUBMITTED',
      payload: { requestId: submits[index].requestId as string, snapshot },
    });
  }

  /** The host granting the scope: a re-minted token pushed as TOKEN_REFRESH. */
  function grant(scopes: string[]): void {
    dispatch({
      type: 'TOKEN_REFRESH',
      payload: {
        token: {
          raw: 'jwt-2',
          scopes,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      },
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 🔴 THE MONEY TEST
  // ───────────────────────────────────────────────────────────────────────────

  it('🔴 the retry re-sends the FIRST attempt\'s idempotencyKey — one logical submit, one reservation', async () => {
    prime([]);
    const { result } = renderHook(() => useBuzzWorkflow());

    let submitted!: Promise<unknown>;
    act(() => {
      submitted = result.current.submit(BODY);
    });

    // Attempt 1 goes out and fails failure-shaped (the `'exception'` arm).
    await waitFor(() => expect(sentOfType('SUBMIT_WORKFLOW')).toHaveLength(1));
    const firstKey = sentOfType('SUBMIT_WORKFLOW')[0].idempotencyKey as string;
    // A real key, not an artifact of a mock that returns undefined for everything.
    expect(typeof firstKey).toBe('string');
    expect(firstKey.length).toBeGreaterThan(0);
    replyToSubmit(0, FAILED_SNAPSHOT);

    // The viewer grants; the hook retries.
    await waitFor(() => expect(sentOfType('REQUEST_CONSENT')).toHaveLength(1));
    grant([BUDGETED]);
    await waitFor(() => expect(sentOfType('SUBMIT_WORKFLOW')).toHaveLength(2));

    const secondKey = sentOfType('SUBMIT_WORKFLOW')[1].idempotencyKey as string;

    // 🔴 THE ASSERTION. Not `toBeDefined`, not `toEqual(expect.any(String))` —
    // the LITERAL values, compared. A retry that minted a fresh key would pass
    // every weaker form of this check and double-reserve a real person's Buzz.
    expect(secondKey).toBe(firstKey);

    // And the two attempts really are two DIFFERENT requests, so the equality
    // above is about the key and not about having read the same message twice.
    expect(sentOfType('SUBMIT_WORKFLOW')[1].requestId).not.toBe(
      sentOfType('SUBMIT_WORKFLOW')[0].requestId,
    );

    replyToSubmit(1, OK_SNAPSHOT);
    await expect(submitted).resolves.toMatchObject({ workflowId: 'wf-9' });
  });

  it('a CALLER-SUPPLIED idempotencyKey is the value both attempts carry', async () => {
    prime([]);
    const { result } = renderHook(() => useBuzzWorkflow());

    let submitted!: Promise<unknown>;
    act(() => {
      submitted = result.current.submit(BODY, { idempotencyKey: 'grid-cell-3' });
    });

    await waitFor(() => expect(sentOfType('SUBMIT_WORKFLOW')).toHaveLength(1));
    replyToSubmit(0, FAILED_SNAPSHOT);
    await waitFor(() => expect(sentOfType('REQUEST_CONSENT')).toHaveLength(1));
    grant([BUDGETED]);
    await waitFor(() => expect(sentOfType('SUBMIT_WORKFLOW')).toHaveLength(2));

    expect(sentOfType('SUBMIT_WORKFLOW').map((p) => p.idempotencyKey)).toEqual([
      'grid-cell-3',
      'grid-cell-3',
    ]);

    replyToSubmit(1, OK_SNAPSHOT);
    await expect(submitted).resolves.toMatchObject({ workflowId: 'wf-9' });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // The prompt
  // ───────────────────────────────────────────────────────────────────────────

  it('prompts with the CORRECT, NON-EMPTY scope names the operation needs', async () => {
    prime([]);
    const { result } = renderHook(() => useBuzzWorkflow());

    let submitted!: Promise<unknown>;
    act(() => {
      submitted = result.current.submit(BODY);
    });
    await waitFor(() => expect(sentOfType('SUBMIT_WORKFLOW')).toHaveLength(1));
    replyToSubmit(0, FAILED_SNAPSHOT);

    await waitFor(() => expect(sentOfType('REQUEST_CONSENT')).toHaveLength(1));
    // 🔴 THE PRECONDITION IN `useConsentUnavailable`'s DOCBLOCK, PINNED. The
    // host's `resolveUngrantableConsentNotice` returns "no notice" unless the
    // hint is an array holding at least one NON-EMPTY string — so `undefined`,
    // `[]` and `['']` would each buy total silence from the host, and the
    // refusal arm of the wait below could then never fire. Exact value, because
    // "non-empty" is not the property that matters: the NAME is.
    expect(sentOfType('REQUEST_CONSENT')[0]).toEqual({ scopes: [BUDGETED] });

    grant([BUDGETED]);
    await waitFor(() => expect(sentOfType('SUBMIT_WORKFLOW')).toHaveLength(2));
    replyToSubmit(1, OK_SNAPSHOT);
    await expect(submitted).resolves.toMatchObject({ workflowId: 'wf-9' });
  });

  it('a different hook prompts for ITS OWN scope, not the workflow one', async () => {
    prime([]);
    const { result } = renderHook(() => useCreatePostFromApp());

    let posted!: Promise<unknown>;
    act(() => {
      posted = result.current
        .createPost({ sources: [{ kind: 'published', imageIds: [1] }] })
        // Settled below; attached now so the rejection is never unhandled.
        .catch((e: unknown) => e);
    });

    await waitFor(() => expect(sentOfType('CREATE_POST_FROM_APP')).toHaveLength(1));
    dispatch({
      type: 'CREATE_POST_RESULT',
      payload: {
        requestId: sentOfType('CREATE_POST_FROM_APP')[0].requestId as string,
        error: 'You do not have permission to post',
      },
    });

    await waitFor(() => expect(sentOfType('REQUEST_CONSENT')).toHaveLength(1));
    expect(sentOfType('REQUEST_CONSENT')[0]).toEqual({ scopes: [POSTS_WRITE] });

    // Granting the WORKFLOW scope must NOT satisfy this wait — the hook is
    // waiting on `posts:write:self`. Kills a helper that resolved on any token
    // change rather than on the scopes it asked for.
    grant([BUDGETED]);
    await new Promise((r) => setTimeout(r, 30));
    expect(sentOfType('CREATE_POST_FROM_APP')).toHaveLength(1);

    grant([BUDGETED, POSTS_WRITE]);
    await waitFor(() => expect(sentOfType('CREATE_POST_FROM_APP')).toHaveLength(2));
    dispatch({
      type: 'CREATE_POST_RESULT',
      payload: {
        requestId: sentOfType('CREATE_POST_FROM_APP')[1].requestId as string,
        result: { postId: 5, url: 'https://civitai.com/posts/5', imageIds: [1] },
      },
    });
    await expect(posted).resolves.toMatchObject({ postId: 5 });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // The guards
  // ───────────────────────────────────────────────────────────────────────────

  it('CONSENT_UNAVAILABLE ⇒ NO prompt, NO retry, and the ORIGINAL error surfaces', async () => {
    prime([]);
    // Mounting `useConsentUnavailable()` arms the refusal latch — one of the two
    // documented arming paths — so the host's push is BUFFERED rather than
    // falling through the transport's no-op tail. The refusal below then reaches
    // `withConsentRetry` through the SAME buffer a block reads, which is the
    // point: one source of truth for "the host has refused", not a second
    // subscription that could disagree with the first.
    renderHook(() => useConsentUnavailable());
    const { result } = renderHook(() => useBuzzWorkflow());

    dispatch({
      type: 'CONSENT_UNAVAILABLE',
      payload: { reason: 'ungrantable', scopes: [BUDGETED] },
    });
    postMessage.mockClear();

    let submitted!: Promise<unknown>;
    let settled!: Promise<unknown>;
    act(() => {
      submitted = result.current.submit(BODY);
      settled = submitted.catch((e: unknown) => e);
    });
    await waitFor(() => expect(sentOfType('SUBMIT_WORKFLOW')).toHaveLength(1));
    replyToSubmit(0, FAILED_SNAPSHOT);

    const err = (await settled) as WorkflowSubmitError;
    expect(err).toBeInstanceOf(WorkflowSubmitError);
    expect(err.code).toBe('exception');

    // 🔴 BOTH zeros, and they are different claims. No prompt: the block does
    // not nag for a permission the host has said can never exist here. No second
    // submit: the retry would be a guaranteed second failure, and on a money
    // path a guaranteed second failure is a guaranteed second reservation.
    expect(sentOfType('REQUEST_CONSENT')).toHaveLength(0);
    expect(sentOfType('SUBMIT_WORKFLOW')).toHaveLength(1);
  });

  it('a SECOND consent failure surfaces — there is no third attempt', async () => {
    prime([]);
    const { result } = renderHook(() => useBuzzWorkflow());

    let settled!: Promise<unknown>;
    act(() => {
      settled = result.current.submit(BODY).catch((e: unknown) => e);
    });
    await waitFor(() => expect(sentOfType('SUBMIT_WORKFLOW')).toHaveLength(1));
    replyToSubmit(0, FAILED_SNAPSHOT);

    await waitFor(() => expect(sentOfType('REQUEST_CONSENT')).toHaveLength(1));
    grant([BUDGETED]);
    await waitFor(() => expect(sentOfType('SUBMIT_WORKFLOW')).toHaveLength(2));

    // The grant did not fix it. The retry fails the same way.
    replyToSubmit(1, FAILED_SNAPSHOT);

    const err = (await settled) as WorkflowSubmitError;
    expect(err).toBeInstanceOf(WorkflowSubmitError);

    // Settle anything the loop-that-must-not-exist would have scheduled.
    await new Promise((r) => setTimeout(r, 50));
    expect(sentOfType('SUBMIT_WORKFLOW')).toHaveLength(2);
    expect(sentOfType('REQUEST_CONSENT')).toHaveLength(1);
  });

  it('a NON-consent failure is untouched — no prompt, no retry, same rejection', async () => {
    // The token HOLDS the scope, so nothing about this failure is consent-shaped.
    prime([BUDGETED]);
    const { result } = renderHook(() => useBuzzWorkflow());

    let settled!: Promise<unknown>;
    act(() => {
      settled = result.current.submit(BODY).catch((e: unknown) => e);
    });
    await waitFor(() => expect(sentOfType('SUBMIT_WORKFLOW')).toHaveLength(1));
    replyToSubmit(0, {
      workflowId: 'wf-real',
      status: 'failed',
      error: 'orchestrator exploded',
    });

    const err = (await settled) as WorkflowSubmitError;
    expect(err).toBeInstanceOf(WorkflowSubmitError);
    // Unchanged classification — this arm is the money-committed one.
    expect(err.code).toBe('workflow-failed');
    expect(err.snapshot.error).toBe('orchestrator exploded');

    await new Promise((r) => setTimeout(r, 50));
    expect(sentOfType('REQUEST_CONSENT')).toHaveLength(0);
    expect(sentOfType('SUBMIT_WORKFLOW')).toHaveLength(1);
  });

  it('autoRequestConsent: false restores the pre-feature behaviour exactly', async () => {
    prime([]);
    const { result } = renderHook(() => useBuzzWorkflow());

    let settled!: Promise<unknown>;
    act(() => {
      settled = result.current.submit(BODY, { autoRequestConsent: false }).catch(
        (e: unknown) => e,
      );
    });
    await waitFor(() => expect(sentOfType('SUBMIT_WORKFLOW')).toHaveLength(1));
    replyToSubmit(0, FAILED_SNAPSHOT);

    const err = (await settled) as WorkflowSubmitError;
    expect(err).toBeInstanceOf(WorkflowSubmitError);

    await new Promise((r) => setTimeout(r, 50));
    expect(sentOfType('REQUEST_CONSENT')).toHaveLength(0);
    expect(sentOfType('SUBMIT_WORKFLOW')).toHaveLength(1);
  });

  it('a viewer who never answers the dialog gets the ORIGINAL error back, once', async () => {
    prime([]);
    const { result } = renderHook(() => useBuzzWorkflow());

    let settled!: Promise<unknown>;
    act(() => {
      // A tiny bound stands in for the 60s default; the branch is the same one.
      settled = result.current.submit(BODY, { consentTimeoutMs: 20 }).catch(
        (e: unknown) => e,
      );
    });
    await waitFor(() => expect(sentOfType('SUBMIT_WORKFLOW')).toHaveLength(1));
    replyToSubmit(0, FAILED_SNAPSHOT);
    await waitFor(() => expect(sentOfType('REQUEST_CONSENT')).toHaveLength(1));

    // The host says nothing at all — a dismissed dialog is indistinguishable
    // from an unanswered one, so this is the shape of both.
    const err = (await settled) as WorkflowSubmitError;
    expect(err).toBeInstanceOf(WorkflowSubmitError);
    expect(err.code).toBe('exception');
    expect(sentOfType('SUBMIT_WORKFLOW')).toHaveLength(1);
  });

  it('a DIRECT-FETCH money hook retries with the SAME key and the NEWLY-GRANTED token', async () => {
    // `useTip` does not go through the bridge — it POSTs to the HTTP API with
    // the block bearer token. Two things have to be true on the retry and they
    // are independent: the SAME `idempotencyKey` (so the host collapses the two
    // POSTs into one transfer) and the NEW token (the one the grant minted).
    //
    // 🔴 The token half is the subtle one. `raw` comes from `useBlockToken()`,
    // i.e. the RENDER closure, and the in-flight call still holds the closure it
    // was created with — the PRE-grant token. Sending that on the retry means
    // the server sees the same scope-less token and refuses again, so the whole
    // feature would be inert on every direct-fetch hook while looking like it
    // worked. Asserting the Authorization header is what sees it.
    const realFetch = globalThis.fetch;
    const calls: Array<{ auth: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = vi.fn(async (_url: unknown, opts: unknown) => {
      const o = opts as { headers: Record<string, string>; body: string };
      calls.push({ auth: o.headers.Authorization, body: JSON.parse(o.body) });
      if (calls.length === 1) {
        return {
          ok: false,
          status: 403,
          json: async () => ({ error: 'insufficient_scope' }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          tip: { toUserId: 123, amount: 50, entityType: null, entityId: null },
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    try {
      prime([]);
      const { result } = renderHook(() => useTip());
      await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

      let tipped!: Promise<unknown>;
      act(() => {
        tipped = result.current.tip({ toUserId: 123, amount: 50 });
      });

      await waitFor(() => expect(calls).toHaveLength(1));
      await waitFor(() => expect(sentOfType('REQUEST_CONSENT')).toHaveLength(1));
      expect(sentOfType('REQUEST_CONSENT')[0]).toEqual({ scopes: ['social:tip:self'] });

      grant(['social:tip:self']); // mints token `jwt-2`
      await waitFor(() => expect(calls).toHaveLength(2));

      // Same logical tip → same key. The money property, on the HTTP rail.
      expect(calls[1].body.idempotencyKey).toBe(calls[0].body.idempotencyKey);
      // …and the retry carries the token the grant produced, not the old one.
      expect(calls[0].auth).toBe('Bearer jwt-1');
      expect(calls[1].auth).toBe('Bearer jwt-2');

      await expect(tipped).resolves.toMatchObject({ ok: true });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('a viewer who DISMISSED a host confirm (`declined`) is never re-prompted', async () => {
    prime([]);
    const { result } = renderHook(() => useCreatePostFromApp());

    let posted!: Promise<unknown>;
    act(() => {
      posted = result.current
        .createPost({ sources: [{ kind: 'published', imageIds: [1] }] })
        .catch((e: unknown) => e);
    });
    await waitFor(() => expect(sentOfType('CREATE_POST_FROM_APP')).toHaveLength(1));
    dispatch({
      type: 'CREATE_POST_RESULT',
      payload: {
        requestId: sentOfType('CREATE_POST_FROM_APP')[0].requestId as string,
        error: 'declined',
      },
    });

    const err = (await posted) as { declined?: boolean };
    expect(err.declined).toBe(true);

    await new Promise((r) => setTimeout(r, 50));
    // The token still lacks `posts:write:self`, so the STRUCTURAL predicate
    // alone would have prompted. The `declined` guard is what stops it — this
    // test is dead without it.
    expect(sentOfType('REQUEST_CONSENT')).toHaveLength(0);
    expect(sentOfType('CREATE_POST_FROM_APP')).toHaveLength(1);
  });
});
