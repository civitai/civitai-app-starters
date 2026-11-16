import { useMemo } from 'react';

import { useTransportSnapshot } from './useBlockContext.js';
import { useTransportConnection } from './useTransportConnection.js';

/**
 * What {@link useCivitaiLocation} returns. An alias — see `./returnTypeLedger.js`
 * for why every hook on the entry has one of these.
 */
export interface UseCivitaiLocation {
  /** The sub-path below your app's root, no leading slash — `''` on your index. Same value as `useCivitaiRoute()`. */
  subPath: string;
  /** The query string, `''` or starting with `?` (`'?take=3'`). */
  search: string;
  /** The fragment, `''` or starting with `#` (`'#top'`). */
  hash: string;
}

/**
 * The view that is CURRENTLY showing, as `{ subPath, search, hash }` — the deep-link
 * twin of {@link useCivitaiRoute}, which keeps returning the bare `subPath` string.
 *
 * Kept live the same way: the first value comes from `BLOCK_INIT.context`, every later
 * one from the host's `ROUTE_CHANGED`. The host sends that on YOUR navigations and on
 * the viewer's back/forward, so render from this hook and your app's views follow the
 * browser's history:
 *
 * ```tsx
 * const { subPath, search } = useCivitaiLocation();
 * const { navigate } = useCivitaiNavigate();
 * const take = new URLSearchParams(search).get('take');
 * // open a character: a history entry, so Back returns to the gallery
 * navigate(`c/${id}`);
 * // switch take: replace, so Back does not step through every take
 * navigate(`c/${id}?take=${n}`, { replace: true });
 * ```
 *
 * 🔴 STATE YOU KEEP ONLY IN `useState` IS NOT IN HISTORY. An app that switches views
 * with local state gets no history entries, so the browser's Back leaves the app. Put
 * the view in the route (`navigate`) and derive it from this hook.
 *
 * Old host: `search` and `hash` read as `''` (it sends neither), and `subPath` behaves as
 * `useCivitaiRoute()` documents. Model slot: all three are `''`.
 *
 * The returned object keeps its identity until a value moves, so it is safe in effect
 * dependency lists.
 */
export function useCivitaiLocation(): UseCivitaiLocation {
  useTransportConnection();
  const context = useTransportSnapshot().context as {
    subPath?: unknown;
    search?: unknown;
    hash?: unknown;
  };
  const subPath = typeof context.subPath === 'string' ? context.subPath : '';
  const search = typeof context.search === 'string' ? context.search : '';
  const hash = typeof context.hash === 'string' ? context.hash : '';
  return useMemo(() => ({ subPath, search, hash }), [subPath, search, hash]);
}
