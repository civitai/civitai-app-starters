---
'@civitai/sdk': patch
---

`createFakeStorage`: `info()` declarations no longer carry `counters: []` or `marks: []`, as civitai.com stopped sending them (civitai/civitai#10590). Documents keep their empty `counters`, `marks` and `viewer` for SDKs before 0.33.
