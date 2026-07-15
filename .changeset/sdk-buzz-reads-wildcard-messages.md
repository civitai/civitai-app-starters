---
"@civitai/app-sdk": minor
---

Add the buzz self-read + wildcard-pack message pairs to the `blocks` postMessage contract, catching the SDK up to the host bridges shipped in civitai/civitai (#3144 buzz reads, #3133 wildcard). Four new request→reply pairs:

- **`GET_BUZZ_TRANSACTIONS` → `BUZZ_TRANSACTIONS_RESULT`** — the Buzz-dashboard ledger read (`{ params? }` → `{ result: { cursor?, transactions: BlockBuzzTransaction[] } }` | `{ error }` free-text). Scope `buzz:read:self`.
- **`GET_BUZZ_ACCOUNTS` → `BUZZ_ACCOUNTS_RESULT`** — all-pool balances (spendable + creator payout pools; `{ result: { accounts: BlockBuzzAccount[] } }` | `{ error }`). Scope `buzz:read:self`.
- **`GET_DAILY_COMPENSATION` → `DAILY_COMPENSATION_RESULT`** — per-modelVersion generation earnings for the month of `date` (`{ result: { resources: BlockDailyCompensationResource[], hasPublishedResources } }` | `{ error }`). Scope `buzz:read:self`.
- **`GET_WILDCARD_PACK` → `WILDCARD_PACK_RESULT`** — parsed wildcard-pack import by model version (`{ modelVersionId }` → `{ pack: BlockWildcardPack }` | `{ error }`). The error is a **discriminated enum** (`BlockWildcardPackErrorCode`: `not-found` | `forbidden` | `too-large` | `parse-failed` | `busy`), NOT free-text. Token-independent (no block scope).

New shared result types in `blocks/types.ts` (re-exported from `@civitai/app-sdk/blocks`): `BlockBuzzTransaction`, `BlockBuzzAccount`, `BlockDailyCompensationResource`, `BlockWildcardPack`, `BlockWildcardPackErrorCode` — each documented as mirroring its civitai/civitai source (`projectBlockBuzzTransaction`, `getMyBuzzAccounts`, `getDailyCompensationRewardByUser`, `ResolveWildcardPackResult` + `wildcardPackParse`) with a "keep in lockstep" note. Plus the request-param types `BlockBuzzTransactionsParams` / `BlockDailyCompensationParams`.

DATE WIRE NOTE: a transaction's `date` and the page `cursor` are documented as ISO-8601, but the host currently forwards the raw tRPC `result` over structured-clone `postMessage` (it does not `.toISOString()`-map it the way the `SHARED_LIST` bridge does), so they arrive as `Date` instances at runtime. The block-side guard + hook tolerate both.

This completes the SDK message contract for the App Blocks host bridges; the other 10 host bridges were already shipped.
