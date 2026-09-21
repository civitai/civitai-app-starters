/**
 * React bindings for `@civitai/blocks-client`.
 *
 * THREE PRIMITIVES, NOT A HOOK PER ENDPOINT. The old surface was 38 hooks, one
 * per capability, each re-implementing request sequencing and unmount safety —
 * and getting them wrong independently. The client has exactly three call
 * shapes, so this package has exactly three hooks:
 *
 *   promise         →  useBridgeCall     (buzz.getAccounts, storage.get, …)
 *   Live<T>         →  useLive           (buzz.watchAccounts)
 *   AsyncIterable   →  useAsyncIterable  (buzz.listTransactions, orchestration.watchWorkflow)
 *
 * Everything else a block needs is a plain call on the client — `storage.set`,
 * `host.resize`, `viewer.requestSignIn` take no React help and get none.
 *
 * The win over per-endpoint hooks is not ergonomics, it is that the two defects
 * the old surface kept regenerating — a superseded reply overwriting newer
 * state, and a write after unmount — are fixed ONCE here instead of once per
 * hook. See civitai/civitai-app-starters#392 and #393.
 */

export { useBridgeCall, type BridgeCallState } from './useBridgeCall.js';
export { useLive, type LiveState } from './useLive.js';
export { useAsyncIterable, type AsyncIterableState } from './useAsyncIterable.js';
