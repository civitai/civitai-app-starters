---
'@civitai/sdk': patch
---

`BREAKING.md` corrections. It ships in the tarball and is the document a porting
app reads, so four of its rows were sending people the wrong way.

- **`APP_STORAGE_*` said "No v1 route".** Five routes exist — `get`, `set`,
  `delete`, `list`, `quota` (civitai#5085). A new *App storage* section carries
  the contract that is not guessable: block-token only (an OAuth-authenticated
  app has no per-viewer app storage), anonymous viewers get 403 where the bridge
  resolved a read to `null`, every failure rejects so the absence of `nextCursor`
  is proof a scan completed, and `sizeBytes` is the **wire** unit while quota is
  `octet_length(value::text)` over JSONB — measured at up to **44.4×** the wire
  size, so summing it under-counts.

- **The workflow row pointed at `app.orchestration`.** It now points at
  `/api/v1/blocks/workflows/*`, because the substitution type-checks and passes
  tests while dropping the spend caps, the maturity clamp and the attribution
  tag. Same note for `queryWorkflows({ tags })`, where the route forces the app
  tag server-side from the verified token and the client takes it from the
  caller — relocating a trust boundary into the iframe.

- **"Waiting on the host" item 1 said the OAuth token was blocked.** It is built:
  the manifest `auth` field plus server-side minting. The phishing finding is not
  re-opened — the token is minted by the host against already-approved scopes,
  and the `appblk-*` bar on the *interactive* flows stands. But the mint is
  gated on `APP_BLOCK_OAUTH_TOKENS_ENABLED`, which defaults `false` and is unset
  in production, so a manifest asking for `oauth` silently receives the block
  token. Marked dark, with "do not build against it yet".

- **Item 3 called app storage the largest remaining gap.** It has landed; the
  remaining gaps are the Buzz account/transaction reads, daily compensation,
  wildcard packs and image upload.
