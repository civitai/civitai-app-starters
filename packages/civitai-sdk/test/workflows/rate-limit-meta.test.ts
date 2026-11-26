import { describe, expect, expectTypeOf, it } from 'vitest';

import type { RateLimitMeta as CoreRateLimitMeta } from '../../src/core/errors.js';
import { ApiError, initialize, type RateLimitMeta, type WorkflowBody } from '../../src/index.js';
import { fakeFetch, json } from '../support/fake-fetch.js';

/**
 * A workflow call refused under a rate limit carries the limit's retry metadata: on the snapshot
 * (`snapshot.rateLimit`) when the host answered with one, and on `ApiError.rateLimit` when it
 * answered `429`. Each fixture's values are distinct, so a read of the wrong field shows.
 */
const BODY: WorkflowBody = {
  kind: 'textToImage',
  modelId: 7,
  modelVersionId: 99,
  params: { prompt: 'a fox' },
};

const POLL_LIMIT: RateLimitMeta = {
  retryAfterSeconds: 23,
  retryAt: '2026-05-06T07:08:31.000Z',
  id: 'apps.poll',
  kind: 'abuse',
};
const CATALOG_LIMIT: RateLimitMeta = {
  retryAfterSeconds: 41,
  retryAt: '2026-05-06T07:08:49.000Z',
  id: 'apps.catalog',
  kind: 'abuse',
};

describe('RateLimitMeta — one shape on both surfaces', () => {
  it("the root export (the snapshot's) is core's (BridgeError's), in both directions", () => {
    expectTypeOf<RateLimitMeta>().toEqualTypeOf<CoreRateLimitMeta>();
  });
});

describe('ApiError.rateLimit', () => {
  it("is the body's meta on a 429", () => {
    const err = new ApiError(429, 'Rate limit exceeded', {
      error: 'Rate limit exceeded',
      code: 'TOO_MANY_REQUESTS',
      rateLimit: { ...CATALOG_LIMIT, extra: 'dropped' },
    });
    expect(err.rateLimit).toStrictEqual(CATALOG_LIMIT);
  });

  it('is absent — no own property — when the body carries none or a malformed one', () => {
    for (const body of [{ error: 'x' }, { rateLimit: { retryAfterSeconds: 'soon' } }, 'text', null]) {
      expect('rateLimit' in new ApiError(429, 'x', body)).toBe(false);
    }
  });

  it('a rate-limited REST estimate rejects with the meta, end to end through the real client', async () => {
    const { fetch } = fakeFetch([
      () =>
        json(429, {
          error: 'Rate limit exceeded, please retry shortly.',
          message: 'Rate limit exceeded, please retry shortly.',
          code: 'TOO_MANY_REQUESTS',
          rateLimit: CATALOG_LIMIT,
        }),
    ]);
    const app = await initialize({ token: 'block-jwt-1', fetch });
    const err = await app.workflows.estimate(BODY).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(429);
    expect((err as ApiError).rateLimit).toStrictEqual(CATALOG_LIMIT);
  });
});

describe('snapshot.rateLimit', () => {
  it('a shed poll resolves with the meta on its throttled snapshot', async () => {
    const shed = { workflowId: 'wf_1', status: 'processing', throttled: true, rateLimit: POLL_LIMIT };
    const { fetch } = fakeFetch([() => json(200, { snapshot: shed })]);
    const app = await initialize({ token: 'block-jwt-1', fetch });
    const snapshot = await app.workflows.get('wf_1');
    expect(snapshot.throttled).toBe(true);
    expect(snapshot.rateLimit).toStrictEqual(POLL_LIMIT);
  });
});
