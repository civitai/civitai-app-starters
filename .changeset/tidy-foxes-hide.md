---
'@civitai/sdk': patch
---

Blocks now start inside civitai.red and civitai.green, and reading the parent
origins from the environment no longer bundles every other `VITE_*` variable
into the app.
