---
'@civitai/app-sdk': patch
---

cookies: memoize the scrypt key and reject keyless-rejectable cookies before the KDF

`scryptSync` is a deliberately expensive KDF — Node's defaults (N=16384, r=8)
cost roughly 16MB and tens of milliseconds per call. `sealCookie` and
`unsealCookie` each ran it on **every** call, for a constant salt and a
long-lived secret whose derived key never changes.

Two changes:

- **Memoized.** `getKey` now caches the derived key in a `Map` keyed on the
  secret, so a server with one `SESSION_SECRET` derives once per process
  instead of once per request. Keying on the secret is load-bearing: a single
  global slot would hand secret B the key derived for secret A and silently
  make `unsealCookie` accept a cookie sealed under a different secret.

- **Reordered.** `unsealCookie` now rejects a zero-byte ciphertext before
  touching `getKey`. `Buffer.from(x, 'hex')` decodes leniently — it stops at
  the first non-hex character — so a cookie of the shape
  `<24 hex chars>:<32 hex chars>:zz` passed every existing format check and
  bought an scrypt run. The sealed value comes from a cookie, i.e. from an
  unauthenticated client, so that was a free CPU/memory amplification lever.
  A zero-byte ciphertext was never unsealable anyway: `sealCookie('')` emits an
  empty ciphertext field, which the existing `!ctHex` guard already rejects.

No API change. Behaviour for every well-formed cookie is identical.
