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

- `code: 'failed'` — the estimate errored server-side.
- `code: 'no-cost'` — an otherwise-successful snapshot whose `cost` the server
  omitted because the whatIf reply had no numeric total.

The server's reason is on **`err.snapshot.error`** — that is the diagnostic read,
and recovering it is the point of the fix. `err.message` is deliberately generic
and names the code instead.

A cost of `0` is a real price (a whatif cache hit prices at 0) and still
resolves; only a non-numeric `cost.total` rejects.

## Migration

Callers that already wrap `estimate()` in `try/catch` — the shape the hook's
docs and every starter use — need no change. Others must add one:

```ts
try {
  await estimate(body);
} catch (err) {
  if (!(err instanceof WorkflowEstimateError)) throw err;
  logForDebugging(err.snapshot.error); // the server's reason
  showError('This configuration cannot be priced right now.');
}
```

Three things to know:

- **Moderator review preview now rejects too.** The host answers every workflow
  request there with `'not available in review preview'`, so a block without a
  `catch` turns a reviewer's first click into an unhandled rejection.
- **The raw server string is on `err.snapshot.error`, never on `err.message`.**
  Exposure to the block is unchanged (`snapshot.error` was always on the wire),
  but `message` is what an uncaught rejection prints and what a third-party
  block's error reporter ships upstream — and raw upstream text (database
  constraint names among it) can reach **`snapshot.error`**. So `message` is a
  constant template carrying only the `code`, with no server text in it at all,
  while **`snapshot.error`** holds the server's words and is documented as
  server-authored and unsanitised. Read `err.snapshot.error` to diagnose; print
  `err.message`; branch on `err.code`.
- **`result` is updated before the rejection**, so a failed estimate can never
  leave a previous config's price in `result` for a Confirm gate to read.

## Not changed

`submit()` still resolves failure-shaped snapshots. It has the same two
producers (budget rejections, which carry a `cost` and are a documented outcome
the block recovers from; and caught server exceptions via the same
`failureSnapshot`, which do not) — so the defect is live there too, discriminated
by `cost` presence rather than `status`. Fixing it is a separate change with its
own blast radius on the top-up recovery path.
