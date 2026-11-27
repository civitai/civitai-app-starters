---
'@civitai/blocks-react': minor
---

**`useViewer().viewer.image` and `useBlockContext().viewer.image`: the viewer's avatar.** It's shape-checked at the trust boundary. A malformed value is dropped and the rest of the reply is still delivered. `createLiveHost` (`dev:live`) forwards the avatar from `/api/v1/blocks/me` onto `BLOCK_INIT.viewer.image`, as production does. Additive.
