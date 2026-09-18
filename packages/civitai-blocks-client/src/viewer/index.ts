import { BridgeError } from '../core/errors.js';
import { getTransport } from '../core/get-transport.js';
import {
  createCaller,
  createListener,
  createNotifier,
  type CallOptions,
  type NotifyOptions,
} from '../core/messaging.js';

import type { Viewer, ViewerNotifications, ViewerPushes, ViewerRequests } from './protocol.js';

const call = createCaller<ViewerRequests>();
const notify = createNotifier<ViewerNotifications>();
const on = createListener<ViewerPushes>();

export type { ConsentRefusal, Viewer } from './protocol.js';

/**
 * Who the viewer is, read fresh and audited per call. Needs `user:read:self`;
 * an anonymous or banned viewer is a failure, not an empty result, so the
 * caller reaches for `requestSignIn` rather than rendering nobody.
 */
export async function getViewer(opts: CallOptions = {}): Promise<Viewer> {
  return (await call('GET_VIEWER', {}, opts)).viewer;
}

/**
 * Starts the host's sign-in flow. Nothing is awaited: the block re-initialises
 * as an authenticated viewer once login completes. `returnUrl` is a path within
 * this app, which the host sanitises.
 */
export function requestSignIn(
  args: { returnUrl?: string } = {},
  opts: NotifyOptions = {},
): void {
  notify('REQUEST_SIGN_IN', args, opts);
}

/**
 * Asks the viewer to grant `scopes`, resolving once the token carries them and
 * rejecting `forbidden` when the host says they never can be. Scopes already
 * held resolve without asking; a viewer who neither confirms nor dismisses
 * settles nothing, so pass a `signal` to bound the wait.
 */
export function requestConsent(scopes: string[], opts: CallOptions = {}): Promise<void> {
  const transport = opts.transport ?? getTransport();
  const granted = () => {
    const held = new Set(transport.snapshot.get().token.scopes);
    return scopes.every((scope) => held.has(scope));
  };
  if (granted()) return Promise.resolve();

  const { signal } = opts;
  if (signal?.aborted) return Promise.reject(signal.reason);

  return new Promise<void>((resolve, reject) => {
    const release: (() => void)[] = [];
    const settle = (finish: () => void) => {
      for (const off of release) off();
      finish();
    };

    release.push(transport.snapshot.subscribe(() => granted() && settle(resolve)));
    // Any refusal ends the wait: the host filters the names it will repeat, so
    // an empty `scopes` still means this can never be granted.
    release.push(
      on(transport, 'CONSENT_UNAVAILABLE', () =>
        settle(() =>
          reject(
            new BridgeError(
              'forbidden',
              'REQUEST_CONSENT',
              `consent for ${scopes.join(', ')} cannot be granted here`,
            ),
          ),
        ),
      ),
    );
    if (signal) {
      const onAbort = () => settle(() => reject(signal.reason));
      signal.addEventListener('abort', onAbort, { once: true });
      release.push(() => signal.removeEventListener('abort', onAbort));
    }

    notify('REQUEST_CONSENT', { scopes }, { transport });
  });
}
