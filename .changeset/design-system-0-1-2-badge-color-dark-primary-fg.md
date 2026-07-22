---
"@civitai/theme": patch
"@civitai/components": patch
"@civitai/components-react": patch
---

Design-system 0.1.2 — two retrofit-dogfood fixes (civitai/civitai-app-starters#181).

- **Badge `data-color` (F2):** Badge now accepts an intent color mirroring
  Alert's `data-color` contract (`info` / `success` / `warning` / `error`),
  recoloring the `filled` / `light` / `outline` variants via the same
  `color-mix()` token approach. `@civitai/components-react` `<Badge>` gains a
  `color` prop mapped to `data-color`. Omitting it keeps the current primary
  accent, so the change is non-breaking.
- **Dark `--civitai-color-primary-fg` (F8):** the generated
  `[data-theme='dark']` token block now emits `--civitai-color-primary-fg`
  (white) for symmetry with light. It is produced by the `@civitai/theme` token
  pipeline (not hand-authored), so generation-parity holds; light is unchanged.
