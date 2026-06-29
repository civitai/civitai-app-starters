---
"@civitai/app-sdk": patch
---

Add the `apps:storage:read` / `apps:storage:write` block scopes (W4 KV datastore) to `BLOCK_SCOPES`. The convenience map was missing them, so authors had no `BLOCK_SCOPES.APPS_STORAGE_*` constant for the per-app storage scopes even though the server accepts them. A new test pins `BLOCK_SCOPES` to the server's canonical block-scope set to catch future drift.
