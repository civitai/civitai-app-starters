---
'@civitai/app-sdk': patch
---

Add `source-scan-pending` to `KnownBlockWorkflowErrorCode`: a generation input names an uploaded image whose scan has not finished. Retry once the scan verdict is `scanned` (civitai#8405).
