---
"@civitai/blocks-react": minor
---

Add React hooks for the buzz self-read + wildcard-pack host bridges, completing the block-side surface for the message pairs added to `@civitai/app-sdk` (host bridges shipped in civitai/civitai #3144 + #3133):

- **`useBuzzTransactions(params?)`** — the viewer's Buzz-transaction ledger page (`GET_BUZZ_TRANSACTIONS`). Rehydrates each row's `date` (and normalizes `cursor`) — tolerating both an ISO string and a `Date` instance on the wire. `error` surfaces the host's free-text message.
- **`useBuzzAccounts()`** — the viewer's all-pool balances (`GET_BUZZ_ACCOUNTS`).
- **`useDailyCompensation({ date, source?, accountType? })`** — per-modelVersion generation compensation for the month of `date` (`GET_DAILY_COMPENSATION`), exposing `resources` + `hasPublishedResources`.
- **`useWildcardPack(modelVersionId)`** — import a wildcard pack's parsed prompt lists (`GET_WILDCARD_PACK`). On failure `error` is a **`WildcardPackError`** whose `.code` is the discriminated reason (`not-found` | `forbidden` | `too-large` | `parse-failed` | `busy`), so a block can branch (e.g. retry on `busy`). A non-positive `modelVersionId` is a no-op.

All four follow the `useBuzzBalance` model (fetch on mount, `refetch`, timeout-not-hang, unmount-safe). Each hook + its result types are exported from the package root, plus the SDK result types (`BlockBuzzTransaction`, `BlockBuzzAccount`, `BlockDailyCompensationResource`, `BlockWildcardPack`, `BlockWildcardPackErrorCode`) are re-exported.

Trust-boundary validators (`isValidBuzzTransactionsResult` / `isValidBuzzAccountsResult` / `isValidDailyCompensationResult` / `isValidWildcardPackResult`) are wired into `payloadValidatorFor`; the wildcard guard enforces the CLOSED error enum (a rogue free-text error is dropped). The `createMockHost` + `createLiveHost` dev harnesses answer all four bridges (`createLiveHost` forwards the three buzz reads to their block-token tRPC mutations; wildcard import is dev:mock-only — it needs the session-authed in-tab zip parse — so `createLiveHost` replies with an honest `parse-failed`).

Bumps the `@civitai/app-sdk` peer dependency to `^0.21.0` (the new message types), matching the established lockstep pattern.
