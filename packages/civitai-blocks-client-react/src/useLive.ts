import { useCallback, useSyncExternalStore } from 'react';
import type { Live } from '@civitai/blocks-client';

export interface LiveState<T> {
  /** `undefined` until the first load lands. */
  value: T | undefined;
  /** The last load's failure. A `value` alongside it is the previous, stale one. */
  error: unknown;
  loading: boolean;
  refresh: () => Promise<T>;
}

/**
 * Host-pushed values — `buzz.watchAccounts()` and anything else returning
 * `Live<T>`.
 *
 * `Live` is an `EventTarget` that dispatches `change` and promises stable value
 * identity between changes, which is exactly `useSyncExternalStore`'s contract.
 * Using it rather than `useState` + `useEffect` is not stylistic: the store API
 * is what makes concurrent React read a consistent value instead of tearing
 * mid-render.
 *
 * 🔴 THREE SUBSCRIPTIONS, ON PURPOSE — DO NOT "TIDY" THIS INTO ONE.
 * `useSyncExternalStore` calls `getSnapshot` on every render and bails out only
 * when the result is `Object.is`-equal to the last one. Composing
 * `{ value, error, loading }` in the snapshot allocates a fresh object each
 * call, is never equal, and React re-renders forever — "The result of
 * getSnapshot should be cached". Reading each field through its own store keeps
 * every snapshot a stable reference or a primitive.
 *
 * The third argument is `getServerSnapshot`. Without it this throws during SSR,
 * and `next-app` renders blocks on the server.
 */
export function useLive<T>(live: Live<T>): LiveState<T> {
  const subscribe = useCallback(
    (onChange: () => void) => {
      live.addEventListener('change', onChange);
      return () => live.removeEventListener('change', onChange);
    },
    [live],
  );

  const value = useSyncExternalStore(
    subscribe,
    () => live.value,
    () => undefined,
  );
  const error = useSyncExternalStore(
    subscribe,
    () => live.error,
    () => undefined,
  );
  const loading = useSyncExternalStore(
    subscribe,
    () => live.loading,
    () => false,
  );

  const refresh = useCallback(() => live.refresh(), [live]);

  return { value, error, loading, refresh };
}
