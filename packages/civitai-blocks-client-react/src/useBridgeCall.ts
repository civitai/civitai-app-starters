import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import type { CallOptions } from '@civitai/blocks-client';

export interface BridgeCallState<T> {
  /** The latest settled value, or `undefined` before the first one lands. */
  data: T | undefined;
  /** The latest failure. Cleared by a subsequent success. */
  error: unknown;
  loading: boolean;
  /** Re-run the call. Supersedes anything in flight, same as a `deps` change. */
  refetch: () => void;
}

/**
 * One-shot bridge calls — `buzz.getAccounts()`, `storage.get(k)`,
 * `orchestration.estimateWorkflow(…)`: anything returning a plain `Promise`.
 *
 * 🔴 TWO GUARANTEES, AND THEY ARE THE WHOLE POINT:
 *
 * 1. **A superseded request can never write state.** Every run takes a ticket
 *    (`runRef`); a reply whose ticket is not the current one is dropped.
 *    Without this, `deps` changing while a request is in flight lets the OLD
 *    reply land second and overwrite the new state — measured on the old SDK's
 *    `useBuzzTransactions`, where paging forward then back wedged the cursor
 *    (civitai/civitai-app-starters#392, seven hooks).
 * 2. **A superseded request is aborted, not merely ignored.** Dropping the reply
 *    fixes the state; aborting stops the host doing work nobody will read.
 *
 * 🔴 THERE IS DELIBERATELY NO `mountedRef`. React 18 made `setState` on an
 * unmounted component a silent no-op and removed the warning that used to claim
 * otherwise, so the guard every one of the old hooks carried was pinning a
 * hazard that no longer exists. A mutation sweep confirmed it: deleting the
 * check left every test green, because React — not the check — is what makes
 * the late write harmless. It was removed rather than kept with a test written
 * to justify it. (#393 is a different defect: a promise handed to a CALLER and
 * never settled. This hook hands out no promises, so it cannot have it.)
 *
 * `deps` decides when to re-run, exactly like `useEffect`: `call` itself is read
 * through a ref, so an inline arrow does not re-run on every render. The list
 * must keep a stable length across renders, same contract React already has.
 */
export function useBridgeCall<T>(
  call: (opts: CallOptions) => Promise<T>,
  deps: DependencyList = [],
): BridgeCallState<T> {
  const callRef = useRef(call);
  callRef.current = call;

  const [state, setState] = useState<Omit<BridgeCallState<T>, 'refetch'>>({
    data: undefined,
    error: undefined,
    loading: true,
  });

  // Bumped by refetch(); participates in the effect's deps so a manual re-run
  // goes through exactly the same supersede path as a deps change.
  const [nonce, setNonce] = useState(0);

  const runRef = useRef(0);

  useEffect(() => {
    const run = ++runRef.current;
    const controller = new AbortController();

    // Keep the previous data visible while reloading; only the flag moves.
    setState((s) => (s.loading ? s : { ...s, loading: true }));

    const current = () => run === runRef.current;

    callRef.current({ signal: controller.signal }).then(
      (data) => {
        if (current()) setState({ data, error: undefined, loading: false });
      },
      (error: unknown) => {
        // An abort is our own doing — it is not a failure to report.
        if (current() && !controller.signal.aborted) {
          setState({ data: undefined, error, loading: false });
        }
      },
    );

    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  return { ...state, refetch };
}
