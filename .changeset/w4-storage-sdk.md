---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

App Storage KV substrate (W4 v0):

- `@civitai/app-sdk/blocks`: five new message pairs for host-mediated KV storage — `APP_STORAGE_GET` / `APP_STORAGE_GET_RESULT`, `APP_STORAGE_SET` / `APP_STORAGE_SET_RESULT`, `APP_STORAGE_DELETE` / `APP_STORAGE_DELETE_RESULT`, `APP_STORAGE_LIST` / `APP_STORAGE_LIST_RESULT`, `APP_STORAGE_QUOTA` / `APP_STORAGE_QUOTA_RESULT`. All requests carry a `requestId` for correlation; responses include either a `value`/`keys`/`quota` payload or a typed `error`.
- `@civitai/blocks-react`: `useAppStorage()` hook with `get`, `set`, `delete`, `list`, `getQuota`. Anon viewers get a clean null on `get` + a thrown `UNAUTHORIZED` on `set`. Server-side enforces 50MB per-app quota and 64KB per-value cap.

Pairs with the platform's per-app PostgreSQL schema (one schema per approved app block, isolated by a NOLOGIN role). v1 will add SQL access and per-app migrations.
