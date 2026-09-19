import { createListener, createNotifier, type NotifyOptions } from '../core/messaging.js';
import { getTransport } from '../core/get-transport.js';
import type { BlockTransport } from '../core/transport.js';

import type { HostNotifications, HostPushes } from './protocol.js';

const notify = createNotifier<HostNotifications>();
const on = createListener<HostPushes>();

/** Asks the host to resize the frame. Clamped to the manifest's bounds. */
export function resize(height: number, opts: NotifyOptions = {}): void {
  notify('RESIZE_IFRAME', { height }, opts);
}

/**
 * Tells the host the block has failed. `fatal` replaces the block with the
 * host's own fallback, so it is for a block that cannot continue, not for a
 * failed request.
 */
export function reportError(
  message: string,
  args: { fatal?: boolean } = {},
  opts: NotifyOptions = {},
): void {
  notify('BLOCK_ERROR', { message, fatal: args.fatal ?? false }, opts);
}

/**
 * Deep-links within this app's own sub-path space; the host refuses anything
 * outside it. `new_tab` opens a window instead of routing in place.
 */
export function navigate(
  path: string,
  args: { target?: 'current' | 'new_tab' } = {},
  opts: NotifyOptions = {},
): void {
  notify('NAVIGATE', { path, target: args.target ?? 'current' }, opts);
}

/**
 * Fires when the page hides and again when it returns. A block that polls or
 * animates should stand down in between; the host sends both unprompted.
 */
export function onVisibilityChange(
  handler: (visible: boolean) => void,
  opts: NotifyOptions = {},
): () => void {
  const transport: BlockTransport = opts.transport ?? getTransport();
  const offSuspend = on(transport, 'SUSPEND', () => handler(false));
  const offResume = on(transport, 'RESUME', () => handler(true));
  return () => {
    offSuspend();
    offResume();
  };
}
