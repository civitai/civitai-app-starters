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

  it('a cancel mid-flight does not let the late result settle the control', async () => {
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
    // The attempt was superseded: no settled note, and the app is not told a tip
    // it saw withdrawn from succeeded.
    expect(screen.queryByTestId('tip-done')).toBeNull();
    expect(onTipped).not.toHaveBeenCalled();
    expect(screen.getByTestId('tip')).toBeTruthy();
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
