import { createNotifier } from '../core/messaging.js';
import type { BlockTransport } from '../core/transport.js';

import type { HostNotifications } from './protocol.js';

const notify = createNotifier<HostNotifications>();

/** At most one report per this long. */
export const VIEWER_ACTIVITY_INTERVAL_MS = 60_000;

/** Deliberate input only: the pointer merely moving over the app is not someone using it. */
const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'focusin'] as const;

/** One reporter per transport, however often `initialize()` runs against it. */
const reporting = new WeakSet<BlockTransport>();

/**
 * Tells the host, as `VIEWER_ACTIVITY`, that the viewer pressed, typed, scrolled
 * or focused something in this frame, which the host page cannot see. At most
 * once per {@link VIEWER_ACTIVITY_INTERVAL_MS}; nothing about the event is sent.
 * The host decides whether it matters (it judges the page's visibility itself).
 * Sent from every block, not only a preview: the frame cannot tell which it is
 * in, and one unanswered message a minute (hosts list it as not handled on
 * purpose; nothing waits on it) costs less than a handshake field would. A
 * no-op where there is no `document`.
 */
export function reportViewerActivity(transport: BlockTransport): void {
  const doc = (globalThis as { document?: EventTarget }).document;
  if (!doc || typeof doc.addEventListener !== 'function' || reporting.has(transport)) return;
  reporting.add(transport);
  let last: number | null = null;
  const onInput = () => {
    const now = Date.now();
    if (last !== null && now - last < VIEWER_ACTIVITY_INTERVAL_MS) return;
    last = now;
    notify('VIEWER_ACTIVITY', undefined, { transport });
  };
  const options = { capture: true, passive: true };
  for (const type of INPUT_EVENTS) doc.addEventListener(type, onInput, options);
}
