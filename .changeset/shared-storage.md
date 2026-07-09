---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

App Blocks **SHARED (app-global / cross-user) storage** — `useSharedStorage` + the `SHARED_*` message contract.

- **`@civitai/app-sdk`**: adds the `SHARED_LIST / SHARED_GET_COUNT / SHARED_GET_COUNTS / SHARED_APPEND / SHARED_VOTE / SHARED_UNVOTE / SHARED_WITHDRAW` request/reply message types + the `SharedStorageValue` / `SharedStorageItemWire` types (the block↔host contract for the shared datastore). Publishing these is required for `@civitai/blocks-react`'s new hook types to resolve for consumers.
- **`@civitai/blocks-react`**: new `useSharedStorage()` hook (`list` / `append` / `vote` / `unvote` / `withdraw` / `getCount` / `getCounts` over a per-app, cross-user store) + a `shared` scenario in `createMockHost` for local dev. Pairs with the civitai host bridge + server core.
