import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReactionError, useReactions } from '../src/hooks/useReactions.js';
import { createMockReactions } from '../src/internal/mockHostReactions.js';
import { getTransport } from '../src/transport/singleton.js';
import { Harness, createMockHost, resetTransport } from '../src/testing.js';

/**
 * `createMockHost`'s SET_ENTITY_REACTION / GET_ENTITY_REACTIONS handlers, driven
 * through the REAL hook and transport, plus `<Harness>` and the pure decision
 * module behind both.
 *
 * 🔴 WHAT THIS MOCK CANNOT PROVE: that a ticket is genuine. A real one is an HMAC
 * only the server can verify, so the mock accepts any well-formed ticket.
 */

const ORIGIN = window.location.origin;
const SCOPE = ['social:react:self'];
const TICKETS = { 1: 't-1', 2: 't-2' };

describe('createMockHost — app reactions', () => {
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = undefined;
    resetTransport();
    vi.restoreAllMocks();
  });

  async function hook(ids: number[], tickets: Record<number, string> = TICKETS) {
    const r = renderHook(() => useReactions('image', ids, { tickets }));
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    return r;
  }

  it('reads a seeded image and zeroes an unseeded one', async () => {
    uninstall = createMockHost({
      declaredScopes: SCOPE,
      reactionStates: { 1: { counts: { Like: 3 }, viewerReactions: ['Like'] } },
    }).install();
    const { result } = await hook([1, 2]);
    await waitFor(() => expect(result.current.byId[2]).toBeDefined());
    expect(result.current.byId[1]).toEqual({
      counts: { Like: 3, Heart: 0, Laugh: 0, Cry: 0 },
      viewerReactions: ['Like'],
      statsUnknown: false,
    });
    expect(result.current.byId[2]!.counts).toEqual({ Like: 0, Heart: 0, Laugh: 0, Cry: 0 });
  });

  it('lists an image without a ticket as unavailable, as the host does', async () => {
    uninstall = createMockHost({ declaredScopes: SCOPE }).install();
    const { result } = await hook([1, 3]);
    await waitFor(() => expect(result.current.unavailable).toEqual([3]));
    expect(result.current.byId[3]).toBeUndefined();
  });

  it('writes, persists, and a matching request changes nothing', async () => {
    uninstall = createMockHost({ declaredScopes: SCOPE }).install();
    const { result } = await hook([1]);
    await waitFor(() => expect(result.current.byId[1]).toBeDefined());

    let r: { changed: boolean; reacted: boolean; counts: { Heart: number } } | undefined;
    await act(async () => {
      r = await result.current.toggle(1, 'Heart', true);
    });
    expect(r).toMatchObject({ reacted: true, changed: true, counts: { Heart: 1 } });

    await act(async () => {
      r = await result.current.toggle(1, 'Heart', true);
    });
    // Desired state, not a toggle: already reacted, so nothing moved.
    expect(r).toMatchObject({ reacted: true, changed: false, counts: { Heart: 1 } });

    // A fresh read (a second mount) sees the write: the mock persists it.
    const again = await hook([1]);
    await waitFor(() => expect(again.result.current.byId[1]).toBeDefined());
    expect(again.result.current.byId[1]!.viewerReactions).toEqual(['Heart']);
  });

  it('refuses every call with needs-consent when the manifest does not declare the scope', async () => {
    uninstall = createMockHost({}).install();
    const { result } = await hook([1]);
    await waitFor(() => expect(result.current.error?.code).toBe('needs-consent'));
    let caught: unknown;
    await act(async () => {
      await result.current.toggle(1, 'Like', true).catch((e: unknown) => {
        caught = e;
      });
    });
    expect((caught as ReactionError).needsConsent).toBe(true);
  });

  it('refuses an anonymous viewer with sign-in-required', async () => {
    uninstall = createMockHost({ declaredScopes: SCOPE, viewer: null }).install();
    const { result } = await hook([1]);
    await waitFor(() => expect(result.current.error?.code).toBe('sign-in-required'));
  });

  it('arms and clears a forced error live via setScenario', async () => {
    const host = createMockHost({ declaredScopes: SCOPE });
    uninstall = host.install();
    const { result } = await hook([1]);
    await waitFor(() => expect(result.current.byId[1]).toBeDefined());

    host.setScenario({ reactionError: 'rate-limited' });
    let caught: unknown;
    await act(async () => {
      await result.current.toggle(1, 'Like', true).catch((e: unknown) => {
        caught = e;
      });
    });
    expect((caught as ReactionError).code).toBe('rate-limited');
    // The hook reverted its optimistic Like.
    expect(result.current.byId[1]!.counts.Like).toBe(0);

    host.setScenario({ reactionError: null });
    await act(async () => {
      await result.current.toggle(1, 'Like', true);
    });
    expect(result.current.byId[1]!.counts.Like).toBe(1);
  });

  it('replaces the state with a new seed via setScenario', async () => {
    const host = createMockHost({ declaredScopes: SCOPE });
    uninstall = host.install();
    const { result } = await hook([1]);
    await waitFor(() => expect(result.current.byId[1]).toBeDefined());
    expect(result.current.byId[1]!.counts.Cry).toBe(0);
    host.setScenario({ reactionStates: { 1: { counts: { Cry: 9 }, statsUnknown: true } } });
    const again = await hook([1]);
    await waitFor(() =>
      expect(again.result.current.byId[1]).toMatchObject({ counts: { Cry: 9 }, statsUnknown: true }),
    );
  });
});

describe('<Harness> — app reactions', () => {
  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    resetTransport();
  });

  function Likes() {
    const { byId } = useReactions('image', [5], { tickets: { 5: 't-5' } });
    const state = byId[5];
    return <div data-testid="likes">{state ? state.counts.Like : 'loading'}</div>;
  }

  it('serves the reaction read to a wrapped block', async () => {
    render(
      <Harness applyUrlToggles={false} showLog={false} declaredScopes={SCOPE} reactionStates={{ 5: { counts: { Like: 12 } } }}>
        <Likes />
      </Harness>,
    );
    await waitFor(() => expect(screen.getByTestId('likes').textContent).toBe('12'));
  });
});

describe('createMockReactions — the decision order', () => {
  const make = (over: Partial<Parameters<typeof createMockReactions>[0]> = {}) =>
    createMockReactions({ signedIn: () => true, hasScope: () => true, ...over });
  const SET = { entityType: 'image', entityId: 1, reaction: 'Like', reacted: true, ticket: 't' };

  it('checks identity before the payload, and the payload before consent', () => {
    // Anonymous AND malformed AND unconsented: identity wins.
    expect(make({ signedIn: () => false, hasScope: () => false }).set({ entityId: 'x' })).toEqual({
      error: 'sign-in-required',
    });
    // Malformed AND unconsented: the payload wins.
    expect(make({ hasScope: () => false }).set({ ...SET, entityId: 'x' })).toEqual({
      error: 'invalid-request',
    });
    expect(make({ hasScope: () => false }).set(SET)).toEqual({ error: 'needs-consent' });
  });

  it('refuses a Dislike as invalid-request, as the host does', () => {
    expect(make().set({ ...SET, reaction: 'Dislike' })).toEqual({ error: 'invalid-request' });
  });

  it('refuses a write without a ticket only after every other check', () => {
    const { ticket: _ticket, ...noTicket } = SET;
    expect(make().set(noTicket)).toEqual({ error: 'entity-unavailable' });
    expect(make({ error: 'rate-limited' }).set(noTicket)).toEqual({ error: 'rate-limited' });
  });

  it('refuses a read of more than 100 ids, or a malformed ticket for a requested id', () => {
    const ids = Array.from({ length: 101 }, (_, i) => i + 1);
    expect(make().get({ entityType: 'image', ids })).toEqual({ error: 'invalid-request' });
    expect(make().get({ entityType: 'image', ids: [1], tickets: { '1': '' } })).toEqual({
      error: 'invalid-request',
    });
    // A malformed ticket for an id NOT requested is ignored, as the host ignores it.
    expect(make().get({ entityType: 'image', ids: [1], tickets: { '1': 't', '9': 7 } })).toMatchObject({
      result: { unavailable: [] },
    });
  });
});
