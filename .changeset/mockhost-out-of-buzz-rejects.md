---
'@civitai/blocks-react': minor
---

**Breaking for tests that use the mock host's out-of-Buzz knobs.** `createMockHost` (`@civitai/blocks-react/testing`) now handles a viewer who runs out of Buzz the way production does. `submit()` from `useBuzzWorkflow` REJECTS with `WorkflowSubmitError` code `'exception'`. It no longer resolves a priced `failed` snapshot.

This affects `buzz: { insufficient: true }`, a `buzz.balance` lower than the generation's cost, and `failMode: 'insufficient'` / `'all'` (including `?insufficient=1` and `?fail=insufficient|all` in a harness URL). Each now replies with the host's `failureSnapshot(err)` shape, `{ workflowId: 'failed', status: 'failed', error }`, with no `cost`.

Why: in production the orchestrator refuses the debit with a 403. civitai turns that into a thrown `BAD_REQUEST`, the submit procedure rethrows it, and the iframe host replies with `failureSnapshot(err)`, which carries no `cost`. The old mock shape let a block build a "resolved refusal → top-up" flow that production never reaches, and its tests passed.

Migrating a test: replace `const snap = await submit(body); expect(snap.status).toBe('failed')` with a `catch` that checks `err.code === 'exception'`. The reason is still on `err.snapshot.error`. To decide whether to offer a top-up, compare the viewer's spendable balance (`useBuzzBalance()`, the mock's `buzzBalance` option) with the quoted cost. Do not use the error text.

New: `generation.submitCapRefusal` (`string | true`, or `?capRefusal=1|<text>` in the URL). It makes every submit resolve a priced spend-cap refusal, `{ workflowId: 'failed', status: 'failed', cost: { total }, error }`. That is what production returns when the per-generation budget, a daily, consent, per-app or dev-session cap stops a run. Buying Buzz does not lift any of those caps. It is checked before the out-of-Buzz path, as on the server, and it can be cleared live with `setScenario({ generation: { submitCapRefusal: undefined } })`.

`OPEN_BUZZ_PURCHASE` now also resets `failMode: 'insufficient' | 'all'` to `'none'`. Before, it cleared only `buzz.insufficient`, so with `?fail=insufficient` every retry after a top-up was refused again.

No option was renamed or removed. The knob names describe the viewer's state, not the reply shape, so only their documentation changed.
