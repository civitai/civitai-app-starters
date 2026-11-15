---
'@civitai/blocks-react': minor
'@civitai/app-sdk': minor
'@civitai/sdk': patch
---

**BREAKING: `useAppStorage()` and `useSharedStorage()` are removed.** civitai.com has refused every call to the legacy stores since 2026-11-10 (`410 legacy_store_removed`). Use the document store, `app.storage.collection(name)` in `@civitai/sdk`: https://developer.civitai.com/apps/guide/storage#moving-from-the-legacy-stores. These packages are pre-1.0, so the break ships as a minor.

- `@civitai/blocks-react`: removed `useAppStorage`, `useSharedStorage`, `SharedStorageRateLimitError` and the types `AppStorageKeyEntry`, `AppStorageListResult`, `AppStorageQuota`, `UseAppStorage`, `SharedAppendValue`, `SharedListItem`, `SharedListResult`, `UseSharedStorage`. From `@civitai/blocks-react/testing`: removed the `storage` and `shared` options of `createMockHost` / `Harness`, the `?seed=` URL toggle, and the types `MockStorageScenario`, `MockSharedScenario` and `MockSharedSeed`. `createMockHost` and `createLiveHost` no longer answer `APP_STORAGE_*` or `SHARED_*` messages. `declaredScopes` stays; it now gates only the reactions bridge.
- `@civitai/app-sdk`: removed `classifyAppStorageError`, `AppStorageRejectionReason` and the message types `SharedStorageValue`, `SharedStorageRateLimit` and `SharedStorageItemWire`; the `APP_STORAGE_*` and `SHARED_*` members leave `BlockToParentMessage`, `ParentToBlockMessage` and `BLOCK_TO_PARENT_MESSAGE_TYPES`. The seven constants `APP_STORAGE_MAX_VALUE_BYTES`, `APP_STORAGE_MAX_BYTES`, `APP_STORAGE_MAX_ROWS` and `APP_STORAGE_ERROR_{VALUE_TOO_LARGE,USER_QUOTA_EXCEEDED,USER_ROW_LIMIT,REQUEST_FAILED}` stay exported, `@deprecated`, because published `@civitai/blocks-react` up to 0.80.x imports them when `@civitai/blocks-react/testing` loads, and its peer range admits this release. Upgrade both packages together.
- `@civitai/sdk`: the `sharedContentKey` doc comment no longer names `useSharedStorage()`. No API change.
