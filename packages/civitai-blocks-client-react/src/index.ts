/**
 * React bindings for `@civitai/blocks-client`.
 *
 * ONE PRIMITIVE PER CALL SHAPE, NOT A HOOK PER ENDPOINT. The old surface was 38
 * hooks, one per capability, each re-implementing request sequencing and
 * cancellation — and getting them wrong independently. The client has four call
 * shapes, so this package has four hooks:
 *
 *   snapshot store  →  useBlockSnapshot  (ready, context, viewer, theme)
 *   promise         →  useBridgeCall     (buzz.getAccounts, storage.get, …)
 *   Live<T>         →  useLive           (buzz.watchAccounts)
 *   AsyncIterable   →  useAsyncIterable  (buzz.listTransactions, orchestration.watchWorkflow)
 *
 * Everything else a block needs is a plain call on the client — `storage.set`,
 * `host.resize`, `viewer.requestSignIn` take no React help and get none.
 *
 * The win over per-endpoint hooks is not ergonomics. It is that the defect the
 * old surface kept regenerating — a superseded reply overwriting newer state —
 * is fixed ONCE here instead of once per hook (#392, seven hooks), and that
 * `useSyncExternalStore`'s tearing guarantee is applied to both store-shaped
 * reads rather than reinvented as `useState` + `useEffect` in each.
 *
 * 🔴 NO PER-ENDPOINT SHIMS, DELIBERATELY. A `useBuzzAccounts`-style
 * compatibility layer was considered and rejected on measurement: across this
 * repo, the only first-party consumer of the blocks hooks is
 * `starters/civitai-block-starter/src`, and it uses THREE of the 36
 * (`useBlockContext`, `useBlockResize`, `useViewer`). A 38-hook shim layer for
 * three call sites is dead code that rebuilds the surface this consolidation
 * exists to delete. The migration is a map, not a shim.
 */

export { useBlockSnapshot } from './useBlockSnapshot.js';
export { useBridgeCall, type BridgeCallState } from './useBridgeCall.js';
export { useLive, type LiveState } from './useLive.js';
export { useAsyncIterable, type AsyncIterableState } from './useAsyncIterable.js';
