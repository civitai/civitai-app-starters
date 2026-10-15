---
'@civitai/blocks-react': patch
---

Docs only. The README no longer says the shared-storage `append`/`update` token-bucket budget "goes live with the next civitai.com release": it is live, so the note about a 20-a-day fixed window is gone. The stored-versus-wire byte gap between `createMockHost` and the host (#347) is no longer given as "up to ~1.5x": that is the figure for a long array of small integers, and a numeric-heavy value has been measured at up to 44.4x (README and the `quotaBytes` doc comment).
