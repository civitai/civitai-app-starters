---
"@civitai/app-sdk": minor
"@civitai/blocks-react": minor
---

App Blocks per-account Buzz (Phase 2 — SDK contract + hook). All additive and backward-compatible.

`@civitai/app-sdk/blocks`:
- New `BuzzAccountType` (`'blue' | 'green' | 'yellow'`) — the domain-clamped pools a block may spend from / read (no platform-internal `red`/`purple`).
- Optional `WorkflowBody.accountType` — a *preference* for which pool funds a generation; the host clamps it server-side. Rides through `useBuzzWorkflow().submit(body)` unchanged; omit for today's default funding order.
- Optional `BlockWorkflowSnapshot.spentAccountType` — the primary funder (largest debit), which can be `blue`/free — populated by the host from the backend.
- New `GET_BUZZ_BALANCE` (block→host) / `BUZZ_BALANCE_RESULT` (host→block) message pair to read the viewer's per-pool balance.

`@civitai/blocks-react`:
- New `useBuzzBalance()` hook — reads the viewer's `{ blue, green, yellow }` balance via the host bridge; fetches on mount, exposes `refetch`, `loading`, and `error`.

Requires the civitai host to add a `GET_BUZZ_BALANCE` handler (Phase 3, parity-guard dependency) before the balance path works end-to-end.
