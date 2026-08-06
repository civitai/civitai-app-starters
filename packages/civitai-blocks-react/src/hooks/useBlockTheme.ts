import type { Theme } from '@civitai/app-sdk/blocks';

import { useTransportSnapshot } from './useBlockContext.js';

/**
 * The host's CURRENT site theme (`'light' | 'dark'`), kept live for the whole
 * life of the block.
 *
 * Reads the SAME singleton transport snapshot {@link useBlockContext} does, so
 * it re-renders when the value changes. Three things can set it, in increasing
 * order of authority:
 *
 *  1. the iframe URL fragment fast path (`#civitai-block=v1&theme=…`), read
 *     synchronously at construction, BEFORE any message — this is why a block
 *     can paint its first frame in the right theme;
 *  2. `BLOCK_INIT` (authoritative — replaces the whole snapshot);
 *  3. `THEME_CHANGE`, the host's push when the viewer toggles light/dark WHILE
 *     the block is mounted. Without it a mounted block kept its mount-time
 *     theme until reloaded: `BLOCK_INIT` is deduped by the transport and the
 *     URL fragment is frozen at mount, so neither can carry a later value.
 *
 * BEFORE `BLOCK_INIT` (and with no fragment) this returns the snapshot's
 * `'light'` sentinel, exactly like `useBlockContext().theme`. Gate first paint
 * on `useBlockContext().ready` if that matters to you.
 *
 * 🔴 OLD HOST: a host that never sends `THEME_CHANGE` simply never moves the
 * value — the hook degrades to today's mount-time-constant behaviour. Nothing
 * here awaits a message, so there is no hang and no timeout.
 *
 * @example
 * // The host cannot reach into your iframe's DOM — put the theme on YOUR root.
 * const theme = useBlockTheme();
 * return <div data-theme={theme}>…</div>;
 */
export function useBlockTheme(): Theme {
  return useTransportSnapshot().theme;
}
