---
'@civitai/app-sdk': minor
---

Add `fetchBuzzAccount` helper (and `BuzzAccount` / `BuzzAccountType` types) to
read the OAuth-authenticated user's Buzz balance. `/api/v1/me` does not
include balance — it lives behind the `buzz.getUserAccount` tRPC procedure
and requires the `BuzzRead` scope. Exported from `@civitai/app-sdk` and
`@civitai/app-sdk/oauth`.
