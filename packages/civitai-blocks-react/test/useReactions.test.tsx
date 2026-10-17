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

    it('sends nothing for no ids', async () => {
      renderHook(() => useReactions('image', [], { tickets: {} }));
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
      // Recorded as the error, so the owner re-renders and a bound element is
      // rewritten from `byId` (which this refusal never moved).
      expect(result.current.error).toBe(caught);
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

  describe('read economy and ordering', () => {
    /** Reply to one specific read message. */
    const answer = (req: Sent, byId: Record<string, unknown>, unavailable: number[] = []) =>
      reply('ENTITY_REACTIONS_RESULT', {
        requestId: req.payload.requestId,
        result: { entityType: 'image', byId, unavailable },
      });
    const okWrite = (req: Sent, over: Record<string, unknown> = {}) =>
      reply('ENTITY_REACTION_RESULT', {
        requestId: req.payload.requestId,
        result: {
          entityType: 'image',
          entityId: 11,
          reaction: 'Like',
          reacted: true,
          changed: true,
          counts: counts(4, 1), // lagging: the store has not counted the Like yet
          viewerReactions: ['Heart', 'Like'],
          statsUnknown: false,
          ...over,
        },
      });
    const STATE_11 = { counts: counts(4, 1), viewerReactions: ['Heart'], statsUnknown: false };
    const ids = (req: Sent) => req.payload.ids as number[];

    function grow(initial: number[], tickets: Record<number, string> = TICKETS) {
      return renderHook(
        ({ list, t }: { list: number[]; t: Record<number, string> }) =>
          useReactions('image', list, { tickets: t }),
        { initialProps: { list: initial, t: tickets } },
      );
    }

    it('growing the ids reads only the new id', async () => {
      const { rerender } = grow([11, 12]);
      await waitFor(() => expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS')).toHaveLength(1));
      answer(sent(postMessageMock, 'GET_ENTITY_REACTIONS')[0]!, { '11': STATE_11 }, [12]);
      rerender({ list: [11, 12, 13], t: { ...TICKETS, 13: 'v1.113.sig-c' } });
      await waitFor(() => expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS')).toHaveLength(2));
      expect(ids(sent(postMessageMock, 'GET_ENTITY_REACTIONS')[1]!)).toEqual([13]);
    });

    it('an id leaving the list needs no read', async () => {
      const { rerender } = grow([11, 12]);
      await waitFor(() => expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS')).toHaveLength(1));
      answer(sent(postMessageMock, 'GET_ENTITY_REACTIONS')[0]!, { '11': STATE_11 }, [12]);
      rerender({ list: [11], t: TICKETS });
      await new Promise((r) => setTimeout(r, 20));
      expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS')).toHaveLength(1);
    });

    it('a ticket change for one id re-reads that id only', async () => {
      const { rerender } = grow([11, 12]);
      await waitFor(() => expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS')).toHaveLength(1));
      answer(sent(postMessageMock, 'GET_ENTITY_REACTIONS')[0]!, { '11': STATE_11 }, [12]);
      rerender({ list: [11, 12], t: { ...TICKETS, 11: 'v1.211.sig-new' } });
      await waitFor(() => expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS')).toHaveLength(2));
      const req = sent(postMessageMock, 'GET_ENTITY_REACTIONS')[1]!;
      expect(ids(req)).toEqual([11]);
      expect(req.payload.tickets).toEqual({ '11': 'v1.211.sig-new' });
    });

    it('a superseded read sends none of its remaining chunks', async () => {
      const list = Array.from({ length: 250 }, (_, i) => i + 1);
      const { rerender } = grow(list, {});
      await waitFor(() => expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS')).toHaveLength(1));
      // Chunk 1 of the first pass is out; the list grows before it is answered.
      rerender({ list: [...list, 251], t: {} });
      await waitFor(() => expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS').length).toBeGreaterThan(1));
      // Answer every read as it arrives until the traffic stops.
      for (let answered = 0; answered < sent(postMessageMock, 'GET_ENTITY_REACTIONS').length; answered++) {
        const req = sent(postMessageMock, 'GET_ENTITY_REACTIONS')[answered]!;
        answer(req, {}, ids(req));
        await new Promise((r) => setTimeout(r, 10));
      }
      const chunks = sent(postMessageMock, 'GET_ENTITY_REACTIONS').map(ids);
      // Exactly one read per id: the first pass's chunk 1, then the second pass
      // for everything not yet sent. Nothing from the first pass after the change.
      expect(chunks.map((c) => [c[0], c[c.length - 1]])).toEqual([
        [1, 100],
        [101, 200],
        [201, 251],
      ]);
    });

    it('🔴 a read issued before a write, answered after it settled, does not overwrite it (grown ids)', async () => {
      const { result, rerender } = grow([11, 12]);
      await waitFor(() => expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS')).toHaveLength(1));
      answer(sent(postMessageMock, 'GET_ENTITY_REACTIONS')[0]!, { '11': STATE_11 }, [12]);
      await waitFor(() => expect(result.current.byId[11]).toBeDefined());
      rerender({ list: [11, 12, 13], t: { ...TICKETS, 13: 'v1.113.sig-c' } });
      await waitFor(() => expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS')).toHaveLength(2));
      const stale = sent(postMessageMock, 'GET_ENTITY_REACTIONS')[1]!; // left unanswered

      await act(async () => {
        const p = result.current.toggle(11, 'Like', true);
        okWrite(sent(postMessageMock, 'SET_ENTITY_REACTION')[0]!);
        await p;
      });
      expect(result.current.byId[11]!.counts.Like).toBe(5);

      // The stale read now answers "not reacted" for everything it was asked.
      answer(stale, Object.fromEntries(ids(stale).map((id) => [String(id), STATE_11])));
      await new Promise((r) => setTimeout(r, 20));
      expect(result.current.byId[11]!.viewerReactions).toEqual(['Heart', 'Like']);
      expect(result.current.byId[11]!.counts.Like).toBe(5);
    });

    it('🔴 the same, for a read of the written image itself (a ticket change)', async () => {
      const { result, rerender } = grow([11]);
      await waitFor(() => expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS')).toHaveLength(1));
      answer(sent(postMessageMock, 'GET_ENTITY_REACTIONS')[0]!, { '11': STATE_11 });
      await waitFor(() => expect(result.current.byId[11]).toBeDefined());
      rerender({ list: [11], t: { 11: 'v1.211.sig-new' } });
      await waitFor(() => expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS')).toHaveLength(2));
      const stale = sent(postMessageMock, 'GET_ENTITY_REACTIONS')[1]!;
      expect(ids(stale)).toEqual([11]);

      await act(async () => {
        const p = result.current.toggle(11, 'Like', true);
        okWrite(sent(postMessageMock, 'SET_ENTITY_REACTION')[0]!);
        await p;
      });
      answer(stale, { '11': STATE_11 });
      await new Promise((r) => setTimeout(r, 20));
      expect(result.current.byId[11]!.viewerReactions).toEqual(['Heart', 'Like']);
      expect(result.current.byId[11]!.counts.Like).toBe(5);
    });

    it('a read answered WHILE a write on that image is in flight does not touch it', async () => {
      const { result, rerender } = grow([11]);
      await waitFor(() => expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS')).toHaveLength(1));
      answer(sent(postMessageMock, 'GET_ENTITY_REACTIONS')[0]!, { '11': STATE_11 });
      await waitFor(() => expect(result.current.byId[11]).toBeDefined());
      let p!: Promise<unknown>;
      act(() => {
        p = result.current.toggle(11, 'Like', true);
      });
      await waitFor(() => expect(result.current.byId[11]!.counts.Like).toBe(5));
      // A read issued AFTER the write started, answered before it settles.
      rerender({ list: [11], t: { 11: 'v1.211.sig-new' } });
      await waitFor(() => expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS')).toHaveLength(2));
      answer(sent(postMessageMock, 'GET_ENTITY_REACTIONS')[1]!, { '11': STATE_11 });
      await new Promise((r) => setTimeout(r, 20));
      expect(result.current.byId[11]!.counts.Like).toBe(5);
      expect(result.current.byId[11]!.viewerReactions).toEqual(['Heart', 'Like']);
      okWrite(sent(postMessageMock, 'SET_ENTITY_REACTION')[0]!, { counts: counts(5, 1) });
      await act(async () => {
        await p;
      });
    });

    it('a failed read leaves its images unread, so the next pass reads them again', async () => {
      const { rerender } = grow([11]);
      await waitFor(() => expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS')).toHaveLength(1));
      reply('ENTITY_REACTIONS_RESULT', {
        requestId: sent(postMessageMock, 'GET_ENTITY_REACTIONS')[0]!.payload.requestId,
        error: 'rate-limited',
      });
      await new Promise((r) => setTimeout(r, 20));
      rerender({ list: [11, 12], t: TICKETS });
      await waitFor(() => expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS')).toHaveLength(2));
      expect(ids(sent(postMessageMock, 'GET_ENTITY_REACTIONS')[1]!)).toEqual([11, 12]);
    });

    it('an older read answered after a newer one for the same image is discarded', async () => {
      const { result, rerender } = grow([11]);
      await waitFor(() => expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS')).toHaveLength(1));
      const older = sent(postMessageMock, 'GET_ENTITY_REACTIONS')[0]!;
      rerender({ list: [11], t: { 11: 'v1.211.sig-new' } });
      await waitFor(() => expect(sent(postMessageMock, 'GET_ENTITY_REACTIONS')).toHaveLength(2));
      const newer = sent(postMessageMock, 'GET_ENTITY_REACTIONS')[1]!;
      answer(newer, { '11': { counts: counts(9), viewerReactions: ['Like'], statsUnknown: false } });
      await waitFor(() => expect(result.current.byId[11]?.counts.Like).toBe(9));
      answer(older, { '11': STATE_11 });
      await new Promise((r) => setTimeout(r, 20));
      expect(result.current.byId[11]!.counts.Like).toBe(9);
    });

    it('a busy refusal is recorded as the error, so a bound element re-renders', async () => {
      const { result } = await mounted();
      act(() => {
        void result.current.toggle(11, 'Like', true).catch(() => {});
      });
      await act(async () => {
        await result.current.toggle(11, 'Like', false).catch(() => {});
      });
      expect(result.current.error?.busy).toBe(true);
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
