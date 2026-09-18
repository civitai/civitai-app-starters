# `@civitai/blocks-client`

The host bridge for Civitai Apps that are not React: vanilla web components,
Svelte, Vue, Solid, or a plain `<script type="module">`. It speaks the
`postMessage` protocol to the civitai.com host and exposes it as typed,
promise-returning functions grouped by domain.

```bash
pnpm add @civitai/blocks-client @civitai/app-sdk
```

## Usage

```ts
import * as civitai from '@civitai/blocks-client';

const accounts = await civitai.buzz.getAccounts();
const outcome = await civitai.buzz.requestPurchase({ amount: 500 });

for await (const transaction of civitai.buzz.listTransactions({ limit: 50 })) {
  render(transaction);
}
```

`import { buzz } from '@civitai/blocks-client'` pulls in one domain and bundles
to the same size — unused domains are dropped either way.

Every call accepts an options bag as its last argument:

```ts
const controller = new AbortController();
await civitai.buzz.getAccounts({ signal: controller.signal });
```

`signal` cancels the call, and cancelling is all it does — **request timeouts
belong to the host**, which owes a reply to every request it accepts. A caller
who wants a bound passes one (`AbortSignal.timeout(...)`) and gets the
platform's own `TimeoutError` back, unwrapped.

## Orchestration

`runWorkflow()` submits and then follows the workflow to a terminal state,
yielding every snapshot on the way:

```ts
import type { WorkflowTemplate } from '@civitai/orchestration-client';

const workflow: WorkflowTemplate = {
  steps: [{ $type: 'textToImage', input: { prompt } }],
  currencies: [],
};

const finished = await civitai.orchestration.runWorkflow(workflow, { maxBuzz: 100 });
```

`runWorkflow` submits and settles, resolving with the finished workflow however
it finished — a failed run resolves too, and `status` says which. To show
progress instead, submit and watch the id:

```ts
const started = await civitai.orchestration.submitWorkflow(workflow, { maxBuzz: 100 });
for await (const state of civitai.orchestration.watchWorkflow(started.id!)) {
  render(state.status, state.steps);
}
```

Workflows are the orchestrator's own `WorkflowTemplate`, and what comes back is
its own `Workflow` — typed steps, typed outputs, every status it can really be.
This package names no step type and declares no shape of its own, so a step the
orchestrator gains tomorrow works here today.

Its one addition is `maxBuzz`, a hard spend ceiling: spend is the binding
control on this path, and the host caps it again at the block token's budget.
For idempotency set `workflow.externalId` — the orchestrator's own key, which
the host namespaces per app, so a retry collapses onto the first submission
rather than charging twice.

`submitWorkflow()` and `watchWorkflow(workflowId)` are the halves, for when the
id has to outlive the loop — stored, or picked up after a reload.
`getWorkflow(workflowId)` is a single read, `estimateWorkflow()` previews the
cost, and `cancelWorkflow()` stops the work.

Two things behave differently here than elsewhere in this package:

- **A failed run is data, not an exception.** It arrives as a workflow with
  `status: 'failed'`, so a block can show a "top up Buzz" CTA rather than
  tearing down. `BridgeError` still covers a request that was refused.
- **`break` stops watching, it does not cancel.** The Buzz is already spent and
  the orchestrator keeps running. Call `cancelWorkflow(id)` to stop the work.

`watchWorkflow` sets no pace of its own: it asks the host to hold each read
until something changes, then reads again immediately. Four images finishing
within a second surface as they land. It yields only when the workflow actually
changed, so a held read that expires quietly says nothing.

A read that fails for transport reasons is retried three times, waiting 250ms,
1s then 4s — a rolling pod should not end a generation, and an outage should not
be hammered. Any successful read resets that. An `AbortSignal` you abort ends
the loop at once rather than waiting out a backoff.

## Ledgers

`listTransactions()` is an async generator over the viewer's ledger. It fetches the
next page only as you read into it, so `break` — or a `signal` you abort —
stops both the loop and any further requests. Page boundaries and the cursor
never surface; keep one iterator across "load more" clicks rather than passing
a cursor back yourself:

```ts
const ledger = civitai.buzz.listTransactions()[Symbol.asyncIterator]();
const next = async (n: number) => {
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const { value, done } = await ledger.next();
    if (done) break;
    rows.push(value);
  }
  return rows;
};
```

## Live values

A read several components share has a `watch*` form — one round-trip however
many read it, kept current by the host rather than by polling:

```ts
const accounts = civitai.buzz.watchAccounts();

accounts.addEventListener('change', () => render(accounts.value), { signal });
for await (const current of accounts) render(current);
```

It is an `EventTarget`, like `MediaQueryList`: read `value`, listen for
`change`, unsubscribe with an `AbortSignal`. `value` identity is stable between
changes, so it backs `useSyncExternalStore` unchanged. A tip arriving or another
app spending updates every consumer, because the host pushes the new state.

## Errors

Failures are thrown as `BridgeError`, with a `code` to branch on and the
`operation` that failed:

| `code` | Meaning |
|---|---|
| `forbidden` | The block's token lacks the scope. |
| `unauthenticated` | No viewer is signed in. |
| `insufficient` | Not enough Buzz. |
| `rate-limited` | Too many requests. |
| `unavailable` | Upstream is down; retrying may work. |
| `invalid` | The request was malformed. |
| `timeout` | The host gave up waiting on something it called. |
| `malformed` | The host replied without the field the call is defined to return. |

A cancellation you requested is re-thrown as the platform's `AbortError`, not
wrapped — you asked for it, so it is not a bridge failure.

## Parent origins

Messages are accepted only from an allowlisted parent origin. The allowlist is
read from `VITE_` / `NEXT_PUBLIC_` / `PUBLIC_BLOCK_ALLOWED_PARENT_ORIGINS` at
build time, falling back to the canonical civitai.com origins when there is no
build step. To override at runtime, call `getTransport({ allowedParentOrigins })`
before any domain call; options apply on first use only.

Wildcards take the form `https://*.example.com` and match subdomains on a dot
boundary. A port never matches a wildcard — list a ported parent as an exact
entry.

## The API surface

[`api/public-api.md`](api/public-api.md) is the whole public surface in one
file, generated from the compiler's own declarations by `npm run api`. CI runs
`npm run api:check`, so widening or narrowing the surface shows up as a diff in
review rather than as a surprise in a release.

## Subpaths

| Import | Contains |
|---|---|
| `@civitai/blocks-client` | domain namespaces (`buzz`), `BridgeError`, `getTransport` |
| `@civitai/blocks-client/testing` | `createFakeTransport`, `__resetTransport` |

`createFakeTransport()` is an in-memory transport for testing a block against a
scripted host: pass it as `{ transport }` to any call, then answer by request
type with `reply(type, result)` or `fail(type, { code, message })`, `stall(type)`
to answer nothing, and `push(type, payload)` for an unsolicited message.

## License

MIT
