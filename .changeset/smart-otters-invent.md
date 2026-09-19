---
'@civitai/theme': minor
'@civitai/components': patch
---

Express "gray in light, surface in dark" as tokens instead of descendant selectors.

Four rules in `components.css` were written as `[data-theme='dark'] <descendant>`.
An ancestor selector cannot cross a shadow boundary and `:host-context()` has
never shipped in Firefox, so those four decisions were unreachable from a custom
element. They are now `--civitai-card-border-width`, `--civitai-color-track`,
`--civitai-color-segmented-bg` and `--civitai-color-media-placeholder`, which
inherit into a shadow root like any custom property.

Mantine has no variable carrying either side of these pairs, so `TokenSpec.source`
and `.literal` now each accept a `{ light, dark }` pair resolved against its own
scheme's variable map. `--civitai-card-border-width` is a width rather than a
colour: dark removes the default hairline's box, and a transparent colour would
leave 1px of it on every card.

No visual change — computed styles are unchanged in both themes. Existing tokens
and artifact bytes are untouched; the new tokens are appended.
