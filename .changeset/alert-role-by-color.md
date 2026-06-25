---
'@civitai/blocks-react': patch
---

Alert: derive the ARIA live-region role from `color` instead of always using `role="alert"`.

`error`/`warning` keep `role="alert"` (assertive, interrupts), while `info`/`success` now use `role="status"` (polite) so a static, always-present callout (e.g. a "How this works" panel on mount) is no longer announced assertively to screen-reader users. A new `role?` prop on `AlertProps` overrides the color-derived default (explicit value always wins). Backward-compatible for `error`/`warning`.
