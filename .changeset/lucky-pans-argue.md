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
was told they granted nothing, with no error anywhere. Refs #326.

A `scope` that is not a whole number in `[0, 2**31-1]` — `NaN`, `Infinity`, a
fraction, a negative, a value wide enough to wrap under the signed 32-bit `|`,
or one of the wrong *type* entirely (`Number(['65537'])` is `65537` and
`Number(true)` is `1`, i.e. a valid-looking but invented grant) — is now
rejected. Rejected means **replaced by `fallbackScope` plus a `console.warn`
naming the value received**, not thrown: on the token path an exception turns a
degraded-but-working session into a hard login failure, and #326 explicitly
left the choice open.

The same predicate is applied to `fallbackScope` itself. It is typed `number`,
which admits `NaN` — `fallbackScope: Number(stored.scope)` against an absent
`stored.scope` is an easy way to pass one, and `??` does not catch it — so an
unvalidated fallback would put the original `NaN` straight back into
`tokens.scope`. An unusable `fallbackScope` is **discarded in favour of `0`**
and warned about, on the absent-`scope` path too, which is otherwise silent.

### Absent and unreadable are not equally sound

The two rejected-into-`fallbackScope` paths are documented separately because
only one of them is safe by construction:

- **Absent** `scope` — RFC 6749 §5.1/§6 make it optional *precisely when the
  grant matches the request*, so the requested scope **is** the granted scope.
  Silent, and correct.
- **Present but unreadable** `scope` — no such guarantee. The server is saying
  something about the grant that this SDK cannot read, and it may be a
  *reduced* grant, so falling back to the requested scope can **over-state**
  what the user actually granted. Every starter renders
  `scopesFromBitmask(tokens.scope)` to the user as "Granted scopes", so the
  over-statement is user-visible. #326 weighed this against `0` and against
  throwing and chose fallback ("more honest than 0"); that stands, and the
  `console.warn` is what keeps the trade visible rather than silent.

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

`patch`, not `minor`: the only surface change is a new optional
`fallbackScope?: number` on the exported `ExchangeCodeOpts` /
`RefreshTokenOpts` (it does appear in the emitted `.d.ts`). Nothing is removed,
nothing existing changes type, no call that resolved before rejects now, and
the package is pre-1.0. Both failure shapes are **latent** rather than live:
Civitai's documented success response carries `scope` for both the
authorization-code and refresh grants. They are reachable against a custom
`baseUrl` (self-hosted or mock auth hub), and become live the day the server is
made RFC-conformant.
