---
'@civitai/app-sdk': minor
---

oauth: parse the token response's `scope` instead of coercing it with `Number()`

`shapeTokens` coerced `OAuthTokenResponse.scope` with `Number()`. Civitai's own
authorization server sends a decimal bitmask in a JSON string (`"scope":
"114689"`), which coerces fine — but [RFC 6749
§5.1](https://datatracker.ietf.org/doc/html/rfc6749#section-5.1) defines `scope`
as a *space-delimited list*, and `Number('UserRead BuzzRead')` is `NaN`. `NaN &
scope` is `0`, so `hasScope()` returned `false` for every scope and
`scopesFromBitmask()` returned `[]` — a user who had just completed consent was
told they granted nothing, with no error anywhere. Fixes #326.

`exchangeCode` / `refreshToken` now route `scope` through a new exported
`parseScope`, which accepts every shape the field can legitimately take — a JSON
number, a decimal string, space-delimited scope names, space-delimited decimal
values, and mixtures — and **never** returns `NaN` or silently degrades to `0`.

### Behaviour change, observable to existing consumers

A `scope` that cannot be parsed (an unknown scope name, a negative or fractional
value, a non-string/non-number type) now **throws** the new `OAuthScopeError`,
naming the value received. Previously it resolved to `NaN` and flowed onward
silently. On an auth path a loud failure beats handing the caller a bitmask that
quietly claims no permissions — but if you have been relying on `exchangeCode`
resolving for such a response, it will now reject. `OAuthScopeError` extends
`OAuthError`, so existing `catch (e) { if (e instanceof OAuthError) … }` blocks
still catch it.

Callers targeting Civitai's auth server are unaffected: the documented
`"114689"` form parsed correctly before and parses correctly now, and is pinned
by tests.

### `fallbackScope` is now wired up

`shapeTokens` has always taken a `fallbackScope` parameter that neither call
site passed — it was dead since the initial commit. Rather than delete it, it is
now reachable as an optional `fallbackScope` on `ExchangeCodeOpts` and
`RefreshTokenOpts`. RFC 6749 §5.1/§6 let a server omit `scope` when the grant
matches what was requested, and without a fallback that omission resolved to
`0`. This matters most on refresh: callers that replace the whole token blob
(`{ ...session, tokens: fresh }` — all four starters do) would persist that `0`
and lock the user out of their own features. Pass `fallbackScope: tokens.scope`
on refresh and `fallbackScope: REQUESTED_SCOPES` on exchange. The default with
no fallback is unchanged (`0`).

`OAuthError.name` is now typed `string` rather than the literal `'OAuthError'`
so subclasses can narrow it; the runtime value is unchanged.
