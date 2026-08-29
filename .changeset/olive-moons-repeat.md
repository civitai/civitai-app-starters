---
'@civitai/app-sdk': patch
---

fix(sdk): make `ok` (and `deleted`) optional on the seven `{ok, error}` `ParentToBlockMessage` reply payloads — the block-side reply validators early-accept an error reply that omits `ok`, so the type guaranteed a field the guard admits without
