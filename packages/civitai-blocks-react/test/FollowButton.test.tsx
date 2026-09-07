import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { getTransport } from '../src/internal/singleton.js';
import { resetTransport } from '../src/testing.js';
import { FollowButton } from '../src/ui/FollowButton.js';

const PARENT_ORIGIN = 'https://civitai.com';

function buildInit(): BlockInitPayload {
  return {
    blockInstanceId: 'i',
    blockId: 'b',
    appId: 'app_test',
    token: { raw: 'jwt', scopes: [], expiresAt: new Date(Date.now() + 60_000).toISOString() },
    context: { slotId: 's' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: { id: 7, username: 'viewer', status: 'active' },
    theme: 'light',
    renderMode: 'iframe',
  };
}

describe('FollowButton', () => {
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
    cleanup();
    resetTransport();
    document.querySelectorAll('style[data-civitai-blocks-ui]').forEach((el) => el.remove());
    vi.restoreAllMocks();
  });

  /** The last outbound message of `type`, or undefined. */
  function sent(type: string): { payload: Record<string, unknown> } | undefined {
    const calls = postMessageMock.mock.calls.filter((c) => c[0]?.type === type);
    return calls[calls.length - 1]?.[0] as { payload: Record<string, unknown> } | undefined;
  }

  function reply(payload: unknown): void {
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'COLLECTION_FOLLOW_RESULT', payload },
          origin: PARENT_ORIGIN,
        }),
      );
    });
  }

  it('sends the id and the INVERSE of the current state, and flips optimistically', async () => {
    render(<FollowButton collectionId={42} followed={false} data-testid="fb" />);
    expect(screen.getByTestId('fb').textContent).toBe('Follow');
    expect(screen.getByTestId('fb').getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByTestId('fb'));

    const req = sent('SET_COLLECTION_FOLLOW');
    expect(req?.payload.collectionId).toBe(42);
    expect(req?.payload.follow).toBe(true);
    // Optimistic: the label moves BEFORE the host answers. A control that waits
    // for the round trip feels broken behind a consent dialog that can sit open
    // for minutes.
    await waitFor(() => expect(screen.getByTestId('fb').textContent).toBe('Following'));
    expect(screen.getByTestId('fb').getAttribute('aria-pressed')).toBe('true');
  });

  it("adopts the HOST'S echo, not the optimistic guess, and reports it via onChange", async () => {
    const onChange = vi.fn();
    render(<FollowButton collectionId={42} followed={false} onChange={onChange} data-testid="fb" />);
    fireEvent.click(screen.getByTestId('fb'));

    // 🔴 The echo DISAGREES with the request. This is the control that separates
    // "renders the host's answer" from "renders what it asked for" — an
    // agreeing fixture passes either way, which is exactly how a control that
    // ignores the echo ships.
    reply({ requestId: sent('SET_COLLECTION_FOLLOW')!.payload.requestId, result: { collectionId: 42, followed: false } });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(false));
    expect(screen.getByTestId('fb').textContent).toBe('Follow');
  });

  it('holds the echoed value when the parent does NOT adopt it (no blink back)', async () => {
    // `onChange` omitted — the parent keeps saying `followed={false}`. The
    // control must keep asserting the host's `true` rather than snapping back to
    // a server value that is now stale.
    render(<FollowButton collectionId={42} followed={false} data-testid="fb" />);
    fireEvent.click(screen.getByTestId('fb'));
    reply({ requestId: sent('SET_COLLECTION_FOLLOW')!.payload.requestId, result: { collectionId: 42, followed: true } });

    await waitFor(() => expect(screen.getByTestId('fb').textContent).toBe('Following'));
    // Give the effect that clears the optimistic value every chance to run.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('fb').textContent).toBe('Following');
  });

  it('stops asserting once the parent catches up', async () => {
    const { rerender } = render(<FollowButton collectionId={42} followed={false} data-testid="fb" />);
    fireEvent.click(screen.getByTestId('fb'));
    reply({ requestId: sent('SET_COLLECTION_FOLLOW')!.payload.requestId, result: { collectionId: 42, followed: true } });
    await waitFor(() => expect(screen.getByTestId('fb').textContent).toBe('Following'));

    rerender(<FollowButton collectionId={42} followed data-testid="fb" />);
    await waitFor(() => expect(screen.getByTestId('fb').textContent).toBe('Following'));
    // …and a subsequent parent-driven change is now honoured, which it would not
    // be if the control were still overriding.
    rerender(<FollowButton collectionId={42} followed={false} data-testid="fb" />);
    await waitFor(() => expect(screen.getByTestId('fb').textContent).toBe('Follow'));
  });

  it('reverts and ANNOUNCES on a server error', async () => {
    render(<FollowButton collectionId={42} followed={false} data-testid="fb" />);
    fireEvent.click(screen.getByTestId('fb'));
    reply({
      requestId: sent('SET_COLLECTION_FOLLOW')!.payload.requestId,
      error: 'You do not have permission to follow this collection',
    });

    await waitFor(() => expect(screen.getByTestId('fb-note')).toBeTruthy());
    expect(screen.getByTestId('fb').textContent).toBe('Follow');
    // 🔴 `role="alert"`. `aria-pressed` reverting is indistinguishable from
    // never having pressed, so without this a screen-reader user is told
    // NOTHING about the failure.
    expect(screen.getByTestId('fb-note').getAttribute('role')).toBe('alert');
  });

  it('reverts SILENTLY when the viewer declines the consent confirm', async () => {
    // 🔴 THE LOAD-BEARING CASE. `declined` means the viewer dismissed the host's
    // dialog and NOTHING was written. Rendering "could not follow" tells someone
    // who chose not to that the platform failed them.
    render(<FollowButton collectionId={42} followed={false} data-testid="fb" />);
    fireEvent.click(screen.getByTestId('fb'));
    reply({ requestId: sent('SET_COLLECTION_FOLLOW')!.payload.requestId, error: 'declined' });

    await waitFor(() => expect(screen.getByTestId('fb').textContent).toBe('Follow'));
    expect(screen.queryByTestId('fb-note')).toBeNull();
    expect(screen.getByTestId('fb').getAttribute('aria-pressed')).toBe('false');
  });

  it('routes sign-in-required into REQUEST_SIGN_IN instead of an error', async () => {
    render(<FollowButton collectionId={42} followed={false} data-testid="fb" />);
    fireEvent.click(screen.getByTestId('fb'));
    expect(sent('REQUEST_SIGN_IN')).toBeUndefined();

    reply({ requestId: sent('SET_COLLECTION_FOLLOW')!.payload.requestId, error: 'sign-in-required' });

    await waitFor(() => expect(sent('REQUEST_SIGN_IN')).toBeDefined());
    expect(screen.queryByTestId('fb-note')).toBeNull();
    expect(screen.getByTestId('fb').textContent).toBe('Follow');
  });

  it('names the collection in the accessible name, and never on the wire', () => {
    render(
      <FollowButton collectionId={42} followed={false} collectionName="Cute Cats" data-testid="fb" />,
    );
    expect(screen.getByTestId('fb').getAttribute('aria-label')).toBe('Follow "Cute Cats"');
    fireEvent.click(screen.getByTestId('fb'));
    // 🔴 The host resolves the real name from `collectionId`; a block-supplied
    // one would be the misrepresentation surface. Assert the wire carries only
    // the three fields.
    expect(Object.keys(sent('SET_COLLECTION_FOLLOW')!.payload).sort()).toEqual([
      'collectionId',
      'follow',
      'requestId',
    ]);
  });

  it('falls back to a generic accessible name, and flips it when following', () => {
    const { rerender } = render(<FollowButton collectionId={42} followed={false} data-testid="fb" />);
    expect(screen.getByTestId('fb').getAttribute('aria-label')).toBe('Follow this collection');
    rerender(<FollowButton collectionId={42} followed data-testid="fb" />);
    expect(screen.getByTestId('fb').getAttribute('aria-label')).toBe('Unfollow this collection');
  });

  it('sends nothing while disabled', () => {
    render(<FollowButton collectionId={42} followed={false} disabled data-testid="fb" />);
    fireEvent.click(screen.getByTestId('fb'));
    expect(sent('SET_COLLECTION_FOLLOW')).toBeUndefined();
  });

  it('defaults its testids when none is given', () => {
    render(<FollowButton collectionId={42} followed={false} />);
    expect(screen.getByTestId('follow-button')).toBeTruthy();
  });

  // ── Audit round 1, finding 1+2: correlation on the echoed collectionId ──────
  //
  // The control used to carry an attempt COUNTER whose comment claimed to close
  // exactly this, and did not: deleting all three of its lines left this file
  // 12/12 green. These cases are what the counter could never fail on.

  it('IGNORES a reply for a collection it has moved off, and does not report it', async () => {
    // 🔴 One mounted instance whose `collectionId` prop CHANGES mid-flight — a
    // rail showing "the currently selected collection", or an unkeyed recycled
    // list row. Adopting the old collection's reply records a follow the viewer
    // never made, against whatever row is on screen now.
    const onChange = vi.fn();
    const { rerender } = render(
      <FollowButton collectionId={1} followed={false} onChange={onChange} data-testid="fb" />,
    );
    fireEvent.click(screen.getByTestId('fb'));
    const req = sent('SET_COLLECTION_FOLLOW')!;
    expect(req.payload.collectionId).toBe(1);

    rerender(<FollowButton collectionId={2} followed={false} onChange={onChange} data-testid="fb" />);
    reply({ requestId: req.payload.requestId, result: { collectionId: 1, followed: true } });

    await act(async () => {
      await Promise.resolve();
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('fb').textContent).toBe('Follow');
    expect(screen.getByTestId('fb').getAttribute('aria-pressed')).toBe('false');
  });

  it('drops the optimistic flip when the collection changes, with no reply at all', () => {
    // The same wrong-row bug with no network involved: the optimistic value
    // belongs to the id it was made for.
    const { rerender } = render(
      <FollowButton collectionId={1} followed={false} data-testid="fb" />,
    );
    fireEvent.click(screen.getByTestId('fb'));
    expect(screen.getByTestId('fb').textContent).toBe('Following');

    rerender(<FollowButton collectionId={2} followed={false} data-testid="fb" />);
    expect(screen.getByTestId('fb').textContent).toBe('Follow');
  });

  it('does not paint a FAILURE from one collection onto the next', async () => {
    const { rerender } = render(
      <FollowButton collectionId={1} followed={false} data-testid="fb" />,
    );
    fireEvent.click(screen.getByTestId('fb'));
    const req = sent('SET_COLLECTION_FOLLOW')!;
    rerender(<FollowButton collectionId={2} followed={false} data-testid="fb" />);
    reply({ requestId: req.payload.requestId, error: 'Collection is private' });

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId('fb-note')).toBeNull();
  });

  it('STILL adopts a reply whose echoed id matches the collection on screen', async () => {
    // The positive control for the three cases above: a correlation guard that
    // rejected everything would pass all of them and break the feature.
    const onChange = vi.fn();
    render(<FollowButton collectionId={3} followed={false} onChange={onChange} data-testid="fb" />);
    fireEvent.click(screen.getByTestId('fb'));
    reply({
      requestId: sent('SET_COLLECTION_FOLLOW')!.payload.requestId,
      result: { collectionId: 3, followed: true },
    });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(true));
    expect(screen.getByTestId('fb').textContent).toBe('Following');
  });

  it('unfollows from the following state', () => {
    render(<FollowButton collectionId={7} followed data-testid="fb" />);
    fireEvent.click(screen.getByTestId('fb'));
    expect(sent('SET_COLLECTION_FOLLOW')!.payload.follow).toBe(false);
  });
});
