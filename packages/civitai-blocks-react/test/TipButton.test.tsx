import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { getTransport } from '../src/internal/singleton.js';
import { resetTransport } from '../src/testing.js';
import { TipButton } from '../src/ui/TipButton.js';

const PARENT_ORIGIN = 'https://civitai.com';

function buildInit(): BlockInitPayload {
  return {
    blockInstanceId: 'i',
    blockId: 'b',
    appId: 'app_test',
    token: {
      raw: 'jwt',
      scopes: ['social:tip:self'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    context: { slotId: 's' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: { id: 7, username: 'viewer', status: 'active' },
    theme: 'light',
    renderMode: 'iframe',
  };
}

/** A tip POST this test settles by hand, so the in-flight state is inspectable. */
function deferredResponse() {
  let resolve!: (r: Response) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<Response>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function okBody(amount: number): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      tip: { toUserId: 99, amount, entityType: null, entityId: null },
    }),
  } as unknown as Response;
}

describe('TipButton', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    Object.defineProperty(window, 'parent', {
      value: { postMessage: vi.fn() },
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
    fetchMock = vi.fn(async () => okBody(50));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    resetTransport();
    document.querySelectorAll('style[data-civitai-blocks-ui]').forEach((el) => el.remove());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** The body of the Nth tip POST, parsed. */
  function body(n = 0): Record<string, unknown> {
    return JSON.parse(fetchMock.mock.calls[n]![1].body as string) as Record<string, unknown>;
  }

  it('does NOT spend on the trigger — only from the armed confirm', () => {
    // 🔴 The whole reason this control is two-step. `useTip` posts directly with
    // the block token; NOTHING outside the iframe asks the viewer anything, so a
    // one-press money spend is reachable by construction without this handshake.
    render(<TipButton noun="curator" toUserId={99} amount={50} data-testid="tip" />);

    fireEvent.click(screen.getByTestId('tip'));
    expect(screen.getByTestId('tip-prompt')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('tip-confirm'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cancel disarms without spending', () => {
    render(<TipButton noun="creator" toUserId={99} amount={50} data-testid="tip" />);
    fireEvent.click(screen.getByTestId('tip'));
    fireEvent.click(screen.getByTestId('tip-cancel'));
    expect(screen.getByTestId('tip')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the target, amount and entity context', async () => {
    render(
      <TipButton
        noun="curator"
        toUserId={99}
        amount={50}
        entityType="Collection"
        entityId={7}
        data-testid="tip"
      />,
    );
    fireEvent.click(screen.getByTestId('tip'));
    fireEvent.click(screen.getByTestId('tip-confirm'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(body()).toMatchObject({
      toUserId: 99,
      amount: 50,
      entityType: 'Collection',
      entityId: 7,
    });
    // Never a sender — the server self-binds it off the token.
    expect(body()).not.toHaveProperty('fromUserId');
  });

  it('REUSES the idempotency key when a failed tip is retried', async () => {
    // 🔴 THE PROPERTY A HAND-ROLLED BUTTON MISSES. `useTip` mints a FRESH key per
    // call when none is passed, so a retry after a LOST response is a second
    // transfer. From inside the block a lost response is indistinguishable from
    // a rejection, so the retry path is exactly where it bites.
    fetchMock.mockRejectedValueOnce(new Error('network'));
    render(<TipButton noun="curator" toUserId={99} amount={50} data-testid="tip" />);
    fireEvent.click(screen.getByTestId('tip'));
    fireEvent.click(screen.getByTestId('tip-confirm'));
    await waitFor(() => expect(screen.getByTestId('tip-prompt').textContent).toContain('network'));

    fireEvent.click(screen.getByTestId('tip-confirm'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const first = body(0).idempotencyKey;
    expect(first).toBeTruthy();
    expect(body(1).idempotencyKey).toBe(first);
  });

  it('mints a DIFFERENT key when the amount changes — a new logical tip', async () => {
    // The other half of the pair, and the case a bare per-mount key gets wrong:
    // an amount switcher would otherwise reuse one key across two genuinely
    // different tips and the server would collapse the second into the first.
    fetchMock.mockRejectedValueOnce(new Error('network'));
    const { rerender } = render(
      <TipButton noun="curator" toUserId={99} amount={50} data-testid="tip" />,
    );
    fireEvent.click(screen.getByTestId('tip'));
    fireEvent.click(screen.getByTestId('tip-confirm'));
    await waitFor(() => expect(screen.getByTestId('tip-prompt').textContent).toContain('network'));

    rerender(<TipButton noun="curator" toUserId={99} amount={200} data-testid="tip" />);
    fireEvent.click(screen.getByTestId('tip-confirm'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(body(1).amount).toBe(200);
    expect(body(1).idempotencyKey).not.toBe(body(0).idempotencyKey);
  });

  it('a settled control is TERMINAL — it cannot be re-armed into a second transfer', async () => {
    // 🔴 This is what licenses the key NOT rotating after a success. If a future
    // change makes the settled state re-armable, the second tip would carry the
    // first one's idempotency key and be collapsed server-side — the viewer
    // presses twice and pays once. This case fails at that moment.
    const { rerender } = render(
      <TipButton noun="curator" toUserId={99} amount={50} data-testid="tip" />,
    );
    fireEvent.click(screen.getByTestId('tip'));
    fireEvent.click(screen.getByTestId('tip-confirm'));
    await waitFor(() => expect(screen.getByTestId('tip-done')).toBeTruthy());

    // Even the app withdrawing its own `tipped` record leaves it settled.
    rerender(
      <TipButton noun="curator" toUserId={99} amount={50} tipped={false} data-testid="tip" />,
    );
    expect(screen.getByTestId('tip-done')).toBeTruthy();
    expect(screen.queryByTestId('tip')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('settles to a tipped note and calls onTipped with the amount', async () => {
    const onTipped = vi.fn();
    render(
      <TipButton noun="curator" toUserId={99} amount={50} onTipped={onTipped} data-testid="tip" />,
    );
    fireEvent.click(screen.getByTestId('tip'));
    fireEvent.click(screen.getByTestId('tip-confirm'));

    await waitFor(() => expect(screen.getByTestId('tip-done')).toBeTruthy());
    expect(screen.getByTestId('tip-done').textContent).toBe('Tipped curator');
    expect(onTipped).toHaveBeenCalledWith(50);
  });

  it('renders the settled state directly when the app says the viewer already tipped', () => {
    render(<TipButton noun="creator" toUserId={99} amount={50} tipped data-testid="tip" />);
    expect(screen.getByTestId('tip-done')).toBeTruthy();
    expect(screen.queryByTestId('tip')).toBeNull();
  });

  it("shows the SERVER's message on failure, as an alert", async () => {
    // A fixed "could not send" would throw away causes the viewer can act on
    // (insufficient balance, over the daily cap, self-tip).
    fetchMock.mockRejectedValueOnce(new Error('Insufficient funds'));
    render(<TipButton noun="curator" toUserId={99} amount={50} data-testid="tip" />);
    fireEvent.click(screen.getByTestId('tip'));
    fireEvent.click(screen.getByTestId('tip-confirm'));

    await waitFor(() =>
      expect(screen.getByTestId('tip-prompt').textContent).toContain('Insufficient funds'),
    );
    expect(screen.getByTestId('tip-prompt').querySelector('[role="alert"]')).toBeTruthy();
    // Still armed — a failed tip must not settle.
    expect(screen.getByTestId('tip-confirm')).toBeTruthy();
  });

  it('refuses locally when the amount exceeds the remaining allowance', () => {
    render(
      <TipButton noun="curator" toUserId={99} amount={50} remaining={20} data-testid="tip" />,
    );
    const btn = screen.getByTestId('tip') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('title')).toContain('allowance');
    fireEvent.click(btn);
    expect(screen.queryByTestId('tip-prompt')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows a tip EQUAL to the remaining allowance', () => {
    // The boundary, not just a comfortable middle: `>` vs `>=` is the whole
    // difference between "spend your last 50" and "you may never spend it".
    render(
      <TipButton noun="curator" toUserId={99} amount={50} remaining={50} data-testid="tip" />,
    );
    expect((screen.getByTestId('tip') as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not gate on an allowance it was not given', () => {
    render(<TipButton noun="curator" toUserId={99} amount={5000} data-testid="tip" />);
    expect((screen.getByTestId('tip') as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables with the reason, and says it in the accessible name', () => {
    render(
      <TipButton
        noun="curator"
        toUserId={99}
        amount={50}
        disabledReason="You can't tip your own collection."
        data-testid="tip"
      />,
    );
    const btn = screen.getByTestId('tip') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('title')).toBe("You can't tip your own collection.");
    // 🔴 `title` alone is not an accessible name here — a screen-reader user
    // gets "Tip the curator, dimmed" and no reason at all.
    expect(btn.getAttribute('aria-label')).toContain("You can't tip your own collection.");
  });

  it('names the amount and the noun in the accessible name when enabled', () => {
    render(<TipButton noun="creator" toUserId={99} amount={25} data-testid="tip" />);
    expect(screen.getByTestId('tip').getAttribute('aria-label')).toBe('Tip the creator 25 Buzz');
    expect(screen.getByTestId('tip').textContent).toBe('Tip 25');
  });

  it('holds the in-flight state and keeps Cancel live', async () => {
    const d = deferredResponse();
    fetchMock.mockReturnValueOnce(d.promise);
    render(<TipButton noun="curator" toUserId={99} amount={50} data-testid="tip" />);
    fireEvent.click(screen.getByTestId('tip'));
    fireEvent.click(screen.getByTestId('tip-confirm'));

    await waitFor(() =>
      expect((screen.getByTestId('tip-confirm') as HTMLButtonElement).disabled).toBe(true),
    );
    // 🔴 Cancel stays enabled in flight — a reply that never arrives would
    // otherwise leave both controls dead with no way out short of a remount.
    expect((screen.getByTestId('tip-cancel') as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      d.resolve(okBody(50));
      await d.promise;
    });
    await waitFor(() => expect(screen.getByTestId('tip-done')).toBeTruthy());
  });

  // 🔴 THIS CASE REPLACES ONE THAT PINNED THE OPPOSITE, AND THE OLD ONE WAS
  // WRONG. It asserted that a cancel mid-flight left `onTipped` UNCALLED — but
  // Cancel resets this control's UI and does NOT abort the POST, so the Buzz had
  // already moved. The app then never refetched the allowance, never wrote its
  // `tipped` record, and the control re-armed over money that was gone.
  it('reports a LANDED transfer even if the viewer cancelled mid-flight', async () => {
    const d = deferredResponse();
    fetchMock.mockReturnValueOnce(d.promise);
    const onTipped = vi.fn();
    render(
      <TipButton noun="curator" toUserId={99} amount={50} onTipped={onTipped} data-testid="tip" />,
    );
    fireEvent.click(screen.getByTestId('tip'));
    fireEvent.click(screen.getByTestId('tip-confirm'));
    fireEvent.click(screen.getByTestId('tip-cancel'));

    await act(async () => {
      d.resolve(okBody(50));
      await d.promise;
    });
    // Money moved ⇒ the app is told, and the control shows it. Re-arming here is
    // what invites a second transfer.
    expect(onTipped).toHaveBeenCalledWith(50);
    expect(screen.getByTestId('tip-done')).toBeTruthy();
    expect(screen.queryByTestId('tip')).toBeNull();
  });

  it('reports a LANDED transfer even if the parent flipped `tipped` mid-flight', async () => {
    // The audit's probe D. The `tipped` effect bumps the attempt for its own
    // reasons; suppressing the settle on that basis swallowed a real transfer.
    const d = deferredResponse();
    fetchMock.mockReturnValueOnce(d.promise);
    const onTipped = vi.fn();
    const { rerender } = render(
      <TipButton noun="curator" toUserId={99} amount={50} onTipped={onTipped} data-testid="tip" />,
    );
    fireEvent.click(screen.getByTestId('tip'));
    fireEvent.click(screen.getByTestId('tip-confirm'));
    rerender(
      <TipButton noun="curator" toUserId={99} amount={50} tipped onTipped={onTipped} data-testid="tip" />,
    );

    await act(async () => {
      d.resolve(okBody(50));
      await d.promise;
    });
    expect(onTipped).toHaveBeenCalledWith(50);
    // And `done` is now set, so withdrawing `tipped` cannot re-arm it — which is
    // the property that licenses the idempotency key not rotating.
    rerender(
      <TipButton noun="curator" toUserId={99} amount={50} tipped={false} onTipped={onTipped} data-testid="tip" />,
    );
    expect(screen.getByTestId('tip-done')).toBeTruthy();
    expect(screen.queryByTestId('tip')).toBeNull();
  });

  it('a superseded FAILURE is still discarded — only success reports unconditionally', async () => {
    // The other half of the pair, and the control that stops the fix above from
    // being read as "ignore supersession everywhere". Nothing moved on a
    // rejection, so an abandoned attempt has nothing to report.
    const d = deferredResponse();
    fetchMock.mockReturnValueOnce(d.promise);
    render(<TipButton noun="curator" toUserId={99} amount={50} data-testid="tip" />);
    fireEvent.click(screen.getByTestId('tip'));
    fireEvent.click(screen.getByTestId('tip-confirm'));
    fireEvent.click(screen.getByTestId('tip-cancel'));

    await act(async () => {
      d.reject(new Error('Insufficient funds'));
      await d.promise.catch(() => {});
    });
    expect(screen.queryByTestId('tip-prompt')).toBeNull();
    expect(screen.getByTestId('tip')).toBeTruthy();
    // 🔴 RE-ARM AND READ THE COPY — without this the case cannot fail. Round 2
    // measured that deleting the guard left the whole suite green: `confirming`
    // is already false after Cancel, so a stored failure is simply invisible at
    // that instant. It only surfaces on the NEXT arm, as a stale `role="alert"`
    // about an attempt the viewer withdrew from.
    fireEvent.click(screen.getByTestId('tip'));
    expect(screen.getByTestId('tip-prompt').textContent).toContain('Send 50 Buzz');
    expect(screen.getByTestId('tip-prompt').textContent).not.toContain('Insufficient funds');
  });

  it('reports a landed transfer AT MOST ONCE — cancel, retry, both POSTs resolve', async () => {
    // 🔴 A REGRESSION THE PREVIOUS FIX ROUND INTRODUCED. Cancel does not abort
    // POST #1; the retry sends POST #2 with the SAME idempotency key, so the
    // server collapses them into ONE transfer — while both promises resolve.
    // Reporting on both called `onTipped(50)` twice for money that moved once,
    // and `onTipped` is handed the amount precisely so a caller can decrement an
    // allowance with it.
    const first = deferredResponse();
    const second = deferredResponse();
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const onTipped = vi.fn();
    render(
      <TipButton noun="curator" toUserId={99} amount={50} onTipped={onTipped} data-testid="tip" />,
    );
    fireEvent.click(screen.getByTestId('tip'));
    fireEvent.click(screen.getByTestId('tip-confirm'));
    fireEvent.click(screen.getByTestId('tip-cancel'));
    fireEvent.click(screen.getByTestId('tip'));
    fireEvent.click(screen.getByTestId('tip-confirm'));

    // Same key ⇒ the server saw one transfer.
    expect(body(1).idempotencyKey).toBe(body(0).idempotencyKey);

    await act(async () => {
      first.resolve(okBody(50));
      second.resolve(okBody(50));
      await Promise.all([first.promise, second.promise]);
    });
    expect(onTipped).toHaveBeenCalledTimes(1);
  });

  // ── Audit round 3: the spend gate read STALE props through a frozen closure ──
  //
  // 🔴 EVERY CASE BELOW USES A **STABLE** `onTipped`. That is the whole point:
  // an inline `onTipped={() => {}}` recreates the callback every render and
  // hides the bug completely, which is why round 2's own tests passed over it.
  // A consumer doing the idiomatic `useCallback` is the one that breaks.
  const STABLE_ON_TIPPED = () => {};

  it('does NOT wedge when the parent TOPS UP the allowance after arming', async () => {
    // Stale-restrictive, and it was permanent: nothing else moved a dep, so Send
    // refused a perfectly good tip for the life of the mount — with a message
    // that is false about the amount.
    const { rerender } = render(
      <TipButton noun="curator" toUserId={99} amount={50} remaining={10} onTipped={STABLE_ON_TIPPED} data-testid="tip" />,
    );
    rerender(
      <TipButton noun="curator" toUserId={99} amount={50} remaining={1000} onTipped={STABLE_ON_TIPPED} data-testid="tip" />,
    );
    fireEvent.click(screen.getByTestId('tip'));
    fireEvent.click(screen.getByTestId('tip-confirm'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it('does NOT wedge when a CLEARED `disabled` is followed by a Send', async () => {
    // The "view still loading, no target resolved yet" usage this component's
    // own JSDoc names.
    const { rerender } = render(
      <TipButton noun="curator" toUserId={99} amount={50} disabled onTipped={STABLE_ON_TIPPED} data-testid="tip" />,
    );
    rerender(
      <TipButton noun="curator" toUserId={99} amount={50} onTipped={STABLE_ON_TIPPED} data-testid="tip" />,
    );
    fireEvent.click(screen.getByTestId('tip'));
    fireEvent.click(screen.getByTestId('tip-confirm'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it('DOES refuse when the allowance DROPS after arming', async () => {
    // Stale-permissive: the mirror case the gate's own comment claims to cover,
    // and which sailed straight through while the deps were incomplete.
    const { rerender } = render(
      <TipButton noun="curator" toUserId={99} amount={50} remaining={1000} onTipped={STABLE_ON_TIPPED} data-testid="tip" />,
    );
    fireEvent.click(screen.getByTestId('tip'));
    rerender(
      <TipButton noun="curator" toUserId={99} amount={50} remaining={10} onTipped={STABLE_ON_TIPPED} data-testid="tip" />,
    );
    fireEvent.click(screen.getByTestId('tip-confirm'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('DOES refuse when a `disabledReason` APPEARS after arming', async () => {
    const { rerender } = render(
      <TipButton noun="curator" toUserId={99} amount={50} onTipped={STABLE_ON_TIPPED} data-testid="tip" />,
    );
    fireEvent.click(screen.getByTestId('tip'));
    rerender(
      <TipButton noun="curator" toUserId={99} amount={50} disabledReason="You can't tip yourself." onTipped={STABLE_ON_TIPPED} data-testid="tip" />,
    );
    fireEvent.click(screen.getByTestId('tip-confirm'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports BOTH transfers when the key CHANGES — two keys are two tips', async () => {
    // 🔴 The mirror of the double-report round 2 fixed, and round 2's own fix
    // caused it. Cancel does not abort POST #1; moving the amount mints a NEW
    // key, so the server does NOT collapse them — 150 Buzz moves. A per-MOUNT
    // guard told the app about 50.
    const first = deferredResponse();
    const second = deferredResponse();
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const onTipped = vi.fn();
    const { rerender } = render(
      <TipButton noun="curator" toUserId={99} amount={50} onTipped={onTipped} data-testid="tip" />,
    );
    fireEvent.click(screen.getByTestId('tip'));
    fireEvent.click(screen.getByTestId('tip-confirm'));
    fireEvent.click(screen.getByTestId('tip-cancel'));

    rerender(<TipButton noun="curator" toUserId={99} amount={100} onTipped={onTipped} data-testid="tip" />);
    fireEvent.click(screen.getByTestId('tip'));
    fireEvent.click(screen.getByTestId('tip-confirm'));

    // Distinct keys ⇒ the server saw TWO transfers.
    expect(body(1).idempotencyKey).not.toBe(body(0).idempotencyKey);

    await act(async () => {
      first.resolve(okBody(50));
      second.resolve(okBody(100));
      await Promise.all([first.promise, second.promise]);
    });
    expect(onTipped).toHaveBeenCalledTimes(2);
    expect(onTipped).toHaveBeenNthCalledWith(1, 50);
    expect(onTipped).toHaveBeenNthCalledWith(2, 100);
  });

  it('BLOCKS a non-number allowance — `Number.isNaN` does not coerce', () => {
    // The type check the `!isFinite` → `isNaN` fix silently dropped; without it
    // `remaining: 'abc'` removes the ceiling instead of blocking.
    render(
      <TipButton noun="curator" toUserId={99} amount={50} remaining={'abc' as unknown as number} data-testid="tip" />,
    );
    expect((screen.getByTestId('tip') as HTMLButtonElement).disabled).toBe(true);
  });

  it('refuses at the SPEND when the amount goes bad AFTER arming', async () => {
    // 🔴 The guard used to sit only on the trigger, but the prompt stays mounted
    // across a re-render — so a parent moving `amount` to 0 mid-handshake left an
    // enabled Send that posted it. An amount switcher is a flow this component's
    // own JSDoc contemplates.
    const { rerender } = render(
      <TipButton noun="curator" toUserId={99} amount={50} data-testid="tip" />,
    );
    fireEvent.click(screen.getByTestId('tip'));
    rerender(<TipButton noun="curator" toUserId={99} amount={0} data-testid="tip" />);
    fireEvent.click(screen.getByTestId('tip-confirm'));

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats an INFINITE allowance as unlimited, not as unusable', () => {
    // 🔴 NaN and Infinity are OPPOSITE readings and a previous revision swept
    // them together with `!Number.isFinite`. NaN cannot be compared, so it must
    // block; Infinity means the viewer has no limit, so blocking it refuses
    // someone who is allowed everything.
    render(
      <TipButton noun="curator" toUserId={99} amount={50} remaining={Number.POSITIVE_INFINITY} data-testid="tip" />,
    );
    expect((screen.getByTestId('tip') as HTMLButtonElement).disabled).toBe(false);
  });

  it('refuses an INFINITE amount', () => {
    // Makes `Number.isFinite(amount)` load-bearing rather than a longer spelling
    // of `> 0` — `NaN > 0` is already false, so only this value discriminates.
    render(
      <TipButton noun="curator" toUserId={99} amount={Number.POSITIVE_INFINITY} data-testid="tip" />,
    );
    expect((screen.getByTestId('tip') as HTMLButtonElement).disabled).toBe(true);
  });

  it('folds the ENTITY into the idempotency key — two objects are two tips', async () => {
    // 🔴 entityType/entityId are sent in the body and recorded on the
    // transaction, so they are part of WHICH tip this is. Omitting them meant a
    // deliberate tip to a different object reused the failed one's key and was
    // collapsed server-side into it — under-charge, but wrong.
    fetchMock.mockRejectedValueOnce(new Error('network'));
    const { rerender } = render(
      <TipButton noun="curator" toUserId={99} amount={50} entityType="Collection" entityId={7} data-testid="tip" />,
    );
    fireEvent.click(screen.getByTestId('tip'));
    fireEvent.click(screen.getByTestId('tip-confirm'));
    await waitFor(() => expect(screen.getByTestId('tip-prompt').textContent).toContain('network'));

    rerender(
      <TipButton noun="curator" toUserId={99} amount={50} entityType="Collection" entityId={8} data-testid="tip" />,
    );
    fireEvent.click(screen.getByTestId('tip-confirm'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(body(0).entityId).toBe(7);
    expect(body(1).entityId).toBe(8);
    expect(body(1).idempotencyKey).not.toBe(body(0).idempotencyKey);
  });

  it('refuses a non-positive or non-finite amount', () => {
    // A money control that renders "Tip 0" and posts it.
    for (const amount of [0, -5, Number.NaN]) {
      cleanup();
      render(<TipButton noun="curator" toUserId={99} amount={amount} data-testid="tip" />);
      expect((screen.getByTestId('tip') as HTMLButtonElement).disabled, `amount=${amount}`).toBe(
        true,
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a NaN allowance BLOCKS rather than silently removing the ceiling', () => {
    // `amount > NaN` is false, so an unusable allowance used to read as "plenty
    // left" — the wrong direction for a value that cannot be compared.
    render(<TipButton noun="curator" toUserId={99} amount={50} remaining={Number.NaN} data-testid="tip" />);
    expect((screen.getByTestId('tip') as HTMLButtonElement).disabled).toBe(true);
  });

  it('defaults its testids when none is given', () => {
    render(<TipButton noun="curator" toUserId={99} amount={50} />);
    expect(screen.getByTestId('tip-button')).toBeTruthy();
    fireEvent.click(screen.getByTestId('tip-button'));
    expect(screen.getByTestId('tip-confirm-prompt')).toBeTruthy();
    expect(screen.getByTestId('tip-confirm')).toBeTruthy();
    expect(screen.getByTestId('tip-cancel')).toBeTruthy();
  });
});
