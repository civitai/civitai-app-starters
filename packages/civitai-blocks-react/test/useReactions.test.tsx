import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  APP_REACTIONS,
  ENTITY_REACTION_ERROR_CODES,
  type BlockInitPayload,
} from '@civitai/app-sdk/blocks';

import {
  REACTION_ERROR_CODES,
  REACTIONS,
  ReactionError,
  isReactionErrorCode,
  useReactions,
} from '../src/hooks/useReactions.js';
import { getTransport } from '../src/transport/singleton.js';
import { resetTransport } from '../src/testing.js';

const PARENT_ORIGIN = 'https://civitai.com';

function buildInit(): BlockInitPayload {
  return {
    blockInstanceId: 'i',
    blockId: 'b',
    appId: 'app_test',
    token: {
      raw: 'jwt',
      scopes: ['social:react:self'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    context: { slotId: 's' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: { id: 7, username: 'viewer', status: 'active' },
    theme: 'light',
    renderMode: 'iframe',
  };
}

type Sent = { type: string; payload: Record<string, unknown> & { requestId: string } };

function sent(mock: ReturnType<typeof vi.fn>, type: string): Sent[] {
  return mock.mock.calls.map((c) => c[0] as Sent).filter((m) => m?.type === type);
}

function reply(type: 'ENTITY_REACTION_RESULT' | 'ENTITY_REACTIONS_RESULT', payload: unknown): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { type, payload }, origin: PARENT_ORIGIN }));
  });
}

const counts = (like: number, heart = 0, laugh = 0, cry = 0) => ({
  Like: like,
  Heart: heart,
  Laugh: laugh,
  Cry: cry,
});

/** Answer the most recent read with `byId` (keys as strings) and `unavailable`. */
function answerRead(
  mock: ReturnType<typeof vi.fn>,
  byId: Record<string, unknown>,
  unavailable: number[] = [],
): void {
  const reads = sent(mock, 'GET_ENTITY_REACTIONS');
  const last = reads[reads.length - 1]!;
  reply('ENTITY_REACTIONS_RESULT', {
    requestId: last.payload.requestId,
    result: { entityType: 'image', byId, unavailable },
  });
}

const TICKETS = { 11: 'v1.111.sig-a', 12: 'v1.112.sig-b' };

describe('useReactions', () => {
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
    resetTransport();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Mount, answer the first read with image 11 at 4 likes / not reacted, 12 unavailable. */
  async function mounted() {
    const hook = renderHook(() => useReactions('image', [11, 12], { tickets: TICKETS }));
    await waitFor(() => expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS')).toHaveLength(1));
    answerRead(
      postMessageMock,
      { '11': { counts: counts(4, 1), viewerReactions: ['Heart'], statsUnknown: false } },
      [12],
    );
    await waitFor(() => expect(hook.result.current.byId[11]).toBeDefined());
    postMessageMock.mockClear();
    return hook;
  }

  describe('the read', () => {
    it('sends the ids and ONLY their tickets on mount', async () => {
      renderHook(() =>
        useReactions('image', [11, 12, 11], { tickets: { ...TICKETS, 99: 'v1.199.other' } }),
      );
      await waitFor(() => expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS')).toHaveLength(1));
      const [req] = sent(postMessageMock, 'GET_ENTITY_REACTIONS');
      expect(Object.keys(req!.payload).sort()).toEqual(['entityType', 'ids', 'requestId', 'tickets']);
      expect(req!.payload.entityType).toBe('image');
      expect(req!.payload.ids).toEqual([11, 12]);
      expect(req!.payload.tickets).toEqual({ '11': 'v1.111.sig-a', '12': 'v1.112.sig-b' });
    });

    it('fills byId from the reply and lists the unanswered ids', async () => {
      const { result } = await mounted();
      expect(result.current.byId[11]).toEqual({
        counts: counts(4, 1),
        viewerReactions: ['Heart'],
        statsUnknown: false,
      });
      // 🔴 Unavailable is NOT "not reacted": there is no entry at all.
      expect(result.current.byId[12]).toBeUndefined();
      expect(result.current.unavailable).toEqual([12]);
      expect(result.current.loading).toBe(false);
    });

    it('splits more than 100 ids into reads of at most 100', async () => {
      const ids = Array.from({ length: 150 }, (_, i) => i + 1);
      renderHook(() => useReactions('image', ids, { tickets: {} }));
      await waitFor(() => expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS')).toHaveLength(1));
      answerRead(postMessageMock, {}, ids.slice(0, 100));
      await waitFor(() => expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS')).toHaveLength(2));
      const [first, second] = sent(postMessageMock, 'GET_ENTITY_REACTIONS');
      expect((first!.payload.ids as number[]).length).toBe(100);
      expect(second!.payload.ids).toEqual(ids.slice(100));
    });

    it('sends nothing for no ids, or when disabled', async () => {
      renderHook(() => useReactions('image', [], { tickets: {} }));
      renderHook(() => useReactions('image', [11], { tickets: TICKETS, enabled: false }));
      await new Promise((r) => setTimeout(r, 20));
      expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS')).toHaveLength(0);
    });

    it('does not re-read for a new array with the same ids and tickets', async () => {
      const { rerender } = renderHook(
        ({ ids }: { ids: number[] }) => useReactions('image', ids, { tickets: { ...TICKETS } }),
        { initialProps: { ids: [11] } },
      );
      await waitFor(() => expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS')).toHaveLength(1));
      rerender({ ids: [11] });
      await new Promise((r) => setTimeout(r, 20));
      expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS')).toHaveLength(1);
      rerender({ ids: [11, 12] });
      await waitFor(() => expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS')).toHaveLength(2));
    });

    it('reports a read refusal as a coded error and leaves byId alone', async () => {
      const { result } = renderHook(() => useReactions('image', [11], { tickets: TICKETS }));
      await waitFor(() => expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS')).toHaveLength(1));
      const [req] = sent(postMessageMock, 'GET_ENTITY_REACTIONS');
      reply('ENTITY_REACTIONS_RESULT', { requestId: req!.payload.requestId, error: 'needs-consent' });
      await waitFor(() => expect(result.current.error).toBeInstanceOf(ReactionError));
      expect(result.current.error!.code).toBe('needs-consent');
      expect(result.current.error!.needsConsent).toBe(true);
      expect(result.current.byId).toEqual({});
    });
  });

  describe('toggle', () => {
    it('sends the desired state with the image ticket, and moves byId optimistically', async () => {
      const { result } = await mounted();
      let p!: Promise<unknown>;
      act(() => {
        p = result.current.toggle(11, 'Like', true);
        void p.catch(() => {});
      });
      const [req] = sent(postMessageMock, 'SET_ENTITY_REACTION');
      expect(Object.keys(req!.payload).sort()).toEqual([
        'entityId',
        'entityType',
        'reacted',
        'reaction',
        'requestId',
        'ticket',
      ]);
      expect(req!.payload).toMatchObject({
        entityType: 'image',
        entityId: 11,
        reaction: 'Like',
        reacted: true,
        ticket: 'v1.111.sig-a',
      });
      // Optimistic, before any reply.
      await waitFor(() => expect(result.current.byId[11]!.counts.Like).toBe(5));
      expect(result.current.byId[11]!.viewerReactions).toEqual(['Heart', 'Like']);
      expect(result.current.pending(11, 'Like')).toBe(true);
      expect(result.current.pending(11, 'Heart')).toBe(false);
    });

    it('resolves with the host result and adopts its viewerReactions', async () => {
      const { result } = await mounted();
      let settled: unknown;
      act(() => {
        void result.current.toggle(11, 'Like', true).then((r) => {
          settled = r;
        });
      });
      const [req] = sent(postMessageMock, 'SET_ENTITY_REACTION');
      const hostResult = {
        entityType: 'image',
        entityId: 11,
        reaction: 'Like',
        reacted: true,
        changed: true,
        counts: counts(5, 1),
        viewerReactions: ['Like', 'Heart'],
        statsUnknown: false,
      };
      reply('ENTITY_REACTION_RESULT', { requestId: req!.payload.requestId, result: hostResult });
      await waitFor(() => expect(settled).toEqual(hostResult));
      // The host's ORDER, not the optimistic one: the reply is the truth.
      expect(result.current.byId[11]!.viewerReactions).toEqual(['Like', 'Heart']);
      expect(result.current.pending(11, 'Like')).toBe(false);
    });

    it('keeps the optimistic count while the metric store lags a write that held', async () => {
      const { result } = await mounted();
      act(() => {
        void result.current.toggle(11, 'Like', true);
      });
      const [req] = sent(postMessageMock, 'SET_ENTITY_REACTION');
      reply('ENTITY_REACTION_RESULT', {
        requestId: req!.payload.requestId,
        result: {
          entityType: 'image',
          entityId: 11,
          reaction: 'Like',
          reacted: true,
          changed: true,
          // Lagging: the store has not counted the new Like yet.
          counts: counts(4, 1),
          viewerReactions: ['Heart', 'Like'],
          statsUnknown: false,
        },
      });
      await waitFor(() => expect(result.current.pending(11, 'Like')).toBe(false));
      expect(result.current.byId[11]!.counts.Like).toBe(5);
    });

    it('follows the host when a concurrent change won', async () => {
      const { result } = await mounted();
      let settled: { reacted: boolean } | undefined;
      act(() => {
        void result.current.toggle(11, 'Like', true).then((r) => {
          settled = r;
        });
      });
      const [req] = sent(postMessageMock, 'SET_ENTITY_REACTION');
      reply('ENTITY_REACTION_RESULT', {
        requestId: req!.payload.requestId,
        result: {
          entityType: 'image',
          entityId: 11,
          reaction: 'Like',
          reacted: false,
          changed: false,
          counts: counts(4, 1),
          viewerReactions: ['Heart'],
          statsUnknown: false,
        },
      });
      await waitFor(() => expect(settled?.reacted).toBe(false));
      expect(result.current.byId[11]).toEqual({
        counts: counts(4, 1),
        viewerReactions: ['Heart'],
        statsUnknown: false,
      });
    });

    // EVERY closed code, not a representative one: two carry flags consumers branch on.
    for (const code of ENTITY_REACTION_ERROR_CODES) {
      it(`rejects with a coded ReactionError for '${code}' and reverts`, async () => {
        const { result } = await mounted();
        let caught: unknown;
        act(() => {
          void result.current.toggle(11, 'Like', true).catch((e: unknown) => {
            caught = e;
          });
        });
        await waitFor(() => expect(result.current.byId[11]!.counts.Like).toBe(5));
        const [req] = sent(postMessageMock, 'SET_ENTITY_REACTION');
        reply('ENTITY_REACTION_RESULT', { requestId: req!.payload.requestId, error: code });
        await waitFor(() => expect(caught).toBeInstanceOf(ReactionError));
        const err = caught as ReactionError;
        expect(err.code).toBe(code);
        expect(err.signInRequired).toBe(code === 'sign-in-required');
        expect(err.needsConsent).toBe(code === 'needs-consent');
        expect(err.timedOut).toBe(false);
        expect(err.busy).toBe(false);
        // Reverted to exactly the pre-tap state.
        await waitFor(() =>
          expect(result.current.byId[11]).toEqual({
            counts: counts(4, 1),
            viewerReactions: ['Heart'],
            statsUnknown: false,
          }),
        );
        expect(result.current.error).toBe(err);
      });
    }

    it('reverts an un-react too, putting the reaction and its count back', async () => {
      const { result } = await mounted();
      let caught: unknown;
      act(() => {
        void result.current.toggle(11, 'Heart', false).catch((e: unknown) => {
          caught = e;
        });
      });
      await waitFor(() => expect(result.current.byId[11]!.counts.Heart).toBe(0));
      expect(result.current.byId[11]!.viewerReactions).toEqual([]);
      const [req] = sent(postMessageMock, 'SET_ENTITY_REACTION');
      reply('ENTITY_REACTION_RESULT', { requestId: req!.payload.requestId, error: 'rate-limited' });
      await waitFor(() => expect(caught).toBeInstanceOf(ReactionError));
      await waitFor(() => expect(result.current.byId[11]!.counts.Heart).toBe(1));
      expect(result.current.byId[11]!.viewerReactions).toEqual(['Heart']);
    });

    it('gives an error string a newer host might send no code, and still rejects', async () => {
      const { result } = await mounted();
      let caught: unknown;
      act(() => {
        void result.current.toggle(11, 'Like', true).catch((e: unknown) => {
          caught = e;
        });
      });
      const [req] = sent(postMessageMock, 'SET_ENTITY_REACTION');
      reply('ENTITY_REACTION_RESULT', { requestId: req!.payload.requestId, error: 'quota-frozen' });
      await waitFor(() => expect(caught).toBeInstanceOf(ReactionError));
      expect((caught as ReactionError).code).toBeUndefined();
      expect((caught as ReactionError).message).toBe('quota-frozen');
    });

    it('settles exactly once: a second reply for the same request changes nothing', async () => {
      const { result } = await mounted();
      const resolved = vi.fn();
      const rejected = vi.fn();
      act(() => {
        void result.current.toggle(11, 'Like', true).then(resolved, rejected);
      });
      const [req] = sent(postMessageMock, 'SET_ENTITY_REACTION');
      const ok = {
        entityType: 'image',
        entityId: 11,
        reaction: 'Like',
        reacted: true,
        changed: true,
        counts: counts(5, 1),
        viewerReactions: ['Heart', 'Like'],
        statsUnknown: false,
      };
      reply('ENTITY_REACTION_RESULT', { requestId: req!.payload.requestId, result: ok });
      await waitFor(() => expect(resolved).toHaveBeenCalledTimes(1));
      // A stray duplicate, with a DIFFERENT answer, must not land.
      reply('ENTITY_REACTION_RESULT', { requestId: req!.payload.requestId, error: 'rate-limited' });
      reply('ENTITY_REACTION_RESULT', {
        requestId: req!.payload.requestId,
        result: { ...ok, reacted: false, viewerReactions: ['Heart'], counts: counts(0) },
      });
      await new Promise((r) => setTimeout(r, 20));
      expect(resolved).toHaveBeenCalledTimes(1);
      expect(rejected).not.toHaveBeenCalled();
      expect(result.current.byId[11]!.viewerReactions).toEqual(['Heart', 'Like']);
      expect(result.current.error).toBeNull();
    });

    it('refuses a second tap on the same reaction while one is in flight, sending nothing', async () => {
      const { result } = await mounted();
      act(() => {
        void result.current.toggle(11, 'Like', true).catch(() => {});
      });
      let caught: unknown;
      await act(async () => {
        await result.current.toggle(11, 'Like', false).catch((e: unknown) => {
          caught = e;
        });
      });
      expect(caught).toBeInstanceOf(ReactionError);
      expect((caught as ReactionError).busy).toBe(true);
      expect((caught as ReactionError).code).toBeUndefined();
      expect(sent(postMessageMock, 'SET_ENTITY_REACTION')).toHaveLength(1);
    });

    it('refuses an image without a ticket locally, before spending a reaction', async () => {
      const { result } = await mounted();
      let caught: unknown;
      await act(async () => {
        await result.current.toggle(13, 'Like', true).catch((e: unknown) => {
          caught = e;
        });
      });
      expect((caught as ReactionError).code).toBe('entity-unavailable');
      expect(sent(postMessageMock, 'SET_ENTITY_REACTION')).toHaveLength(0);
    });

    it('flags a transport timeout, reverts, and re-reads that image', async () => {
      const { result } = await mounted();
      vi.useFakeTimers();
      let caught: unknown;
      act(() => {
        void result.current.toggle(11, 'Like', true).catch((e: unknown) => {
          caught = e;
        });
      });
      // Past the 30s protocol default; nothing replies. NOT the 10-minute
      // human bound: there is no confirm to wait on.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000 + 1000);
      });
      vi.useRealTimers();
      expect(caught).toBeInstanceOf(ReactionError);
      const err = caught as ReactionError;
      expect(err.timedOut).toBe(true);
      expect(err.code).toBeUndefined();
      await waitFor(() => expect(result.current.byId[11]!.counts.Like).toBe(4));
      // The write may have landed, so the hook asks again for that one image.
      await waitFor(() => expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS')).toHaveLength(1));
      expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS')[0]!.payload).toMatchObject({
        ids: [11],
        tickets: { '11': 'v1.111.sig-a' },
      });
    });

    it('does NOT flag a non-timeout transport failure as a timeout', async () => {
      const { result } = await mounted();
      let caught: unknown;
      act(() => {
        void result.current.toggle(11, 'Like', true).catch((e: unknown) => {
          caught = e;
        });
      });
      act(() => {
        resetTransport();
      });
      await waitFor(() => expect(caught).toBeInstanceOf(ReactionError));
      expect((caught as ReactionError).timedOut).toBe(false);
    });
  });

  describe('the vocabulary', () => {
    it('matches @civitai/app-sdk, which mirrors the host', () => {
      expect([...REACTIONS]).toEqual([...APP_REACTIONS]);
      expect([...REACTION_ERROR_CODES]).toEqual([...ENTITY_REACTION_ERROR_CODES]);
    });

    it('classifies codes by membership', () => {
      expect(isReactionErrorCode('rate-limited')).toBe(true);
      expect(isReactionErrorCode('declined')).toBe(false);
    });
  });
});
