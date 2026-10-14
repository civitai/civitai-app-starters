import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  CivitaiError,
  initialize,
  SubmissionUnconfirmedError,
  type AppWorkflow,
  type BlockWorkflowSnapshot,
  type WorkflowBody,
  type WorkflowsClient,
} from '../../src/index.js';
import { createFakeTransport } from '../../src/testing.js';
import { fakeFetch, json, type FetchCall } from '../support/fake-fetch.js';

/**
 * The seam is `fetch`. Everything below drives the REAL client — its URLs, its
 * bodies and its status handling — against a scripted server. Every expected
 * path and body is a literal written out here, not read back from the module.
 */
const ROUTE = 'https://civitai.com/api/v1/blocks/workflows';

/** Two steps, the second consuming the first — written against `@civitai/sdk` alone. */
const BODY: WorkflowBody = {
  kind: 'workflow',
  arguments: { prompt: 'a lighthouse at dusk' },
  steps: [
    {
      name: 'draw',
      $type: 'imageGen',
      input: {
        engine: 'google',
        model: 'nano-banana-2',
        prompt: { $ref: '$arguments', path: 'prompt' },
      },
      suppressOutput: true,
    },
    {
      name: 'cutout',
      $type: 'imageBackgroundRemoval',
      input: { image: { $ref: 'draw', path: 'output.images[0].url' } },
    },
  ],
};

/** The same body as the JSON a server receives, spelled independently of `BODY`. */
const BODY_ON_THE_WIRE = {
  kind: 'workflow',
  arguments: { prompt: 'a lighthouse at dusk' },
  steps: [
    {
      name: 'draw',
      $type: 'imageGen',
      input: {
        engine: 'google',
        model: 'nano-banana-2',
        prompt: { $ref: '$arguments', path: 'prompt' },
      },
      suppressOutput: true,
    },
    {
      name: 'cutout',
      $type: 'imageBackgroundRemoval',
      input: { image: { $ref: 'draw', path: 'output.images[0].url' } },
    },
  ],
};

const WORKFLOW_ID = '4417-20261013101112131';

const PRICED: BlockWorkflowSnapshot = {
  workflowId: 'estimate',
  status: 'pending',
  cost: { total: 37, authorFee: 3 },
};
const REFUSED_ESTIMATE: BlockWorkflowSnapshot = {
  workflowId: 'failed',
  status: 'failed',
  error: 'Step 1 references a step that does not exist.',
  errorCode: 'workflow_ref_invalid',
};
const OVER_BUDGET: BlockWorkflowSnapshot = {
  workflowId: 'failed',
  status: 'failed',
  cost: { total: 912 },
  error: 'This generation costs more than the app may spend per call.',
};
const snapshot = (
  status: BlockWorkflowSnapshot['status'],
  extra: Partial<BlockWorkflowSnapshot> = {},
): BlockWorkflowSnapshot => ({ workflowId: WORKFLOW_ID, status, ...extra });

async function client(responses: Parameters<typeof fakeFetch>[0]) {
  const { fetch, calls } = fakeFetch(responses);
  const app = await initialize({ token: 'block-jwt-1', fetch });
  return { workflows: app.workflows as WorkflowsClient, calls };
}

const sentBody = (call: FetchCall) => JSON.parse(call.body!) as unknown;

afterEach(() => {
  vi.useRealTimers();
});

describe('AppClient.workflows — estimate', () => {
  it('posts `{ body }` to blocks/workflows/estimate and resolves the snapshot', async () => {
    const { workflows, calls } = await client([() => json(200, { snapshot: PRICED })]);

    await expect(workflows.estimate(BODY)).resolves.toEqual({
      workflowId: 'estimate',
      status: 'pending',
      cost: { total: 37, authorFee: 3 },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://civitai.com/api/v1/blocks/workflows/estimate',
      headers: { Authorization: 'Bearer block-jwt-1', 'Content-Type': 'application/json' },
    });
    expect(sentBody(calls[0]!)).toEqual({ body: BODY_ON_THE_WIRE });
  });

  it('🔴 a refused estimate RESOLVES with the failed snapshot — it is an answer, not a throw', async () => {
    const { workflows } = await client([() => json(200, { snapshot: REFUSED_ESTIMATE })]);

    const refused = await workflows.estimate(BODY);

    expect(refused.status).toBe('failed');
    expect(refused.errorCode).toBe('workflow_ref_invalid');
    expect(refused.error).toBe('Step 1 references a step that does not exist.');
    expect(refused.cost).toBeUndefined();
  });

  it('rejects with the API error when the request itself is refused', async () => {
    const { workflows } = await client([() => json(400, { error: 'Invalid request body' })]);

    const error = await workflows.estimate(BODY).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).message).toBe('Invalid request body');
  });

  it('🔴 throws on a 2xx that carried no snapshot, rather than inventing one', async () => {
    const { workflows } = await client([() => json(200, { notASnapshot: true })]);

    const error = await workflows.estimate(BODY).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CivitaiError);
    expect(error).not.toBeInstanceOf(ApiError);
    expect((error as Error).message).toContain('estimate');
  });

  it('throws on a snapshot with no status — a caller branches on it', async () => {
    const { workflows } = await client([() => json(200, { snapshot: { workflowId: 'x' } })]);

    await expect(workflows.estimate(BODY)).rejects.toBeInstanceOf(CivitaiError);
  });
});

describe('AppClient.workflows — submit', () => {
  it('posts `{ body, idempotencyKey }` to blocks/workflows/submit', async () => {
    const { workflows, calls } = await client([
      () => json(200, { snapshot: snapshot('pending', { cost: { total: 41 } }) }),
    ]);

    await expect(
      workflows.submit(BODY, { idempotencyKey: 'order-7f3a_retry-safe' }),
    ).resolves.toEqual({ workflowId: '4417-20261013101112131', status: 'pending', cost: { total: 41 } });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://civitai.com/api/v1/blocks/workflows/submit',
      headers: { Authorization: 'Bearer block-jwt-1' },
    });
    expect(sentBody(calls[0]!)).toEqual({
      body: BODY_ON_THE_WIRE,
      idempotencyKey: 'order-7f3a_retry-safe',
    });
  });

  it('🔴 a budget refusal RESOLVES with the failed snapshot and the price it refused', async () => {
    const { workflows } = await client([() => json(200, { snapshot: OVER_BUDGET })]);

    const refused = await workflows.submit(BODY, { idempotencyKey: 'k-1' });

    expect(refused.status).toBe('failed');
    expect(refused.cost).toEqual({ total: 912 });
  });

  it.each([
    ['no options at all', undefined],
    ['options without a key', {}],
    ['an empty key', { idempotencyKey: '' }],
    ['a key that is not a string', { idempotencyKey: 12 }],
  ])('🔴 refuses %s before any request — nothing is sent', async (_label, opts) => {
    const { workflows, calls } = await client([]);

    const error = await workflows.submit(BODY, opts as never).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CivitaiError);
    expect((error as Error).message).toContain('idempotencyKey');
    expect(calls).toEqual([]);
  });

  it('sends the key as given — the host owns the format rule and answers 400 itself', async () => {
    const { workflows, calls } = await client([
      () => json(400, { error: 'Invalid request body' }),
    ]);

    const error = await workflows.submit(BODY, { idempotencyKey: 'sheet:panel' }).catch((e) => e);

    expect((sentBody(calls[0]!) as { idempotencyKey: string }).idempotencyKey).toBe('sheet:panel');
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
  });

  it('does not retry a failed submit on its own', async () => {
    const { workflows, calls } = await client([() => json(503, { message: 'unavailable' })]);

    await expect(workflows.submit(BODY, { idempotencyKey: 'k-2' })).rejects.toMatchObject({
      status: 503,
    });
    expect(calls).toHaveLength(1);
  });
});

/**
 * The one reply on these routes that carries a field BESIDE `snapshot`. The host
 * sends it when it could not learn whether a viewer-confirmed run was created:
 * the run may be live and charged. The snapshot beside it is shaped exactly like
 * a refusal, so only the flag tells the two apart.
 */
describe('AppClient.workflows — submit, when the host could not confirm the run', () => {
  const TRAINING: WorkflowBody = {
    kind: 'training',
    datasetId: 'tds_0123456789abcdef0123456789abcdef',
    engine: 'ai-toolkit',
    model: 'sdxl',
    params: { engine: 'ai-toolkit', ecosystem: 'sdxl' } as never,
    triggerWord: 'lighthousestyle',
    samplePrompts: ['a lighthouse at dusk'],
    quoteId: 'tq_0123456789abcdef0123456789abcdef',
  };
  const CONFIRMED_STEP: WorkflowBody = {
    kind: 'step',
    $type: 'videoGen',
    input: { prompt: 'waves against a lighthouse' },
    maxBuzz: 250,
    quoteId: 'sq_fedcba9876543210fedcba9876543210',
  };

  it.each([
    ['a `kind: "training"` run', TRAINING, 4_800, 'key-train-1'],
    ['a step that carries a `quoteId`', CONFIRMED_STEP, 163, 'key-step-1'],
  ])('🔴 rejects for %s — an unknown outcome is not a refusal', async (_label, body, total, key) => {
    const { workflows, calls } = await client([
      () =>
        json(200, {
          snapshot: {
            workflowId: 'failed',
            status: 'failed',
            cost: { total },
            error: 'We could not confirm this run was started.',
          },
          submissionUnconfirmed: true,
        }),
    ]);

    const error = await workflows.submit(body, { idempotencyKey: key }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SubmissionUnconfirmedError);
    expect(error).toBeInstanceOf(CivitaiError);
    expect(error).not.toBeInstanceOf(ApiError);
    expect((error as Error).name).toBe('SubmissionUnconfirmedError');
    // The price the host had reserved travels on the error.
    expect((error as SubmissionUnconfirmedError).snapshot).toEqual({
      workflowId: 'failed',
      status: 'failed',
      cost: { total },
      error: 'We could not confirm this run was started.',
    });
    // The message says what the caller must not conclude.
    expect((error as Error).message).toContain('may be running');
    expect((error as Error).message).toContain('charged');
    // One request: the client does not resubmit on its own.
    expect(calls).toHaveLength(1);
    expect(sentBody(calls[0]!)).toMatchObject({ idempotencyKey: key, body: { quoteId: body.kind === 'training' ? 'tq_0123456789abcdef0123456789abcdef' : 'sq_fedcba9876543210fedcba9876543210' } });
  });

  it('CONTROL — the same snapshot WITHOUT the flag is a refusal, and resolves', async () => {
    const { workflows } = await client([
      () =>
        json(200, {
          snapshot: { workflowId: 'failed', status: 'failed', cost: { total: 4_800 }, error: 'Over the daily limit.' },
        }),
    ]);

    await expect(workflows.submit(TRAINING, { idempotencyKey: 'key-train-2' })).resolves.toEqual({
      workflowId: 'failed',
      status: 'failed',
      cost: { total: 4_800 },
      error: 'Over the daily limit.',
    });
  });

  it('only `true` is the flag — a started run that happens to carry `false` resolves', async () => {
    const { workflows } = await client([
      () => json(200, { snapshot: snapshot('pending'), submissionUnconfirmed: false }),
    ]);

    await expect(workflows.submit(CONFIRMED_STEP, { idempotencyKey: 'key-step-2' })).resolves.toMatchObject({
      status: 'pending',
    });
  });

  it('still rejects as unconfirmed when the flag arrives with no usable snapshot', async () => {
    const { workflows } = await client([() => json(200, { submissionUnconfirmed: true })]);

    const error = await workflows.submit(TRAINING, { idempotencyKey: 'key-train-3' }).catch((e) => e);

    expect(error).toBeInstanceOf(SubmissionUnconfirmedError);
    expect((error as SubmissionUnconfirmedError).snapshot).toBeUndefined();
  });
});

describe('AppClient.workflows — get', () => {
  it('posts the id in the BODY of blocks/workflows/poll, never in the URL', async () => {
    const { workflows, calls } = await client([
      () => json(200, { snapshot: snapshot('processing') }),
    ]);

    await expect(workflows.get(WORKFLOW_ID)).resolves.toEqual({
      workflowId: '4417-20261013101112131',
      status: 'processing',
    });

    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://civitai.com/api/v1/blocks/workflows/poll',
    });
    // Exactly one key: an unset `waitSeconds` is not sent at all.
    expect(sentBody(calls[0]!)).toEqual({ workflowId: '4417-20261013101112131' });
  });

  it('passes `waitSeconds` through for a held read', async () => {
    const { workflows, calls } = await client([
      () => json(200, { snapshot: snapshot('succeeded') }),
    ]);

    await workflows.get(WORKFLOW_ID, { waitSeconds: 7 });

    expect(sentBody(calls[0]!)).toEqual({ workflowId: '4417-20261013101112131', waitSeconds: 7 });
  });

  it('rejects an ownership refusal with its status', async () => {
    const { workflows } = await client([() => json(403, { message: 'FORBIDDEN' })]);

    await expect(workflows.get('9-1')).rejects.toMatchObject({ name: 'ApiError', status: 403 });
  });

  it('throws on a 2xx with no snapshot', async () => {
    const { workflows } = await client([() => json(200, {})]);

    await expect(workflows.get(WORKFLOW_ID)).rejects.toBeInstanceOf(CivitaiError);
  });
});

describe('AppClient.workflows — cancel', () => {
  it('posts `{ workflowId }` to blocks/workflows/cancel and resolves the snapshot', async () => {
    const { workflows, calls } = await client([
      () => json(200, { snapshot: snapshot('canceled') }),
    ]);

    await expect(workflows.cancel(WORKFLOW_ID)).resolves.toEqual({
      workflowId: '4417-20261013101112131',
      status: 'canceled',
    });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://civitai.com/api/v1/blocks/workflows/cancel',
    });
    expect(sentBody(calls[0]!)).toEqual({ workflowId: '4417-20261013101112131' });
  });

  it('resolves whatever state the host reports — a cancel is not always a stop', async () => {
    const { workflows } = await client([() => json(200, { snapshot: snapshot('succeeded') })]);

    await expect(workflows.cancel(WORKFLOW_ID)).resolves.toMatchObject({ status: 'succeeded' });
  });
});

describe('AppClient.workflows — list', () => {
  const ROW: AppWorkflow = {
    workflowId: WORKFLOW_ID,
    status: 'succeeded',
    images: [{ url: 'https://example.test/a.png', width: 832, height: 1216, nsfwLevel: 1 }],
    cost: 23,
    createdAt: '2026-10-13T10:11:12.131Z',
  };

  it('posts an empty object to blocks/workflows/query when given nothing', async () => {
    const { workflows, calls } = await client([() => json(200, { workflows: [ROW], cursor: 'next-9' })]);

    await expect(workflows.list()).resolves.toEqual({
      workflows: [
        {
          workflowId: '4417-20261013101112131',
          status: 'succeeded',
          images: [{ url: 'https://example.test/a.png', width: 832, height: 1216, nsfwLevel: 1 }],
          cost: 23,
          createdAt: '2026-10-13T10:11:12.131Z',
        },
      ],
      cursor: 'next-9',
    });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://civitai.com/api/v1/blocks/workflows/query',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(calls[0]!.body).toBe('{}');
  });

  it('sends `cursor` and `limit`, and nothing else a caller smuggles in', async () => {
    const { workflows, calls } = await client([() => json(200, { workflows: [], cursor: null })]);

    const page = await workflows.list({ cursor: 'next-9', limit: 5, tags: ['other-app'] } as never);

    // The route's body schema is closed: an extra key is a 400, not a filter.
    expect(sentBody(calls[0]!)).toEqual({ cursor: 'next-9', limit: 5 });
    // `null` is the host's word for "last page" and is passed through as it is.
    expect(page).toEqual({ workflows: [], cursor: null });
  });

  it('🔴 throws on a 2xx with no `workflows` array, rather than answering "empty"', async () => {
    const { workflows } = await client([() => json(200, { cursor: null })]);

    await expect(workflows.list()).rejects.toBeInstanceOf(CivitaiError);
  });

  it('rejects a rate-limit refusal — it is not an empty queue', async () => {
    const { workflows } = await client([() => json(429, { message: 'TOO_MANY_REQUESTS' })]);

    await expect(workflows.list()).rejects.toMatchObject({ status: 429 });
  });
});

describe('AppClient.workflows — watch and wait', () => {
  it('reads once, then holds each later read, and ends at a final status', async () => {
    const { workflows, calls } = await client([
      () => json(200, { snapshot: snapshot('pending') }),
      () => json(200, { snapshot: snapshot('processing') }),
      () => json(200, { snapshot: snapshot('succeeded', { imageUrls: ['https://example.test/1.png'] }) }),
    ]);

    const seen: string[] = [];
    for await (const s of workflows.watch(WORKFLOW_ID, { intervalMs: 0, waitSeconds: 9 })) {
      seen.push(s.status);
    }

    expect(seen).toEqual(['pending', 'processing', 'succeeded']);
    expect(calls.map((c) => c.url)).toEqual([`${ROUTE}/poll`, `${ROUTE}/poll`, `${ROUTE}/poll`]);
    expect(calls.map(sentBody)).toEqual([
      { workflowId: '4417-20261013101112131' },
      { workflowId: '4417-20261013101112131', waitSeconds: 9 },
      { workflowId: '4417-20261013101112131', waitSeconds: 9 },
    ]);
  });

  it('holds reads by default — the second read asks the host to wait', async () => {
    const { workflows, calls } = await client([
      () => json(200, { snapshot: snapshot('pending') }),
      () => json(200, { snapshot: snapshot('succeeded') }),
    ]);

    await workflows.wait(WORKFLOW_ID, { intervalMs: 0 });

    const second = sentBody(calls[1]!) as { waitSeconds?: unknown };
    expect(typeof second.waitSeconds).toBe('number');
    expect(second.waitSeconds).toBeGreaterThan(0);
  });

  it('does not yield a snapshot that did not change', async () => {
    const { workflows } = await client([
      () => json(200, { snapshot: snapshot('processing') }),
      () => json(200, { snapshot: snapshot('processing') }),
      () => json(200, { snapshot: snapshot('processing', { imageUrls: ['https://example.test/1.png'] }) }),
      () => json(200, { snapshot: snapshot('failed', { error: 'boom' }) }),
    ]);

    const seen: BlockWorkflowSnapshot[] = [];
    for await (const s of workflows.watch(WORKFLOW_ID, { intervalMs: 0 })) seen.push(s);

    expect(seen.map((s) => [s.status, s.imageUrls?.length ?? 0])).toEqual([
      ['processing', 0],
      ['processing', 1],
      ['failed', 0],
    ]);
  });

  it('🔴 spaces its reads — a host that answers at once is not hammered', async () => {
    vi.useFakeTimers();
    const { workflows, calls } = await client([
      () => json(200, { snapshot: snapshot('processing') }),
      () => json(200, { snapshot: snapshot('succeeded') }),
    ]);

    const done = workflows.wait(WORKFLOW_ID, { intervalMs: 730 });

    await vi.advanceTimersByTimeAsync(729);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(done).resolves.toMatchObject({ status: 'succeeded' });
    expect(calls).toHaveLength(2);
  });

  it('`wait` resolves a failed workflow rather than throwing', async () => {
    const { workflows } = await client([
      () => json(200, { snapshot: snapshot('failed', { error: 'boom', cost: { total: 12 } }) }),
    ]);

    await expect(workflows.wait(WORKFLOW_ID, { intervalMs: 0 })).resolves.toEqual({
      workflowId: '4417-20261013101112131',
      status: 'failed',
      error: 'boom',
      cost: { total: 12 },
    });
  });

  it('waits out a blip but not a refusal', async () => {
    vi.useFakeTimers();
    const blip = await client([
      () => json(200, { snapshot: snapshot('processing') }),
      () => json(503, { message: 'unavailable' }),
      () => json(200, { snapshot: snapshot('succeeded') }),
    ]);
    const settled = blip.workflows.wait(WORKFLOW_ID, { intervalMs: 0 });
    await vi.runAllTimersAsync();
    await expect(settled).resolves.toMatchObject({ status: 'succeeded' });
    expect(blip.calls).toHaveLength(3);

    const refusal = await client([
      () => json(200, { snapshot: snapshot('processing') }),
      () => json(403, { message: 'FORBIDDEN' }),
    ]);
    const refused = refusal.workflows.wait(WORKFLOW_ID, { intervalMs: 0 }).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    expect(await refused).toMatchObject({ name: 'ApiError', status: 403 });
    expect(refusal.calls).toHaveLength(2);
  });

  it('gives up on a failure that does not clear, with the last error', async () => {
    vi.useFakeTimers();
    const { workflows, calls } = await client([
      () => json(200, { snapshot: snapshot('processing') }),
      () => json(503, { message: 'unavailable' }),
      () => json(502, { message: 'bad gateway' }),
      () => json(503, { message: 'unavailable' }),
      () => json(504, { message: 'gateway timeout' }),
      () => json(200, { snapshot: snapshot('succeeded') }),
    ]);

    const settled = workflows.wait(WORKFLOW_ID, { intervalMs: 0 }).catch((e: unknown) => e);
    await vi.runAllTimersAsync();

    expect(await settled).toMatchObject({ name: 'ApiError', status: 504 });
    // One good read, then four failed ones: three waited out, the fourth final.
    expect(calls).toHaveLength(5);
  });

  it.each(['canceled', 'expired'] as const)('`wait` ends on `%s` after ONE read — it is final', async (status) => {
    vi.useFakeTimers();
    // Nothing else is scripted: a second read would have no answer to get.
    const { workflows, calls } = await client([() => json(200, { snapshot: snapshot(status) })]);

    const settled = workflows.wait(WORKFLOW_ID, { intervalMs: 0 }).catch((e: unknown) => e);
    await vi.runAllTimersAsync();

    expect(await settled).toEqual({ workflowId: '4417-20261013101112131', status });
    expect(calls).toHaveLength(1);
  });

  it.each(['canceled', 'expired'] as const)('`watch` stops iterating at `%s`', async (status) => {
    vi.useFakeTimers();
    const { workflows, calls } = await client([
      () => json(200, { snapshot: snapshot('processing') }),
      () => json(200, { snapshot: snapshot(status) }),
    ]);

    const seen: string[] = [];
    const finished = (async () => {
      for await (const s of workflows.watch(WORKFLOW_ID, { intervalMs: 0 })) seen.push(s.status);
      return 'ended';
    })().catch(() => 'threw');
    await vi.runAllTimersAsync();

    expect(await finished).toBe('ended');
    expect(seen).toEqual(['processing', status]);
    expect(calls).toHaveLength(2);
  });

  it('counts CONSECUTIVE failures only — five blips spread over a long watch do not end it', async () => {
    vi.useFakeTimers();
    const blip = () => json(503, { message: 'unavailable' });
    const progress = (n: number) => () =>
      json(200, { snapshot: snapshot('processing', { imageUrls: Array.from({ length: n }, (_, i) => `https://example.test/${i}.png`) }) });
    const { workflows, calls } = await client([
      progress(0),
      blip,
      progress(1),
      blip,
      progress(2),
      blip,
      progress(3),
      blip,
      progress(4),
      blip,
      () => json(200, { snapshot: snapshot('succeeded') }),
    ]);

    const settled = workflows.wait(WORKFLOW_ID, { intervalMs: 0 }).catch((e: unknown) => e);
    await vi.runAllTimersAsync();

    // Five failures in total, never two in a row: every one is waited out.
    expect(await settled).toEqual({ workflowId: '4417-20261013101112131', status: 'succeeded' });
    expect(calls).toHaveLength(11);
  });

  it('waits before re-reading after a failed read — a failing host is not retried at once', async () => {
    vi.useFakeTimers();
    const { workflows, calls } = await client([
      () => json(200, { snapshot: snapshot('processing') }),
      () => json(503, { message: 'unavailable' }),
      () => json(200, { snapshot: snapshot('succeeded') }),
    ]);

    const settled = workflows.wait(WORKFLOW_ID, { intervalMs: 0 });
    await vi.advanceTimersByTimeAsync(0);
    // The good read and the failed one have happened; the retry has not.
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toHaveLength(2);

    await vi.runAllTimersAsync();
    await expect(settled).resolves.toMatchObject({ status: 'succeeded' });
    expect(calls).toHaveLength(3);
  });

  it('an abort DURING a held read rejects with the reason and sends nothing more', async () => {
    vi.useFakeTimers();
    const urls: string[] = [];
    const fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
      urls.push(String(input));
      if (urls.length === 1) return Promise.resolve(json(200, { snapshot: snapshot('processing') }));
      // Every later read is held open until the caller's signal fires.
      return new Promise<Response>((_resolve, reject) => {
        const signal = init.signal!;
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }) as typeof globalThis.fetch;
    const app = await initialize({ token: 'block-jwt-1', fetch });
    const controller = new AbortController();
    const reason = new Error('navigated away');

    const settled = app.workflows
      .wait(WORKFLOW_ID, { intervalMs: 0, signal: controller.signal })
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(0);
    expect(urls).toHaveLength(2); // the held read is in flight

    controller.abort(reason);
    // Long enough for every back-off this client has: none may be spent on a retry.
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await settled).toBe(reason);
    expect(urls).toHaveLength(2);
  });

  it('stops reading when the caller stops watching', async () => {
    const { workflows, calls } = await client([
      () => json(200, { snapshot: snapshot('processing') }),
      () => json(200, { snapshot: snapshot('succeeded') }),
    ]);

    for await (const s of workflows.watch(WORKFLOW_ID, { intervalMs: 0 })) {
      expect(s.status).toBe('processing');
      break;
    }

    expect(calls).toHaveLength(1);
  });

  it('rejects with the abort reason when the signal fires between reads', async () => {
    vi.useFakeTimers();
    const { workflows, calls } = await client([
      () => json(200, { snapshot: snapshot('processing') }),
    ]);
    const controller = new AbortController();
    const reason = new Error('navigated away');

    const settled = workflows
      .wait(WORKFLOW_ID, { intervalMs: 5_000, signal: controller.signal })
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10);
    controller.abort(reason);

    expect(await settled).toBe(reason);
    expect(calls).toHaveLength(1);
  });
});

describe('AppClient.workflows — which token reaches it', () => {
  const blockToken = { raw: 'jwt', scopes: ['ai:write:budgeted'], expiresAt: new Date(0), kind: 'block' as const };

  function blockTransport() {
    const transport = createFakeTransport({ token: blockToken, viewer: { id: 7, username: 'viewer' } });
    transport.handle('REQUEST_TOKEN', () => ({
      token: { ...blockToken, expiresAt: new Date(0).toISOString() },
    }));
    return transport;
  }

  it('a block holding the block token is served — the routes were minted for it', async () => {
    const { fetch, calls } = fakeFetch([() => json(200, { snapshot: PRICED })]);
    const app = await initialize({ transport: blockTransport(), fetch });

    await expect(app.workflows.estimate(BODY)).resolves.toMatchObject({ cost: { total: 37 } });
    expect(calls[0]).toMatchObject({
      url: 'https://civitai.com/api/v1/blocks/workflows/estimate',
      headers: { Authorization: 'Bearer jwt' },
    });
  });

  it('🔴 is NOT the orchestrator client: the block token that one refuses is sent here', async () => {
    const { fetch, calls } = fakeFetch([
      () => json(200, { snapshot: snapshot('pending') }),
    ]);
    const app = await initialize({ transport: blockTransport(), fetch });

    await expect(app.orchestration.submitWorkflow({ steps: [] })).rejects.toBeInstanceOf(CivitaiError);
    expect(calls).toEqual([]);

    await app.workflows.submit(BODY, { idempotencyKey: 'k-3' });
    expect(calls.map((c) => c.url)).toEqual(['https://civitai.com/api/v1/blocks/workflows/submit']);
  });

  it('leaves a refusal here alone — no `auth: "oauth"` advice on the block token\'s own routes', async () => {
    const { fetch } = fakeFetch([
      () => json(401, { error: 'invalid block token' }),
      () => json(401, { error: 'invalid block token' }),
    ]);
    const app = await initialize({ transport: blockTransport(), fetch });

    const error = await app.workflows.get(WORKFLOW_ID).catch((e: unknown) => e);

    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).message).toBe('invalid block token');
  });

  it('🔴 explains a 401 to a block holding an OAuth access token — these routes take the block token', async () => {
    const oauthToken = { raw: 'oauth-access', scopes: ['ai:write:budgeted'], expiresAt: new Date(0), kind: 'oauth' as const };
    const transport = createFakeTransport({ token: oauthToken, viewer: { id: 7, username: 'viewer' } });
    transport.handle('REQUEST_TOKEN', () => ({
      token: { ...oauthToken, expiresAt: new Date(0).toISOString() },
    }));
    const { fetch } = fakeFetch([
      () => json(401, { error: 'Block token required' }),
      () => json(401, { error: 'Block token required' }),
    ]);
    const app = await initialize({ transport, fetch });

    const error = await app.workflows.estimate(BODY).catch((e: unknown) => e);

    // The status and body a caller branches on are untouched.
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).body).toEqual({ error: 'Block token required' });
    // The server's sentence stays first; the diagnosis is added to it.
    expect((error as ApiError).message.startsWith('Block token required')).toBe(true);
    expect((error as ApiError).message).toContain('OAuth access token');
    expect((error as ApiError).message).toContain('app.orchestration');
  });

  it('adds nothing to a failure the token kind cannot explain', async () => {
    const oauthToken = { raw: 'oauth-access', scopes: [], expiresAt: new Date(0), kind: 'oauth' as const };
    const transport = createFakeTransport({ token: oauthToken, viewer: { id: 7, username: 'viewer' } });
    const { fetch } = fakeFetch([() => json(403, { message: 'FORBIDDEN' })]);
    const app = await initialize({ transport, fetch });

    const error = await app.workflows.get(WORKFLOW_ID).catch((e: unknown) => e);

    expect((error as ApiError).status).toBe(403);
    expect((error as ApiError).message).toBe('FORBIDDEN');
  });

  it('adds nothing for `initialize({ token })`, which knows no token kind', async () => {
    const { workflows } = await client([
      () => json(401, { error: 'Block token required' }),
      () => json(401, { error: 'Block token required' }),
    ]);

    const error = await workflows.estimate(BODY).catch((e: unknown) => e);

    expect((error as ApiError).message).toBe('Block token required');
  });

  it('follows a `siteUrl` override', async () => {
    const { fetch, calls } = fakeFetch([() => json(200, { snapshot: PRICED })]);
    const app = await initialize({ token: 't', siteUrl: 'http://localhost:3000/api/v1/', fetch });

    await app.workflows.estimate(BODY);

    expect(calls[0]!.url).toBe('http://localhost:3000/api/v1/blocks/workflows/estimate');
  });
});
