---
'@civitai/blocks-react': minor
---

feat(testing): add `createLiveHost` — the LIVE sibling of `createMockHost`. Where the mock host synthesizes every reply with no network, `createLiveHost` FORWARDS the App-Block postMessage protocol to the REAL Civitai backend using a short-lived, pasted dev block token (minted via `POST /api/v1/blocks/dev-token`), so a harness's `dev:live` mode runs local block code against real compute / real Buzz / the real catalog (Phase 2 of the dev-token live-mode design).

It returns the same `{ install, setScenario, buzz }` interface as `createMockHost` (so a harness can swap them; `setScenario`/`buzz` are inert in live mode). On install it decodes the token JWT payload (no signature verification) to seed `BLOCK_INIT`, fetches the viewer via `GET /api/v1/blocks/me`, and forwards `ESTIMATE/SUBMIT/POLL/CANCEL_WORKFLOW` to the corresponding `blocks.*` tRPC mutations (Bearer = block token), mapping `BlockWorkflowSnapshot` back to the right reply keyed by `requestId`. Backend/network errors map to a failed-shape snapshot (never a hung promise). `OPEN_BUZZ_PURCHASE` deep-links to the real purchase page and replies `purchased: false` (honest — the out-of-band purchase isn't observable). Pickers / `SET_USER_CHECKPOINT` / the app-storage KV protocol reply with a clearly-labelled "not supported in live v1" outcome. Accepts an injectable `fetchImpl` for tests.

Exported from `@civitai/blocks-react/testing` as `createLiveHost`, `decodeBlockTokenPayload`, and the `LiveHostOptions` type.
