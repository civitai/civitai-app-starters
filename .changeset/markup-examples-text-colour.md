---
"@civitai/components": patch
"@civitai/app-sdk": patch
---

Docs only. `@civitai/components` MARKUP.md: correct which in-repo pages set an ancestor text colour — the `starters/examples/*` apps now set `color: var(--civitai-color-text)` on their root, so only `civitai-block-starter` still carries `#e6e6e6`, and the examples join `demo/` and `playground/` as pages that inherit the token. `@civitai/app-sdk` README: the `blockManifestPlugin` sentence no longer counts "six" examples (there are eleven, and all register it).
