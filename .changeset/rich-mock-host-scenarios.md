---
'@civitai/blocks-react': minor
---

`createMockHost`: rich, configurable scenario controls for local-dev DX (Layer 1).

The mock host now lets a block dev exercise the full money / error / storage UX
locally — synthetically, with no real Buzz and no network. All additions are
optional and backward-compatible (existing `createMockHost({ viewer })` calls and
the legacy `cost` / `failMode` / `buzzBudget` / `pollsUntilDone` knobs are
unchanged).

- **`generation`** scenario: `costPerGen` (number or `(body) => number`),
  `latencyMs` (number or `[min, max]`), `failRate` (0..1), `failNext` (fail the
  next N submits), and `image` / `images` (custom result URLs). Simulate real
  costs, slow gens, and failures.
- **`buzz`** scenario: `balance` (a simulated spendable wallet — a gen that would
  exceed it returns an insufficient-Buzz outcome; successes debit it; a top-up
  refills it) and `insufficient` (force the insufficient path). Exercise the
  top-up / insufficient UX.
- **`storage`** scenario + a working in-memory KV backend: the mock host now
  answers the full `APP_STORAGE_*` protocol (`get` / `set` / `delete` / `list`
  with cursor pagination / `getQuota`), with `seed`, `quotaBytes`,
  `valueCapBytes`, and `failNext` knobs. W4 KV apps (e.g. Prompt Library) can
  test load / quota / error states against `createMockHost` directly instead of
  hand-injecting a fake store.
- **Runtime handle**: `createMockHost(...)` now returns `setScenario(patch)` plus
  a `buzz` handle (`getBalance()` / `setBalance(n)`) so a harness UI can flip
  scenarios mid-session.
- `readMockHostUrlOptions` maps new query params onto the scenarios:
  `?balance`, `?insufficient`, `?latency` (`2000` or `500-2000`), `?costPerGen`,
  `?failNext`, `?failRate`, `?seed=<json>`.

The mock host remains pure + synthetic (a test asserts the full protocol never
calls `fetch`).
