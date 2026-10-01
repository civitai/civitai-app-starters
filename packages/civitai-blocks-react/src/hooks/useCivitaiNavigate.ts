import { useCallback } from 'react';

import type { BlockNavigateScope } from '@civitai/app-sdk/blocks';

import { getTransport } from '../transport/singleton.js';

/**
 * Options for {@link UseCivitaiNavigate.navigate}.
 *
 * Passed as the SECOND argument, where a bare `'current' | 'new_tab'` string is
 * also still accepted — see {@link UseCivitaiNavigate.navigate}.
 */
export interface UseCivitaiNavigateOptions {
  /**
   * Which SPACE `path` is resolved in. DEFAULTS to `'app'` — this app's own
   * sub-paths, which is all `navigate` could reach before this field existed.
   *
   * 🔴 `'/models/12345'` WITHOUT a scope does NOT reach civitai's model page. A
   * leading slash carries no meaning: the host normalises it away in both
   * scopes, so that call is a request for `<this app>/models/12345`. To reach
   * the civitai.com page, say `{ scope: 'site' }`.
   */
  scope?: BlockNavigateScope;
  /** Where the host should open it. Defaults to `'current'`. */
  target?: 'current' | 'new_tab';
}

/** What {@link useCivitaiNavigate} returns. */
export interface UseCivitaiNavigate {
  /**
   * Requests a navigation. The second argument is either an options object or —
   * for the call shape that predates `scope` — a bare target string.
   */
  navigate: (path: string, options?: 'current' | 'new_tab' | UseCivitaiNavigateOptions) => void;
}

/**
 * Requests a navigation from the host: the hook sends a `NAVIGATE` message and
 * returns. Fire-and-forget — the host doesn't reply, so the block never learns
 * what the host did, including when the host REFUSES the request.
 *
 * 🔴 `scope` SELECTS THE SPACE, AND IT DEFAULTS TO `'app'`.
 *
 *  - `'app'` (default) — `path` is resolved under this app's OWN route, as a
 *    sub-path of it, and pushed shallowly so the page stays mounted.
 *  - `'site'` — `path` is resolved at the civitai.com root and the viewer leaves
 *    the app. The host grants this per-surface and refuses it elsewhere.
 *
 * 🔴 A LEADING SLASH CARRIES NO MEANING — the host normalises it away in BOTH
 * scopes, so `'/settings'` and `'settings'` are one request within whichever
 * scope you chose. `navigate('/models/12345')` is therefore a request for THIS
 * APP's `/models/12345`, not civitai's model page; that needs
 * `{ scope: 'site' }`. (Both spellings were app-scoped before `scope` existed
 * too, so no existing call changed meaning — which is the point of the default.)
 *
 * `target` is a REQUEST, not a guarantee. How the host acts on `'current'` vs
 * `'new_tab'` is host-side behaviour, and the host is the authority on it; this
 * package sends the message and makes no promise about the outcome.
 *
 * 🔴 Nothing in your manifest enables `'new_tab'`. In particular, do NOT declare
 * `allow-popups-to-escape-sandbox`: the host intersects a manifest's
 * `iframe.sandbox` with a fixed allowlist that does not contain that token, so it
 * is dropped for every block at every trust tier and declaring it has no effect.
 * (Earlier versions of this doc said `"new_tab"` required it — that was wrong.)
 *
 * @example
 * const { navigate } = useCivitaiNavigate();
 * navigate('settings');                                  // this app's own /settings
 * navigate('/settings');                                 // identical — the slash means nothing
 * navigate('models/12345', { scope: 'site' });           // civitai.com/models/12345
 * navigate('models/12345', { scope: 'site', target: 'new_tab' });
 * navigate('detail/7', 'new_tab');                       // the pre-`scope` shape, still app-scoped
 */
export function useCivitaiNavigate(): UseCivitaiNavigate {
  const navigate = useCallback(
    (path: string, options: 'current' | 'new_tab' | UseCivitaiNavigateOptions = {}) => {
      // A bare string is the pre-`scope` call shape (`navigate(path, 'new_tab')`)
      // and stays supported: there are live callers, and the whole point of the
      // `'app'` default is that none of them changes meaning. Widening the
      // parameter rather than adding an overload keeps ONE published signature,
      // so `UseCivitaiNavigate` still describes the hook exactly.
      const opts: UseCivitaiNavigateOptions = typeof options === 'string' ? { target: options } : options;
      // `scope` is OMITTED, not sent as `undefined`, when the caller did not
      // choose one — absent and `'app'` mean the same thing to the host, so the
      // payload an unscoped call puts on the wire stays byte-identical to what
      // every pre-`scope` build sent.
      getTransport().sendMessage({
        type: 'NAVIGATE',
        payload: {
          path,
          ...(opts.scope ? { scope: opts.scope } : {}),
          target: opts.target ?? 'current',
        },
      });
    },
    [],
  );
  return { navigate };
}
