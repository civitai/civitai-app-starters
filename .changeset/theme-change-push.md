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
  `useBlockContext().theme` tracks it too. The host forwards the theme twice —
  top-level and inside `BLOCK_INIT.context` — so the push updates
  `context.theme` as well when the host sent that field, keeping both documented
  readers (`useBlockContext().theme` and `ModelSlotContext.theme`) in step. It is
  never introduced on a context that lacked it. `createMockHost` / the `dev:live`
  host gain `setTheme(theme)` so the push can be exercised locally.

  Frozen on the v1 inline transport, which receives no host pushes at all — same
  degradation as an older host.

Purely additive in both directions. A deployed block on an older SDK has no
handler, so the message falls through its transport's no-op tail and it is
completely unaffected. A new block against an older host never awaits the
message — the theme just never moves, i.e. today's behaviour.
