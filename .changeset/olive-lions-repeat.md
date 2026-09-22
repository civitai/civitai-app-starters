---
'@civitai/components': minor
---

`<civitai-text-input>` and `<civitai-textarea>` take `maxlength` and
`autocomplete` and hand them to the control, which is where the UA reads them.
Both were missing, and `civitai-brawl` needed all three of its lobby inputs
capped when it adopted the elements.
