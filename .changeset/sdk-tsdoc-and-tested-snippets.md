---
'@civitai/app-sdk': patch
'@civitai/blocks-react': patch
---

Add TSDoc (summary + `@example`) to the public API surface so usage surfaces in
the editor exactly when an agent/dev writes the call.

- `@civitai/blocks-react`: examples on every exported hook (`useBlockContext`,
  `useBlockResize`, `useBlockToken`, `useBlockSettings`, `useBuzzWorkflow`,
  `useBuzzPurchase`, `useAppStorage`, `useCheckpointPicker`, `useResourcePicker`,
  `useCivitaiNavigate`, `useRequestSignIn`, `useRequestConsent`,
  `useBlockAnalytics`) plus the `/ui` `Button` and `Modal` components. Examples
  mirror the README so docs and tag stay in sync.
- `@civitai/app-sdk`: examples on the most-called exports — `defineBlock`, the
  OAuth functions (`generatePkce`, `buildAuthorizeUrl`, `exchangeCode`,
  `refreshToken`, `revokeToken`, `fetchMe`), the orchestrator helpers
  (`createOrchestratorClient`, `buildTextToImageBody`, `estimateWorkflow`,
  `submitWorkflow`, `getWorkflow`, `pollWorkflow`, `isTerminal`,
  `extractImageUrls`), and the scopes helpers (`hasScope`, `scopesFromBitmask`,
  `bitmaskFromScopes`, `getScopeLabel`).

No runtime or API-shape changes — documentation only (now emitted into the
shipped `.d.ts`). Also corrects a README OAuth example that read a non-existent
`balance` field off `fetchMe`'s `unknown` return.
