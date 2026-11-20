import { useCallback, useEffect, useMemo, useRef } from 'react';

/**
 * ONE latest-wins guard for every hook that auto-issues a request and writes the
 * reply into component state (#392).
 *
 * 🔴 WHY THIS IS A SHARED HELPER AND NOT A PATTERN TO COPY. Before it, eight
 * hooks each open-coded a `mountedRef` and every one of them got the same thing
 * wrong in the same direction: `mountedRef` answers "is this component still
 * here?", which is not the question a reply has to pass. The question is "is
 * this reply still the one I am waiting for?" — and a superseded request's reply
 * passes the mount check every time, because nothing unmounted. A predicate
 * duplicated across N call sites regenerates the same bug at N sites; this is
 * the consolidation that makes it one site.
 *
 * THE FAILURE IT CLOSES. `refetch`'s identity changes (a `paramsKey` moves when
 * the viewer clicks "next page"), the mount effect re-runs, and request B goes
 * out while A is still in flight. B answers first and paints page 2. A answers
 * second and — with only a mount guard — repaints page 1 *and* rewrites `cursor`
 * to page 2's value, so "next" re-fetches the page already shown and the viewer
 * is wedged. The transport correlates each reply to its own request correctly;
 * the defect is purely in which reply the hook lets write state.
 *
 * WHAT IT SUPERSEDES. `isCurrent` is FALSE after unmount as well as for a
 * superseded request, so it replaces `mountedRef` rather than sitting next to
 * it — one predicate, one place, both hazards.
 *
 * ⚠️ HONEST LABEL ON THE MOUNT HALF: it is DEFENSIVE, not load-bearing, and no
 * test in this package can kill it. Mutating `mountedRef.current && token ===
 * latestRef.current` down to just the latest-wins half leaves 84 tests green,
 * because on React 18+ a `setState` against an unmounted component is a silent
 * no-op — there is no warning to catch and no render to observe. It is kept
 * because it is what the hooks did before (it avoids the pointless work), NOT
 * because anything measures it. The LATEST-WINS half is the one that carries
 * weight: mutating THAT away reddens 24 cases.
 *
 * @example
 * const seq = useRequestSequencer();
 * const refetch = useCallback(() => {
 *   const token = seq.begin();          // supersedes any earlier request
 *   setLoading(true);
 *   sendTypedRequest(...)
 *     .then((reply) => {
 *       if (!seq.isCurrent(token)) return;   // stale or unmounted — drop it
 *       setData(reply.result);
 *       setLoading(false);
 *     });
 * }, [seq, ...]);
 */
export interface RequestSequencer {
  /**
   * Open a new request and SUPERSEDE every earlier one. Returns the token that
   * identifies it; hand that token to {@link RequestSequencer.isCurrent} before
   * writing any state derived from the reply.
   */
  begin: () => number;
  /**
   * `true` only when `token` names the most recently begun request AND the
   * component is still mounted. Every other case — a superseded request, a reply
   * after unmount — is `false`.
   */
  isCurrent: (token: number) => boolean;
}

/**
 * Create a {@link RequestSequencer} for one hook instance.
 *
 * The returned object is STABLE for the life of the component (both methods are
 * `useCallback`-pinned with no dependencies, and the object itself is memoized),
 * so a consumer can list it in a `useCallback` dependency array without
 * retriggering the very effect it guards.
 */
export function useRequestSequencer(): RequestSequencer {
  // Monotonic request counter. `0` is the "no request yet" value and is never
  // handed out, so `isCurrent(0)` is false by construction.
  const latestRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const begin = useCallback(() => {
    latestRef.current += 1;
    return latestRef.current;
  }, []);

  const isCurrent = useCallback(
    (token: number) => mountedRef.current && token === latestRef.current,
    [],
  );

  return useMemo(() => ({ begin, isCurrent }), [begin, isCurrent]);
}
