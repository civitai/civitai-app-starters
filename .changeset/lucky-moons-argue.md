---
'@civitai/block-components': minor
---

Add `@civitai/block-components` with `<civitai-sign-in-button>`.

The elements that need the host bridge live here rather than in
`@civitai/components`, because `@civitai/blocks-client` is for on-site block
apps only — an external OAuth app has no host frame, so bundling the transport
into the design system would make every external app pay for something it
cannot use.

A layering guard enforces the split from day one, checking both
`@civitai/components`' source for a bridge import and its manifest for a bridge
dependency. It runs in CI ahead of the tests here.

`<civitai-sign-in-button>` is inert before `BLOCK_INIT`: there is no validated
host origin until the handshake lands, so a press sends nothing and the control
renders disabled. It composes `<civitai-button>` rather than restyling one, and
disappears once the snapshot carries a viewer.
