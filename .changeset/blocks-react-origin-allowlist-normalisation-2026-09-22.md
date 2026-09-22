---
'@civitai/blocks-react': minor
---

Normalise `allowedParentOrigins` entries, and name the origins actually seen when `BLOCK_INIT` times out (#397).

`OriginMatcher` only `.trim()`ed each entry and then compared it to `event.origin`
by raw string equality. A browser reports an origin with no trailing slash, a
lowercase scheme and host, and default ports elided — so `https://civitai.com/`,
`HTTPS://CIVITAI.COM` and `https://civitai.com:443` each produced an allowlist
that matched nothing, a block that sat blank for ten seconds, and a timeout error
that named neither the origin that arrived nor the allowlist it was checked
against.

Entries are now canonicalised with the URL parser. Accepted as equivalent: a
trailing slash, scheme/host case, an explicit **default** port, and an IDN host
(normalised to the punycode a browser reports). Deliberately still significant: a
**non-default** port, the scheme, a trailing-dot host, and the exact host — a
prefix collision such as `https://civitai.com.evil.com` never matches
`https://civitai.com`. Wildcard entries (`https://*.civitaic.com`) go through the
same canonicalisation, so they obey the same rules instead of a second copy of
them.

🔴 Only ENTRIES are normalised. The candidate handed to `matches()` is still
compared as given, because a real `event.origin` is already canonical and a
`.origin` round-trip on the candidate could only add accepts (`new
URL('https://civitai.com/evil').origin` is `https://civitai.com`).

An entry that is not a bare origin now **throws at construction** instead of being
silently kept as an entry that can never match: no scheme, a path/query/fragment,
credentials, or a scheme whose origin serialises to the literal `"null"` (which is
also what a sandboxed opaque frame reports, so accepting it would allowlist every
opaque frame at once).

The init-timeout error now reports which origins were received and rejected, which
were accepted without yielding a valid `BLOCK_INIT`, or that nothing arrived at
all — bounded to five distinct origins per bucket, and labelled as truncated past
that. A pre-init rejection also warns once per distinct origin.

**Why `minor`, not `patch`:** the permissive half accepts allowlist spellings that
previously matched nothing, which changes observable behaviour for existing
configs; and the strict half turns four classes of malformed entry from a silent
no-op into a constructor throw. Both are behaviour changes rather than fixes to a
crash, so this is not a bugfix-only release even though the permissive direction is
what motivated it.
