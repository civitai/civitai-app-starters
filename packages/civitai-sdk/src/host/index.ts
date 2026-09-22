import { createCaller, createListener, createNotifier } from '../core/messaging.js';
import { tokenFromWrapped, type BlockTransport } from '../core/transport.js';
import type { GrantOptions, Scope, Session, TokenOptions } from '../session/index.js';

import type {
  DownloadRequest,
  HostNotifications,
  HostPushes,
  HostRequests,
  PickedResource,
  ResourcePickerType,
} from './protocol.js';

export type {
  ConsentRefusal,
  DownloadRequest,
  PickedResource,
  ResourcePickerType,
} from './protocol.js';

const call = createCaller<HostRequests>();
const notify = createNotifier<HostNotifications>();
const on = createListener<HostPushes>();

export interface HostCallOptions {
  signal?: AbortSignal;
}

/** Asking the host page to show its own UI. Data goes over the API, not here. */
export interface Host {
  /** Resizes the frame, clamped to the manifest's bounds. */
  resize(height: number): void;
  /** Keeps the frame as tall as `element` (the body by default). Returns a stop function. */
  autoResize(element?: Element): () => void;
  /** `fatal` swaps the block for the host's fallback, for a block that cannot continue. */
  reportError(message: string, args?: { fatal?: boolean }): void;
  /** Deep-links within this app's own sub-paths; the host refuses anything else. */
  navigate(path: string, args?: { target?: 'current' | 'new_tab' }): void;
  /** Fires `false` when the page hides and `true` when it returns. */
  onVisibilityChange(handler: (visible: boolean) => void): () => void;
  /** Starts sign-in; the block re-initialises as a signed-in viewer. */
  requestSignIn(args?: { returnUrl?: string }): void;
  /**
   * Saves to the viewer's device through the host, because a sandboxed frame
   * cannot. The host fetches only from origins it allowlists.
   */
  download(request: DownloadRequest, opts?: HostCallOptions): Promise<void>;
  /** civitai's own picker. Resolves the one resource chosen, or `null` if dismissed. */
  openResourcePicker(
    args: { resourceType: ResourcePickerType; baseModelGroup?: string },
    opts?: HostCallOptions,
  ): Promise<PickedResource | null>;
  /** `suggestedAmount` is a starting point the viewer can change. */
  openBuzzPurchase(
    args?: { suggestedAmount?: number },
    opts?: HostCallOptions,
  ): Promise<{ purchased: boolean }>;
}

export function createHost(transport: BlockTransport): Host {
  return {
    resize: (height) => notify('RESIZE_IFRAME', { height }, { transport }),
    autoResize(element) {
      const target = element ?? globalThis.document?.body;
      if (!target || typeof ResizeObserver === 'undefined') return () => {};
      let sent = -1;
      const report = () => {
        const height = Math.ceil(target.getBoundingClientRect().height);
        if (height === sent) return;
        sent = height;
        notify('RESIZE_IFRAME', { height }, { transport });
      };
      const observer = new ResizeObserver(report);
      observer.observe(target);
      report();
      return () => observer.disconnect();
    },
    reportError: (message, args = {}) =>
      notify('BLOCK_ERROR', { message, fatal: args.fatal ?? false }, { transport }),
    navigate: (path, args = {}) =>
      notify('NAVIGATE', { path, target: args.target ?? 'current' }, { transport }),
    onVisibilityChange(handler) {
      const offSuspend = on(transport, 'SUSPEND', () => handler(false));
      const offResume = on(transport, 'RESUME', () => handler(true));
      return () => {
        offSuspend();
        offResume();
      };
    },
    requestSignIn: (args = {}) => notify('REQUEST_SIGN_IN', args, { transport }),
    async download(request, opts = {}) {
      await call('SAVE_IMAGE', request, { ...opts, transport });
    },
    async openResourcePicker(args, opts = {}) {
      return (await call('OPEN_RESOURCE_PICKER', args, { ...opts, transport })).selected ?? null;
    },
    async openBuzzPurchase(args = {}, opts = {}) {
      const { purchased } = await call('OPEN_BUZZ_PURCHASE', args, { ...opts, transport });
      return { purchased };
    },
  };
}

/** The token the host minted for this block, kept current as the host rotates it. */
export function createHostSession(transport: BlockTransport): Session {
  return {
    async getToken({ fresh, signal }: TokenOptions = {}) {
      if (!fresh) return transport.snapshot.get().token.raw;
      const { blockInstanceId } = transport.snapshot.get();
      const { token } = await call('REQUEST_TOKEN', { blockInstanceId }, { transport, signal });
      return tokenFromWrapped(token).raw;
    },
    requestGrants: (scopes, opts = {}) => requestGrants(transport, scopes, opts),
  };
}

/**
 * The host re-mints the token once the viewer consents, so a grant arrives as
 * a token carrying the scopes. A viewer who closes the dialog sends nothing,
 * so pass a `signal` to bound the wait.
 */
function requestGrants(
  transport: BlockTransport,
  scopes: readonly Scope[],
  { signal }: GrantOptions,
): Promise<boolean> {
  const granted = () => {
    const held = new Set(transport.snapshot.get().token.scopes);
    return scopes.every((scope) => held.has(scope));
  };
  if (granted()) return Promise.resolve(true);
  if (signal?.aborted) return Promise.reject(signal.reason);

  return new Promise<boolean>((resolve, reject) => {
    const release: (() => void)[] = [];
    const settle = (finish: () => void) => {
      for (const off of release) off();
      finish();
    };

    release.push(transport.snapshot.subscribe(() => granted() && settle(() => resolve(true))));
    release.push(on(transport, 'CONSENT_UNAVAILABLE', () => settle(() => resolve(false))));
    if (signal) {
      const onAbort = () => settle(() => reject(signal.reason));
      signal.addEventListener('abort', onAbort, { once: true });
      release.push(() => signal.removeEventListener('abort', onAbort));
    }

    notify('REQUEST_CONSENT', { scopes: [...scopes] }, { transport });
  });
}
