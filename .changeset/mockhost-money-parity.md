---
'@civitai/blocks-react': minor
---

`createMockHost` gains per-account Buzz money-path parity so the scaffold no longer needs to patch around three mock-host gaps:

- **Balance-read errors** — new `buzzBalanceError?: boolean | string | Error` option forces `GET_BUZZ_BALANCE` to FAIL (replying with the exact `{ requestId, error }` shape `createLiveHost` uses, no `balance`) so a block's balance-read error UI (`useBuzzBalance().error`) is exercisable locally. `true` → a default message, a string → that message, an `Error` → its `.message`.
- **Disallowed-account rejection** — new `disallowedAccountTypes?: BuzzAccountType[]` option makes a `SUBMIT_WORKFLOW` whose `body.accountType` names a disallowed pool resolve to a `failed` snapshot carrying the real backend's content-rating message (exported as `disallowedAccountError(accountType)`). Checked BEFORE the insufficient-Buzz / generic-failure paths, mirroring the real backend rejecting at the currency-resolution boundary before any spend.
- **Pick-aware `spentAccountType`** — the succeeded snapshot now stamps `spentAccountType` from the SUBMITTED `body.accountType` (the picked pool) instead of always the largest wallet pool, falling back to the largest-pool heuristic only when no `accountType` was submitted. FIDELITY CAVEAT: the picked pool equals the real backend's primary realized debit only in the common FULL-COVERAGE case. The mock's single-total-balance model cannot simulate split/fallback debits, so `spentAccountType` may differ from the real backend when a gen splits across pools; the mock also always stamps on success and cannot model the no-debit / field-omitted case. Treat it as an approximation, not a guarantee.

Both new options are live-tunable via `setScenario()`. Backward-compatible: absent options preserve existing behavior; only the pick-aware `spentAccountType` change alters a default (and only when the block actually submits an `accountType`).
