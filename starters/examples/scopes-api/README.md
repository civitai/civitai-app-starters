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
| `useHostOrigin()` — the one origin the token may be sent to | `src/App.tsx` |
| `GET /api/v1/blocks/me` with `Authorization: Bearer <jwt>` | `callBlocksMe()` |
| 401 → refresh → retry-once | `callBlocksMe()` |

## Block scopes

Block scopes are `domain:verb:target`, all lowercase (e.g. `models:read:self`).
Declare what you need in the manifest:

```jsonc
"scopes": ["user:read:self", "models:read:self"]
```

The known set is the `scopes` enum of the
[canonical manifest schema](https://civitai.com/schemas/app-block/v1.json)
(also `BLOCK_SCOPES` in `@civitai/app-sdk/blocks`). Copied from that enum,
in its order — a guard test fails if the two ever differ:

<!-- scopes-enum:start -->
`models:read:self`, `user:read:self`, `ai:write:budgeted`, `buzz:read:self`,
`social:tip:self`, `apps:storage:read`, `apps:storage:write`,
`apps:storage:shared:read`, `apps:storage:shared:write`,
`collections:read:self`, `collections:write:self`, `collections:read:private`,
`posts:write:self`, `goods:read:self`, `goods:purchase:self`,
`apps:store:items:write`.
<!-- scopes-enum:end -->

A moderator sees your declared scopes at review. The issued JWT carries the
**granted intersection** of what you declared and what the user consented to —
so always read `useBlockContext().token.scopes` (or `useBlockToken().scopes`)
for what you *actually* have, not the manifest.

## Calling a scope-gated endpoint

```tsx
const { raw, refresh } = useBlockToken();   // raw JWT, auto-refreshing
const host = useHostOrigin();               // undefined until BLOCK_INIT

let res = await fetch(`${host}/api/v1/blocks/me`, {
  headers: { Authorization: `Bearer ${raw}` },
});
if (res.status === 401) {              // token may have just rotated
  const fresh = await refresh();       // force a fresh mint; resolves WITH the new token
  res = await fetch(`${host}/api/v1/blocks/me`, {
    headers: { Authorization: `Bearer ${fresh.raw}` },
  });                                  // retry once, with the NEW raw
}
```

🔴 **Send the token to `useHostOrigin()`, never to a hard-coded host.** It is the
origin that passed the SDK's parent-origin allowlist — the same gate
`BLOCK_INIT` passed — so the bearer token only ever goes back to the host that
issued it. Never derive it from `document.referrer` or anything else the parent
page controls.

> Retry with `fresh.raw`, not the `raw` destructured above: that binding belongs
> to the closure that ran before the refresh, so re-reading it re-sends the stale
> JWT and 401s again.

`/api/v1/blocks/me` is the authoritative who-am-i (the BLOCK_INIT viewer is a
coarse hint). It needs `user:read:self` and 403s without it — the check is
all-or-nothing at the route, not a per-field filter on the response. If the
viewer is all you need, `useViewer()` returns the same
`{ id, username, status, buzzBudget }` body over the host bridge, with no fetch
of your own; this example fetches to show the pattern for endpoints the bridge
does not cover. Other
endpoints are gated by their own scopes — e.g. reading the bound model needs
`models:read:self`.

> The platform serves your built `dist/` and owns the CSP — it allows
> `https://civitai.com` for `connect-src` for you. You don't ship an
> `nginx.conf` (or `Dockerfile`); the build recipe is injected at approve.

## Run it

```bash
npm install           # inside this monorepo: pnpm install, at the root
npm run dev:harness   # → http://localhost:5184
```

Under `dev:harness` the call returns **401** (twice — the refresh-retry runs):
the host origin is the dev server, whose `/api` proxy forwards the request to
the real API, and the mock token is not a real RS256 JWT. The mock token also
carries none of the declared scopes, so the "granted" card reads `(none)`.

To see real data, run `npm run dev:live` with a dev token
([the examples README](../README.md#against-the-real-backend-devlive)) — the
same code, a real token, a real answer. See the
[root README](../../../README.md) for submit → review → deploy.
