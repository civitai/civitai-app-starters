---
'@civitai/sdk': patch
---

`createFakeStorage` with `enforceRateLimits: true` now applies the document store's own shared write budget from civitai/civitai#8873: a burst of 30 (one token back a minute) and 300 a day (one back every 4.8 minutes), in place of 10 and 50. The rejection bucket is unchanged (10, one back every 30 minutes). The fake's `info().limits.rate` reports `sharedWritesBurst: 30` and `sharedWritesPerDay: 300`. Rate limits stay off by default.
