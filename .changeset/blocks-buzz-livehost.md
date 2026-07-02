---
'@civitai/blocks-react': minor
---

`createLiveHost` (the `dev:live` real-backend proxy) now answers
`GET_BUZZ_BALANCE` by calling the token-bound `blocks.getMyBuzzBalance` tRPC
mutation (POST — the block JWT rides in the request body, not the URL) and
replying with `BUZZ_BALANCE_RESULT` carrying the viewer's per-pool balance
(`{ blue, green, yellow }`), or an `error` on failure. This closes the last
`dev:live` gap for the per-account Buzz feature: `useBuzzBalance()` and the
account-picker balance panel now work in local real-Buzz testing, matching the
production host and the mock host. No new message types (they already ship in
`@civitai/app-sdk`); `spentAccountType` already flows through the submit/poll
snapshot passthrough unchanged.
