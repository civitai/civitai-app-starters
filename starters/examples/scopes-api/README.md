# scopes-api — declare scopes + call REST endpoints

Some block needs aren't on the postMessage bridge — they're plain civitai.com
REST endpoints, gated by the scopes in the block's JWT. The block calls them
directly with the BLOCK_INIT token.

## What it shows

| Concept | Where |
|---|---|
| Declaring `scopes` in the manifest | `block.manifest.json` |
| Declared vs **granted** scopes | `src/App.tsx` |
| `useBlockToken()` — raw JWT + `refresh()` | `src/App.tsx` |
| `GET /api/v1/blocks/me` with `Authorization: Bearer <jwt>` | `callBlocksMe()` |
| 401 → refresh → retry-once | `callBlocksMe()` |

## Block scopes

Block scopes are `domain:verb:target`, all lowercase (e.g. `models:read:self`).
Declare what you need in the manifest:

```jsonc
"scopes": ["user:read:self", "models:read:self"]
```

The known set (see `BLOCK_SCOPES` in `@civitai/app-sdk/blocks`): `models:read:self`,
`media:read:owned`, `user:read:self`, `ai:write:budgeted`, `buzz:read:self`,
`block:settings:read`, `block:settings:write`, `social:tip:self`.

A moderator sees your declared scopes at review. The issued JWT carries the
**granted intersection** of what you declared and what the user consented to —
so always read `useBlockContext().token.scopes` (or `useBlockToken().scopes`)
for what you *actually* have, not the manifest.

## Calling a scope-gated endpoint

```tsx
const { raw, refresh } = useBlockToken();   // raw JWT, auto-refreshing

let res = await fetch('https://civitai.com/api/v1/blocks/me', {
  headers: { Authorization: `Bearer ${raw}` },
});
if (res.status === 401) {       // token may have just rotated
  await refresh();              // force a fresh mint
  res = await fetch('https://civitai.com/api/v1/blocks/me', {
    headers: { Authorization: `Bearer ${raw}` },
  });                           // retry once
}
```

`/api/v1/blocks/me` is the authoritative who-am-i (the BLOCK_INIT viewer is a
coarse hint). It returns only what your granted scopes allow. Other endpoints
are gated by their own scopes — e.g. reading the bound model needs
`models:read:self`.

> The platform serves your built `dist/` and owns the CSP — it allows
> `https://civitai.com` for `connect-src` for you. You don't ship an
> `nginx.conf` (or `Dockerfile`); the build recipe is injected at approve.

## Run it

```bash
cp .env.example .env
pnpm install
pnpm dev:harness   # → http://localhost:5184
```

Locally the call returns **401** — the harness mints a mock token, not a real
RS256 JWT. The example shows the exact request shape + the refresh-retry
pattern; deploy the block to see real data. See the
[root README](../../../README.md) for submit → review → deploy.
