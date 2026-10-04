/**
 * Unit-tier coverage for the two `useNestedDocument` properties the browser
 * tier structurally cannot see: the FETCH DEADLINE, and that no committed
 * render ever pairs a new `src` with the previous document.
 *
 * WHY THIS FILE EXISTS ALONGSIDE `useNestedDocument.browser.test.tsx`
 * ==================================================================
 * The browser file's job is "a real parser resolves against the injected base",
 * which needs Chromium. These two need FAKE TIMERS and a RENDER LOG, neither of
 * which wants a browser.
 *
 * The `timedOut`-flag deadline below is not new practice here: `useGoodPurchase`
 * arms the same flag and branches on it the same way, pinned with fake timers in
 * `test/useGoodPurchase.test.tsx`'s `the abort branch` describe.
 *
 * The division:
 *
 *   `useNestedDocument.browser.test`  → the state machine + in-browser resolution
 *   this file                         → the deadline, and the (src, srcDoc) pair
 *
 * 🔴 WHY THE DEADLINE NEEDS A TEST AT ALL, AND WHY THE OBVIOUS WIRING IS WRONG.
 * The hook creates its own `AbortController` and never exposes it, so before the
 * deadline existed a stalled response left `status === 'loading'` FOREVER with
 * nothing a caller could do about it. And the first wiring anyone reaches for —
 * `setTimeout(() => controller.abort(), …)` — is SWALLOWED here, because the
 * `.catch` drops every rejection whose `controller.signal.aborted` is true (it
 * has to: that is how an unmount and a `src` change stay silent). So the
 * timeout needs its own flag, and the test below is red without it: the hook
 * sits on `'loading'` past the deadline instead of reporting an error.
 *
 * WATCHED TO FAIL (mutation-checked 2026-10-03). Denominator: 7 tests in this
 * file, green at HEAD, with the unmutated baseline run as the positive control:
 *
 *   - wire the deadline to the shared controller but DELETE the `timedOut`
 *     branch (the swallowing above)                → 1 red: `expected 'loading'
 *     to be 'error'`. The hook sits on `'loading'` past the deadline.
 *   - flag `timedOut` but never `abort()`          → 1 red, same assertion,
 *     different cause: the fetch never settles, so the `.catch` never runs.
 *   - change the constant 30_000 → 5_000           → 2 red: the message
 *     assertion AND the 29,999ms boundary, which is why the boundary is here.
 *   - drop `clearTimeout` from the effect cleanup  → 1 red, and ONLY via
 *     `vi.getTimerCount()`. 🔴 The sweep found this mutant SURVIVING first: it
 *     changes no state at all, because `abort()` on an already-aborted
 *     controller is a no-op and `.finally` clears the timer a microtask later
 *     anyway. What it does change is that each unmount leaves a 30-second timer
 *     holding the effect's closure, so the timer COUNT is the observable, and
 *     the assertion had to be added rather than assumed.
 *   - drop the render-phase reset entirely         → 2 red, both pairing cases.
 *   - keep the reset but RETURN the stale `state`  → 2 red, the same two. Both
 *     spellings are listed because they differ in whether React would ever
 *     COMMIT the stale pair, and only the returned value is observable.
 *
 * Method: exact-literal replacement, occurrence count asserted to be 1, restore
 * from a `cp -a` copy with its sha256 re-checked after every restore.
 *
 * FIXTURE VALUES ARE PAIRWISE DISTINCT, and distinct from the constants the
 * assertions name. The two hosts (`stall-fixture.example`,
 * `pair-fixture.example`), the directories (`boot/`, `alpha/`, `bravo/`) and the
 * documents (`entry.html`, `one.html`, `two.html`) share no substring with each
 * other or with `30000`, so no assertion can be satisfied by the wrong fixture
 * and a mutant hardcoding any one literal cannot pass another's assertion.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useNestedDocument } from '../src/hooks/useNestedDocument.js';

/* ------------------------------------------------------------------ fixtures */

const STALL_DOC = 'https://stall-fixture.example/boot/entry.html';

const PAIR_HOST = 'https://pair-fixture.example';
const ONE = `${PAIR_HOST}/alpha/one.html`;
const TWO = `${PAIR_HOST}/bravo/two.html`;

/** Carries a relative asset, so the injected base is visible in the output. */
const MARKUP = '<!doctype html><html><head></head><body><img src="tile.avif"></body></html>';

/**
 * The exact `<base>` each `src` must produce. LITERALS, in a lookup — not a
 * function that recomputes the directory, which would re-implement the thing
 * under test.
 */
const EXPECTED_BASE: Record<string, string> = {
  [ONE]: '<base href="https://pair-fixture.example/alpha/">',
  [TWO]: '<base href="https://pair-fixture.example/bravo/">',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function textResponse(body: string, url: string): Response {
  return { ok: true, status: 200, url, text: async () => body } as unknown as Response;
}

/**
 * A faithful stalled `fetch`: it never resolves, and — like the real one — it
 * REJECTS with an `AbortError` when its signal aborts. A stub that ignored the
 * signal could not distinguish the fix from the bug, because neither would ever
 * reach the hook's `.catch`.
 */
function stubStalledFetch(): { aborts: number } {
  const seen = { aborts: 0 };
  vi.stubGlobal(
    'fetch',
    (_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          seen.aborts += 1;
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }),
  );
  return seen;
}

function Probe({ src }: { src?: string }) {
  const { srcDoc, status, error } = useNestedDocument({ src });
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="error">{error ? error.message : '-'}</span>
      <span data-testid="len">{srcDoc === null ? 'null' : String(srcDoc.length)}</span>
    </div>
  );
}

const status = () => screen.getByTestId('status').textContent;
const message = () => screen.getByTestId('error').textContent;

/* -------------------------------------------------------------- the deadline */

describe('useNestedDocument — the fetch has a deadline', () => {
  it('🔴 a stalled fetch becomes an ERROR at 30s, naming the timeout', async () => {
    vi.useFakeTimers();
    const seen = stubStalledFetch();

    render(<Probe src={STALL_DOC} />);
    expect(status()).toBe('loading');

    // 🔴 `act` + `advanceTimersByTimeAsync`, NOT `waitFor`: under fake timers
    // `waitFor` polls on a timer it is itself freezing and never settles (it
    // hung this test for the full 5s budget while writing it). Every other
    // fake-timer test in this package uses this shape.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(status()).toBe('error');

    // Literal. The `30000` here is the claim; a mutant that changes the
    // constant fails on this string even when the state machine still works.
    expect(message()).toBe(
      'useNestedDocument: fetching https://stall-fixture.example/boot/entry.html ' +
        'timed out after 30000ms.',
    );
    expect(screen.getByTestId('len').textContent).toBe('null');
    // The deadline ABORTS as well as reports — otherwise the request keeps
    // consuming a connection after the hook has given up on it.
    expect(seen.aborts).toBe(1);
  });

  it('BOUNDARY: still loading at 29,999ms — the deadline is not fired early', async () => {
    // The other end of the pair. Without it, "error at 30s" is satisfied by an
    // implementation that errors immediately.
    vi.useFakeTimers();
    const seen = stubStalledFetch();

    render(<Probe src={STALL_DOC} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_999);
    });

    expect(status()).toBe('loading');
    expect(message()).toBe('-');
    expect(seen.aborts).toBe(0);
  });

  it('🔴 an UNMOUNT abort is NOT reported as a timeout, and the timer is cleared', async () => {
    // The distinction the separate flag exists for. The unmount aborts the same
    // controller the deadline would have aborted, so an implementation that
    // reads `signal.aborted` to decide "timed out" would report a timeout for
    // every unmount — and one that forgets `clearTimeout` would fire the
    // deadline on a dead effect.
    vi.useFakeTimers();
    const errors: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    const seen = stubStalledFetch();

    const { unmount } = render(<Probe src={STALL_DOC} />);
    expect(status()).toBe('loading');

    unmount();
    expect(seen.aborts).toBe(1);
    // 🔴 SYNCHRONOUSLY ZERO PENDING TIMERS — the only observable the cleanup's
    // `clearTimeout` has. The mutation sweep found that dropping it changes NO
    // state: the deadline's `abort()` on an already-aborted controller is a
    // no-op, and `.finally` clears the timer a microtask later anyway. What it
    // does change is that each unmount leaves a 30-second timer holding this
    // effect's closure, and THIS read is the one place that is visible.
    expect(vi.getTimerCount()).toBe(0);

    // Well past the deadline. Nothing may be written or logged.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });

    expect(seen.aborts).toBe(1);
    expect(errors).toEqual([]);
    expect(screen.queryByTestId('status')).toBeNull();
  });

  it('a settled fetch clears the timer, so the deadline cannot fire afterwards', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', async (input: unknown) => textResponse(MARKUP, String(input)));

    render(<Probe src={ONE} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(status()).toBe('ready');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    // Still ready — a leaked timer would abort a finished request and, with a
    // `timedOut` flag set, overwrite a good document with an error.
    expect(status()).toBe('ready');
    expect(message()).toBe('-');
  });

  it('POSITIVE CONTROL: a non-OK status still reports the HOST’s error, not the timeout', async () => {
    // Proves the timeout branch has not swallowed the ordinary error path: the
    // two must stay distinguishable in the message a developer reads.
    vi.stubGlobal(
      'fetch',
      async (input: unknown) =>
        ({
          ok: false,
          status: 451,
          url: String(input),
          text: async () => '',
        }) as unknown as Response,
    );

    render(<Probe src={STALL_DOC} />);
    await waitFor(() => expect(status()).toBe('error'));

    expect(message()).toBe(
      'fetchNestedDocument: https://stall-fixture.example/boot/entry.html returned HTTP 451.',
    );
  });
});

/* ------------------------------------------------- the (src, srcDoc) pairing */

describe('useNestedDocument — no committed render pairs a new src with the old document', () => {
  interface Seen {
    src: string;
    status: string;
    srcDoc: string;
  }

  it('🔴 every `ready` render carries the base belonging to ITS OWN src', async () => {
    // The render-phase reset is what buys this. Without it the render that
    // changes `src` returns the PREVIOUS document still labelled `'ready'` —
    // committed, and therefore paintable — and only the effect afterwards moves
    // the hook to `'loading'`. A post-`act` status read cannot see that frame,
    // because `act` has already flushed the effect; the log below can.
    const seen: Seen[] = [];
    function Logged({ src }: { src: string }) {
      const { srcDoc, status: s } = useNestedDocument({ src });
      seen.push({ src, status: s, srcDoc: srcDoc ?? '' });
      return <span data-testid="status">{s}</span>;
    }

    vi.stubGlobal('fetch', async (input: unknown) => textResponse(MARKUP, String(input)));

    const { rerender } = render(<Logged src={ONE} />);
    await waitFor(() => expect(status()).toBe('ready'));

    rerender(<Logged src={TWO} />);
    await waitFor(() => expect(status()).toBe('ready'));

    const mismatched = seen.filter(
      (r) => r.status === 'ready' && !r.srcDoc.includes(EXPECTED_BASE[r.src] ?? ' '),
    );
    expect(mismatched).toEqual([]);

    // POSITIVE CONTROLS. An empty `mismatched` is otherwise indistinguishable
    // from a log that recorded no `ready` render at all.
    expect(seen.filter((r) => r.status === 'ready' && r.src === ONE).length).toBeGreaterThan(0);
    expect(seen.filter((r) => r.status === 'ready' && r.src === TWO).length).toBeGreaterThan(0);
  });

  it('clearing src never pairs it with a document either', async () => {
    const seen: Seen[] = [];
    function Logged({ src }: { src?: string }) {
      const { srcDoc, status: s } = useNestedDocument({ src });
      seen.push({ src: src ?? '', status: s, srcDoc: srcDoc ?? '' });
      return <span data-testid="status">{s}</span>;
    }

    vi.stubGlobal('fetch', async (input: unknown) => textResponse(MARKUP, String(input)));

    const { rerender } = render(<Logged src={ONE} />);
    await waitFor(() => expect(status()).toBe('ready'));

    rerender(<Logged />);
    await waitFor(() => expect(status()).toBe('idle'));

    expect(seen.filter((r) => r.src === '' && r.srcDoc !== '')).toEqual([]);
    expect(seen.filter((r) => r.src === ONE && r.status === 'ready').length).toBeGreaterThan(0);
  });
});
