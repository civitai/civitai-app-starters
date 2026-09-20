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
| `src/internal/requestTimeouts.ts` | `DEFAULT_REQUEST_TIMEOUT_MS` (30s, protocol round-trips), `HUMAN_INTERACTION_TIMEOUT_MS` (10 min, anything gated on a person), and `REQUEST_TIMEOUT_CLASS` — a TOTAL `human`/`protocol`/`no-reply` bucketing of every block→parent message type, from which `HUMAN_GATED_REQUEST_TYPES` is derived. |
| `src/internal/singleton.ts` | `getTransport()` lazy-init + cache. Hooks share one instance. `__resetTransport()` for tests only. |
| `src/hooks/` | The eight public hooks. Each is a thin wrapper around the singleton transport. |
| `src/testing.tsx` | The **host-simulation subpath**, `@civitai/blocks-react/testing` — a documented, published entry point, not an internal escape hatch. 🔴 **`createLiveHost` is NOT a mock — it forwards the postMessage protocol to the REAL Civitai backend over a pasted dev block token, `blocks.submitWorkflow` included, and a successful generation SPENDS THE TOKEN HOLDER'S REAL BUZZ.** It sits one autocomplete entry away from `createMockHost`; only `createMockHost` is free. `dev:live` is the only thing that should reach for it. **The exported surface is enumerated in exactly one place — README § "The `/testing` subexport"** — and `test/testingSurface.test.ts` holds a ledger that it pins to the module (two tests) *and* to that README section (a third). No edit to the module, the ledger or the README leaves all three green. Do not restate the list here; a second copy goes stale, which is the whole of #334. |
| `src/internal/mockHost.ts` | The mock host itself (~3.1k lines) — every `*_RESULT` reply, the scenario knobs, the in-memory app/shared storage. Reached only from `src/testing.tsx`; nothing in `src/index.ts` or `src/ui/` imports it. |
| `src/internal/liveHost.ts` | The LIVE host (~1.9k lines of real tRPC calls against civitai.com). Backs `createLiveHost`. Reached only from `src/testing.tsx`. |
| `src/internal/catalog.ts`, `src/internal/pickerOverlay.ts` | The catalog client + the in-harness picker overlay the live host opens for `OPEN_RESOURCE_PICKER`. **Internal wiring, deliberately NOT on the `./testing` surface** (they were until #334, under names like `fetchCatalog` and `DEFAULT_LIMIT`). `liveHost.ts` is their only consumer in `src/`; import them by relative path from `test/`. |

## Patterns to keep

- **Module-level singleton, no Provider.** The hooks API surface deliberately omits a `<BlockProvider>` — `useBlockContext()` works at the root of any tree. Internally the transport is detected once and cached; tests use `__resetTransport()` to start clean.
- **Same hook surface for both transports.** Block apps should never branch on `renderMode`. If you find yourself writing `if (renderMode === 'iframe')` in a hook, push the difference behind the `BlockTransport` interface instead.
- **`postMessage` origin is non-negotiable.** Every inbound message in `IframeTransport.handleMessage` drops if `event.origin` is not in `allowedParentOrigins`. The allowlist must come from a build-time env var; never accept `*` and never derive it from the message itself.
- **Request/response correlation by `requestId`.** Workflow estimates, token refreshes, buzz purchases — all use a UUID `requestId` that the transport tracks in a `Map<requestId, { resolve, reject }>`. Reply messages without a matching `requestId` are dropped.
- **Hooks subscribe via `useSyncExternalStore`.** That's React's built-in API for external stores; it gets concurrent-mode safety for free and avoids the `useState` + manual `useEffect` re-render dance.
- **Hooks that send requests do not gate on `ready`.** Only `useBlockContext` exposes `ready` to consumers. Every other hook relies on `IframeTransport`'s outbound queue: messages dispatched before `BLOCK_INIT` arrives are buffered and flushed when init resolves. If init times out (10s reject), already-queued requests still wait for their own per-request timeout (the 30s default, or the hook's override — see the next bullet) before failing — acceptable for the v1 path but worth knowing when debugging "request never returned."

- 🔴 **A request whose reply waits on a HUMAN must pass `HUMAN_INTERACTION_TIMEOUT_MS`.** The default 30s is sized for a protocol round-trip; a picker, an upload, a purchase modal or a consent confirm is sized by how long a person takes to notice a dialog and click. `usePublishGenerationOutputs` shipped without the opt-out and rejected mid-confirm on an ALREADY-BILLED generation with no refund path (civitai/civitai#4158). Bucket every message type in `REQUEST_TIMEOUT_CLASS` (`src/internal/requestTimeouts.ts`); the ledger the tests read is derived from it. **Two halves, and they catch different things — don't read either as covering the other:** the `satisfies Record<BlockToParentMessageType, …>` totality gate fails **`typecheck`** when a NEW message type is added and left unbucketed (the unlisted-hook shape, i.e. #4158 itself), while `test/humanGatedRequestTimeouts.test.tsx` catches a REGRESSION on an already-bucketed type — a dropped `timeoutMs` or a deleted ledger entry. A test that enumerates the ledger is green when the ledger is wrong by omission, so the type gate is the half doing that work.

## Patterns to avoid

- ❌ Adding a runtime `react` dep instead of `peerDependencies`. Two copies of React in one tree break Hooks.
- ❌ Mocking `window.parent.postMessage` inline in tests; use the `mockParentMessage()` helper in `test/helpers/mockParentMessage.ts` so origin-validation paths get exercised. (It lives under `test/`, not `src/`, since #334 — `test/` is excluded from the build, so it no longer ships. It is a two-line `MessageEvent` constructor, so the one fleet consumer that imported it from the subpath — `dogfood-app/dogfood-2/src/mock-buzz.ts` — inlines it instead; the changeset shows the replacement.)
- ❌ **Adding an export to `src/testing.tsx` because it is convenient to reach from a test.** That subpath is published; a relative import from `test/` (`../src/internal/<module>.js`) reaches the same symbol with no public-API cost. `test/testingSurface.test.ts` fails when the surface grows OR shrinks — updating its ledger *and* the README section it parses is the deliberate act that makes an addition public.
- ❌ **Reaching for `createLiveHost` in a test.** It spends real Buzz. `createMockHost` is the free one.
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
