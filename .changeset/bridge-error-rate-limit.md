---
'@civitai/sdk': minor
---

**A bridge call refused under a rate limit rejects with its `rateLimit` metadata.** This is additive.

- `BridgeError` gains an optional `rateLimit` (`RateLimitMeta`): `retryAfterSeconds`, `retryAt`, `id` (the refusing limit, e.g. `apps.publish`), `kind` (`'product'` or `'abuse'`), and, for a limit that publishes them, `limit`, `used`, `remaining`, `windowSeconds` and `resetAt`. Only those fields are copied. If `retryAfterSeconds` or `retryAt` is malformed, no `rateLimit` is set.
- A refusal that carries the metadata has the code `rate-limited`, whatever its message says. A refusal without it is classified from its message, as before.
- The host sends the metadata on every bridge error reply from civitai/civitai#10367 on. On an older host, `rateLimit` is absent (not even an own property), and nothing else changes.
- `kind` is informational: an `abuse` limit can carry counts too (the App Platform's tip and goods daily caps do), so branch on whether the counts are present, not on `kind`.
- New exported types: `RateLimitMeta` and `BridgeErrorOptions`. `@civitai/sdk/testing`'s `fail(type, { code, message, rateLimit })` accepts the metadata, so an app can test how it handles the refusal.
