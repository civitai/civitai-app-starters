---
'@civitai/blocks-react': minor
---

`createMockHost` now answers `GET_BUZZ_BALANCE`, so `useBuzzBalance()` resolves against the mock host instead of hanging to the request timeout in local dev / tests. Adds an optional `buzzBalance?: { blue; green; yellow }` mock-host option (defaults to a plausible non-zero wallet) that the new `BUZZ_BALANCE_RESULT` reply carries — mirroring `createLiveHost`'s reply shape exactly. The mock succeeded-snapshot also stamps a synthetic `spentAccountType` (primary-funder) for parity with the real backend. Backward-compatible: absent option → the default wallet.
