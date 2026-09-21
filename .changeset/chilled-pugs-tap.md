---
'@civitai/components': minor
---

Fields take `size`. `<civitai-button>`, `<civitai-badge>`, `<civitai-loader>`
and `<civitai-segmented-control>` all had `sm | md | lg`; no field did, so a
toolbar could not put a select next to a small button without them disagreeing
about height. `CivitaiField` carries it now, which is every text input,
textarea, number input, select and slider at once.
