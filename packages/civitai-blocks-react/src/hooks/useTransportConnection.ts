import { useEffect } from 'react';

import { getTransport } from '../transport/singleton.js';

/** One console line per page, not one per hook instance per mount. */
let reportedConnectFailure = false;

/**
 * Connects the block to its host at MOUNT. Internal — every public hook calls
 * it, and it is deliberately not exported from the package entry.
 *
 * 🔴 WHY EVERY HOOK, AND WHY AT MOUNT. The host waits 10 s for the block's
 * handshake — `BLOCK_HELLO` on transport construction, `BLOCK_READY` on the
 * first valid `BLOCK_INIT` — and then shows "This app didn't load in time",
 * retries twice and gives up (`bootSkeleton` hides the cover, not the
 * deadline). Both messages are sent by the transport, and the transport is a
 * lazy singleton: nothing goes out until something calls `getTransport()`.
 * Request-only hooks (`useBuzzWorkflow`, `useTip`, …) used to call it only
 * inside their callbacks, so an app whose only SDK use was one of them never
 * answered the host and was torn down before anyone could click. Calling this
 * from every public hook makes "uses any SDK hook" imply "is connected".
 * `test/connectsAtMount.test.tsx` pins it over the whole exported hook set.
 *
 * 🔴 WHY AN EFFECT, NOT RENDER. `useBlockContext` constructs during render, and
 * that is fine for it — but a render-time call throws during SSR (the iframe
 * transport refuses to construct without a `window`), and these hooks have
 * always been safe to render on a server. An effect never runs there, and on
 * the client it runs at mount, long before the host's deadline.
 *
 * 🔴 WHY NOT AT MODULE LOAD. `getTransport(opts)` honours only its FIRST call;
 * dev harnesses and tests inject their allowlist (`installDevTransport()`,
 * `getTransport({ allowedParentOrigins })`) after importing this package and
 * before the first hook runs. Constructing on import would win that race and
 * silently discard their options.
 *
 * 🔴 WHY A FAILURE IS LOGGED, NOT THROWN. Construction throws when no parent
 * allowlist is configured. Before this hook existed, such an app still rendered
 * and only failed on its first bridge call — and it still does: `getTransport()`
 * caches nothing on a throw, so that call throws the same error as before. This
 * hook only ADDS the connection; it must not turn a misconfigured block that
 * renders into one that crashes on mount.
 */
export function useTransportConnection(): void {
  useEffect(() => {
    try {
      getTransport();
    } catch (err) {
      if (!reportedConnectFailure) {
        reportedConnectFailure = true;
        // eslint-disable-next-line no-console -- developer-facing diagnostic; the host will time this block out
        console.error('@civitai/blocks-react: could not connect to the host at mount.', err);
      }
    }
  }, []);
}
