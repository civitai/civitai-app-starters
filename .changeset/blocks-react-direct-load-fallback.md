---
'@civitai/blocks-react': minor
---

Add an "Open on Civitai" fallback for blocks loaded directly (top-level) instead of embedded.

A block is served from `<slug>.civit.ai` but is designed to run embedded in the Civitai host iframe, which delivers its context via the `BLOCK_INIT` handshake. Opened directly (top-level navigation to the bare origin — a shared link, a social crawl), no parent ever sends `BLOCK_INIT`, so `ready` never flips and the block hangs on its loading spinner forever.

New, in the SDK so every block degrades uniformly:

- `<BlockGate>` (from `@civitai/blocks-react/ui`) — wrap your app root once; it renders a branded, theme-aware "Open on Civitai" landing (linking to `civitai.com/apps/run/<slug>`) on a direct load, and is a transparent pass-through otherwise.
- `<DirectLoadFallback>` (from `/ui`) — the landing itself, for a custom gate.
- `useDirectLoad()` and `hostToRunUrl()` (from the package root) — the detection hook and pure slug→URL helper, for building your own UI.

The trigger is precise, so the embedded happy path and the dev harness are untouched: the fallback shows only when the block is top-level (`window.self === window.top`) **and** no `BLOCK_INIT` arrives within a short timeout (~2s, overridable). Framed blocks never trip it; the harness posts `BLOCK_INIT` immediately, so it never trips there either. On a non-`*.civit.ai` host (e.g. `localhost`), it shows a neutral "waiting for the host" state rather than a broken `apps/run/localhost` link.
