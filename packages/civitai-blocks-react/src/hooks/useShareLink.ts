import { useCallback, useEffect, useRef, useState } from 'react';

import type { BlockShareLinkRequest, BlockShareLinkResult } from '@civitai/app-sdk/blocks';

import { HUMAN_INTERACTION_TIMEOUT_MS } from '../transport/requestTimeouts.js';
import { getTransport } from '../transport/singleton.js';
import { sendTypedRequest } from '../transport/transport.js';
import { useTransportSnapshot } from './useBlockContext.js';
import { useCivitaiLocation } from './useCivitaiLocation.js';
import { useTransportConnection } from './useTransportConnection.js';

/** What {@link useShareLink} returns. */
export interface UseShareLink {
  /**
   * Ask the host for a link to a view of this app, and have it copy the link (or open
   * the share sheet on a phone). With no argument, links to the view showing NOW
   * (`useCivitaiLocation()`); with one, to exactly that view (absent fields are `''`).
   * Resolves with `{ url, copied, method }`; rejects only on a host refusal.
   */
  share: (target?: BlockShareLinkRequest) => Promise<BlockShareLinkResult>;
  isPending: boolean;
  /** The last refusal, cleared when the next `share()` starts. */
  error: Error | null;
  /** The last successful result, so a component can render the fallback text. */
  lastResult: BlockShareLinkResult | null;
}

const SHARE_FAILED = 'failed to share the link';

/**
 * The refusal for a host that cannot serve SHARE_LINK: a page host that predates it, or any
 * slot that is not a full page. The same text the mock and dev:live hosts reply with.
 */
export const SHARE_LINK_UNSUPPORTED_ERROR = 'unsupported on this host';

/**
 * A "Copy link" for a view of your app (HQ app_blocks_sdk_j1gc).
 *
 * The HOST builds the canonical URL — `https://civitai.com/apps/run/<slug>/<subPath>`
 * plus your `search` and `hash` — from its own origin and your app's slug. You name only
 * the view, never a URL, and a view that would leave your app (`..`, `//host`, a scheme)
 * is refused with `'invalid share link'`. The host then copies it, or opens the native
 * share sheet on a phone, and tells you what happened:
 *
 *  - `{ copied: true, method: 'clipboard' }` — it is on the clipboard;
 *  - `{ copied: false, method: 'share' }` — the viewer shared it from the sheet;
 *  - `{ copied: false, method: 'none' }` — nothing was delivered. 🔴 Show `url` as
 *    selectable text so the viewer can copy it by hand. This is a normal result, not an
 *    error: a browser can refuse the copy for reasons the app cannot see.
 *
 * 🔴 CALL IT FROM THE CLICK HANDLER, WITH NOTHING AWAITED FIRST. The clipboard and the
 * share sheet need the viewer's click; it reaches the host from your frame, but expires.
 * Without it the host does not try, and answers `method: 'none'`.
 *
 * Refusals (rejections): `'invalid share link'`, `'sharing is not available here'`
 * (a surface with no app route, review, or the dev tunnel), `'the app is not ready yet'`,
 * `'rate_limited'` (the host admits one share at a time, at most one a second), and
 * `'unsupported on this host'`.
 *
 * 🔴 `'unsupported on this host'` IS DECIDED HERE, BEFORE ANYTHING IS SENT, when the init
 * context carries no `search` field: that is a page host older than SHARE_LINK, or a slot
 * that is not a full page. An old host sends NO reply to a message type it does not know,
 * so sending would leave `share()` pending for the whole human bound (10 min).
 *
 * ```tsx
 * const { share, lastResult } = useShareLink();
 * <Button onClick={() => share().catch(() => {})}>Copy link</Button>
 * {lastResult && !lastResult.copied && lastResult.method === 'none' && (
 *   <input readOnly value={lastResult.url} onFocus={(e) => e.currentTarget.select()} />
 * )}
 * ```
 *
 * The request waits the human bound (10 min), because a share sheet answers only when the
 * viewer acts.
 */
export function useShareLink(): UseShareLink {
  useTransportConnection();
  const currentView = useCivitaiLocation();
  // A page host that knows SHARE_LINK always sends `search` (possibly `''`); its absence is
  // the old-host / non-page signal. See the docblock.
  const hostKnowsShareLink =
    typeof (useTransportSnapshot().context as { search?: unknown }).search === 'string';
  const [inFlight, setInFlight] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const [lastResult, setLastResult] = useState<BlockShareLinkResult | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const share = useCallback(async (target?: BlockShareLinkRequest): Promise<BlockShareLinkResult> => {
    const view = target
      ? { subPath: target.subPath ?? '', search: target.search ?? '', hash: target.hash ?? '' }
      : currentView;
    if (!hostKnowsShareLink) {
      const unsupported = new Error(SHARE_LINK_UNSUPPORTED_ERROR);
      if (mountedRef.current) setError(unsupported);
      throw unsupported;
    }
    if (mountedRef.current) {
      setInFlight((n) => n + 1);
      setError(null);
    }
    try {
      const reply = await sendTypedRequest(
        getTransport(),
        {
          type: 'SHARE_LINK',
          payload: {
            subPath: view.subPath,
            // Omitted when empty, so the wire carries only what names the view.
            ...(view.search ? { search: view.search } : {}),
            ...(view.hash ? { hash: view.hash } : {}),
          },
        },
        'SHARE_LINK_RESULT',
        { timeoutMs: HUMAN_INTERACTION_TIMEOUT_MS },
      );
      if (reply.error !== undefined || !reply.result) {
        throw new Error(reply.error || SHARE_FAILED);
      }
      const { url, copied, method } = reply.result;
      const result: BlockShareLinkResult = { url, copied, method };
      if (mountedRef.current) setLastResult(result);
      return result;
    } catch (err: unknown) {
      const wrapped = err instanceof Error ? err : new Error(String(err));
      if (mountedRef.current) setError(wrapped);
      throw wrapped;
    } finally {
      if (mountedRef.current) setInFlight((n) => n - 1);
    }
  }, [currentView, hostKnowsShareLink]);

  return { share, isPending: inFlight > 0, error, lastResult };
}
