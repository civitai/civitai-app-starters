---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

Iframe wire contract: URL-fragment fast path for `theme`/`renderMode`/`blockInstanceId`, plus a `BLOCK_HELLO` readiness announce.

Both changes are **additive fast paths**. The `BLOCK_INIT` payload remains authoritative and still carries all three fields; a block is still only `ready` once the payload lands; and **no token is ever put in the URL**.

- `@civitai/app-sdk/blocks` gains `encodeBlockInitFragment` / `parseBlockInitFragment` / `stripBlockInitFragment` and the `BLOCK_INIT_FRAGMENT_*` constants. Wire format v1 is `#civitai-block=v1&theme=…&renderMode=…&blockInstanceId=…`; an absent, foreign, or unknown-version fragment decodes to `{}`.
- `BlockToParentMessage` gains `{ type: 'BLOCK_HELLO' }` — a contentless announce the transport posts the moment its `message` listener is attached, so the host can push `BLOCK_INIT` in response instead of waiting out its retry tick.
- `IframeTransport` seeds its pre-init snapshot from the fragment when one is present (and strips only its own keys from the visible URL, best-effort), then posts the announce.

**Compatibility.** A new block against an old host sees no fragment and no answer to its announce, and falls back to waiting for `BLOCK_INIT` — today's behaviour exactly. A host that never receives the announce still delivers `BLOCK_INIT` on its own bounded retry/timeout schedule, so the announce can never hang a block or a host.
