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

## The viewer

`buzz` refuses with `unauthenticated` when nobody is signed in and `forbidden`
when the block's token lacks a scope. `viewer` is how a block answers both:

```ts
try {
  const me = await civitai.viewer.getViewer();
} catch (err) {
  if (err.code === 'unauthenticated') civitai.viewer.requestSignIn({ returnUrl: '/gallery' });
}
```

`getViewer()` is the audited self-read — `id`, `username`, `status`,
`buzzBudget` — and needs `user:read:self`. It is not the same as the snapshot's
`viewer`, which every block receives unconditionally at load and which only
tells you whether *someone* is signed in.

`requestSignIn()` returns nothing to await: the host runs its login flow and the
block re-initialises as an authenticated viewer.

`requestConsent(scopes)` does have something to await:

```ts
await civitai.viewer.requestConsent(['buzz:read:self']);
const accounts = await civitai.buzz.getAccounts();
```

It resolves once the re-minted token actually carries the scopes, so the retry
belongs after the `await` rather than in a listener. Scopes already held resolve
without asking anyone. It rejects `forbidden` when the host says the scopes were
withheld at mint and no dialog here can add them — which is a real state, and
distinct from a viewer who simply hasn't confirmed yet. A viewer who neither
confirms nor dismisses settles nothing, so pass a `signal` to bound the wait.

## App storage

`storage` is a per-viewer, per-install key/value store the host keeps server-side
— not a wrapper over `localStorage`:

```ts
await civitai.storage.set('draft/42', { prompt, seed });
const draft = await civitai.storage.get<Draft>('draft/42');   // null when unset

for await (const { key, updatedAt } of civitai.storage.list({ prefix: 'draft/' })) {
  render(key, updatedAt);
}
```

It is deliberately not a `localStorage` fallback, because the two are not
interchangeable. In the iframe `localStorage` is usually not *available*: the
host grants `allow-same-origin` only to verified and internal apps, so for
everyone else the document has an opaque origin and merely reading the property
throws. Where it does work it is one browser on one device. This store follows
the viewer, and a value written here is read back after they switch machines.

The trade is that it needs a signed-in viewer — an anonymous one reads `null`
from every key — and every call is a round-trip, so it is for state worth
keeping, not for which panel is open.

Values are JSON, capped at 64KB each, with 2MB and a million rows per viewer per
app. `getQuota()` reports usage against those ceilings; exceeding either fails as
`insufficient`. `remove(key)` answers whether a row actually went. `list()` is an
async generator that pages as you read it, ascending by key.

Keys are scoped to the **install**, not the app: the same app placed on a model
page and as a full page does not share a store.

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
| `insufficient` | Not enough of a metered resource — Buzz, or storage quota. |
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
| `@civitai/blocks-client` | domain namespaces (`buzz`, `orchestration`, `storage`, `viewer`), `BridgeError`, `getTransport` |
| `@civitai/blocks-client/testing` | `createFakeTransport`, `__resetTransport` |

`createFakeTransport()` is an in-memory `BlockTransport` for testing a block
against a scripted host — the interface with the boilerplate pre-written, so a
hand-rolled object literal remains a perfectly good stub where that reads better.
Pass it as `{ transport }` to any call, then script it by request type:

```ts
const t = createFakeTransport();
t.handle('APP_STORAGE_GET', ({ key }) => ({ value: store.get(key) ?? null }));
```

`handle(type, fn)` stands until replaced and answers from the request, so a test
states a rule rather than counting calls; throw from it to fail the call.
`reply(type, result)` and `fail(type, { code, message })` answer one call and are
used ahead of a standing handler, which is how a sequence — page one then page
two — or a single departure from the rule is written. `stall(type)` answers
nothing, for abort and deadline tests, and `push(type, payload)` delivers an
unsolicited host message.

## License

MIT
