import { useSyncExternalStore } from 'react';

import { getTransport } from '../internal/singleton.js';
import type { BlockSnapshot } from '../internal/transport.js';

/**
 * Subscribe a hook to the singleton transport. All hooks build on this —
 * `useSyncExternalStore` gives concurrent-mode safety and minimal re-renders.
 */
function useTransportSnapshot(): BlockSnapshot {
  const transport = getTransport();
  return useSyncExternalStore(
    (cb) => transport.subscribe(cb),
    () => transport.getSnapshot(),
    // Server snapshot: blocks don't SSR meaningful state. Return the
    // pre-init empty snapshot so React's hydration check doesn't warn.
    () => transport.getSnapshot(),
  );
}

/**
 * Primary hook for a block app. Returns the full per-instance context
 * delivered by the host plus a `ready` gate the UI should respect — fields
 * other than `ready` are sentinel-empty before `BLOCK_INIT` lands.
 *
 * The transport detection (iframe vs inline) happens on first call and is
 * cached process-wide; block apps don't branch on render mode.
 *
 * @returns The per-instance block context: `ready` gate plus `renderMode`,
 * `context` (narrow to `ModelSlotContext` on model-page slots), `token`,
 * `settings`, `viewer` (`null` = anonymous), `theme` (`'light' | 'dark'` —
 * set `data-theme={theme}` on your root, gotcha #60), `blockId`,
 * `blockInstanceId`, and `appId`.
 *
 * @example
 * const { ready, context, viewer, theme, settings } = useBlockContext();
 * if (!ready) return <div>Loading…</div>;
 * // Set data-theme on YOUR root — the host can't reach into the iframe (gotcha #60).
 * return <div data-theme={theme}>Hi {viewer?.username ?? 'anon'}</div>;
 */
export function useBlockContext(): Pick<
  BlockSnapshot,
  | 'ready'
  | 'renderMode'
  | 'context'
  | 'token'
  | 'settings'
  | 'viewer'
  | 'theme'
  | 'blockId'
  | 'blockInstanceId'
  | 'appId'
> {
  const snap = useTransportSnapshot();
  return {
    ready: snap.ready,
    renderMode: snap.renderMode,
    context: snap.context,
    token: snap.token,
    settings: snap.settings,
    viewer: snap.viewer,
    theme: snap.theme,
    blockId: snap.blockId,
    blockInstanceId: snap.blockInstanceId,
    appId: snap.appId,
  };
}

/** Re-exported so other hooks in this package can share the subscription. */
export { useTransportSnapshot };
