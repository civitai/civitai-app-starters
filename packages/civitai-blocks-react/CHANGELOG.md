# @civitai/blocks-react

## 0.7.0

### Minor Changes

- 6ba78fa: Add the PAGE resource picker (Design 1 — host-chrome): `useResourcePicker()` +
  the `OPEN_RESOURCE_PICKER` / `RESOURCE_PICKER_RESULT` message pair.

  This generalizes the existing model-slot `OPEN_CHECKPOINT_PICKER` /
  `useCheckpointPicker` flow to App Block PAGES, and widens it from Checkpoint-only
  to a typed allowlist — v1 accepts `'Checkpoint' | 'LORA'` only
  (`BlockResourcePickerType`). The block asks the host to open its OWN native
  resource modal as host chrome; the user searches in host chrome (NOT the iframe);
  the host returns ONLY the single chosen resource as the narrow `BlockResourceInfo`
  (`{ versionId, modelId, baseModel, modelType }`). The iframe never receives the
  catalog, a list, or any resource it didn't pick.

  `@civitai/app-sdk` additions: `BlockResourceInfo`, `BlockResourcePickerType`, and
  the two message variants. `@civitai/blocks-react` adds `useResourcePicker()`
  whose `open({ resourceType, baseModelGroup? })` resolves with the chosen
  `BlockResourceInfo` or `null` when the user dismissed.

  Discovery only: the returned `versionId` is a hint, never an entitlement — feed
  it into `body.modelVersionId` (Checkpoint) or `body.additionalResources` (LoRA)
  and the host re-validates every id server-side at estimate/submit (the page gate

  - orchestrator belt). Purely additive and backward-compatible. The host side
    ships in civitai/civitai (`PageBlockHost` `OPEN_RESOURCE_PICKER` handler); a block
    can consume this hook once a version of these packages is published.

## 0.6.0

### Minor Changes

- Add `useRequestSignIn()` — anonymous conversion. Returns
  `requestSignIn(payload?)`, a fire-and-forget helper that posts the new
  `REQUEST_SIGN_IN` message (`{ returnUrl?: string }`) through the active
  transport. A block rendered for a logged-out viewer (`viewer === null`) calls
  it when the user clicks an action that needs auth/money (e.g. Generate) so the
  host starts civitai.com's login flow. Pairs with `@civitai/app-sdk@^0.9`.

- Add `useRequestConsent()` — lazy consent. Returns `requestConsent(payload?)`,
  a fire-and-forget helper mirroring `useRequestSignIn()` that posts the new
  `REQUEST_CONSENT` message (`{ scopes?: string[] }`). A block rendered for a
  logged-in viewer whose token is missing a consent-gated scope calls it on the
  gated action (instead of prompting on load); the host opens its consent UI and,
  on grant, re-mints and pushes a `TOKEN_REFRESH` with the now-granted scopes so
  the block can retry.

- Suffix-wildcard support in the `IframeTransport` origin allowlist (new
  `internal/originMatcher`). The allowed-parent-origin list now accepts entries
  like `https://*.civitai.com`: a bare host still matches exactly; a `*.` prefix
  matches any subdomain of the suffix (never the apex unless listed separately,
  never a different registrable domain). Lets a block be embedded under
  preview/canary hosts without enumerating every one.

- Fix `peerDependencies["@civitai/app-sdk"]`: widened from `^0.7.0` (which
  excluded the `0.8.x`/`0.9.x` it is actually used with) to `>=0.7.0 <1`, so
  installing the current `@civitai/blocks-react` alongside the current
  `@civitai/app-sdk` no longer emits an unmet-peer-dependency warning.

## 0.4.2

### Patch Changes

- `useBuzzWorkflow` now gives the orchestrator-bound requests (`estimate` / `submit` / `poll`) a 120s timeout instead of the transport's 30s `DEFAULT_REQUEST_TIMEOUT_MS`. `submit` does a whatif cost-preflight + the real submit (two orchestrator round-trips) plus a prompt audit server-side, which legitimately exceeds 30s on a busy generation queue — the old default surfaced that as a spurious `request "SUBMIT_WORKFLOW" timed out after 30000ms` rejection even though the submit was healthy.

## 0.4.1

### Patch Changes

- Republish to fix `workspace:^` protocol leaking into `peerDependencies."@civitai/app-sdk"` of the 0.4.0 tarball — npm consumers got `EUNSUPPORTEDPROTOCOL` on install. Replaced with explicit `^0.6.0` semver.

## 0.4.0

### Minor Changes

- Initial public release of `@civitai/blocks-react` (0.4.0 — pre-1.0 v0): React hooks and iframe transport for Civitai App Blocks. Pairs with `@civitai/app-sdk/blocks` (the framework-agnostic contract) so block apps don't need to wire `postMessage` themselves.

  **Transport**

  - `IframeTransport` — origin-validated `postMessage` transport. Awaits `BLOCK_INIT` with a 10s timeout, queues outbound messages until init lands, correlates request/response by `requestId`, and auto-sends `BLOCK_READY` after applying init so the platform's 10s ready timeout doesn't fire on blocks that never explicitly send one (`useBlockResize` follows with real height measurements). Refuses to mount without at least one allowed parent origin. Every inbound payload passes a shape-validation gate (`payloadValidatorFor`) before reaching state-mutating code: malformed messages drop with `console.warn` instead of clobbering the token snapshot or producing `Invalid Date`. Handles both host-pushed `TOKEN_REFRESH` (no `requestId`) and `TOKEN_REFRESH_RESPONSE` (optional `requestId`); both replace the full wrapped token — scopes and `buzzBudget` included — not just `raw`/`expiresAt`.
  - `InlineTransport` — v2 stub. Reads `window.__CIVITAI_BLOCK_CONTEXT__`; not wired in v1.
  - `BlockTransportDetector.detect()` — picks iframe vs inline based on bootstrap presence; reads the allowlist from `VITE_` / `NEXT_PUBLIC_` / `PUBLIC_` env vars.
  - `getTransport()` — process-wide singleton so hooks share one instance.

  **Hooks**

  - `useBlockContext` — primary; returns the host-provided context, viewer (`ViewerInfo | null` — `null` for anonymous), theme (`'light' | 'dark'`), `appId`, `blockId`, `blockInstanceId`, and a `ready` gate.
  - `useBlockSettings`, `useBlockToken` (with `refresh()` for 401 retries and in-flight dedup so the scheduled and synchronous refresh paths never fan out duplicate `REQUEST_TOKEN` messages), `useBuzzWorkflow` (estimate/submit/poll with a shared terminal-status set so a host-returned `canceled` / `expired` snapshot exits `polling` correctly), `useBlockResize` (ResizeObserver → `RESIZE_IFRAME`), `useBuzzPurchase`, `useCivitaiNavigate`, `useBlockAnalytics`, `useCheckpointPicker`.

- Manifest-driven settings (W3 v0): `@civitai/blocks-react/ui` `SettingsForm` headless component. Renders a typed form from a `ManifestSettings` declaration, filters fields by scope + `requires_scope`, surfaces inline server-side validation errors, and delegates `resource_picker` widgets to the host via the existing `useCheckpointPicker` bridge.

- App Storage KV substrate (W4 v0): `useAppStorage()` hook with `get`, `set`, `delete`, `list`, `getQuota`. Anon viewers get a clean null on `get` + a thrown `UNAUTHORIZED` on `set`. Server-side enforces 50MB per-app quota and 64KB per-value cap. Pairs with the platform's per-app PostgreSQL schema (one schema per approved app block, isolated by a NOLOGIN role).

  Tracks `BlockInitPayload` and the postMessage protocol from civitai/civitai's `src/components/AppBlocks/types.ts` / `IframeHost.tsx` — viewer/theme/`appId` field layout and the wrapped-token shape match the platform contract.

  Peer-depends on `react ^18 || ^19` and `@civitai/app-sdk ^0.6`. Test surface covers origin validation, the 10s init timeout, requestId correlation, payload shape validation at the trust boundary (rejecting malformed `BLOCK_INIT` / `TOKEN_REFRESH` / `TOKEN_REFRESH_RESPONSE` / workflow replies), host-pushed token refresh, auto-`BLOCK_READY`, token-refresh scheduling + snapshot updates, the workflow state machine, the `SettingsForm` field rendering + validation, and the `useAppStorage` request/response cycle.
