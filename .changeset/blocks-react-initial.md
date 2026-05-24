---
'@civitai/blocks-react': major
---

Initial release of `@civitai/blocks-react` (1.0.0): React hooks and iframe transport for Civitai App Blocks. Pairs with `@civitai/app-sdk/blocks` (the framework-agnostic contract) so block apps don't need to wire `postMessage` themselves.

**Transport**
- `IframeTransport` — origin-validated `postMessage` transport. Awaits `BLOCK_INIT` with a 10s timeout, queues outbound messages until init lands, correlates request/response by `requestId`, and auto-sends `BLOCK_READY` after applying init so the platform's 10s ready timeout doesn't fire on blocks that never explicitly send one (`useBlockResize` follows with real height measurements). Refuses to mount without at least one allowed parent origin. Every inbound payload passes a shape-validation gate (`payloadValidatorFor`) before reaching state-mutating code: malformed messages drop with `console.warn` instead of clobbering the token snapshot or producing `Invalid Date`. Handles both host-pushed `TOKEN_REFRESH` (no `requestId`) and `TOKEN_REFRESH_RESPONSE` (optional `requestId`); both replace the full wrapped token — scopes and `buzzBudget` included — not just `raw`/`expiresAt`.
- `InlineTransport` — v2 stub. Reads `window.__CIVITAI_BLOCK_CONTEXT__`; not wired in v1.
- `BlockTransportDetector.detect()` — picks iframe vs inline based on bootstrap presence; reads the allowlist from `VITE_` / `NEXT_PUBLIC_` / `PUBLIC_` env vars.
- `getTransport()` — process-wide singleton so hooks share one instance.

**Hooks**
- `useBlockContext` — primary; returns the host-provided context, viewer (`ViewerInfo | null` — `null` for anonymous), theme (`'light' | 'dark'`), `appId`, `blockId`, `blockInstanceId`, and a `ready` gate.
- `useBlockSettings`, `useBlockToken` (with `refresh()` for 401 retries and in-flight dedup so the scheduled and synchronous refresh paths never fan out duplicate `REQUEST_TOKEN` messages), `useBuzzWorkflow` (estimate/submit/poll with a shared terminal-status set so a host-returned `canceled` / `expired` snapshot exits `polling` correctly), `useBlockResize` (ResizeObserver → `RESIZE_IFRAME`), `useBuzzPurchase`, `useCivitaiNavigate`, `useBlockAnalytics`. The last three depend on host-side handlers that ship in Phase 2 of civitai/civitai's App Blocks substrate — calls will reject on the per-request timeout until the platform implements them.

Tracks `BlockInitPayload` and the postMessage protocol from civitai/civitai's `src/components/AppBlocks/types.ts` / `IframeHost.tsx` — viewer/theme/`appId` field layout and the wrapped-token shape match the platform contract.

Peer-depends on `react ^18 || ^19` and `@civitai/app-sdk ^0.3`. Test surface covers origin validation, the 10s init timeout, requestId correlation, payload shape validation at the trust boundary (rejecting malformed `BLOCK_INIT` / `TOKEN_REFRESH` / `TOKEN_REFRESH_RESPONSE` / workflow replies), host-pushed token refresh, auto-`BLOCK_READY`, token-refresh scheduling + snapshot updates, and the workflow state machine.
