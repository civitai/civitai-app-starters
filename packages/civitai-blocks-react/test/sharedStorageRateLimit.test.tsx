import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { SharedStorageRateLimitError, useSharedStorage } from '../src/hooks/useSharedStorage.js';
import { SharedStorageRateLimitError as PublicSharedStorageRateLimitError } from '../src/index.js';
import { getTransport } from '../src/transport/singleton.js';
import { resetTransport } from '../src/testing.js';
import { parseSharedStorageRateLimit } from '../src/transport/validate.js';

/**
 * Shared-storage rate-limit metadata (#597): the optional `rateLimit` the host
 * puts beside `error` on the six shared WRITE replies.
 *
 *  - `parseSharedStorageRateLimit` accepts exactly the platform's valid shape;
 *  - the hook throws `SharedStorageRateLimitError` (an `Error` subclass) with
 *    the exact fields when it is valid, and the plain `Error` when it is absent
 *    or malformed — the transport delivers it as sent, so the hook's parse is
 *    the only thing standing between a malformed value and the caller.
 *
 * Fixture values are pairwise distinct and distinct from every default in the
 * code (the mock host's 60s), so a hardcoded literal cannot pass.
 */

const VALID = { retryAfterSeconds: 312, retryAt: '2031-04-05T06:07:08.000Z' };

/** Every malformed shape, named, so a failure says which one leaked. */
const MALFORMED: Array<[string, unknown]> = [
  ['retryAfterSeconds is a string', { retryAfterSeconds: '312', retryAt: VALID.retryAt }],
  ['retryAfterSeconds is negative', { retryAfterSeconds: -5, retryAt: VALID.retryAt }],
  ['retryAfterSeconds is zero', { retryAfterSeconds: 0, retryAt: VALID.retryAt }],
  ['retryAfterSeconds is fractional', { retryAfterSeconds: 1.5, retryAt: VALID.retryAt }],
  ['retryAfterSeconds is NaN', { retryAfterSeconds: Number.NaN, retryAt: VALID.retryAt }],
  ['retryAfterSeconds is missing', { retryAt: VALID.retryAt }],
  ['retryAt is missing', { retryAfterSeconds: 312 }],
  ['retryAt is a number', { retryAfterSeconds: 312, retryAt: 1_900_000_000_000 }],
  ['retryAt is not a date', { retryAfterSeconds: 312, retryAt: 'soon' }],
  ['retryAt is empty', { retryAfterSeconds: 312, retryAt: '' }],
  ['a string', 'retry in 312s'],
  ['a number', 312],
  ['null', null],
  ['an array', [312, VALID.retryAt]],
];

describe('parseSharedStorageRateLimit', () => {
  it('returns exactly the two known fields of a valid value (extra keys dropped)', () => {
    expect(parseSharedStorageRateLimit({ ...VALID, internal: 'leak' })).toEqual({
      retryAfterSeconds: 312,
      retryAt: '2031-04-05T06:07:08.000Z',
    });
  });

  it('accepts the boundary retryAfterSeconds = 1', () => {
    expect(parseSharedStorageRateLimit({ retryAfterSeconds: 1, retryAt: VALID.retryAt })).toEqual({
      retryAfterSeconds: 1,
      retryAt: '2031-04-05T06:07:08.000Z',
    });
  });

  it('returns undefined for undefined (absent)', () => {
    expect(parseSharedStorageRateLimit(undefined)).toBeUndefined();
  });

  for (const [name, value] of MALFORMED) {
    it(`returns undefined when ${name}`, () => {
      expect(parseSharedStorageRateLimit(value)).toBeUndefined();
    });
  }
});

// ---------------------------------------------------------------------------
// The SDK call path: useSharedStorage over the real iframe transport.
// ---------------------------------------------------------------------------

const PARENT_ORIGIN = 'https://civitai.com';

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

function reply(data: unknown) {
  window.dispatchEvent(new MessageEvent('message', { data, origin: PARENT_ORIGIN }));
}

type Shared = ReturnType<typeof useSharedStorage>;

const CALLS: Array<{
  name: string;
  call: (s: Shared) => Promise<unknown>;
  reply: string;
  failure: Record<string, unknown>;
  message: string;
}> = [
  {
    name: 'append',
    call: (s) => s.append({ title: 't' }),
    reply: 'SHARED_APPEND_RESULT',
    failure: { key: '' },
    message: 'Too many submissions — retry in 312s',
  },
  {
    name: 'update',
    call: (s) => s.update('k', { title: 't' }),
    reply: 'SHARED_UPDATE_RESULT',
    failure: { ok: false },
    message: 'Too many submissions — retry in 312s',
  },
  {
    name: 'vote',
    call: (s) => s.vote('k'),
    reply: 'SHARED_VOTE_RESULT',
    failure: { count: 0 },
    message: 'Too many votes — retry in 312s',
  },
  {
    name: 'unvote',
    call: (s) => s.unvote('k'),
    reply: 'SHARED_UNVOTE_RESULT',
    failure: { count: 0 },
    message: 'Too many votes — retry in 312s',
  },
  {
    name: 'withdraw',
    call: (s) => s.withdraw('k'),
    reply: 'SHARED_WITHDRAW_RESULT',
    failure: { ok: false, deleted: false },
    message: 'Too many withdrawals — retry in 312s',
  },
  {
    name: 'report',
    call: (s) => s.report('k'),
    reply: 'SHARED_REPORT_RESULT',
    failure: { ok: false },
    message: 'Too many reports — retry in 312s',
  },
];

describe('useSharedStorage — rate-limited refusals', () => {
  let postMessageMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    postMessageMock = vi.fn();
    Object.defineProperty(window, 'parent', {
      value: { postMessage: postMessageMock },
      configurable: true,
      writable: true,
    });
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    reply({ type: 'BLOCK_INIT', payload: buildInit() });
    postMessageMock.mockClear();
  });

  afterEach(() => {
    resetTransport();
  });

  /** Start `call`, answer it with `fields`, and return what it rejected with. */
  async function settle(
    call: (s: Shared) => Promise<unknown>,
    replyType: string,
    fields: Record<string, unknown>,
  ): Promise<unknown> {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = call(result.current);
    });
    const calls = postMessageMock.mock.calls;
    const sent = calls[calls.length - 1][0] as { payload: { requestId: string } };
    act(() => {
      reply({ type: replyType, payload: { requestId: sent.payload.requestId, ...fields } });
    });
    return p.then(
      () => {
        throw new Error('expected the call to reject');
      },
      (e: unknown) => e,
    );
  }

  it('the error class is exported from the package root', () => {
    expect(typeof PublicSharedStorageRateLimitError).toBe('function');
    expect(PublicSharedStorageRateLimitError).toBe(SharedStorageRateLimitError);
    expect(Object.getPrototypeOf(PublicSharedStorageRateLimitError)).toBe(Error);
  });

  for (const c of CALLS) {
    it(`${c.name}() throws SharedStorageRateLimitError with the exact fields`, async () => {
      const err = await settle(c.call, c.reply, {
        ...c.failure,
        error: c.message,
        rateLimit: { ...VALID },
      });
      expect(err).toBeInstanceOf(SharedStorageRateLimitError);
      // Existing `catch (e) { if (e instanceof Error) … }` code keeps working.
      expect(err).toBeInstanceOf(Error);
      const rl = err as SharedStorageRateLimitError;
      expect(rl.name).toBe('SharedStorageRateLimitError');
      expect(rl.message).toBe(c.message);
      expect(rl.retryAfterSeconds).toBe(312);
      expect(rl.retryAt).toBe('2031-04-05T06:07:08.000Z');
    });

    it(`${c.name}() throws the plain Error when the refusal carries no rateLimit`, async () => {
      const err = await settle(c.call, c.reply, { ...c.failure, error: 'FORBIDDEN' });
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(SharedStorageRateLimitError);
      expect((err as Error).message).toBe('FORBIDDEN');
    });

    it(`${c.name}() throws the plain Error (not a hang) when rateLimit is malformed`, async () => {
      const err = await settle(c.call, c.reply, {
        ...c.failure,
        error: c.message,
        rateLimit: { retryAfterSeconds: -5, retryAt: VALID.retryAt },
      });
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(SharedStorageRateLimitError);
      expect((err as Error).message).toBe(c.message);
    });
  }

  it('an empty refusal string with rateLimit still throws the rate-limit error, with fallback copy', async () => {
    const err = await settle((s) => s.append({ title: 't' }), 'SHARED_APPEND_RESULT', {
      key: '',
      error: '',
      rateLimit: { ...VALID },
    });
    expect(err).toBeInstanceOf(SharedStorageRateLimitError);
    expect((err as Error).message).toBe('shared append failed');
  });
});
