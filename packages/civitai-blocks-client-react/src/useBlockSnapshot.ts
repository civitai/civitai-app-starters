import { useSyncExternalStore } from 'react';
import { getTransport, type BlockSnapshot, type BlockTransport } from '@civitai/blocks-client';

/**
 * The handshake snapshot — what `BLOCK_INIT` delivered, and everything the host
 * has amended since (`THEME_CHANGE`, token refresh).
 *
 * This is the FOURTH call shape, and the framing of "three primitives" would be
 * wrong without it. `BlockTransport.snapshot` is `{ get(), subscribe() }` — a
 * synchronous store, already exactly `useSyncExternalStore`'s contract, and
 * distinct from `Live<T>` which is an asynchronously loaded value with its own
 * loading and error. It is also the shape a block touches FIRST: `ready`,
 * `context`, `viewer`, `theme` all come from here.
 *
 * Identity is stable by construction: the transport holds one `#snapshot` field
 * and replaces it wholesale on change, so `get()` returns the same reference
 * until something actually moves. That is what keeps `useSyncExternalStore`
 * from re-rendering forever, and it is a property of the client — if the
 * transport ever starts building a fresh object per `get()`, this hook loops
 * and the `useLive` docblock explains the same trap in more detail.
 *
 * 🔴 `SERVER_SNAPSHOT` is a module-level constant, not a fresh object, for the
 * same identity reason. A block is rendered inside an iframe and is never
 * server-rendered, so this exists only so that importing the hook into an SSR
 * bundle does not throw. It would be better for `@civitai/blocks-client` to
 * export its own `EMPTY_SNAPSHOT` (it has one, unexported) so the two cannot
 * drift — worth asking for upstream rather than keeping this copy forever.
 */
const SERVER_SNAPSHOT: BlockSnapshot = Object.freeze({
  ready: false,
  renderMode: 'iframe',
  context: { slotId: '' },
  token: { raw: '', scopes: [], expiresAt: new Date(0) },
  settings: { publisherSettings: {}, userSettings: {} },
  viewer: null,
  theme: 'dark',
  blockInstanceId: '',
  hostOrigin: null,
}) as BlockSnapshot;

export function useBlockSnapshot(transport: BlockTransport = getTransport()): BlockSnapshot {
  return useSyncExternalStore(
    transport.snapshot.subscribe,
    transport.snapshot.get,
    () => SERVER_SNAPSHOT,
  );
}
