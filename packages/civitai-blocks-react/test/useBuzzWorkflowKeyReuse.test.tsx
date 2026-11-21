import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useBuzzWorkflow, WorkflowSubmitError } from '../src/hooks/useBuzzWorkflow.js';
import { getTransport } from '../src/transport/singleton.js';
import { WORKFLOW_REQUEST_TIMEOUT_MS } from '../src/transport/requestTimeouts.js';
import { RequestTimeoutError } from '../src/transport/transport.js';
import { resetTransport } from '../src/testing.js';

const PARENT_ORIGIN = 'https://civitai.com';

/**
 * `submit()` REUSES the key of a FAILED submit when the SAME input is retried.
 *
 * THE DEFECT. `submit()` minted a fresh `idempotencyKey` on every call unless the
 * caller passed one, so a block whose "try again" re-called `submit(body)` after
 * a timeout or an error sent a NEW key. The host dedupes on that key, so a new
 * key is a second logical submit: when the first attempt had in fact been
 * accepted (a lost response), the viewer was charged twice.
 *
 * 🔴 KEYS ARE COMPARED AS LITERALS READ OFF THE WIRE (the `SUBMIT_WORKFLOW`
 * message posted to the parent), never derived from the hook. Every "different"
 * assertion also checks the key is a non-empty string, so `undefined !==
 * undefined`-style passes are impossible.
 *
 * The money scope is granted in the init token for the reason
 * `useBuzzWorkflow.test.tsx` gives: these tests are about the key, not consent.
 */

function buildInit(): BlockInitPayload {
  return {
    blockInstanceId: 'i',
    blockId: 'b',
    appId: 'app_test',
    token: {
      raw: 'jwt',
      scopes: ['ai:write:budgeted'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    context: { slotId: 's' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: null,
    theme: 'light',
    renderMode: 'iframe',
  };
}

/** The host's own `failureSnapshot(err)` shape: `submit()` rejects it as `'exception'`. */
const FAILED = { workflowId: 'failed', status: 'failed', error: 'upstream timed out' };
/** An ordinary accepted submit. */
const ACCEPTED = { workflowId: 'wf-1', status: 'processing' };

const bodyA = () => ({
  kind: 'textToImage' as const,
  modelId: 7,
  modelVersionId: 99,
  params: { prompt: 'cat', steps: 20 },
});

describe('useBuzzWorkflow.submit — idempotency key reuse on retry', () => {
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
    vi.useRealTimers();
    resetTransport();
  });

  type Sent = { type: string; payload: { requestId: string; idempotencyKey?: unknown } };

  /** The LAST message of `type` this test's frame posted to the parent. */
  function lastSent(type: string): Sent | undefined {
    const calls = postMessageMock.mock.calls.map((c) => c[0] as Sent);
    return calls.filter((m) => m.type === type).at(-1);
  }

  /**
   * Start a submit, read the key it put on the wire, and (when `reply` is given)
   * answer it. Returns the key and how the call settled.
   */
  async function submitOnce(
    submit: (body: never, options?: { idempotencyKey?: string }) => Promise<unknown>,
    body: unknown,
    reply: unknown | undefined,
    options?: { idempotencyKey?: string },
  ) {
    postMessageMock.mockClear();
    let promise!: Promise<unknown>;
    act(() => {
      promise = submit(body as never, options);
    });
    const settled = promise.then(
      (v) => ({ ok: true as const, v }),
      (e: unknown) => ({ ok: false as const, e }),
    );
    const sent = lastSent('SUBMIT_WORKFLOW');
    expect(sent).toBeDefined();
    const key = sent!.payload.idempotencyKey;
    expect(typeof key).toBe('string');
    expect((key as string).length).toBeGreaterThan(0);
    if (reply !== undefined) {
      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'WORKFLOW_SUBMITTED',
              payload: { requestId: sent!.payload.requestId, snapshot: reply },
            },
            origin: PARENT_ORIGIN,
          }),
        );
      });
    }
    return { key: key as string, settled };
  }

  it('a retry of the SAME input after a failed submit sends the SAME idempotencyKey', async () => {
    const { result } = renderHook(() => useBuzzWorkflow());

    const first = await submitOnce(result.current.submit as never, bodyA(), FAILED);
    const firstOutcome = await first.settled;
    expect(firstOutcome.ok).toBe(false);
    expect((firstOutcome as { e: unknown }).e).toBeInstanceOf(WorkflowSubmitError);

    // A fresh but EQUAL body object: "same input" is by value, not identity.
    const retry = await submitOnce(result.current.submit as never, bodyA(), ACCEPTED);
    expect((await retry.settled).ok).toBe(true);
    expect(retry.key).toBe(first.key);
  });

  it('a TIMED-OUT submit (outcome unknown) is retried with the SAME idempotencyKey', async () => {
    // The case the reuse exists for: the host may have accepted the first
    // attempt and only the reply was lost.
    vi.useFakeTimers();
    const { result } = renderHook(() => useBuzzWorkflow());

    const first = await submitOnce(result.current.submit as never, bodyA(), undefined);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WORKFLOW_REQUEST_TIMEOUT_MS + 1_000);
    });
    const firstOutcome = await first.settled;
    expect(firstOutcome.ok).toBe(false);
    expect((firstOutcome as { e: unknown }).e).toBeInstanceOf(RequestTimeoutError);

    const retry = await submitOnce(result.current.submit as never, bodyA(), ACCEPTED);
    expect((await retry.settled).ok).toBe(true);
    expect(retry.key).toBe(first.key);
  });

  it('a NEW input after a failed submit sends a NEW idempotencyKey', async () => {
    const { result } = renderHook(() => useBuzzWorkflow());

    const first = await submitOnce(result.current.submit as never, bodyA(), FAILED);
    expect((await first.settled).ok).toBe(false);

    // One field differs, one level down.
    const changed = { ...bodyA(), params: { prompt: 'dog', steps: 20 } };
    const next = await submitOnce(result.current.submit as never, changed, ACCEPTED);
    expect((await next.settled).ok).toBe(true);
    expect(next.key).not.toBe(first.key);
  });

  it('after a SUCCESSFUL submit, the same input sends a NEW idempotencyKey', async () => {
    const { result } = renderHook(() => useBuzzWorkflow());

    // Fail, then retry successfully: the retry carries the remembered key...
    const first = await submitOnce(result.current.submit as never, bodyA(), FAILED);
    expect((await first.settled).ok).toBe(false);
    const retry = await submitOnce(result.current.submit as never, bodyA(), ACCEPTED);
    expect((await retry.settled).ok).toBe(true);
    expect(retry.key).toBe(first.key);

    // ...and once that key has succeeded, the same input again is a NEW logical
    // submit. Reusing the key would make the host replay the earlier result
    // instead of running it.
    const again = await submitOnce(result.current.submit as never, bodyA(), ACCEPTED);
    expect((await again.settled).ok).toBe(true);
    expect(again.key).not.toBe(first.key);
  });

  it('a caller-passed key wins over the remembered key, and does not replace it', async () => {
    const { result } = renderHook(() => useBuzzWorkflow());

    const auto = await submitOnce(result.current.submit as never, bodyA(), FAILED);
    expect((await auto.settled).ok).toBe(false);

    // Same input, caller key: the caller's key is what is sent.
    const explicit = await submitOnce(result.current.submit as never, bodyA(), FAILED, {
      idempotencyKey: 'caller-key-1',
    });
    expect(explicit.key).toBe('caller-key-1');
    expect((await explicit.settled).ok).toBe(false);

    // The caller-keyed failure did not overwrite the remembered auto key: an
    // auto-keyed retry of the same input still carries the FIRST key.
    const autoRetry = await submitOnce(result.current.submit as never, bodyA(), ACCEPTED);
    expect((await autoRetry.settled).ok).toBe(true);
    expect(autoRetry.key).toBe(auto.key);
  });

  it('the same input with its object keys in a DIFFERENT ORDER reuses the key', async () => {
    const { result } = renderHook(() => useBuzzWorkflow());

    const first = await submitOnce(result.current.submit as never, bodyA(), FAILED);
    expect((await first.settled).ok).toBe(false);

    const reordered = {
      params: { steps: 20, prompt: 'cat' },
      modelVersionId: 99,
      modelId: 7,
      kind: 'textToImage' as const,
    };
    const retry = await submitOnce(result.current.submit as never, reordered, ACCEPTED);
    expect((await retry.settled).ok).toBe(true);
    expect(retry.key).toBe(first.key);
  });

  it('a body holding a non-JSON value is never treated as the same input', async () => {
    // Two DIFFERENT Maps both serialise to `{}` as JSON. Calling them equal
    // would send a new input under the old key.
    const { result } = renderHook(() => useBuzzWorkflow());
    const withMap = (m: Map<string, number>) => ({ ...bodyA(), params: { prompt: 'cat', extra: m } });

    const first = await submitOnce(result.current.submit as never, withMap(new Map([['a', 1]])), FAILED);
    expect((await first.settled).ok).toBe(false);

    const next = await submitOnce(result.current.submit as never, withMap(new Map([['b', 2]])), ACCEPTED);
    expect((await next.settled).ok).toBe(true);
    expect(next.key).not.toBe(first.key);
  });

  // INVARIANT GUARD, not regression coverage: estimate() never carried a key
  // before this change either. Pinned because the hook now remembers one.
  it('estimate() never sends an idempotencyKey, even while a failed key is remembered', async () => {
    const { result } = renderHook(() => useBuzzWorkflow());

    const first = await submitOnce(result.current.submit as never, bodyA(), FAILED);
    expect((await first.settled).ok).toBe(false);

    postMessageMock.mockClear();
    act(() => {
      result.current.estimate(bodyA()).catch(() => {});
    });
    const sent = lastSent('ESTIMATE_WORKFLOW');
    expect(sent).toBeDefined();
    expect(sent!.payload).not.toHaveProperty('idempotencyKey');
  });
});
