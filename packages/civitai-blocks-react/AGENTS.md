# Agent Guide — `@civitai/blocks-react`

> **If you only read one thing:** this package is the React-runtime side of
> Civitai Apps. The framework-agnostic contract — manifest types,
> `defineBlock`, `BLOCK_SCOPES`, the `postMessage` protocol — lives in
> [`@civitai/app-sdk/blocks`](../civitai-app-sdk/). This package adds the
> `IframeTransport`, the singleton that detects + caches it, and the eight
> React hooks block apps actually call.

## Stack

TypeScript strict, ESM-only. Two runtime peers (`react`, `@civitai/app-sdk`)
declared in `peerDependencies`. Built with `tsc` to `dist/`. Tested with
`vitest` + `@testing-library/react` against `happy-dom`. Published to npm
under the same release pipeline as `@civitai/app-sdk` (changesets + OIDC).

## Where things live

| Path | Purpose |
|---|---|
| `src/internal/transport.ts` | `BlockTransport` interface — what every transport implements (`getSnapshot`, `subscribe`, `sendMessage`, `sendRequest`). Plus `sendTypedRequest` (the typed wrapper hooks call), `BlockSnapshot`, `EMPTY_SNAPSHOT`, `snapshotFromInit`, and `nextRequestId`. `waitForInit` is iframe-specific and lives on the class, not the interface. |
| `src/internal/iframeTransport.ts` | `IframeTransport` — the v1 path. Validates `event.origin` against an allowlist, awaits `BLOCK_INIT` with a 10s timeout, queues outbound messages until init, correlates request/response by `requestId`. Throws in its constructor if no `window` is available — never `new` it during SSR; in Next.js, wrap the consuming tree in `'use client'`. |
| `src/internal/inlineTransport.ts` | `InlineTransport` — v2 stub. Reads bootstrap from `window.__CIVITAI_BLOCK_CONTEXT__`. Not wired to anything in v1; ships so the detector can branch. |
| `src/internal/detector.ts` | `BlockTransportDetector.detect()` — picks inline vs iframe based on bootstrap presence. |
| `src/internal/requestTimeouts.ts` | `DEFAULT_REQUEST_TIMEOUT_MS` (30s, protocol round-trips), `HUMAN_INTERACTION_TIMEOUT_MS` (10 min, anything gated on a person), and `HUMAN_GATED_REQUEST_TYPES` — the ledger the class guard in `test/humanGatedRequestTimeouts.test.tsx` pins. |
| `src/internal/singleton.ts` | `getTransport()` lazy-init + cache. Hooks share one instance. `__resetTransport()` for tests only. |
| `src/hooks/` | The eight public hooks. Each is a thin wrapper around the singleton transport. |
| `src/testing.ts` | Test-only helpers (`resetTransport`, `mockParentMessage`). Subpath-exported (`@civitai/blocks-react/testing`) so production code doesn't accidentally depend on it. |

## Patterns to keep

- **Module-level singleton, no Provider.** The hooks API surface deliberately omits a `<BlockProvider>` — `useBlockContext()` works at the root of any tree. Internally the transport is detected once and cached; tests use `__resetTransport()` to start clean.
- **Same hook surface for both transports.** Block apps should never branch on `renderMode`. If you find yourself writing `if (renderMode === 'iframe')` in a hook, push the difference behind the `BlockTransport` interface instead.
- **`postMessage` origin is non-negotiable.** Every inbound message in `IframeTransport.handleMessage` drops if `event.origin` is not in `allowedParentOrigins`. The allowlist must come from a build-time env var; never accept `*` and never derive it from the message itself.
- **Request/response correlation by `requestId`.** Workflow estimates, token refreshes, buzz purchases — all use a UUID `requestId` that the transport tracks in a `Map<requestId, { resolve, reject }>`. Reply messages without a matching `requestId` are dropped.
- **Hooks subscribe via `useSyncExternalStore`.** That's React's built-in API for external stores; it gets concurrent-mode safety for free and avoids the `useState` + manual `useEffect` re-render dance.
- **Hooks that send requests do not gate on `ready`.** Only `useBlockContext` exposes `ready` to consumers. Every other hook relies on `IframeTransport`'s outbound queue: messages dispatched before `BLOCK_INIT` arrives are buffered and flushed when init resolves. If init times out (10s reject), already-queued requests still wait for their own per-request timeout (the 30s default, or the hook's override — see the next bullet) before failing — acceptable for the v1 path but worth knowing when debugging "request never returned."

- 🔴 **A request whose reply waits on a HUMAN must pass `HUMAN_INTERACTION_TIMEOUT_MS`.** The default 30s is sized for a protocol round-trip; a picker, an upload, a purchase modal or a consent confirm is sized by how long a person takes to notice a dialog and click. `usePublishGenerationOutputs` shipped without the opt-out and rejected mid-confirm on an ALREADY-BILLED generation with no refund path (civitai/civitai#4158). When you add such a hook, add its request type to `HUMAN_GATED_REQUEST_TYPES` in `src/internal/requestTimeouts.ts` — `test/humanGatedRequestTimeouts.test.tsx` pins that ledger exactly and behaviourally drives every member past the default window, so a missing entry and a missing `timeoutMs` each fail the suite.

## Patterns to avoid

- ❌ Adding a runtime `react` dep instead of `peerDependencies`. Two copies of React in one tree break Hooks.
- ❌ Mocking `window.parent.postMessage` inline in tests; use the `mockParentMessage()` helper in `src/testing.ts` so origin-validation paths get exercised.
- ❌ Awaiting init inside individual hooks. `getTransport().getSnapshot()` returns a synchronous view; the gate is `snapshot.ready`. Only `useBlockContext` exposes `ready` to consumers.
- ❌ Caching the token across `useBlockToken()` calls inside React. The transport already caches; pulling from `useSyncExternalStore` ensures hooks re-render when refresh succeeds.

## Verifying changes

| You touched | Run |
|---|---|
| `src/internal/` | `pnpm --filter @civitai/blocks-react typecheck && pnpm --filter @civitai/blocks-react test` |
| Any hook | Same — hook tests live in `test/`. |
| Public exports | `pnpm --filter @civitai/blocks-react build` — verify the `.d.ts` reflects the new export. |
| Anything consumed by the (forthcoming) block starter | `pnpm -r --filter "./starters/*" typecheck` from repo root once the starter lands. |

After any meaningful change: `pnpm changeset` in the repo root.

## See also

- [`../civitai-app-sdk/AGENTS.md`](../civitai-app-sdk/AGENTS.md) — the contract this package consumes.
- [`../civitai-app-sdk/src/blocks/messages.ts`](../civitai-app-sdk/src/blocks/messages.ts) — the `postMessage` protocol both sides share.
