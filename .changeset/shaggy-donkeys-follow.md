---
'@civitai/theme': minor
---

Follow `prefers-color-scheme` when no `data-theme` is set. The dark token values
are now also emitted under `@media (prefers-color-scheme: dark)`, scoped to
`:root:not([data-theme])`, so a page that never picks a theme starts in the one
the OS asks for. An app that sets the attribute — including a block acting on the
host's `THEME_CHANGE` — never matches the new block and is unaffected; every
pre-existing byte of the stylesheet is unchanged.
