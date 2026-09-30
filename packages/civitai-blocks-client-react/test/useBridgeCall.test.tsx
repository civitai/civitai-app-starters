import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CallOptions } from '@civitai/blocks-client';
import { useBridgeCall } from '../src/useBridgeCall.js';

afterEach(cleanup);

/** A promise whose settlement this test controls, plus the signal it was given. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function Probe<T>({
  call,
  deps,
  seen,
}: {
  call: (opts: CallOptions) => Promise<T>;
  deps: unknown[];
  seen: Array<{ data: T | undefined; error: unknown; loading: boolean }>;
}) {
  const state = useBridgeCall(call, deps);
  seen.push({ data: state.data, error: state.error, loading: state.loading });
  return null;
}

describe('useBridgeCall', () => {
  it('exposes the resolved value and clears loading', async () => {
    const d = deferred<string>();
    const seen: Array<{ data: string | undefined; error: unknown; loading: boolean }> = [];

    render(<Probe call={() => d.promise} deps={['a']} seen={seen} />);
    expect(seen.at(-1)).toMatchObject({ data: undefined, loading: true });

    await act(async () => {
      d.resolve('ok');
      await d.promise;
    });

    expect(seen.at(-1)).toMatchObject({ data: 'ok', error: undefined, loading: false });
  });

  // 🔴 THE REGRESSION THIS PRIMITIVE EXISTS FOR — civitai/civitai-app-starters#392.
  // Request A goes out, deps change, request B goes out and resolves FIRST.
  // A then resolves. Its reply is older and must be dropped, not written.
  it('drops a superseded reply that lands after a newer one', async () => {
    const a = deferred<string>();
    const b = deferred<string>();
    const seen: Array<{ data: string | undefined; error: unknown; loading: boolean }> = [];

    const { rerender } = render(<Probe call={() => a.promise} deps={['page-1']} seen={seen} />);

    // deps change -> run B supersedes run A, which is still in flight.
    rerender(<Probe call={() => b.promise} deps={['page-2']} seen={seen} />);

    await act(async () => {
      b.resolve('page-2');
      await b.promise;
    });
    expect(seen.at(-1)?.data).toBe('page-2');

    // A lands LAST. Without the run ticket this overwrites page-2 with page-1.
    await act(async () => {
      a.resolve('page-1');
      await a.promise;
    });

    expect(seen.at(-1)?.data).toBe('page-2');
    expect(seen.map((s) => s.data)).not.toContain('page-1');
  });

  it('aborts the superseded request rather than only ignoring it', async () => {
    const signals: AbortSignal[] = [];
    const never = () => new Promise<string>(() => {});
    const seen: Array<{ data: string | undefined; error: unknown; loading: boolean }> = [];

    const call = (opts: CallOptions) => {
      signals.push(opts.signal!);
      return never();
    };

    const { rerender } = render(<Probe call={call} deps={['a']} seen={seen} />);
    rerender(<Probe call={call} deps={['b']} seen={seen} />);

    expect(signals).toHaveLength(2);
    expect(signals[0]!.aborted).toBe(true); // superseded
    expect(signals[1]!.aborted).toBe(false); // current
  });

  // Pins the ABORT on unmount, and nothing more. The second assertion (no extra
  // render) is a free consequence of React 18 no-opping setState on an unmounted
  // component — it is NOT evidence of a guard in this hook, and a mutation sweep
  // confirmed that: the `mountedRef` check this hook used to carry survived
  // deletion because React, not the check, was doing the work. The check was
  // removed rather than kept; this name says what is left.
  it('aborts the in-flight request on unmount', async () => {
    const d = deferred<string>();
    let signal: AbortSignal | undefined;
    const seen: Array<{ data: string | undefined; error: unknown; loading: boolean }> = [];

    const { unmount } = render(
      <Probe
        call={(opts) => {
          signal = opts.signal;
          return d.promise;
        }}
        deps={['a']}
        seen={seen}
      />,
    );

    unmount();
    expect(signal?.aborted).toBe(true);

    const rendersBefore = seen.length;
    await act(async () => {
      d.resolve('late');
      await d.promise;
    });

    // No further render was produced by the late reply.
    expect(seen.length).toBe(rendersBefore);
    expect(seen.map((s) => s.data)).not.toContain('late');
  });

  it('reports a rejection, but never an abort', async () => {
    const d = deferred<string>();
    const seen: Array<{ data: string | undefined; error: unknown; loading: boolean }> = [];

    render(<Probe call={() => d.promise} deps={['a']} seen={seen} />);

    const boom = new Error('forbidden');
    await act(async () => {
      d.reject(boom);
      await d.promise.catch(() => {});
    });

    expect(seen.at(-1)).toMatchObject({ error: boom, loading: false });
  });

  it('refetch() re-runs the call and supersedes the previous one', async () => {
    const calls: Array<ReturnType<typeof deferred<string>>> = [];
    const seen: Array<{ data: string | undefined; error: unknown; loading: boolean }> = [];
    let api: { refetch: () => void } | undefined;

    function Harness() {
      const state = useBridgeCall<string>(() => {
        const d = deferred<string>();
        calls.push(d);
        return d.promise;
      }, []);
      api = state;
      seen.push({ data: state.data, error: state.error, loading: state.loading });
      return null;
    }

    render(<Harness />);
    expect(calls).toHaveLength(1);

    await act(async () => {
      calls[0]!.resolve('first');
      await calls[0]!.promise;
    });
    expect(seen.at(-1)?.data).toBe('first');

    await act(async () => {
      api!.refetch();
    });
    expect(calls).toHaveLength(2);

    await act(async () => {
      calls[1]!.resolve('second');
      await calls[1]!.promise;
    });
    expect(seen.at(-1)?.data).toBe('second');
  });
});
