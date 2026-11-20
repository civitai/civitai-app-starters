/**
 * App Blocks INIT FRAGMENT — the URL-fragment fast path for the three
 * non-secret init fields.
 *
 * WHY THIS EXISTS
 * ---------------
 * `theme`, `renderMode` and `blockInstanceId` are delivered in the `BLOCK_INIT`
 * postMessage payload. That payload cannot arrive until the host has minted a
 * token and resolved its queries, so a block cannot paint its own loading state
 * in the right theme, and cannot key any per-instance bootstrap, until the
 * handshake completes. Putting the same three values in the iframe URL's
 * FRAGMENT makes them readable synchronously at document parse time — before a
 * single postMessage has been exchanged.
 *
 * 🔴 THE PAYLOAD REMAINS AUTHORITATIVE. This is an additive FAST PATH, never a
 * replacement:
 *   - `BLOCK_INIT` still carries all three fields and still overwrites whatever
 *     the fragment said (`snapshotFromInit` runs after this seed).
 *   - A block is only `ready` after `BLOCK_INIT`. The fragment never sets
 *     `ready`, never sets `viewer`, and never sets a token.
 *   - When the fragment is absent (an OLD host, or a host that declined to
 *     append one), every consumer falls back to waiting for the payload, which
 *     is exactly today's behaviour.
 *
 * 🔴 THE TOKEN IS NEVER IN THE URL. Only these three non-secret fields are.
 * URLs leak — into `document.referrer`, into browser history, into logs, into
 * screenshots. `token`, `viewer`, `settings` and `context` stay in the payload.
 *
 * WIRE FORMAT (v1)
 * ----------------
 *   #civitai-block=v1&theme=dark&renderMode=iframe&blockInstanceId=bi_abc
 *
 * The fragment body is a standard `application/x-www-form-urlencoded` string
 * (i.e. `URLSearchParams`), and `civitai-block=v1` is BOTH the namespace marker
 * and the format version. The marker lets a reader tell "this fragment is the
 * host's" from "this fragment is the block app's own routing state" without
 * guessing, and lets a future v2 change the field set without ambiguity.
 *
 * FORWARD/BACKWARD COMPATIBILITY RULES for anyone editing this file:
 *   - Decoding NEVER throws and NEVER returns a partially-trusted value. Each
 *     field is validated independently; an invalid one is simply absent.
 *   - An UNKNOWN version marker decodes to `{}` — a v2 host talking to a v1
 *     block degrades to "no fast path", not to garbage.
 *   - Extra unknown keys are ignored, so a later host may add fields without
 *     breaking an older block.
 */

/** Fragment key that both namespaces and versions the payload. */
export const BLOCK_INIT_FRAGMENT_MARKER_KEY = 'civitai-block';

/** Current fragment format version. */
export const BLOCK_INIT_FRAGMENT_VERSION = 'v1';

/** Every key this version of the format owns. Used by the stripper. */
export const BLOCK_INIT_FRAGMENT_KEYS = [
  BLOCK_INIT_FRAGMENT_MARKER_KEY,
  'theme',
  'renderMode',
  'blockInstanceId',
] as const;

/**
 * The three fields carried by the fragment. Every field is OPTIONAL on decode —
 * a caller must treat an absent field as "not known yet, wait for BLOCK_INIT".
 */
export interface BlockInitFragment {
  theme?: 'light' | 'dark';
  renderMode?: 'iframe' | 'inline';
  blockInstanceId?: string;
}

/**
 * Encode the fast-path fields into a fragment BODY (no leading `#`).
 *
 * Key order is fixed (marker first) so the output is deterministic and can be
 * pinned by a literal-valued contract test on both sides of the wire.
 */
export function encodeBlockInitFragment(fields: {
  theme: 'light' | 'dark';
  renderMode: 'iframe' | 'inline';
  blockInstanceId: string;
}): string {
  const params = new URLSearchParams();
  params.set(BLOCK_INIT_FRAGMENT_MARKER_KEY, BLOCK_INIT_FRAGMENT_VERSION);
  params.set('theme', fields.theme);
  params.set('renderMode', fields.renderMode);
  params.set('blockInstanceId', fields.blockInstanceId);
  return params.toString();
}

/**
 * Decode a fragment (with or without the leading `#`) into the fast-path
 * fields. Total: any input — empty, a block's own hash route, a truncated
 * string, a future version — yields `{}` rather than throwing.
 */
export function parseBlockInitFragment(hash: string | null | undefined): BlockInitFragment {
  if (typeof hash !== 'string' || hash.length === 0) return {};
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  if (body.length === 0) return {};

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(body);
  } catch {
    return {};
  }

  // Version gate. A missing or unrecognised marker means the fragment is NOT
  // ours (a hash-routed block app's own state, say) — decode nothing. This is
  // what makes the format safe to co-exist with a fragment we did not write.
  if (params.get(BLOCK_INIT_FRAGMENT_MARKER_KEY) !== BLOCK_INIT_FRAGMENT_VERSION) return {};

  const out: BlockInitFragment = {};

  const theme = params.get('theme');
  if (theme === 'light' || theme === 'dark') out.theme = theme;

  const renderMode = params.get('renderMode');
  if (renderMode === 'iframe' || renderMode === 'inline') out.renderMode = renderMode;

  const blockInstanceId = params.get('blockInstanceId');
  if (typeof blockInstanceId === 'string' && blockInstanceId.length > 0) {
    out.blockInstanceId = blockInstanceId;
  }

  return out;
}

/**
 * Remove ONLY this format's keys from a fragment, preserving anything else the
 * block app put there.
 *
 * Returns the new fragment BODY (no leading `#`), or `null` when the input
 * carried none of our keys (i.e. nothing to do — callers should then skip the
 * `history.replaceState` entirely rather than rewrite the URL to an identical
 * value).
 */
export function stripBlockInitFragment(hash: string | null | undefined): string | null {
  if (typeof hash !== 'string' || hash.length === 0) return null;
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  if (body.length === 0) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(body);
  } catch {
    return null;
  }
  if (params.get(BLOCK_INIT_FRAGMENT_MARKER_KEY) !== BLOCK_INIT_FRAGMENT_VERSION) return null;

  for (const key of BLOCK_INIT_FRAGMENT_KEYS) params.delete(key);
  return params.toString();
}
