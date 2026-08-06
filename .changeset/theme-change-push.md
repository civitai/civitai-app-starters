---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

Add a `THEME_CHANGE` host→block push so a mounted block follows the viewer's
light/dark toggle.

Before this the host handed a block its theme exactly once — in `BLOCK_INIT` and
(where enabled) in the iframe URL fragment — and neither could change afterwards:
`BLOCK_INIT` is deduped by the transport, and the host freezes the fragment at
mount so a toggle cannot re-navigate a third-party frame. A viewer flipping dark
mode left every open block rendering the old theme until it was reloaded.

- `@civitai/app-sdk`: new `THEME_CHANGE` variant on `ParentToBlockMessage`,
  carrying `{ theme }`. Host-initiated, no `requestId` (mirrors `TOKEN_REFRESH`).
- `@civitai/blocks-react`: the iframe transport validates and applies it to the
  snapshot; new `useBlockTheme()` hook returns the live value, and
  `useBlockContext().theme` tracks it too. `createMockHost` / the `dev:live` host
  gain `setTheme(theme)` so the push can be exercised locally.

Purely additive in both directions. A deployed block on an older SDK has no
handler, so the message falls through its transport's no-op tail and it is
completely unaffected. A new block against an older host never awaits the
message — the theme just never moves, i.e. today's behaviour.
