---
"@civitai/components": patch
---

Comment only. The `[data-civitai-ui='text']` rule's comment in `components.css` (also embedded in the generated `componentsCss` string) no longer says in-repo blocks colour a `[data-theme]` root `#e6e6e6`, or that no in-repo consumer renders Text: every Civitai App page sets `color: var(--civitai-color-text)` itself, and the block starter renders `<civitai-text>`. No rule or value changes.
