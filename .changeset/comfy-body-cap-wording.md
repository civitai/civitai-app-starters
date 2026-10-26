---
'@civitai/app-sdk': patch
---

Docs only: the 256 KB whole-request cap (a 413) applies when calling the `/api/v1/blocks/workflows/estimate` and `/submit` REST routes directly with a block token, not to page apps using the hooks through the host bridge. The README's `checkComfyGraph` section now also says `classes` is the complete list and `packs` is partial (only the `cnr_id`s present in the file).
