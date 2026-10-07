---
"@civitai/components": patch
"@civitai/app-sdk": patch
---

Docs only. `@civitai/components` MARKUP.md: correct which in-repo pages set an ancestor text colour — no in-repo page sets `#1a1a1a` / `#e6e6e6` any more — every `starters/examples/*` app sets `color: var(--civitai-color-text)` on `:root` and `civitai-block-starter` on `body`, so they join `demo/` and `playground/` as pages that inherit the token. `@civitai/app-sdk` README: the `blockManifestPlugin` sentence no longer counts "six" examples (there are eleven, and all register it).
