---
'@civitai/blocks-react': minor
---

`useBuzzWorkflow().estimate()` now REJECTS when the host's reply carries no
usable price, instead of resolving a snapshot with no `cost` (civitai/civitai#4159).
Adds the exported `WorkflowEstimateError` and a `generation.failEstimate` mock-host
knob.

**`minor`, and deliberately so.** This is a behaviour change, not purely additive
— but the package is pre-1.0, where this repo's practiced convention is that
breaking changes ride a `minor` (see the `0.4x` line's earlier entries). It also
genuinely *adds* API (`WorkflowEstimateError`, `failEstimate`). Calling it
`patch` would be wrong; calling it `major` would break that convention.

## Why

A server-side `blocks.estimateWorkflow` error cannot reach the block as a
rejection — the reply crosses `postMessage` — so the host posts a well-formed
`ESTIMATE_RESULT` carrying `{ workflowId: 'failed', status: 'failed', error }`
with no `cost`. `estimate()` used to resolve that and move the hook to
`'confirming'`, so a block that correctly gates Confirm on
`typeof snapshot.cost?.total === 'number'` rendered a confirm dialog it could
never confirm ("Cost unavailable"), while the server's explanation — already
present on `snapshot.error` — was discarded.

There are **two** producers of that observable, and the guard covers both:

- `code: 'failed'` — the estimate errored server-side; `message` is the server's
  own reason.
- `code: 'no-cost'` — an otherwise-successful snapshot whose `cost` the server
  omitted because the whatIf reply had no numeric total.

A cost of `0` is a real price (a whatif cache hit prices at 0) and still
resolves; only a non-numeric `cost.total` rejects.

## Migration

Callers that already wrap `estimate()` in `try/catch` — the shape the hook's
docs and every starter use — need no change. Others must add one:

```ts
try {
  await estimate(body);
} catch (err) {
  if (err instanceof WorkflowEstimateError) showError(err.message);
  else throw err;
}
```

Three things to know:

- **Moderator review preview now rejects too.** The host answers every workflow
  request there with `'not available in review preview'`, so a block without a
  `catch` turns a reviewer's first click into an unhandled rejection.
- **`err.message` is server-authored and unsanitised.** It is `snapshot.error`
  promoted, which the host already sends into the iframe (so this changes
  disposition, not exposure), but an uncaught rejection prints it and an error
  reporter will ship it. Branch on `err.code`, not the string.
- **`result` is updated before the rejection**, so a failed estimate can never
  leave a previous config's price in `result` for a Confirm gate to read.

## Not changed

`submit()` still resolves failure-shaped snapshots. It has the same two
producers (budget rejections, which carry a `cost` and are a documented outcome
the block recovers from; and caught server exceptions via the same
`failureSnapshot`, which do not) — so the defect is live there too, discriminated
by `cost` presence rather than `status`. Fixing it is a separate change with its
own blast radius on the top-up recovery path.
