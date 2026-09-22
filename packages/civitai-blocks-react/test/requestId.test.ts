/**
 * #395 — the single routability predicate, and every behaviour that moved when
 * 64 open-coded copies were consolidated onto it.
 *
 * Three jobs, in this order:
 *
 *  1. **The predicates themselves**, over a value matrix, plus the containment
 *     property `isRoutableRequestId(v) => isWireRequestIdShape(v)`. That
 *     property is the contract the two helpers exist to keep explicit; without
 *     it a future "simplification" could invert them and both unit suites would
 *     still pass.
 *  2. **`null` is not routable — END TO END, not just in the predicate.** This
 *     is the claim #395 was filed on ("a payload with `requestId: null`
 *     satisfies one check and not another"). It did NOT reproduce: every
 *     spelling already rejected `null`. These tests pin the behaviour that
 *     already held, at the validator AND at the transport, so the consolidation
 *     cannot later be "corrected" onto the wrong answer.
 *  3. **The two behaviours that DID move**, both on values the SDK itself never
 *     emits (`sendRequest` always assigns a non-empty id) but a hand-built or
 *     buggy peer can put on the wire:
 *       - a block→host request carrying `requestId: ''` — the mock/dev hosts
 *         used to answer it with an equally unroutable `requestId: ''` reply and
 *         now decline to answer;
 *       - a host echoing a NON-STRING truthy `requestId` on
 *         `TOKEN_REFRESH_RESPONSE` — the old `...(requestId ? {requestId} : {})`
 *         truthiness spread passed it through, which then failed the block's own
 *         validator and dropped the whole message (losing the token side effect);
 *         the predicate omits the field instead, so the message validates.
 *
 * 🔴 EVERY `IframeTransport` HERE IS DISPOSED IN `afterEach`, not inline. A
 * failing assertion skips an inline `dispose()`, leaking that transport's
 * `window` message listener into the next test in this file — which then fails
 * for a reason that has nothing to do with its subject.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload, ParentToBlockMessage } from '@civitai/app-sdk/blocks';

import { isRoutableRequestId, isWireRequestIdShape } from '../src/transport/requestId.js';
import { IframeTransport } from '../src/transport/iframeTransport.js';
import { isValidTokenRefreshResponse, isValidImageScanResolved } from '../src/transport/validate.js';
import { createMockHost, resetTransport } from '../src/testing.js';
import { getTransport } from '../src/transport/singleton.js';

const PARENT_ORIGIN = 'https://civitai.com';

/**
 * Every value shape any of the five retired spellings could see, each labelled
 * with the two answers it must now get. Kept deliberately WIDER than the
 * predicates' branches (two numbers, both a falsy and a truthy string, a boxed
 * String) so a mutant that hardcodes one arm cannot survive by accident.
 */
const MATRIX: ReadonlyArray<{ label: string; value: unknown; routable: boolean; wireShape: boolean }> = [
  { label: "'abc-1'", value: 'abc-1', routable: true, wireShape: true },
  { label: "' '", value: ' ', routable: true, wireShape: true },
  { label: "'0'", value: '0', routable: true, wireShape: true },
  { label: "''", value: '', routable: false, wireShape: true },
  { label: 'undefined', value: undefined, routable: false, wireShape: true },
  { label: 'null', value: null, routable: false, wireShape: false },
  { label: '0', value: 0, routable: false, wireShape: false },
  { label: '7', value: 7, routable: false, wireShape: false },
  { label: 'false', value: false, routable: false, wireShape: false },
  { label: 'true', value: true, routable: false, wireShape: false },
  { label: 'NaN', value: NaN, routable: false, wireShape: false },
  { label: '{}', value: {}, routable: false, wireShape: false },
  { label: '[]', value: [], routable: false, wireShape: false },
  { label: "['a']", value: ['a'], routable: false, wireShape: false },
  // eslint-disable-next-line no-new-wrappers -- a boxed String is an OBJECT; `typeof` must say so
  { label: 'new String("x")', value: new String('x'), routable: false, wireShape: false },
];

function buildInitPayload(): BlockInitPayload {
  return {
    blockInstanceId: 'inst-1',
    blockId: 'my-block',
    appId: 'app_test',
    token: {
      raw: 'jwt-1',
      scopes: ['models:read:self'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    context: { slotId: 'model.sidebar_top', modelId: 42 },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: { id: 1, username: 'alice', status: 'active' },
    theme: 'light',
    renderMode: 'iframe',
  };
}

function wrappedToken() {
  return {
    raw: 'jwt-2',
    scopes: ['models:read:self'],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

describe('#395 — isRoutableRequestId / isWireRequestIdShape', () => {
  for (const { label, value, routable, wireShape } of MATRIX) {
    it(`${label} → routable=${routable}, wireShape=${wireShape}`, () => {
      expect(isRoutableRequestId(value)).toBe(routable);
      expect(isWireRequestIdShape(value)).toBe(wireShape);
    });
  }

  it('routable implies wire-shape-valid for every value in the matrix (strict containment)', () => {
    for (const { label, value } of MATRIX) {
      if (isRoutableRequestId(value)) {
        expect(isWireRequestIdShape(value), `${label} is routable but not wire-shape-valid`).toBe(true);
      }
    }
    // …and the containment is STRICT — two values sit in the gap on purpose.
    const gap = MATRIX.filter((m) => m.wireShape && !m.routable).map((m) => m.label);
    expect(gap).toEqual(["''", 'undefined']);
  });

  it('narrows to `string` (type predicate, not a boolean helper)', () => {
    const v: unknown = 'id-9';
    if (isRoutableRequestId(v)) {
      // Compiles only because the predicate narrows; `v.length` on `unknown` is an error.
      expect(v.length).toBe(4);
    } else {
      throw new Error('unreachable');
    }
  });
});

describe('#395 — `requestId: null` is not routable, and never was', () => {
  let originalParent: Window;
  let transport: IframeTransport | undefined;

  beforeEach(() => {
    originalParent = window.parent;
    Object.defineProperty(window, 'parent', {
      value: { postMessage: vi.fn() },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    transport?.dispose();
    transport = undefined;
    Object.defineProperty(window, 'parent', {
      value: originalParent,
      configurable: true,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  it('the validator rejects a null requestId before routing ever sees it', () => {
    expect(isValidTokenRefreshResponse({ token: wrappedToken(), requestId: null })).toBe(false);
    // …and accepts the same payload with the field absent, or empty — the
    // deliberate pre-v2 looseness `isValidTokenRefreshResponse` documents.
    expect(isValidTokenRefreshResponse({ token: wrappedToken() })).toBe(true);
    expect(isValidTokenRefreshResponse({ token: wrappedToken(), requestId: '' })).toBe(true);
  });

  it('the one REQUIRED-requestId validator rejects null and empty alike', () => {
    const base = {
      imageId: 5,
      result: { status: 'blocked' as const, reason: 'nsfw' },
    };
    expect(isValidImageScanResolved({ ...base, requestId: 'r-1' })).toBe(true);
    expect(isValidImageScanResolved({ ...base, requestId: null })).toBe(false);
    expect(isValidImageScanResolved({ ...base, requestId: '' })).toBe(false);
    expect(isValidImageScanResolved(base)).toBe(false);
  });

  it('a reply with requestId: null never settles the pending request', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    const initPromise = transport.waitForInit();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'BLOCK_INIT', payload: buildInitPayload() } satisfies ParentToBlockMessage,
        origin: PARENT_ORIGIN,
      }),
    );
    await initPromise;

    let settled: 'no' | 'resolved' | 'rejected' = 'no';
    const pending = transport
      .sendRequest({ type: 'REQUEST_TOKEN', payload: {} }, 'TOKEN_REFRESH_RESPONSE')
      .then(
        () => {
          settled = 'resolved';
        },
        () => {
          settled = 'rejected';
        },
      );

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'TOKEN_REFRESH_RESPONSE', payload: { requestId: null, token: wrappedToken() } },
        origin: PARENT_ORIGIN,
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe('no');

    // Nail it down as "unroutable", not "the transport is broken": the same
    // request DOES settle once a routable id arrives.
    const posted = (window.parent.postMessage as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0] as { type: string; payload: { requestId?: string } })
      .find((m) => m.type === 'REQUEST_TOKEN');
    expect(isRoutableRequestId(posted?.payload.requestId)).toBe(true);
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'TOKEN_REFRESH_RESPONSE',
          payload: { requestId: posted!.payload.requestId, token: wrappedToken() },
        },
        origin: PARENT_ORIGIN,
      }),
    );
    await pending;
    expect(settled).toBe('resolved');
  });

  it('a reply with requestId: "" validates but does not settle the pending request', async () => {
    transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    const initPromise = transport.waitForInit();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'BLOCK_INIT', payload: buildInitPayload() } satisfies ParentToBlockMessage,
        origin: PARENT_ORIGIN,
      }),
    );
    await initPromise;

    let settled = false;
    void transport
      .sendRequest({ type: 'REQUEST_TOKEN', payload: {} }, 'TOKEN_REFRESH_RESPONSE')
      .then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'TOKEN_REFRESH_RESPONSE', payload: { requestId: '', token: wrappedToken() } },
        origin: PARENT_ORIGIN,
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    // It VALIDATED — the snapshot side effect ran — it simply did not correlate.
    // That is the whole reason the wire-shape check stays looser than routability.
    expect(transport.getSnapshot().token.raw).toBe('jwt-2');
  });
});

describe('#395 — behaviours that MOVED in the consolidation', () => {
  const ORIGIN = window.location.origin;
  let host: ReturnType<typeof createMockHost> | undefined;
  let uninstall: (() => void) | undefined;
  let inbound: Array<{ type: string; payload?: { requestId?: unknown } }>;
  let listener: (e: MessageEvent) => void;

  beforeEach(() => {
    inbound = [];
    listener = (e: MessageEvent) => {
      const d = e.data as { type?: string; payload?: { requestId?: unknown } } | null;
      if (d && typeof d.type === 'string') inbound.push({ type: d.type, payload: d.payload });
    };
    window.addEventListener('message', listener);
    getTransport({ allowedParentOrigins: [ORIGIN] });
    host = createMockHost({});
    uninstall = host.install();
  });

  afterEach(() => {
    window.removeEventListener('message', listener);
    uninstall?.();
    uninstall = host = undefined;
    resetTransport();
  });

  async function flush() {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  }

  it('MOVED: a guarded request carrying requestId: "" gets no reply at all', async () => {
    // BEFORE: `typeof '' === 'string'` passed the guard, so the host answered
    // with `{ requestId: '', ok: … }` — a reply the block can never correlate.
    // AFTER: the host declines. Same end state for the block (its request times
    // out either way); one fewer unroutable message on the wire.
    window.parent.postMessage(
      { type: 'SET_USER_CHECKPOINT', payload: { requestId: '', versionId: 1 } },
      ORIGIN,
    );
    await flush();
    expect(inbound.filter((m) => m.type === 'USER_CHECKPOINT_SET')).toEqual([]);

    // POSITIVE CONTROL — the same request with a routable id IS answered, so the
    // empty result above is a decision by the guard and not a dead harness.
    window.parent.postMessage(
      { type: 'SET_USER_CHECKPOINT', payload: { requestId: 'r-1', versionId: 1 } },
      ORIGIN,
    );
    await flush();
    const replies = inbound.filter((m) => m.type === 'USER_CHECKPOINT_SET');
    expect(replies).toHaveLength(1);
    expect(replies[0]!.payload?.requestId).toBe('r-1');
  });

  it('MOVED: a non-string requestId is no longer echoed onto TOKEN_REFRESH_RESPONSE', async () => {
    // BEFORE: `...(requestId ? { requestId } : {})` is a TRUTHINESS test, so a
    // numeric id was spread straight back — and then failed the block's own
    // `isValidTokenRefreshResponse`, dropping the message and with it the token
    // update that reply exists to deliver. AFTER: the field is omitted, the
    // message validates, and the token still lands.
    window.parent.postMessage({ type: 'REQUEST_TOKEN', payload: { requestId: 7 } }, ORIGIN);
    await flush();
    const replies = inbound.filter((m) => m.type === 'TOKEN_REFRESH_RESPONSE');
    expect(replies).toHaveLength(1);
    expect(replies[0]!.payload).not.toHaveProperty('requestId');
    expect(isValidTokenRefreshResponse(replies[0]!.payload)).toBe(true);

    // UNCHANGED on both sides of the move: a routable id is still echoed, and an
    // absent one is still omitted.
    window.parent.postMessage({ type: 'REQUEST_TOKEN', payload: { requestId: 'r-2' } }, ORIGIN);
    window.parent.postMessage({ type: 'REQUEST_TOKEN', payload: {} }, ORIGIN);
    await flush();
    const all = inbound.filter((m) => m.type === 'TOKEN_REFRESH_RESPONSE');
    expect(all).toHaveLength(3);
    expect(all[1]!.payload?.requestId).toBe('r-2');
    expect(all[2]!.payload).not.toHaveProperty('requestId');
  });
});
