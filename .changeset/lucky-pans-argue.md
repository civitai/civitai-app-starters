---
'@civitai/app-sdk': patch
---

oauth: guard the token response's `scope`, and wire `fallbackScope` up

`shapeTokens` coerced `OAuthTokenResponse.scope` with `Number()` and used the
result unchecked. Civitai's authorization server sends a decimal bitmask in a
JSON string (`"scope": "114689"`), which coerces fine — but [RFC 6749
§5.1](https://datatracker.ietf.org/doc/html/rfc6749#section-5.1) defines `scope`
as a *space-delimited list*, and `Number('ai:write:budgeted user:read:self')` is
`NaN`. `NaN & scope` is `0`, so `hasScope()` returned `false` for every scope
and `scopesFromBitmask()` returned `[]` — a user who had just completed consent
was told they granted nothing, with no error anywhere. Fixes #326.

A `scope` that is not a whole number in `[0, 2**31-1]` — `NaN`, `Infinity`, a
fraction, a negative, a value wide enough to wrap under the signed 32-bit `|`
— is now rejected. Rejected means **replaced by `fallbackScope` plus a
`console.warn` naming the value received**, not thrown: on the token path an
exception turns a degraded-but-working session into a hard login failure, and
#326 explicitly left the choice open.

### `fallbackScope` is now reachable, and the starters pass it

`shapeTokens` has always taken a `fallbackScope` parameter that neither call
site passed — dead since the initial commit. It is now an optional
`fallbackScope` on `ExchangeCodeOpts` / `RefreshTokenOpts`, and all four
starters pass it: the requested scope from the sealed OAuth-state cookie on
exchange, the previously granted `tokens.scope` on refresh.

This matters most on refresh. RFC 6749 §6 lets a server omit `scope` when the
refreshed grant is unchanged, and every starter replaces the whole token blob
(`{ ...session, tokens: fresh }`), so that omission would be *persisted* as
`0` and lock the user out of features their token still grants. The default
with no `fallbackScope` is unchanged (`0`).

No public API is added or removed, and no call that resolved before rejects
now — hence `patch`. Both failure shapes are **latent** rather than live:
Civitai's documented success response carries `scope` for both the
authorization-code and refresh grants. They are reachable against a custom
`baseUrl` (self-hosted or mock auth hub), and become live the day the server is
made RFC-conformant.
