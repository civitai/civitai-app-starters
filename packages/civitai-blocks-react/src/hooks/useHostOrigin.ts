import { useSyncExternalStore } from 'react';

import { getTransport } from '../internal/singleton.js';

/**
 * Returns the validated host (parent) origin the block may safely direct-fetch
 * the civitai App Blocks HTTP API against — `undefined` until the transport
 * has established it (iframe: the first allowlist-passing `BLOCK_INIT`;
 * inline: bootstrap present).
 *
 * Use this as the base URL for a direct `fetch` to the App Blocks API when you
 * need to bypass the host bridge — always paired with the bearer token from
 * `useBlockToken()`:
 *
 * @example
 * const host = useHostOrigin();
 * const { raw } = useBlockToken();
 * if (!host) return null; // not initialized yet
 * const res = await fetch(`${host}/api/v1/blocks/me`, {
 *   headers: { authorization: `Bearer ${raw}` },
 * });
 *
 * SECURITY INVARIANT — the whole reason this hook exists: the value it returns
 * is ONLY ever an origin that passed the transport's trust gate (the iframe
 * `OriginMatcher` allowlist, or the inline same-origin host). It is NEVER
 * derived from `document.referrer`, `window.location` of a cross-origin
 * parent, or any unvalidated `event.origin`. `useBlockToken().raw` is a
 * money-scoped bearer credential, so sending it to an unvalidated origin would
 * be a token-exfiltration vector — always send the token to THIS origin, never
 * to a host you read off a spoofable browser signal.
 *
 * Built on the same `useSyncExternalStore` subscription as `useBlockToken` /
 * `useBlockContext`: the iframe transport captures the origin and emits in the
 * same tick it applies `BLOCK_INIT`, so the hook re-renders with the origin the
 * moment init lands.
 */
export function useHostOrigin(): string | undefined {
  const transport = getTransport();
  const origin = useSyncExternalStore(
    (cb) => transport.subscribe(cb),
    () => transport.getHostOrigin(),
    // Server snapshot: no host origin is known before hydration.
    () => transport.getHostOrigin(),
  );
  // Normalize the transport's `null` sentinel to `undefined` for the hook's
  // "not yet available" contract (mirrors the optional-field hook convention).
  return origin ?? undefined;
}
