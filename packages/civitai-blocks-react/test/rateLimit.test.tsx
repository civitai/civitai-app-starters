import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { BatchEstimateError, useBatchEstimate } from '../src/hooks/useBatchEstimate.js';
import {
  useBuzzWorkflow,
  WorkflowCancelNotIssuedError,
  WorkflowEstimateError,
  WorkflowSubmitError,
} from '../src/hooks/useBuzzWorkflow.js';
import { rateLimitOf, type RateLimitMeta } from '../src/index.js';
import { parseRateLimitMeta, withRateLimit } from '../src/internal/rateLimit.js';
import { throwOnFailedReply, throwOnReplyError } from '../src/internal/replyError.js';
import { getTransport } from '../src/transport/singleton.js';
import { resetTransport } from '../src/testing.js';

/**
 * The host's rate-limit retry metadata (`rateLimit`) reaches the app on the error a hook throws.
 *
 * The workflow calls report a refusal inside a snapshot (`snapshot.rateLimit`); every other bridge
 * call on its error reply (`{ requestId, error, rateLimit }`). A host that predates the field sends
 * neither, and the error is then exactly what it was: same class, same message, no property.
 *
 * Every meta value is distinct from every other in this file (and from any constant the code
 * names), so a read of the wrong field or a hardcoded value shows.
 */
const PARENT_ORIGIN = 'https://civitai.com';

const SUBMIT_LIMIT: RateLimitMeta = {
  retryAfterSeconds: 37,
  retryAt: '2026-05-06T07:08:45.000Z',
  id: 'apps.submit',
  kind: 'abuse',
};
const CATALOG_LIMIT: RateLimitMeta = {
  retryAfterSeconds: 13,
  retryAt: '2026-05-06T07:08:21.000Z',
  id: 'apps.catalog',
  kind: 'abuse',
};
const PRODUCT_LIMIT: RateLimitMeta = {
  retryAfterSeconds: 3_601,
  retryAt: '2026-05-06T08:08:09.000Z',
  id: 'apps.forks',
  kind: 'product',
  limit: 5,
  used: 6,
  remaining: 0,
  windowSeconds: 86_400,
  resetAt: '2026-05-07T00:00:00.000Z',
};

describe('parseRateLimitMeta / withRateLimit / rateLimitOf', () => {
  it('keeps every known field of a full product meta', () => {
    expect(parseRateLimitMeta(PRODUCT_LIMIT)).toStrictEqual(PRODUCT_LIMIT);
  });

  it('drops unknown fields and a malformed optional one, keeping the rest', () => {
    // `kind: 'mystery'` replaces the valid kind, so the result has none.
    expect(
      parseRateLimitMeta({ ...CATALOG_LIMIT, extra: 'x', used: -1, kind: 'mystery', resetAt: 'never' }),
    ).toStrictEqual({
      retryAfterSeconds: CATALOG_LIMIT.retryAfterSeconds,
      retryAt: CATALOG_LIMIT.retryAt,
      id: CATALOG_LIMIT.id,
    });
  });

  it.each([
    ['no retryAfterSeconds', { retryAt: CATALOG_LIMIT.retryAt }],
    ['a zero retryAfterSeconds', { retryAfterSeconds: 0, retryAt: CATALOG_LIMIT.retryAt }],
    ['a fractional retryAfterSeconds', { retryAfterSeconds: 1.5, retryAt: CATALOG_LIMIT.retryAt }],
    ['a non-instant retryAt', { retryAfterSeconds: 9, retryAt: 'soon' }],
    ['a string', 'apps.catalog'],
    ['null', null],
  ])('refuses %s', (_label, value) => {
    expect(parseRateLimitMeta(value)).toBeUndefined();
  });

  it('withRateLimit returns the SAME error, with the meta set as an own property', () => {
    class CustomError extends Error {}
    const err = new CustomError('refused');
    const out = withRateLimit(err, { error: 'refused', rateLimit: SUBMIT_LIMIT });
    expect(out).toBe(err);
    expect(out).toBeInstanceOf(CustomError);
    expect(out.message).toBe('refused');
    expect(rateLimitOf(out)).toStrictEqual(SUBMIT_LIMIT);
  });

  it('withRateLimit adds nothing when the source carries no valid meta (an older host)', () => {
    for (const source of [{ error: 'x' }, { error: 'x', rateLimit: { retryAfterSeconds: 'soon' } }, null, 'x']) {
      const err = withRateLimit(new Error('x'), source);
      expect('rateLimit' in err).toBe(false);
      expect(rateLimitOf(err)).toBeUndefined();
    }
  });

  it('rateLimitOf answers undefined for a non-object', () => {
    expect(rateLimitOf(undefined)).toBeUndefined();
    expect(rateLimitOf('Rate limit exceeded')).toBeUndefined();
  });
});

describe('throwOnReplyError / throwOnFailedReply carry the reply meta', () => {
  it('throwOnReplyError', () => {
    let caught: unknown;
    try {
      throwOnReplyError({ error: 'Rate limit exceeded', rateLimit: CATALOG_LIMIT } as { error?: string }, 'fb');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('Rate limit exceeded');
    expect(rateLimitOf(caught)).toStrictEqual(CATALOG_LIMIT);
  });

  it('throwOnFailedReply', () => {
    let caught: unknown;
    try {
      throwOnFailedReply({ ok: false, error: '', rateLimit: PRODUCT_LIMIT } as { ok?: boolean; error?: string }, 'fb');
    } catch (err) {
      caught = err;
    }
    expect((caught as Error).message).toBe('fb');
    expect(rateLimitOf(caught)).toStrictEqual(PRODUCT_LIMIT);
  });

  it('a reply with no meta throws the error it always did — no `rateLimit` property', () => {
    let caught: unknown;
    try {
      throwOnReplyError({ error: 'nope' }, 'fb');
    } catch (err) {
      caught = err;
    }
    expect((caught as Error).message).toBe('nope');
    expect('rateLimit' in (caught as object)).toBe(false);
  });
});

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

const BODY = { kind: 'textToImage', modelId: 7, modelVersionId: 99, params: { prompt: 'a fox' } } as const;

/** Driven through the real transport: `postMessage` → validation → projection → the hook. */
describe('through the transport', () => {
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
      new MessageEvent('message', { data: { type: 'BLOCK_INIT', payload: buildInit() }, origin: PARENT_ORIGIN }),
    );
    postMessageMock.mockClear();
  });

  afterEach(() => {
    resetTransport();
  });

  /** Answer the most recent outbound request of `type` with `replyType` + `payload`. */
  async function answer(type: string, replyType: string, payload: Record<string, unknown>) {
    await waitFor(() => {
      expect(postMessageMock.mock.calls.some((c) => (c[0] as { type: string }).type === type)).toBe(true);
    });
    const sent = postMessageMock.mock.calls
      .map((c) => c[0] as { type: string; payload: { requestId: string } })
      .filter((m) => m.type === type)
      .at(-1)!;
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: replyType, payload: { requestId: sent.payload.requestId, ...payload } },
          origin: PARENT_ORIGIN,
        }),
      );
    });
  }

  const refused = (rateLimit?: unknown) => ({
    workflowId: 'failed',
    status: 'failed',
    error: 'Rate limit exceeded, please retry shortly.',
    ...(rateLimit === undefined ? {} : { rateLimit }),
  });

  it('estimate: WorkflowEstimateError.rateLimit is the snapshot meta', async () => {
    const { result } = renderHook(() => useBuzzWorkflow());
    const p = result.current.estimate(BODY);
    const settled = p.catch((e: unknown) => e);
    await answer('ESTIMATE_WORKFLOW', 'ESTIMATE_RESULT', { snapshot: refused(CATALOG_LIMIT) });
    const err = await settled;
    expect(err).toBeInstanceOf(WorkflowEstimateError);
    expect((err as WorkflowEstimateError).rateLimit).toStrictEqual(CATALOG_LIMIT);
    expect((err as WorkflowEstimateError).snapshot.rateLimit).toStrictEqual(CATALOG_LIMIT);
    expect(rateLimitOf(err)).toStrictEqual(CATALOG_LIMIT);
  });

  it('submit: WorkflowSubmitError.rateLimit is the snapshot meta', async () => {
    const { result } = renderHook(() => useBuzzWorkflow());
    const settled = result.current.submit(BODY).catch((e: unknown) => e);
    await answer('SUBMIT_WORKFLOW', 'WORKFLOW_SUBMITTED', { snapshot: refused(SUBMIT_LIMIT) });
    const err = await settled;
    expect(err).toBeInstanceOf(WorkflowSubmitError);
    expect((err as WorkflowSubmitError).code).toBe('exception');
    expect((err as WorkflowSubmitError).rateLimit).toStrictEqual(SUBMIT_LIMIT);
    await waitFor(() => expect(rateLimitOf(result.current.error)).toStrictEqual(SUBMIT_LIMIT));
  });

  it('cancel shed by a rate limit: WorkflowCancelNotIssuedError.rateLimit is the meta', async () => {
    const { result } = renderHook(() => useBuzzWorkflow());
    const settled = result.current.cancel('wf_1').catch((e: unknown) => e);
    await answer('CANCEL_WORKFLOW', 'WORKFLOW_CANCELED', {
      snapshot: { workflowId: 'wf_1', status: 'processing', throttled: true, rateLimit: CATALOG_LIMIT },
    });
    const err = await settled;
    expect(err).toBeInstanceOf(WorkflowCancelNotIssuedError);
    expect((err as WorkflowCancelNotIssuedError).rateLimit).toStrictEqual(CATALOG_LIMIT);
  });

  it('a malformed meta is dropped from the snapshot and never reaches the error', async () => {
    const { result } = renderHook(() => useBuzzWorkflow());
    const settled = result.current.estimate(BODY).catch((e: unknown) => e);
    await answer('ESTIMATE_WORKFLOW', 'ESTIMATE_RESULT', { snapshot: refused({ retryAfterSeconds: 'soon' }) });
    const err = (await settled) as WorkflowEstimateError;
    expect(err).toBeInstanceOf(WorkflowEstimateError);
    expect('rateLimit' in err.snapshot).toBe(false);
    expect('rateLimit' in err).toBe(false);
  });

  it('an older host (no meta): the error is unchanged — same class, same message, no property', async () => {
    const { result } = renderHook(() => useBuzzWorkflow());
    const settled = result.current.submit(BODY).catch((e: unknown) => e);
    await answer('SUBMIT_WORKFLOW', 'WORKFLOW_SUBMITTED', { snapshot: refused() });
    const err = (await settled) as WorkflowSubmitError;
    expect(err).toBeInstanceOf(WorkflowSubmitError);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('submit did not return a usable workflow (exception) — reason on .snapshot.error');
    expect('rateLimit' in err).toBe(false);
  });

  it('batch estimate: a whole-call refusal carries the reply meta on BatchEstimateError', async () => {
    const { result } = renderHook(() => useBatchEstimate());
    const settled = result.current.estimateBatch([BODY]).catch((e: unknown) => e);
    await answer('ESTIMATE_WORKFLOW_BATCH', 'ESTIMATE_BATCH_RESULT', {
      error: 'Rate limit exceeded, please retry shortly.',
      rateLimit: PRODUCT_LIMIT,
    });
    const err = await settled;
    expect(err).toBeInstanceOf(BatchEstimateError);
    expect((err as BatchEstimateError).code).toBe('failed');
    expect((err as BatchEstimateError).rateLimit).toStrictEqual(PRODUCT_LIMIT);
  });
});
