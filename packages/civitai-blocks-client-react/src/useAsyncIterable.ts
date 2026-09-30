import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import type { CallOptions } from '@civitai/blocks-client';

export interface AsyncIterableState<T> {
  /** Everything yielded so far by the CURRENT run. Reset when a run supersedes. */
  items: T[];
  error: unknown;
  /** True while the iteration is still open. */
  loading: boolean;
  /** True once the iterable ended on its own. Never true for an endless one. */
  done: boolean;
  /** Restart the iteration from scratch. Supersedes anything in flight. */
  refetch: () => void;
}

/**
 * Streaming bridge reads — `buzz.listTransactions()`,
 * `orchestration.listWorkflows()`, `orchestration.watchWorkflow()`: anything
 * returning an `AsyncIterable`.
 *
 * The client replaced cursor-threading with async generators, so there is no
 * page token for a caller to hold and no "load more" to wire; the generator
 * pulls until its `limit`, its end, or its `AbortSignal`.
 *
 * 🔴 CANCELLATION IS THE WHOLE JOB, AND `break` ALONE IS NOT ENOUGH. The effect
 * cleanup does both halves: it aborts the signal (so the generator's own
 * in-flight bridge request is cancelled) AND flips `cancelled` (so nothing
 * writes state after the component is gone, and the loop stops even if the
 * generator ignores its signal). A run that is superseded mid-iteration must
 * not append to the next run's list — the same defect class as
 * civitai/civitai-app-starters#392, with more chances to hit it because an
 * iterable settles many times rather than once.
 *
 * `items` is copied on each yield so React sees a new reference and renders
 * progressively. That is O(n²) over a very long stream; pass a `limit` in the
 * query for endless ones — `watchWorkflow` is endless by design and should
 * normally be read for its latest item, not accumulated.
 */
export function useAsyncIterable<T>(
  create: (opts: CallOptions) => AsyncIterable<T>,
  deps: DependencyList = [],
): AsyncIterableState<T> {
  const createRef = useRef(create);
  createRef.current = create;

  const [state, setState] = useState<Omit<AsyncIterableState<T>, 'refetch'>>({
    items: [],
    error: undefined,
    loading: true,
    done: false,
  });

  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    setState({ items: [], error: undefined, loading: true, done: false });

    void (async () => {
      const acc: T[] = [];
      try {
        for await (const item of createRef.current({ signal: controller.signal })) {
          if (cancelled) return;
          acc.push(item);
          setState({ items: [...acc], error: undefined, loading: true, done: false });
        }
        if (!cancelled) {
          setState({ items: acc, error: undefined, loading: false, done: true });
        }
      } catch (error: unknown) {
        // An abort is our own doing — it is not a failure to report.
        if (!cancelled && !controller.signal.aborted) {
          setState({ items: acc, error, loading: false, done: false });
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  return { ...state, refetch };
}
