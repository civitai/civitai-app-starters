# `@civitai/blocks-react`

React hooks and iframe transport for [Civitai Apps](https://github.com/civitai/civitai-app-starters/blob/main/docs/build-your-first-app-block.md).

Pairs with [`@civitai/app-sdk`](https://www.npmjs.com/package/@civitai/app-sdk)'s
`/blocks` subpath, which carries the framework-agnostic manifest, scope, and
`postMessage` contract. This package adds the transport that actually moves bytes
and the React hooks block authors call.

> **Starting a new block app? Start from
> [`@civitai/sdk`](https://www.npmjs.com/package/@civitai/sdk).** The three
> packages are layers over one host contract, and all three are supported:
>
> - **`@civitai/sdk`** is the client new block apps start on: `initialize()`,
>   then `app.workflows`, `app.storage`, `app.site` and `app.host`.
> - **`@civitai/app-sdk/blocks`** is the contract itself: the workflow body
>   types, the manifest types and the host message shapes.
> - **`@civitai/blocks-react`** (this package) is the React hook binding over
>   that same contract.

## Install

```bash
pnpm add @civitai/blocks-react @civitai/app-sdk react
```

`react` and `@civitai/app-sdk` are peer dependencies — bring them yourself so
your block app and the SDK share a single React tree.

## Quick start

> **Building a UI?** The `/ui` subexport ships a drop-in, Civitai-themed
> component pack (Button, TextInput, Textarea, Card, Stack, Group, Alert, Loader,
> Badge, Modal + `injectBlocksStyles`) — zero CSS setup, auto-themed via your
> block's `data-theme`. See [The `/ui` subexport](#the-ui-subexport).

```tsx
import { useRef } from 'react';
import { useBlockContext, useBlockResize, useBuzzWorkflow } from '@civitai/blocks-react';
import { Button } from '@civitai/blocks-react/ui';
import { isModelSlotContext, isSignedIn } from '@civitai/app-sdk/blocks';

export function App() {
  const { ready, context, viewer, theme } = useBlockContext();
  const { submit, status, result } = useBuzzWorkflow();
  const rootRef = useRef<HTMLDivElement>(null);
  useBlockResize(rootRef);                 // host fits the iframe to content

  // No ref on the pre-init skeleton — useBlockResize observes the real root
  // whenever it mounts, including on a later render.
  if (!ready) return <div>Loading…</div>;
  // `context` is a union keyed on slotId — narrow with the guard, not a cast.
  if (!isModelSlotContext(context)) return <div ref={rootRef}>Wrong slot.</div>;

  return (
    // GOTCHA #60: set data-theme on YOUR OWN root — the host can't reach into
    // the iframe to set it. Without this any [data-theme="dark"] CSS is dormant.
    <div ref={rootRef} data-theme={theme}>
      {/* Sign-in gate: call `isSignedIn`, never an identity read. */}
      <p>Block for model {context.modelName} ({isSignedIn(viewer) ? 'signed in' : 'anon'})</p>
      {/* `/ui` Button — themed by the data-theme above; `loading` disables + shows a spinner */}
      <Button
        loading={status === 'submitting' || status === 'polling'}
        onClick={() =>
          submit({
            kind: 'textToImage',
            modelId: context.modelId,
            modelVersionId: context.modelVersionId,
            params: { prompt: 'a cat' },
          })
        }
      >
        Generate
      </Button>
      {status === 'done' && result?.imageUrls?.map((u) => <img key={u} src={u} />)}
    </div>
  );
}
```

> `submit` takes a full `WorkflowBody` (`{ kind, modelId, modelVersionId, params }`),
> **not** `{ prompt }`. Both ids come from `useBlockContext().context` narrowed to
> `ModelSlotContext`.

## Web storage works, even sandboxed

Block iframes have no `allow-same-origin`, so the document runs at an **opaque
origin** where even *reading* `localStorage` throws a `SecurityError` — most
often from a third-party dependency you can't guard from the outside, which then
reports it as something else entirely.

Importing `@civitai/blocks-react` installs the SDK's in-memory `Storage`
fallback over `localStorage` / `sessionStorage` when — and only when — a
round-trip probe shows they're broken. Working storage is left untouched, and
nothing is fabricated in Node/SSR. You don't have to do anything.

The one case that needs your help: a dependency that reads storage **while its
module evaluates**, imported ahead of this package. Import statements are
hoisted above every statement, so put the shim's side-effect import first in
your entry file:

```ts
import '@civitai/app-sdk/safe-storage';
```

Full rules + the `installSafeStorage()` / `createMemoryStorage()` API:
[`@civitai/app-sdk` README → Web storage in a block](https://github.com/civitai/civitai-app-starters/tree/main/packages/civitai-app-sdk#web-storage-in-a-block-civitaiapp-sdksafe-storage).
Remember the fallback is session-scoped — use [`useAppStorage()`](#useappstorage)
for anything durable.

## The hooks

All hooks build on a singleton transport, so they're safe to call from any
component without prop-drilling. Every hook with a section below gets one
minimal snippet — but the sections are **not** the full export surface, so treat
the package's type declarations (IDE hover / autocomplete on the package root) as
the authoritative list of what exists.

Exported from the package root with no snippet in this section, as of this
writing: `useGatedImages()`, `usePublishGenerationOutputs()`,
`useTip()` and `useTipAllowance()` — for the tip pair, the
[`TipButton`](#the-ui-subexport) row documents the intended usage and the
allowance-sharing rule. `useDirectLoad()` is covered under
[Direct-load fallback](#direct-load-fallback-open-on-civitai) rather than here.
**`dev:live` refuses `usePublishGenerationOutputs()`**: publishing requires the
viewer's signed-in civitai.com session, which the local harness does not have, so
`publish()` rejects with a message saying so. Test publishing against the mock
host — `createMockHost` or `Harness` from `@civitai/blocks-react/testing`, with
the `publishImageIds` / `publishError` options.

### Required at mount: the host handshake

The SDK must be **connected at mount**. When the transport is created it posts
`BLOCK_HELLO` to the host, and it answers the host's first valid `BLOCK_INIT`
with `BLOCK_READY`. The host waits **10 seconds** for that answer; without it,
the viewer sees "This app didn't load in time", the host retries twice, and then
gives up. `"bootSkeleton": true` only removes the host's loading cover — it does
**not** extend or lift that deadline.

You do not have to do anything for this: **every hook exported from the package
root connects the transport when its component mounts**, so a block that calls
any one of them — even only `useBuzzWorkflow()`, whose requests all happen in
callbacks — answers the host before anyone clicks. (In earlier releases, request-only
hooks connected lazily on their first call, so a block whose only SDK use was
such a hook rendered fine and was then timed out by the host.)

What this means for you:

- A block that renders but uses **no** hook from this package never connects.
  Call `useBlockContext()` at your root (you will want its `ready` gate anyway).
- A dev harness that injects options with `getTransport({ allowedParentOrigins })`
  must still do so **before** the first component that uses a hook mounts — only
  the first call's options are honoured.
- If no parent allowlist is configured, the mount-time connect logs one
  `console.error` and the block keeps rendering; the first bridge call then
  throws the same configuration error it always did.

### `useBlockContext()`

The primary hook. Returns everything the host delivered in `BLOCK_INIT` plus a
`ready` gate — fields are sentinel-empty before init, so gate your UI on `ready`.

```tsx
const { ready, context, viewer, theme, settings, blockId, blockInstanceId, appId, token, renderMode } =
  useBlockContext();
```

- `context` — `BlockContext` (`{ slotId, … }`); narrow to `ModelSlotContext` for
  model-page slots. LIVE on a page slot: `context.subPath` starts at the
  `BLOCK_INIT` value and then tracks the host's `ROUTE_CHANGED` push on every
  navigation — see [`useCivitaiRoute()`](#usecivitairoute).
- `viewer` — `ViewerInfo | null` (`null` = anonymous). **Gate sign-in with
  `isSignedIn(viewer)`** (from `@civitai/app-sdk/blocks`), never on
  `viewer.id`/`viewer.username` (both `@deprecated`). Don't open-code the gate:
  the SDK owns which spelling is correct — `signedIn` is optional on the wire
  and is the one viewer field the init validator deliberately does not reject
  when malformed, so `isSignedIn` answers from presence instead. Hover it for
  the full reasoning. Need the identity itself? Use
  [`useViewer()`](#useviewer) — scope-gated and audited per call.
- `theme` — `'light' | 'dark'`. **Set `data-theme={theme}` on your root** (gotcha #60).
  LIVE: it starts at the `BLOCK_INIT` value and then tracks the host's
  `THEME_CHANGE` push when the viewer toggles dark mode mid-session — see
  [`useBlockTheme()`](#useblocktheme).
- `settings` — `{ publisherSettings, userSettings }`.

### `useBlockTheme()`

The host's CURRENT site theme, and nothing else. Same value as
`useBlockContext().theme` — reach for this when theme is all you need.

```tsx
function ThemedRoot() {
  const theme = useBlockTheme(); // 'light' | 'dark'
  return <div data-theme={theme}>…</div>;
}
```

The viewer can toggle light/dark **while your block is mounted**. The host pushes
a `THEME_CHANGE` message and this hook re-renders. You get that for free as long
as you *read* the theme on every render — a block that copies it into state once
at mount, or writes `data-theme` imperatively in a mount-only effect, will stay
stuck on the old theme.

Against a host that predates `THEME_CHANGE` the value simply never moves (the
old behaviour). Nothing awaits the message, so there is no hang either way.

Exercise it locally: `createMockHost(...).setTheme('light')` (and the same on the
`dev:live` host) pushes the real message.

### `useBlockResize(ref)`

Attach to your root element. Observes its height and posts `RESIZE_IFRAME` so the
host sizes the iframe to fit. No-op on the inline transport (host DOM reflows
naturally).

```tsx
const rootRef = useRef<HTMLDivElement>(null);
useBlockResize(rootRef);
```

**The element may mount on a later render, and that is the normal case** — a
block renders a skeleton until `BLOCK_INIT` lands. The hook keys on the observed
*element*, so you do **not** need to pin the same `ref` to every branch of a
loading/ready conditional to keep the host resizing. Put it on the root you
actually want measured, in whichever branch renders it.

> Also set `iframe.minHeight` in your manifest to the block's *real* rendered
> height — a too-small minHeight makes the iframe seed short and grow-jump on
> `BLOCK_READY` (CLS). Measure it in the dev harness (gotcha #53).

### `useBlockBreakpoint(ref?)`

Reports the block's **own** width tier, so you can branch on "am I narrow?"
without hand-rolling a `ResizeObserver` or hard-coding pixel numbers.

```tsx
const bp = useBlockBreakpoint();
<div style={{ display: 'flex', flexDirection: bp.below('sm') ? 'column' : 'row' }}>
  {bp.atLeast('md') && <aside>…</aside>}
</div>
```

- `tier` — `'base' | 'xs' | 'sm' | 'md' | 'lg' | 'xl'` on civitai's **px** scale
  (480 / 768 / 1024 / 1184 / 1440 — *not* Mantine's em scale, which agrees only
  on `sm`). Tailwind semantics: a tier applies at its breakpoint and above.
  `'base'` is narrower than `xs`, where both a 360px phone and the desktop
  `model.sidebar_top` slot land.
- `atLeast(key)` / `below(key)` — the comparators you actually want at a call site.
- `measured` — `false` until the first measurement lands. An unmeasured width
  resolves to `'base'`, so gate a *structural* narrow branch on
  `measured && below('sm')` if a one-frame swap would be jarring.

> **Container query, not a media query.** It observes an element — by default
> `document.documentElement`, which inside the block's sandbox iframe *is* the
> slot the host gave you. Slot width is not monotonic in viewport width (the
> `model.sidebar_top` slot is ~360px at a 360px viewport and only ~430px at a
> 1440px one), so a `matchMedia` inside the frame answers the wrong question.
> Pass a `ref` to measure a nested container instead.

> **No re-render storm.** A `ResizeObserver` fires on every pixel; this hook
> stores the resolved *tier* and returns a referentially stable object while the
> tier is unchanged, so a 200px drag inside one tier re-renders zero times. That
> is also why the raw width is not returned — it would either cost a render per
> pixel or be stale.

### `useBlockToken()`

Current block-scoped JWT, auto-refreshing ~2 min before expiry. Returns the token
fields plus a `refresh()` for the 401-retry path, which **resolves with the new
token**.

```tsx
const { raw, scopes, expiresAt, buzzBudget, refresh } = useBlockToken();

let res = await fetch(url, { headers: { Authorization: `Bearer ${raw}` } });
if (res.status === 401) {
  const fresh = await refresh();   // resolves WITH the new token
  res = await fetch(url, { headers: { Authorization: `Bearer ${fresh.raw}` } });
}
```

> **Retry with the resolved token, not the `raw` you destructured.** That `raw` is
> a `const` from the render closure that ran *before* the refresh — awaiting
> `refresh()` re-renders the component but cannot reassign the binding your
> in-flight callback is already holding. A retry that re-reads the outer `raw`
> re-sends the stale JWT and 401s for exactly the reason the first call did.

### `useHostOrigin()`

The validated host origin to direct-fetch the App Blocks HTTP API against —
`undefined` until init. Use it as the base URL when you need to bypass the host
bridge, always paired with the bearer token from `useBlockToken()`.

```tsx
const host = useHostOrigin();          // e.g. "https://civitai.com" (undefined until BLOCK_INIT)
const { raw } = useBlockToken();
// Once `host` is set, fetch the API on that validated origin with the block token:
if (host) {
  const res = await fetch(`${host}/api/v1/blocks/me`, {
    headers: { authorization: `Bearer ${raw}` },
  });
}
```

> **Security:** this is ONLY ever the origin that passed the SDK's origin
> allowlist (the same gate `BLOCK_INIT` passes) — never `document.referrer` or
> `window.location` of the parent. The block token is a money-scoped bearer
> credential, so always send it to *this* origin. Never derive the API host
> from a spoofable browser signal.

### `useBlockSettings()`

Shorthand for `useBlockContext().settings`. Read-only from the iframe — there is
no general "set settings" bridge message. Writing them is platform-side, in the
settings panel reached from the **Manage** control on an installed app. The one
setting a block can write itself is the viewer's checkpoint, via the
`SET_USER_CHECKPOINT` message (see `useCheckpointPicker`).

```tsx
const { publisherSettings, userSettings } = useBlockSettings();
```

### `useBuzzWorkflow()`

The generation flow: `estimate` → `submit` → `poll`, host-mediated. Returns
`{ estimate, submit, poll, status, result, error }`.

```tsx
import type { WorkflowBody } from '@civitai/app-sdk/blocks';

const { estimate, submit, poll, status, result } = useBuzzWorkflow();
declare const modelId: number, modelVersionId: number, userPrompt: string;

const body: WorkflowBody = {
  kind: 'textToImage',
  modelId,
  modelVersionId,
  params: { prompt: userPrompt },
};
// The viewer-facing copy is a string YOUR APP owns, chosen by `err.code`.
// Nothing on the error may be rendered: `err.message` is developer-facing and
// its wording is not a contract; `err.snapshot.error` is server-authored and
// unsanitised.
const estimateFailureMessage = (err: WorkflowEstimateError) =>
  err.code === 'no-cost'
    ? 'We could not get a price for this configuration. Try adjusting it.'
    : 'Pricing is unavailable right now. Please try again shortly.';

// 🔴 estimate() REJECTS when the reply carries no usable price. ALWAYS catch it.
let priced = false;
try {
  await estimate(body);          // status 'estimating' → 'confirming' (cost in result.cost.total)
  priced = true;
} catch (err) {
  if (!(err instanceof WorkflowEstimateError)) throw err;
  // status is now 'error'. Log both for the developer; render neither.
  logForDebugging(err.message, err.snapshot.error);
  showError(estimateFailureMessage(err));
}
if (priced) {
  // 🔴 submit() REJECTS when the reply carries no usable workflow outcome. A
  // priced refusal is different — it RESOLVES.
  try {
    const snap = await submit(body); // status 'submitting' → 'polling'
    if (snap.status === 'failed') {
      // 🔴 A RESOLVED `failed` IS A SERVER OUTCOME, NEVER A TOP-UP CUE: a spend
      // cap or limit buying Buzz does not raise, or a run that may already have
      // spent. The complete list is on `useBuzzWorkflow`'s `submit` docs.
      // Running OUT of Buzz rejects instead — see the catch below.
      showError(submitOutcomeMessage(snap)); // YOUR app owns this copy
    } else {
      await poll(snap.workflowId);   // you loop this on a backoff until terminal
    }
  } catch (err) {
    if (!(err instanceof WorkflowSubmitError)) throw err;
    // Log both for the developer; render neither.
    logForDebugging(err.message, err.snapshot.error);
    // 🔴 TWO SEPARATE QUESTIONS — DO NOT CONJOIN THEM. `code` decides what you may
    // say about MONEY; the id decides only whether there is something to POLL.
    // Folding the id test into the `code` test sends a 'workflow-failed' reply
    // whose id is 'whatif' into the reassuring arm — the exact blind-retry
    // invitation this whole guard exists to remove.
    if (err.code === 'workflow-failed') {
      // 🔴 Spend MAY ALREADY BE COMMITTED. Do not tell the viewer it was free,
      // and do not retry blindly — a retry mints a fresh idempotency key, i.e. a
      // SECOND reservation.
      showError('The generation may have started but did not complete. Check your history.');
      // Only NOW ask about pollability: 'whatif' is a non-workflow sentinel.
      if (err.snapshot.workflowId !== 'whatif') await poll(err.snapshot.workflowId);
    } else {
      // 🔴 'exception' means the host had no workflow to report — USUALLY nothing
      // was queued, but a lost response or an in-progress idempotency conflict
      // reaches this arm too. Retry with the SAME idempotencyKey, not a fresh one.
      showError('Could not start the generation. Please try again.');
    }
  }
}
```

**Status semantics** (gotcha #8/#9/#10):

- `status === 'confirming'` is **IDLE** (estimate landed, user reviewing the
  cost) — keep the Generate button enabled. Only `estimating | submitting |
  polling` are busy.
- `result` is populated after `estimate()` too — don't treat a non-null `result`
  as "something is queued."
- The hook does **not** auto-poll. After `submit` flips status to `'polling'`,
  the **caller** runs a `useEffect` that calls `poll(workflowId)` on a backoff
  until the snapshot is terminal (`succeeded | failed | canceled | expired`).
- A **priced** submit refusal comes back as a **resolved** snapshot with
  `status: 'failed'`, an `error` string, **and a numeric `cost.total`** — the
  price the server refused to charge. That is a workflow *outcome*, not an error.
  Check `snap.status`, not just `try/catch`.
  🔴 **None of them is a top-up cue.** Each is a spend cap or limit that buying
  Buzz does not raise — the per-call `buzzBudget` and the viewer's daily cap
  included — or a reply that may already have spent. The complete list, and
  which of them may say "nothing was charged", is in `useBuzzWorkflow`'s
  `submit` docs. A viewer who is genuinely **out of Buzz** makes `submit`
  **reject** (`WorkflowSubmitError` code `'exception'`, shared with other
  thrown submits): decide a top-up from `useBuzzBalance()` — blue plus the
  block's domain pool, never all three — against the quoted cost.
- **`submit` REJECTS when the reply carries no usable workflow outcome**
  (`@civitai/blocks-react@0.44.0+`). Every failure-shaped reply reports
  `status: 'failed'`, so `status` cannot tell them apart — **`cost` presence
  decides resolve-vs-reject, and `workflowId` decides which rejection**:
  - **priced refusal** → carries `cost`. **Resolves**, as above.
  - **a reply the host built itself** (`failureSnapshot(err)`, which stamps the
    literal `workflowId: 'failed'` — from a `catch` or a short-circuit such as
    the moderator-review nack) → no `cost`. **Rejects** with
    `err.code === 'exception'`, which means *the host had no workflow to report*.
    🔴 **Not the same as "nothing happened."** Usually nothing was queued or
    charged and a retry is fine, but a **lost response**, an **in-progress
    idempotency conflict**, or a **transient 5xx/408/429/401** also land here,
    and a workflow may have been created and charged. Prefer reusing the same
    `idempotencyKey` on retry, and don't render "nothing was charged" as fact.
  - **a failed, unpriced reply whose id is NOT that sentinel** (normally a
    genuine orchestrator id) → no `cost`. **Rejects** with
    `err.code === 'workflow-failed'`.
    🔴 **Money may already be committed.** Server-side, *any* resolved submit
    keeps its Buzz reservation "regardless of snapshot status", with no refund on
    a non-throwing failed snapshot. So do not tell the viewer it was free, and do
    not retry blindly — `submit()` mints a fresh `idempotencyKey` per call, so an
    automatic retry is a second reservation. Read `err.snapshot.workflowId` (a
    usually-pollable id) and `watch`/`poll` it to learn the workflow's actual
    fate — guarding with `err.snapshot.workflowId !== 'whatif'` first, since the
    server treats both `'failed'` and `'whatif'` as non-workflow sentinels.

  Before that version everything resolved, so a block branching on
  `snap.status === 'failed'` could not tell "you can't afford this" from "the
  request failed", and one gating a money control on
  `typeof snap.cost?.total === 'number'` saw the same dead-control shape
  civitai/civitai#4159 describes. An ordinary in-flight reply
  (`{ status: 'pending' }`) is cost-less too and still resolves — and so are
  cost-less `succeeded` / `canceled` / `expired` replies. Only a *failure-shaped*
  reply with no price rejects. `err.message` is a generic developer-facing
  constant that makes **no claim about money** (the two codes differ on that) and
  the server's words stay on `err.snapshot.error`, exactly as on
  `WorkflowEstimateError` below. Note this also fires in **moderator review
  preview**. To exercise your `catch` locally, set the mock host's
  `generation.failSubmitException: true`.
- **`estimate` follows the same rule for a different question** (`@civitai/blocks-react@0.43.0+`).
  It **rejects** with a `WorkflowEstimateError` when the reply carries no usable
  price, rather than resolving a snapshot with no `cost`. Two things produce
  that, and `err.code` tells them apart: `'failed'` (the estimate errored
  server-side) and `'no-cost'` (an otherwise-successful reply that simply has no
  price).
  Before that version both cases resolved, so a block that correctly gates
  Confirm on `typeof cost === 'number'` rendered a dialog it could never confirm
  ("Cost unavailable") and the server's reason was discarded — civitai/civitai#4159.
  Note this also fires in **moderator review preview**, where the host answers
  every workflow request with `'not available in review preview'`: without a
  `catch`, a reviewer's first click becomes an unhandled rejection.
  To exercise your `catch` locally, set the mock host's
  `generation.failEstimate: 'failed' | 'no-cost'`.
- **Three fields, three audiences — and none of them is viewer-facing copy.**
  The string a viewer sees is one **your app owns**; nothing on this error may
  be rendered as-is.
  - `err.code` (`'failed' | 'no-cost'`) — **the branch target**, and the only
    stable one. Switch on it to pick your own localised message.
  - `err.snapshot.error` — **the diagnostic read**, and recovering it is the
    whole point of the fix. **Server-authored and unsanitised** (raw upstream
    text, including database constraint names, can reach it): log it or show it
    in a developer-facing surface, and **never render it verbatim into markup**.
  - `err.message` — **developer-facing**. A generic constant naming only the code
    (`estimate did not return a usable price (no-cost) — reason on .snapshot.error`),
    because `message` is what an uncaught rejection prints and what an error
    reporter ships by default. Safe to log and to let a stack trace print;
    **not intended for display to viewers** — it names an internal field path,
    it is not localised, and **its exact wording is not a contract**, so a UI
    built on it silently rots. Two apps migrating to `0.43.0` piped it into
    rendered UI and would have shipped that sentence to end users.
- A cost of **`0` is a real price**, not a missing one (the orchestrator whatif
  prices a cache hit at 0). `estimate` resolves it; only a non-numeric
  `cost.total` rejects.

#### Showing the app fee: `cost.authorFee`

`cost.total` is what the viewer pays and **already includes the app author's
per-generation fee**. `cost.authorFee` is that fee on its own, in whole Buzz, so
`total - authorFee` is the generation's price. It is display only.

```tsx
import type { BlockWorkflowSnapshot, WorkflowBody } from '@civitai/app-sdk/blocks';

const { estimate } = useBuzzWorkflow();
declare const body: WorkflowBody;

function priceLine(cost: NonNullable<BlockWorkflowSnapshot['cost']>): string {
  // Absent = not itemised. Show the total alone; do NOT treat it as a 0 fee.
  if (cost.authorFee === undefined) return `${cost.total} Buzz`;
  // 0 = a fee was looked up and none applies to this request.
  if (cost.authorFee === 0) return `${cost.total} Buzz (no app fee)`;
  const generation = cost.total - cost.authorFee;
  return `${cost.total} Buzz (generation ${generation} + app fee ${cost.authorFee})`;
}

const quote = await estimate(body); // rejects without a usable price — see above
if (quote.cost) showPrice(priceLine(quote.cost));
```

| `cost.authorFee` | Means | Where |
|---|---|---|
| a number `> 0` | that much of `total` is the app fee | `estimate()` for a `textToImage`, registered-`step` or `workflow` body (one fee for the whole workflow), and the refusal `submit()` resolves for those kinds when a budget, spend cap or rate limit refuses the quoted price |
| `0` | a fee was looked up and none applies to this request | the same replies |
| absent | the total is **not itemised** | a host that predates the field; every snapshot of a submitted workflow (`submit` success, `poll`, `cancel`), whose `total` is the generation's realized cost with the fee charged separately; the registered-`step` `submit()` refusal for a missing orchestrator price quote, which refuses before any fee is looked up; and `customComfy`, pass-through `step` and `training` quotes, which price no fee |

- **Against an older host the field is simply absent.** Nothing else changes:
  `total` has the same value with or without it, so an app that never reads
  `authorFee` is unaffected.
- **Test all three locally** with the mock host's `generation.authorFee`
  (`createMockHost({ generation: { costPerGen: 40, authorFee: 5 } })`, or
  `?authorFee=5` in the dev harness): a number itemises it, the default `0`
  reports `authorFee: 0`, and `authorFee: false` (`?authorFee=off`) leaves it
  out, as an older host does.

#### Why a training step could not be priced: `snapshot.errorCode`

A pass-through `step` body whose `$type` is a training type (`'training'` or
`'imageResourceTraining'`) needs a price quote; when the host cannot get one it
refuses with `{ workflowId: 'failed', status: 'failed', error, errorCode }` and
no `cost`. `estimate()` rejects with a `WorkflowEstimateError` and `submit()`
with a `WorkflowSubmitError` (before anything is reserved), and a batch
estimate returns it as that body's cell. `errorCode` is the stable value to
branch on; `error` stays the diagnostic read.

```tsx
import { useBuzzWorkflow, WorkflowEstimateError } from '@civitai/blocks-react';
import type { WorkflowBody } from '@civitai/app-sdk/blocks';

const { estimate } = useBuzzWorkflow();
declare const body: WorkflowBody;

try {
  await estimate(body);
} catch (err) {
  if (!(err instanceof WorkflowEstimateError)) throw err;
  switch (err.snapshot.errorCode) {
    case 'training-quote-rejected': // the request itself was refused — change it
      showError('These training settings were refused. Check them and try again.');
      break;
    case 'training-quote-unavailable': // no answer right now — retrying may work
    case 'training-quote-unpriced': // answered without a price
      showError('Training cannot be priced right now. Try again shortly.');
      break;
    default: // no code, or one a later host added
      showError('Could not get a price.');
  }
}
```

| `errorCode` | Means |
|---|---|
| `'training-quote-rejected'` | the orchestrator refused the request itself; resending the same body will not help. `error` reads `Training could not be priced: <reason>` when the reason is safe to show |
| `'training-quote-unavailable'` | no usable answer (an outage, a timeout, a rate limit, insufficient funds, …); a retry may succeed |
| `'training-quote-unpriced'` | the orchestrator answered without a price |
| `'daily-limit-exceeded'` | a viewer-confirmed job (a training run or a [confirmed step](#userunconfirmedstep--one-job-above-the-per-call-budget)) would exceed what remains today of the daily Buzz limit **the viewer** set for this app. Nothing was charged, no job started, and only the viewer can raise the limit. Arrives on a confirmed submit's failed snapshot, never on an estimate; `useRunConfirmedStep()` surfaces it as `err.dailyLimitExceeded` |
| absent | any other reply, and every reply from a host that predates the field |

- **Treat an unknown value as possible.** The field is typed as an open string
  (`KnownBlockWorkflowErrorCode | (string & {})`), the host may add codes, and
  the inbound validator accepts any string. Keep a `default` branch.
- A `kind: 'training'` **estimate** does not set it; the three `training-quote-*`
  codes belong to the pass-through arm.
- A refused `kind: 'workflow'` body sets its own codes, in the same shape — see
  the next section.

#### A registered step with no price quote: `step_quote_*`

A **registered** `kind: 'step'` body (one with a `step` id, such as
`'chat-completion'` or `'convert-image'`) that the host has no price quote for
fails on `estimate()` (`WorkflowEstimateError`) and as a batch-estimate cell,
as `{ workflowId: 'failed', status: 'failed', error, errorCode }` with no
`cost`. `submit()` of the same body is unchanged. The pass-through arm (a
`$type`, no `step`) does not set these codes.

| `errorCode` | Means | `error` | Retry the same body? |
|---|---|---|---|
| `'step_quote_rejected'` | the orchestrator refused the request | `No price quote for this step: the orchestrator rejected the request: <reason>` when the reason is safe to show, else `No price quote for this step: the orchestrator rejected the request; check the step inputs and references (retrying the same body will not help)` | no — change the body |
| `'step_quote_unavailable'` | no usable answer (an outage, a timeout, a rate limit, …) | `No price quote for this step: none could be obtained; try again` | yes |
| `'step_quote_unpriced'` | the orchestrator answered without a price | `No price quote for this step: the orchestrator answered without one` | not expected to help |

An older host has none of the three: it resolves the estimate priced at the
step's declared estimate. The mock host always quotes a registered step (at
`generation.costPerGen`), so it never sends these codes.

#### Several steps as one workflow: `kind: 'workflow'`

A `kind: 'workflow'` body submits **several orchestrator steps as one
workflow**, where a later step can consume an earlier step's result. It goes
through the hooks you already use: `useBuzzWorkflow().estimate / submit /
watch / cancel`, a `useBatchEstimate()` cell, and `useWorkflowBatch()`. There
is no new hook and no new message.

```tsx
import { useBuzzWorkflow } from '@civitai/blocks-react';
import type { WorkflowBody } from '@civitai/app-sdk/blocks';

const { estimate, submit, watch } = useBuzzWorkflow();

// Step 1 draws an image; step 2 removes the background from step 1's result.
const body: WorkflowBody = {
  kind: 'workflow',
  arguments: { prompt: 'a lighthouse at dusk' },
  steps: [
    {
      name: 'draw',
      $type: 'imageGen',
      input: {
        engine: 'google',
        model: 'nano-banana-2',
        // Read from `arguments` above.
        prompt: { $ref: '$arguments', path: 'prompt' },
      },
      // An intermediate step: its image is not surfaced.
      suppressOutput: true,
    },
    {
      name: 'cutout',
      $type: 'imageBackgroundRemoval',
      // Read from the EARLIER step named `draw`.
      input: { image: { $ref: 'draw', path: 'output.images[0].url' } },
    },
  ],
};

const quote = await estimate(body);
showPrice(`About ${quote.cost?.total} Buzz`); // an estimate, not a maximum

const submitted = await submit(body);
const done = await watch(submitted.workflowId);

for (const step of done.steps ?? []) {
  if (step.status === 'failed') showError(`${step.name} failed`);
}
// Even when `done.status === 'failed'`, earlier steps may have left images.
showImages(done.imageUrls ?? []);
```

**The body**

- `steps`: 1 to 8 (`BLOCK_WORKFLOW_MAX_STEPS`). Each is `{ name?, $type, input,
  suppressOutput? }`, where `$type` is an orchestrator step type and `input` is
  that step's own input.
- **A step `name`** is optional. It is a lowercase letter followed by up to 31
  of `a-z`, `0-9`, `_` or `-`, unique within the body, and not `block-step`
  (reserved). A step you do not name is named by its position: `$0`, `$1`, ….
- **A reference** is `{ $ref, path, default?, format? }` and may stand in for
  any value in `input`, at any depth. `$ref` is `'$arguments'`, the `name` of an
  **earlier** step, or — for an earlier step you did not name — its position
  (`'$0'` is the first step). A step can never reference itself or a later
  step. An object is a reference only when it has both `$ref` and `path` and no
  other key but `default` / `format`.
- **Limits**: 64 references per body, inputs nested at most 32 levels, `repeat`
  templates nested at most 4 deep, a `$type` of at most 64 characters, and 256
  KB (262144 bytes) for every step's `input` plus `arguments` together. An
  unknown key on the body or on a step is rejected. The app's velocity limit
  counts one unit per step, and a `repeat` step one per iteration instead.
- **No inline media** in a step `input` or in `arguments` — here or in a
  pass-through `kind: 'step'` body's `input`: no `data:image|video|audio` URI
  and no raw base64 string of 4096+ characters, at any depth. Upload the image,
  video or audio with [`useMediaUpload()`](#usemediaupload) (an image also works
  with `useImageUpload({ purpose: 'generationSource' })` or `useImagePicker()`)
  and pass the returned `url`. A body holding more than
  262144 values in those fields is refused outright. `createMockHost` refuses
  both as the host does, naming the path.
- `suppressOutput: true` marks an intermediate step. Its images are left out of
  `snapshot.imageUrls` and out of its own `steps[i].imageUrls`. It still runs
  and is still charged.
- There is **no `maxBuzz`**. The spend ceiling is the app's per-generation
  budget × the number of steps, enforced by the host.
- Any orchestrator `$type` is accepted except the platform-internal ones:
  scanners, moderation classifiers, hashing, web scrape/search, and the retired
  `textToImage` step type.
- **`repeat` over `arguments` only, at most 16 iterations**
  (`BLOCK_WORKFLOW_REPEAT_MAX_ITERATIONS`, nested repeats multiplied). Its input
  is exactly `{ for: { $ref: '$arguments', path, as }, template: { $type,
  name?, input? } }`, where `path` names an array in `arguments`. Inside the
  template, `as` is a source a reference may name; it may not equal a step
  name. The template's `$type` is held to the denylist too. A `repeat` over
  another step's output is refused, because its length is unknown until that
  step has run. The single-step pass-through `kind: 'step'` arm refuses
  `repeat` outright.
- **`merge`**: every entry of `input.fields` needs a string `$ref` (`$arguments`
  or an earlier step, never a repeat variable) and a `reduce`; each counts
  toward the 64-reference limit.
- `WithWorkflowStepRefs<T>` (from `@civitai/app-sdk/blocks`) types an input you
  already have a type for while still allowing references in it.

**🔴 Three things about the price**

1. **The estimate is not a maximum.** When a step reads from an earlier step,
   the orchestrator re-prices it once those values are known and charges the
   difference. Never show the estimate as "you will pay at most".
2. **A workflow the host cannot price has no estimate, but its submit still
   proceeds.** `estimate()` rejects with a `workflow_quote_*` `errorCode` and
   no `cost` (see the second table under Refusals), and a batch estimate
   returns that as the cell. `submit()` of the same body is **not** refused: it
   reserves the ceiling above instead of a quote. So a failed estimate does not
   predict a refused submit. Two exceptions are refused on both, before any
   reservation: a workflow with a training step (a `training-quote-*`
   `errorCode`, as on the single-step arm), and a workflow with a `repeat` step
   at any depth (`workflow_repeat_unbounded`). Their `error` states why there
   is no quote, and only `none could be obtained; try again` is a cause a retry
   of the same body can clear; for the others the body has to change.
   An older host returns the ceiling as the estimate's `cost.total` instead of
   failing, so there a total equal to the ceiling may be unpriced.
3. **One author fee per workflow**, not one per step, on the quoted base. The
   estimate's `cost.authorFee` is that single fee, already inside `cost.total`.
   If the workflow bills more than the quote, the fee charged is held to the
   fee shown. A workflow that does not succeed has its **whole** fee reversed,
   even if earlier steps delivered output.

**The result**

`snapshot.steps` lists every step in order, as `{ name, $type, status,
imageUrls?, output?, error? }`. Read it from `poll()`, `watch()` and
`cancel()`; do not rely on it being on the `submit()` reply. The steps a
`repeat` step generates follow it, named `<repeat name>.<n>`. The top-level
fields keep their meaning: `status` and `cost` are the whole workflow's, and
`imageUrls` is the union of the steps that did not set `suppressOutput`.

🔴 **A `failed` workflow is not an empty one.** Steps that succeeded before the
failing step stay charged and keep their results, so a snapshot with `status:
'failed'` can carry `cost.total > 0` and usable `imageUrls`. Show what did
finish, and do not tell the viewer nothing was charged — though the app fee is
reversed for any workflow that does not succeed.

**Refusals**

A body the host will not run is refused before anything is priced or reserved:
`estimate()` rejects with `WorkflowEstimateError`, `submit()` with
`WorkflowSubmitError`, and a batch estimate returns it as that cell. Branch on
`err.snapshot.errorCode`:

| `errorCode` | Means |
|---|---|
| `'workflow_too_many_steps'` | more than 8 steps |
| `'workflow_step_denied'` | a step names a platform-internal `$type` |
| `'workflow_ref_invalid'` | a reference points at the step itself, a later step, or nothing; a step name breaks the rules above; a `repeat` or `merge` is malformed; or a repeat `as` name is also a step name |
| `'workflow_repeat_unbounded'` | a `repeat` iterates something other than an array in `arguments`, or more than 16 times (nested repeats multiplied); or the workflow has a `repeat` and the host has no price quote for it. `error` then reads `workflow step N: a workflow with a repeat needs a price quote and <cause>`; a retry of the same body can work only when `<cause>` is `none could be obtained; try again` |

A body the host WOULD run, but has no price quote for, fails on `estimate()`
and as a batch-estimate cell only, with no `cost`. `submit()` of the same body
still proceeds (point 2 above):

| `errorCode` | Means | `error` | Retry the same body? |
|---|---|---|---|
| `'workflow_quote_rejected'` | the orchestrator refused the body | `No price quote for this workflow: the orchestrator rejected the request: <reason>` when the reason is safe to show, else `No price quote for this workflow: the orchestrator rejected the request; check the step inputs and references (retrying the same body will not help)` | no — change the body |
| `'workflow_quote_unavailable'` | no usable answer (an outage, a timeout, a rate limit, …) | `No price quote for this workflow: none could be obtained; try again` | yes |
| `'workflow_quote_unpriced'` | the orchestrator answered without a price | `No price quote for this workflow: the orchestrator answered without one` | not expected to help |

An older host has none of the three: it resolves the estimate with the ceiling
as `cost.total`.

- **Requires a host that knows the kind.** An older host refuses the body.
- **Test it locally.** The mock host prices each step with
  `generation.costPerGen` (a function gets the step as its second argument) and
  multiplies it by a `repeat` step's iteration count, then adds
  `generation.authorFee` once; refuses with the four codes of the first table,
  in the host's order; reports
  `steps` on every poll, finishing them in order; and
  `generation.failWorkflowStep: '<name>'` (`'$<index>'` for an unnamed step)
  makes one step fail, so you can render a partial failure. The mock checks
  where a reference points, not whether its `path` exists; it never re-prices;
  and it does not expand a `repeat` step into generated `<name>.<n>` steps. It
  quotes every workflow unless you set `generation.workflowUnpriced` to
  `'rejected'`, `'unavailable'` or `'unpriced'` (`true` means `'unavailable'`),
  which simulates no quote for that cause: a workflow with a training step or a
  `repeat` is refused on both `estimate()` and `submit()`; any other fails its
  `estimate()` with `workflow_quote_<cause>` and no `cost`, while its
  `submit()` is reserved at `buzzBudget` × steps with no fee. The mock has no
  orchestrator reason to pass on, so `'rejected'` always gives the reason-less
  message, never the `…rejected the request: <reason>` form.

> **Estimate must mirror submit** (gotcha #59): build the params for `estimate`
> with the *exact* same logic as `submit` — same seed decision especially. The
> orchestrator whatif prices a cache hit (identical workflow) at 0 and a fresh
> job at full cost, and the seed decides which. A drifting estimate silently
> mis-quotes. See the `buzz-workflow` example.

> **cancel** — `@civitai/blocks-react@0.5.0+` adds `useBuzzWorkflow().cancel(workflowId)`
> for a real server-side orchestrator cancel (gotcha #51), so a running workflow
> stops spending Buzz. Before that, cancel was client-side only (stop polling). If
> your installed version predates 0.5.0, do the client-side half and add the
> `cancel(...)` call after upgrading.

### `useBatchEstimate()`

Price a grid of generations in one request. `estimateBatch(bodies)` takes a list
of workflow bodies, each exactly what `useBuzzWorkflow().estimate()` takes, and
resolves with one cell per body, in order, plus the run total. Returns
`{ estimateBatch, pending, result, error }`.

- **One request against the estimate allowance** however many cells it carries.
  On a page app that allowance is shared by every viewer of the app and by the
  host's other reads for it, so a 16-cell grid priced cell by cell used 16 of it.
- **At most 16 bodies per call** (`BATCH_ESTIMATE_MAX_CELLS`). Price a larger grid
  in several calls.
- **Cells are metered too**, against an allowance of their own that is shared
  the same way (on a page app, by every viewer of the app), so a batch is not a
  way around the estimate allowance. A call over either limit is refused whole:
  it rejects with `BatchEstimateError` code `'failed'`. Retry in a few seconds.
- **Every rule of a single estimate applies to each cell.** A cell that one
  `estimate()` would reject comes back as `ok: false` with the same
  `WorkflowEstimateError`, and the other cells still price.
- **`kind: 'training'` bodies are refused per cell.** Estimate a training run
  with `useBuzzWorkflow().estimate()`.
- **A cell never carries a `stepQuote`.** A batch stores nothing, so a
  pass-through step priced above the per-call budget comes back with its cost and
  no confirmable quote. To run it with
  [`useRunConfirmedStep()`](#userunconfirmedstep--one-job-above-the-per-call-budget),
  estimate that one body with `useBuzzWorkflow().estimate()`.
- **Estimate only.** Nothing is submitted and no Buzz is held or spent. There is
  no batch submit. Submit each cell with
  `useBuzzWorkflow().submit()`, which asks the viewer and checks the budget per
  cell. `aggregate.total` is a quote, not a lock: each cell is priced again when
  it is submitted. To follow the submitted cells and cancel them together, see
  [`useWorkflowBatch()`](#useworkflowbatch).

`aggregate.total` sums the cells that priced. It covers the whole grid only when
`aggregate.pricedCells === aggregate.cellCount`; otherwise show it as a partial
total.

**The host bounds the time one call takes.** If its budget runs out, the call
still resolves: the cells that priced are returned, and every other cell is
`ok: false` with `timedOut: true`. Show those cells as unavailable and let the
viewer retry later. Branch on `timedOut`, not on `snapshot.error`: the host's
wording is not a contract.

`estimateBatch` rejects with `BatchEstimateError` only when the whole call
failed. Branch on `err.code`:

| `code` | Meaning | What to do |
|---|---|---|
| `'unsupported'` | The host answered `unsupported on this host`. | Price each cell with `estimate()`. |
| `'timeout'` | No reply in time. A host that supports the batch replies within its own time budget, well inside the default wait, so this usually means a slow host, not an old one. | Show the estimate as unavailable and retry later. **Do not** fall back to one `estimate()` per cell: that sends up to 16 more estimates at a host that is already slow. |
| `'invalid-request'` | Empty list, or more than 16 bodies. Refused before sending. | Fix the list. |
| `'failed'` | Any other whole-call refusal: the scope, a rate limit, review preview. The reason is on `err.hostError`; log it, don't render it. | Show your own copy and retry later. |

A 2 × 2 grid (two prompts × two checkpoints), falling back to per-cell estimates
only on a host that answers `'unsupported'`:

```tsx
import { useState } from 'react';
import type { WorkflowBody } from '@civitai/app-sdk/blocks';
import {
  BatchEstimateError,
  useBatchEstimate,
  useBuzzWorkflow,
  WorkflowEstimateError,
} from '@civitai/blocks-react';

const PROMPTS = ['a lighthouse at dusk', 'a lighthouse in fog'];
const CHECKPOINTS = [
  { modelId: 101, modelVersionId: 1001 },
  { modelId: 202, modelVersionId: 2002 },
];

/** One cell's quote: a price, or why it has none. */
type CellQuote = { total: number } | { unavailable: string };

export function GridQuote() {
  const { estimateBatch } = useBatchEstimate();
  const { estimate } = useBuzzWorkflow();
  const [quotes, setQuotes] = useState<CellQuote[]>([]);
  const [runTotal, setRunTotal] = useState<number | null>(null);

  const bodies: WorkflowBody[] = PROMPTS.flatMap((prompt) =>
    CHECKPOINTS.map((cp) => ({ kind: 'textToImage' as const, ...cp, params: { prompt } })),
  );

  // Your copy, chosen by `code` (and, for a batch cell, `timedOut`). Never
  // render or match `err.message` or `snapshot.error`.
  const why = (err: WorkflowEstimateError, timedOut = false) =>
    timedOut
      ? 'Price not ready, try again shortly'
      : err.code === 'no-cost'
        ? 'No price for this cell'
        : 'This cell cannot run';

  async function priceGrid() {
    try {
      const { cells, aggregate } = await estimateBatch(bodies);
      setQuotes(
        cells.map((c) => (c.ok ? { total: c.cost.total } : { unavailable: why(c.error, c.timedOut) })),
      );
      setRunTotal(aggregate.pricedCells === aggregate.cellCount ? aggregate.total : null);
      return;
    } catch (err) {
      if (!(err instanceof BatchEstimateError)) throw err;
      if (err.code !== 'unsupported') {
        // 'timeout' is a slow host, not an old one: never fan out per cell here.
        setQuotes([]);
        setRunTotal(null);
        return; // show "pricing unavailable, try again" in your UI
      }
    }
    // This host has no batch estimate: one estimate() per cell, as before.
    const fallback: CellQuote[] = [];
    for (const body of bodies) {
      try {
        const snapshot = await estimate(body);
        fallback.push({ total: snapshot.cost!.total });
      } catch (err) {
        if (!(err instanceof WorkflowEstimateError)) throw err;
        fallback.push({ unavailable: why(err) });
      }
    }
    setQuotes(fallback);
    const priced = fallback.filter((q): q is { total: number } => 'total' in q);
    setRunTotal(
      priced.length === fallback.length ? priced.reduce((sum, q) => sum + q.total, 0) : null,
    );
  }

  return (
    <div>
      <button onClick={() => void priceGrid()}>Price grid</button>
      <ul>
        {quotes.map((q, i) => (
          <li key={i}>{'total' in q ? `${q.total} Buzz` : q.unavailable}</li>
        ))}
      </ul>
      {runTotal !== null && <p>Run total: {runTotal} Buzz</p>}
    </div>
  );
}
```

The fallback spends one request of the shared allowance per cell, which is why
the batch exists. Each submit stays per cell: call `submit(bodies[i])` for each
cell the viewer confirms.

A host that predates the batch message never replies, so the call ends in
`'timeout'` after the full wait. Only if your app must support such a host,
detect it with a deliberate probe: send a one-body batch once with a short
`{ timeoutMs }`, and treat only that probe's `'timeout'` as "no batch support".
Any other `'timeout'` is a slow host.

**Mock host:** `createMockHost` and `Harness` price each cell exactly as they
price one `estimate()` of that body (`costPerGen` and `failEstimate` apply per
cell). Like the host, they refuse the **whole call** while the token lacks
`ai:write:budgeted` — `'failed'`, with `hostError` `block lacks
ai:write:budgeted scope` — so pass `consentGranted: true`, or drive
`requestConsent()` and estimate again once the scope lands. Set `generation.batchEstimate` to `'unsupported'` to test the fallback,
or to `'silent'` to test a call that never gets a reply (pass a short
`timeoutMs` in a test). Set `generation.batchEstimateTimedOutCells` to a list
of cell indices to answer those cells the way the host does when its time
budget runs out (`ok: false`, `timedOut: true`). **`dev:live`** forwards the call to civitai.com, so against
a civitai.com that predates the batch procedure it rejects with `'failed'`
rather than `'unsupported'`.

### `useWorkflowBatch()`

Watch a set of already-submitted workflows as one batch: per-cell status, a
summary, and cancel-all. Built for grid apps that submit each cell with
`useBuzzWorkflow().submit()` (one submit per cell, unchanged) and
then have to follow all of them. `useWorkflowBatch(workflowIds, options?)`
returns `{ cells, summary, cancelAll, rewatch }`.

- **The array of ids is the batch.** There is no server-side batch id. Append
  each id as its `submit()` resolves, and persist the same array (plain
  strings) to re-attach after a reload by passing it back. Skip a submit that
  resolved with the `'failed'` placeholder id: nothing was created.
- **Every cell is one ordinary `watch()`**, so each workflow has exactly one
  poll in flight. When a cell's loop restarts (the list changes, `rewatch()`,
  a StrictMode remount) the new loop waits for the old loop's poll to return.
  `options` (`intervalMs`, `waitSeconds`, `timeoutMs`, `maxRetries`) are passed
  to every cell's `watch()`.
- **At most 30 ids** (`WORKFLOW_BATCH_MAX_CELLS`): the poll allowance (1,200 per
  60 s per block instance and viewer) divided by one watch's 40 polls a minute.
  A longer list, a duplicate, an empty id or a `'failed'`/`'whatif'`
  placeholder throws.
- **`summary`** counts `succeeded`, `failed`, `canceled`, `expired` and `running`
  (not terminal, including cells with no snapshot yet) from each cell's latest
  snapshot, plus `realisedCost`: the sum of `cost.total` on the terminal
  snapshots that carry one. That is the generation cost the host reported, not a
  ledger read; the author fee is charged separately and is not included.
  `settled` is `running === 0`.
- **A host failure placeholder is not a workflow outcome.** When the host fails
  a poll it answers `{ workflowId: 'failed', status: 'failed' }`. That says
  nothing about the workflow, so the cell is not counted as failed: its `phase`
  becomes `'stopped'` with `error` set, and `summary.stopped` counts it. A
  stopped cell (also a watch that timed out or ran out of retries) is not
  polled again until you call `rewatch()`.
- **`cancelAll()` cancels every cell not known to be finished** and resolves
  (never rejects) with `{ canceled, alreadySettled, refused, notAttempted,
  failed, complete }`, each a list of ids. Cancels charge the estimate allowance
  (150 per 10 s per block instance; on a page app every viewer shares it), so at
  most four are in flight. A refused cancel resolves `status: 'processing'`: it
  was not sent and the workflow is still running. After the first refusal the
  rest of the call is not sent (`notAttempted`). A cancel answered with the
  host's failure placeholder is `failed`, not a failed workflow. Nothing is
  retried automatically. When `complete` is `false`, wait a few seconds and call
  `cancelAll()` again; it targets only cells that are still not finished.
- **Unmounting stops every poll.** A `cancelAll()` already running keeps sending.

```tsx
import { useEffect, useState } from 'react';
import type { WorkflowBody } from '@civitai/app-sdk/blocks';
import { useBuzzWorkflow, useWorkflowBatch } from '@civitai/blocks-react';

const SAVED = 'grid-run-ids';

function GridRun({ bodies }: { bodies: WorkflowBody[] }) {
  const { submit } = useBuzzWorkflow();
  const [ids, setIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(SAVED) ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(SAVED, JSON.stringify(ids));
    } catch {
      // Storage can be unavailable; the run still works, it just won't re-attach.
    }
  }, [ids]);

  const { cells, summary, cancelAll, rewatch } = useWorkflowBatch(ids);
  const [cancelNote, setCancelNote] = useState<string | null>(null);

  async function runCell(body: WorkflowBody, key: string) {
    const snap = await submit(body, { idempotencyKey: key });
    if (snap.workflowId !== 'failed') setIds((prev) => [...prev, snap.workflowId]);
  }

  async function onCancelAll() {
    const result = await cancelAll();
    setCancelNote(
      result.complete
        ? null
        : `${result.refused.length + result.notAttempted.length + result.failed.length} cells are still running. Try again in a few seconds.`,
    );
  }

  return (
    <div>
      <button onClick={() => bodies.forEach((b, i) => void runCell(b, `cell-${i}`))}>Run grid</button>
      <p>
        {summary.succeeded} done, {summary.failed} failed, {summary.canceled} cancelled,{' '}
        {summary.running} running. Spent {summary.realisedCost} Buzz.
      </p>
      {!summary.settled && <button onClick={onCancelAll}>Cancel all</button>}
      {summary.stopped > 0 && <button onClick={rewatch}>Refresh stalled cells</button>}
      {cancelNote && <p>{cancelNote}</p>}
      <ul>
        {cells.map((cell) => (
          <li key={cell.workflowId}>{cell.snapshot?.status ?? 'queued'}</li>
        ))}
      </ul>
    </div>
  );
}
```

**Mock host:** `createMockHost` and `Harness` keep a cancelled workflow
cancelled on later polls, report a finished workflow's real status when it is
cancelled, and count down an id they did not submit (one restored after a
reload) like any other. Set `generation.cancelRefused` to `true` (or a list of
workflow ids) to answer cancels the way the host does when the allowance is used
up, and `generation.workflowOutcome` to a `(workflowId, body) => 'succeeded' |
'failed' | 'expired'` function to give a grid a mix of outcomes. The mock does
not model the rate limits themselves.

### `useBuzzPurchase()`

Open the Buzz purchase modal. It raises the viewer's WALLET, never a spend cap:
offer it when the viewer's spendable Buzz is below a quoted cost, never on a
resolved `failed` submit (see `useBuzzWorkflow`'s `submit` docs).

```tsx
const { openPurchaseModal } = useBuzzPurchase();
const { purchased, newBalance } = await openPurchaseModal(suggestedAmount);
if (purchased) { /* retry the generation */ }
```

### `useGoodPurchase()`

Sell a **digital good** — a manifest-declared entitlement the platform sells to the viewer for Buzz on your app's behalf. Requires the `goods:purchase:self` scope **and** a `goods` entry in your manifest; without both the endpoint answers 404.

```tsx
const { purchase, loading, error } = useGoodPurchase();
const { entitlement } = await purchase(
  { goodId: 'extra-slots', expectedPriceBuzz: 250 },
  { topUpOnInsufficientFunds: true },
);
```

🔴 **The platform renders no confirmation for the purchase itself** — this is a plain authed POST on the block token, so whatever the viewer confirms is *your* UI. Spend is bounded by the manifest-reviewed price and the viewer's daily cap, but a good can be priced near that cap where a tip cannot. Show the price and require an explicit action.

`{ topUpOnInsufficientFunds: true }` opens `useBuzzPurchase()` on an `insufficient_funds` refusal and retries **once with the same idempotency key** — but only if the viewer actually bought Buzz. **Pass `expectedPriceBuzz` with it**, or the modal opens with no suggested amount and the retry can re-refuse after real fiat was spent. It keys on the *reason*, never on "the call failed", so it never offers Buzz for a failure Buzz cannot fix.

Refusals reject with a `GoodPurchaseRefusal` carrying `status` and, where the server sends one, `reason`. `reason` is **`undefined`** for the endpoint's own refusals (404, 429, daily-cap 400, every idempotency refusal) — only service-level ones populate it, so always fall back to `status` and `message`.

Two rejections are **not** refusals, and `name` tells them apart: the 30s bound rejects with a plain `Error` naming the timeout — a real failure, the charge may have landed, retry with the **same** `idempotencyKey` — while an unmount rejects with `name === 'AbortError'`, the usual signal that the component navigated away and there is nothing to report. That split is decided by the **abort state**, so it holds wherever the abort lands, the body read included. The one exception runs the other way: a refusal the hook had already parsed stays a `GoodPurchaseRefusal` even if an abort fires in the same tick — `reason` is worth more than the abort wrapper. So ignoring `AbortError` never swallows a refusal or a timeout.

### `useEntitlements()`

What the viewer owns **from this app** — the read half of the goods rail. Scope `goods:read:self`, which is consent-exempt: the reply is scoped server-side to your own app, so a read-only block needs no purchase power and triggers no re-consent prompt.

```tsx
function PaidFeature() {
  const { owns, loading, error, unauthenticated, refetch } = useEntitlements();
  if (loading) return <Spinner />;
  if (unauthenticated) return <SignInToBuy />;        // a logged-out viewer
  if (error) return <RetryNotice onRetry={refetch} />; // NOT "you own nothing"
  return owns('extra-slots') ? <Unlocked /> : <BuyButton onDone={refetch} />;
}
```

🔴 **`owns()` returns `false` when the viewer owns nothing AND when the read failed**, so never gate paid content on it alone — check `loading`, `unauthenticated` and `error` first, in that order. A block that paywalls on `!owns(id)` takes away something the viewer paid for on every transient failure. `unauthenticated` exists because a **page** app is a public surface, so a logged-out viewer is the common path rather than an edge.

🔴 **`unauthenticated` is derived from the viewer, not from a response.** It is `isSignedIn(useBlockContext().viewer) === false` once `BLOCK_INIT` has landed — so it is known *before* any request, and an anonymous viewer costs **no round trip**: the hook skips the GET entirely and settles with `error === null`, because nothing failed. It stays `false` until init lands (a pre-init viewer is *unknown*, not absent), so a block that never gets embedded reaches its host-origin error rather than a sign-in screen.

🔴 **No 403 is ever read as "not signed in"** — and a predicate that tried to be was **dead code**. The endpoint runs under `withBlockScope(…, { requiredScope: 'goods:read:self' })`, whose `:self` arm rejects an anonymous subject as `code: 'context_binding'`, so there is no reachable uncoded 403 on this route; keying on `context_binding` instead would be worse, since the same code covers a wrong `modelId`. Every 403 therefore reaches `error` with the server's own wording — including the one you will actually hit, `insufficient_scope`, a manifest that forgot `goods:read:self`. Read `error.message`, not the status.

Call `refetch()` after a successful purchase to reflect it without a remount.

### `useBuzzBalance()`

The signed-in viewer's per-pool Buzz balance (`{ blue, green, yellow }` — the
domain-clamped pools a block may read; never the platform-internal `red`/`purple`).
Host-mediated over `GET_BUZZ_BALANCE` → `BUZZ_BALANCE_RESULT`; same trust model as
`useBuzzWorkflow`/`useBuzzPurchase` (the host resolves the viewer from the block
token — the block never touches the balance API). Fetches on mount; `refetch` for
on-demand refreshes.

```tsx
const { balance, loading, error, refetch } = useBuzzBalance();
// `balance` is null until the first successful fetch. refetch() after a
// generation debits it. An anon viewer / missing scope / host failure → `error`.
if (!loading && balance) console.log(`Yellow: ${balance.yellow}`);
```

> Per-account Buzz: `useBuzzWorkflow().submit(body)` also takes an optional
> `body.accountType` (`'blue' | 'green' | 'yellow'`) — a *preference* for which
> pool funds the generation; the host clamps it server-side.

### `useViewer()`

The signed-in viewer as an on-demand authoritative self-read (`{ id, username,
status, buzzBudget }`) — distinct from `useBlockContext().viewer`, the coarse
`BLOCK_INIT`-time snapshot. `status` is `'active' | 'muted'`; `username`
(`string | null`) and `buzzBudget` (`number | null`) are present-but-nullable, so
handle the null case. Host-mediated over `GET_VIEWER` → `VIEWER_RESULT` (the host
resolves the viewer from the block token via `blocks.getMyViewer`); an anonymous /
banned viewer comes back as `error`. Fetches on mount; `refetch` for on-demand
refreshes.

```tsx
const { viewer, loading, error, refetch } = useViewer();
// `viewer` is null until the first successful fetch. An anon / banned viewer,
// missing scope, or host failure → `error`. `username`/`buzzBudget` may be null.
if (!loading && viewer) console.log(`${viewer.username ?? 'anon'} · budget ${viewer.buzzBudget ?? 0}`);
```

### `useBuzzTransactions(params?)`

The signed-in viewer's Buzz-transaction ledger (a paged, host-projected read of
the Buzz dashboard). Returns `{ transactions, cursor, loading, error, refetch }`;
`transactions` rows are rehydrated so `date` is a `Date`. Pass the returned
`cursor` back as `params.cursor` to page forward. Requires the `buzz:read:self`
scope; host-mediated over `GET_BUZZ_TRANSACTIONS`.

```tsx
const { transactions, cursor, loading, error } = useBuzzTransactions({ type: 'Tip', limit: 20 });
if (!loading && transactions) transactions.forEach((t) => console.log(t.type, t.amount, t.date));
```

### `useBuzzAccounts()`

The viewer's all-pool Buzz balances — the three spendable pools **plus** the
creator payout pools (`{ accountType, balance }[]`), a superset of
`useBuzzBalance`. Returns `{ accounts, loading, error, refetch }`. Requires
`buzz:read:self`; host-mediated over `GET_BUZZ_ACCOUNTS`.

```tsx
const { accounts, loading, error } = useBuzzAccounts();
if (!loading && accounts) accounts.forEach((a) => console.log(a.accountType, a.balance));
```

### `useDailyCompensation(params)`

Per-modelVersion generation-compensation for the month containing `params.date`
(Buzz totals + cash totals in pennies). Returns `{ resources,
hasPublishedResources, loading, error, refetch }`. Requires `buzz:read:self`;
host-mediated over `GET_DAILY_COMPENSATION`.

```tsx
const { resources, hasPublishedResources } = useDailyCompensation({ date: '2026-07-01' });
```

### `useWildcardPack(modelVersionId)`

Import a wildcard pack's parsed prompt lists by model version — the host
resolves + fetches + unzips + parses it **in the user's own page session** (every
download gate enforced), so the untrusted iframe never sees the bytes. Returns
`{ pack, loading, error, refetch }`. On failure `error` is a `WildcardPackError`
with a discriminated `code` (`not-found` / `forbidden` / `too-large` /
`parse-failed` / `busy` — `busy` is retryable), not free text.

```tsx
const { pack, loading, error, refetch } = useWildcardPack(modelVersionId);
// `error.code === 'busy'` is retryable — call refetch(); the other codes are terminal.
if (error instanceof WildcardPackError && error.code === 'busy') void refetch();
if (!loading && pack) console.log(Object.keys(pack.lists));
```

### `useResourceFile(modelVersionId, fileId?)`

Read a resource file's parsed JSON — for a workflow, its graphs — by model
version. The host resolves, fetches, unzips and parses the file **in the
viewer's own page session**, enforcing the real download gates, so the iframe
never sees the session, a signed URL or the raw bytes. No block scope is needed.
Returns `{ file, loading, error, refetch }`.

- `file.meta` names what was served (`modelId`, `modelVersionId`, `fileId`,
  `fileName`, `modelName`, `versionName`, `creatorUsername`).
- `file.entries` holds one `{ path, format, graph }` per JSON document: one for a
  plain `.json`, several for a `.zip` (non-JSON entries are skipped). `format`
  is `'ui'` (a `nodes` array), `'api'` (every top-level value has `class_type`
  and `inputs`) or `'unknown'`; check it before treating `graph` as a graph.
  `file.truncated` is `true` when an entry was dropped: past 20 entries, over
  the 4 MB per-entry or 16 MB total cap, unreadable, or not valid JSON.
- Pass `fileId` to pin one file of a multi-file version. Without it the host
  picks one.
- Changing `modelVersionId` or `fileId` resets `file` and `error` to `null`
  before the new fetch, so a file never shows for ids it does not belong to.
- The request waits up to 120 s, because the host downloads and unzips the file.

On failure `error` is a `ResourceFileError` whose `code` is one of a closed set:

| `code` | Means | Retry? |
|---|---|---|
| `not-found` | No such version or file, not a workflow, or not downloadable for free (see below) | No |
| `forbidden` | Above the viewer's maturity ceiling on this site, or the app is in review preview | No |
| `unauthorized` | The viewer is signed out | No |
| `too-large` | Over 32 MB, or every entry was over a size cap (4 MB per entry, 16 MB in total) | No |
| `parse-failed` | Not a `.json`/`.zip`, corrupt, or no valid JSON — **or** the host's catch-all: a network error, a failed fetch, no answer within its 110 s deadline, a transient storage failure, or another server error | Once, maybe: it can be transient |
| `busy` | Three fetches already in flight in this tab | Yes |
| `rate-limited` | The viewer's 30-a-minute budget is spent | Yes, later |

🔴 **Full-page app hosts only — not the model-page slot, not `dev:live`.** The
model-page slot does not answer it (the request times out), and `dev:live`
replies `parse-failed`. Develop against `dev:mock`: `createMockHost` takes a
`resourceFile` (the canned reply) and a `resourceFileError` (force a code);
`setScenario({ resourceFileError: undefined })` clears the forced error.

🔴 **Only free, public versions are served.** An unpublished draft (the owner's
included) and an early-access or paid version answer `not-found` — even for a
viewer who bought it. Only the owner gets their own published early-access
version. A POI model, or a model or version whose availability is not `Public`
or `Unsearchable` (e.g. `Private`), is refused to everyone but the owner,
moderators included.

```tsx
const { file, loading, error, refetch } = useResourceFile(modelVersionId);
// Retry a retryable code from an effect, after a delay — never during render.
const retryable =
  error instanceof ResourceFileError && (error.code === 'busy' || error.code === 'rate-limited');
useEffect(() => {
  if (!retryable) return;
  const t = setTimeout(refetch, 2_000);
  return () => clearTimeout(t);
}, [retryable, refetch]);
const graphs = file?.entries.filter((e) => e.format !== 'unknown') ?? [];
if (!loading && file) console.log(file.meta.fileName, graphs.length, file.truncated);
```

### `useCollectionFollow()`

Follow / unfollow a collection **for the viewer**, host-mediated over
`SET_COLLECTION_FOLLOW`. Returns `{ setFollow, pending, error }`.

**No block scope, and no token on the wire.** The host calls the session-authed
`collection.follow` / `collection.unfollow` procedures, which self-bind to the
viewer server-side — `collectionId` is the only thing a block influences.

🔴 **Every call opens a host-chrome consent confirm naming the collection**, and
that click is the *only* consent this path has ever had: the HTTP predecessor's
`collections:write:self` scope is consent-exempt server-side and prompted nobody.
Moving to this bridge **tightens** the flow; what it gives up is the manifest
`scopes` declaration a moderator reads before install. The host resolves the
collection's name itself (there is no `name` field on the wire, deliberately) and
bounds that to **20 distinct ids per block instance** — past the cap it refuses
with `collection-unavailable`, the same code a collection the viewer cannot see
gets.

`setFollow` **rejects** with a `CollectionFollowError` on every non-success. Two
of those are not failures to render:

| | meaning | what to do |
|---|---|---|
| `err.declined` | the viewer dismissed the confirm — **no write occurred** | revert, say nothing |
| `err.signInRequired` | no session | route into `useRequestSignIn()` |
| `err.timedOut` | no reply arrived within the 10-min consent bound | 🔴 **check this BEFORE `.message`** — it also has no `.code`, and its message is an SDK-internal string. It does **not** mean no write occurred; re-read your state |
| `err.code` set otherwise | a host refusal (`invalid-request` / `review-mode` / `not-ready` / `collection-unavailable`) | show or ignore per case |
| `err.code === undefined` **and** `!err.timedOut` | a **server** message the host forwarded verbatim | show `err.message` |

```tsx
const { setFollow, pending } = useCollectionFollow();
const { requestSignIn } = useRequestSignIn();

async function toggle() {
  try {
    const result = await setFollow({ collectionId, follow: !followed });
    setFollowed(result.followed); // adopt the host's echo, not the guess
  } catch (err) {
    if (err instanceof CollectionFollowError) {
      if (err.signInRequired) return requestSignIn();
      if (err.declined) return; // the viewer said no — say nothing
      if (err.timedOut) return showToast('Still working — check back in a moment.');
      showToast(err.message); // a real server message, safe to render
    }
  }
}
```

Most blocks want `<FollowButton>` from `@civitai/blocks-react/ui` instead, which
wires all of the above.

### `useReactions(entityType, ids, { tickets })`

Read and set the **viewer's** reactions on images this app was served, over
`GET_ENTITY_REACTIONS` / `SET_ENTITY_REACTION`. Returns
`{ byId, unavailable, loading, error, toggle, pending }`.

It reads on mount, then reads again only the images that need it: an id added
to `ids`, or one whose ticket changed. An id that leaves `ids` costs nothing.
Every read counts against the block instance's catalog rate limit on the host,
which every viewer of a page app shares with its other catalog reads.

A reaction made here **is** a reaction on civitai.com: it pays the reactor and
the image owner exactly as the site's own button does, moves rankings, notifies,
and lists the viewer among the reactors. It draws on the **same** per-viewer
quota as the site. Apps may set `Like`, `Heart`, `Laugh` and `Cry`; never
`Dislike`. Image is the only entity type today.

🔴 **Scope `social:react:self`: consent-gated and sensitive.** Declare it with a
`scopeJustifications` entry. Until the viewer grants it, every call fails with
`needs-consent` (`err.needsConsent`): ask with `useRequestConsent()`. There is
no per-tap confirm.

🔴 **Tickets are required, and only the REST block endpoints supply them.** Each
image that `/api/v1/blocks/images`, `/api/v1/blocks/gated-images` or
`/api/v1/blocks/collections/{id}` serves, fetched with the block token for a
signed-in viewer, carries a `reactTicket` signed for this app and this viewer
for 24 hours. **No hook in this package supplies one yet:** `useGatedImages()`
goes through the host bridge, whose reply carries no `reactTicket`
([#687](https://github.com/civitai/civitai-app-starters/issues/687)). Pass the
tickets as `tickets`, keyed by image id. An image without a valid one is not
answered by the read (it lands in `unavailable`, which is **not** "not reacted")
and a `toggle` on it is refused locally, before anything is sent.

`toggle(id, reaction, reacted)` sets a **desired state**, moves `byId[id]`
optimistically, and puts it back on failure. It rejects with a `ReactionError`:

| | meaning | what to do |
|---|---|---|
| `err.signInRequired` | no session | route into `useRequestSignIn()` |
| `err.needsConsent` | the scope is not granted | `useRequestConsent()` |
| `err.code === 'rate-limited'` | the viewer's reaction quota is spent | back off |
| `err.code === 'entity-unavailable'` | no valid ticket, an image the viewer may not react to, the kill switch, or a network failure | retry later or give up |
| `err.code` otherwise | `invalid-request` / `review-mode` / `not-ready` | a block bug, a review sandbox, or retry after `ready` |
| `err.timedOut` | no reply within 30s | the write **may** have landed; the hook re-reads that image |
| `err.busy` | the same image and reaction already has a request in flight. Rejects the call only: `error` is not set, because the write it collided with is still running | disable the control while `pending(id, reaction)` |

🔴 **Bind `<civitai-reaction>` from `byId` on every render; never let it keep
its own state.** The element flips `reacted` and `count` itself on a click. When
the hook makes no optimistic move of its own (an image not read yet, or a
refusal such as a missing ticket), `byId` does not change, so an element that
only listens would keep showing a reaction that does not exist. Every rejected
`toggle` re-renders the owner: a refusal or a failed write sets `error`, and a
`busy` refusal is followed by the in-flight write's own settle, which clears
`pending`. An element whose `reacted` and `count` come from `byId` on each
render is then put back. Outside React, set the two properties back yourself
after a rejection.

```tsx
import { useEffect, useState } from 'react';
import { isAppReaction } from '@civitai/app-sdk/blocks';
import { useBlockToken, useHostOrigin, useReactions } from '@civitai/blocks-react';

type ServedImage = { id: number; url: string; reactTicket?: string };

function useReactableImages() {
  const host = useHostOrigin();
  const { raw } = useBlockToken();
  const [images, setImages] = useState<ServedImage[]>([]);

  // The tickets come from the REST endpoint, fetched with the block token.
  useEffect(() => {
    if (!host || !raw) return;
    void fetch(`${host}/api/v1/blocks/images?limit=20`, {
      headers: { Authorization: `Bearer ${raw}` },
    })
      .then((res) => res.json() as Promise<{ items: ServedImage[] }>)
      .then((body) => setImages(body.items));
  }, [host, raw]);

  const reactions = useReactions(
    'image',
    images.map((image) => image.id),
    { tickets: Object.fromEntries(images.map((image) => [image.id, image.reactTicket])) },
  );

  // Props for one `<civitai-reaction>` (e.g. `CivitaiReaction` from
  // `@civitai/components-react`), derived from `byId` on every render.
  const bind = (id: number, reaction: 'Like' | 'Heart' | 'Laugh' | 'Cry') => ({
    reaction,
    reacted: reactions.byId[id]?.viewerReactions.includes(reaction) ?? false,
    count: reactions.byId[id]?.counts[reaction] ?? 0,
    disabled: !reactions.byId[id] || reactions.pending(id, reaction),
    onReact: (event: CustomEvent<{ reaction?: string; reacted: boolean }>) => {
      const { reaction: which, reacted } = event.detail;
      // `detail.reaction` is any string the element was given; narrow it.
      if (!isAppReaction(which)) return;
      // A rejection needs no handling here to put the element back: it
      // re-renders, and `bind` reads `byId` again.
      reactions.toggle(id, which, reacted).catch(() => {});
    },
  });

  return { images, bind, error: reactions.error };
}
```

### `useCreatePostFromApp()`

Publish a **real, published Post on the viewer's profile** from this app's own
outputs, host-mediated over `CREATE_POST_FROM_APP`. Returns
`{ createPost, pending, error }`.

The strictly-more-consequential sibling of `usePublishGenerationOutputs()`: that
one makes a bare `Image` row with no post, no feed presence, no reward and no
notification; this one makes **public, feed-visible, reward-earning content under
the viewer's byline**.

🔴 **Requires the `posts:write:self` scope**, which is **sensitive** and
**consent-gated**. Declare it in your manifest *with* a `scopeJustifications`
entry — the server rejects the manifest at submit without one — and expect the
viewer to be prompted to grant it before the first call succeeds.

🔴 **The grant is not the consent.** Every call opens a host-chrome confirm, and
what it shows is the **server's** resolution of your request, never your strings:
the tag names that will *actually* be applied, host-fetched model and version
names for a gallery attach, and real thumbnails. A block cannot show one post and
publish another.

🔴 **No arm of `sources` takes a URL.** Name a workflow from this app's own
subqueue plus indexes into its outputs, or `Image` ids from a previous
`usePublishGenerationOutputs()` publish or `useUploadImageBytes()` upload. The
server re-verifies both — ownership,
this app's provenance marker, and that the image is not already in a post.

⚠️ **Posting a published image removes it from this app's own grid.** The
app-scoped read behind `useGatedImages()` is conjoined with `postId IS NULL`, so
an image that joins a post stops resolving there. An app cannot both keep an
image in its shared grid and let the viewer post it — design around it.

Text is advisory: the server bounds `title`/`detail`, screens them, refuses a
`detail` containing a link, and resolves `tags` against **existing** tags only (a
name matching no tag is dropped, never minted, and is shown to the viewer on the
confirm).

`createPost` **rejects** with a `CreatePostError` on every non-success:

| | meaning | what to do |
|---|---|---|
| `err.declined` | the viewer dismissed the confirm — **no post was created** | revert, say nothing |
| `err.signInRequired` | no session | route into `useRequestSignIn()` |
| `err.timedOut` | no reply arrived within the 10-min consent bound | 🔴 **check this BEFORE `.message`** — it also has no `.code`, and its message is an SDK-internal string. It does **not** mean nothing happened; tell the viewer to check their profile and never retry automatically |
| `err.code` set otherwise | a host refusal (`review-mode` / `block is not ready` / `no images to post` / `no block token`) | show or ignore per case |
| `err.code === undefined` **and** `!err.timedOut` | a **server** message the host forwarded verbatim (rate limit, blocked title, refused gallery attach) | show `err.message` |

```tsx
const { createPost, pending } = useCreatePostFromApp();
const { requestSignIn } = useRequestSignIn();

async function share() {
  try {
    const post = await createPost({
      sources: [{ kind: 'workflow', workflowId: w.workflowId, imageIndexes: [0, 2] }],
      title: 'Made with Sticker Studio',
    });
    showToast(`Posted! ${post.url}`);
  } catch (err) {
    if (err instanceof CreatePostError) {
      if (err.signInRequired) return requestSignIn();
      if (err.declined) return; // the viewer said no — say nothing
      if (err.timedOut) return showToast('Still working — check your profile.');
      showToast(err.message); // a real server message, safe to render
    }
  }
}
```

With the mock host — `createMockHost` or `Harness` from
`@civitai/blocks-react/testing` — the `createPostResult` / `createPostError`
options drive both arms (including `declined`). **`dev:live` refuses this bridge on purpose** —
it has no civitai chrome to render the server-resolved confirm in, and driving
the write without it would let dev prove out a flow production does not have.

### `useImageUpload({ purpose: 'trainingData' })` and `useRunTraining()` — LoRA training

Train a LoRA with the ai-toolkit engine on **images the viewer uploads**, from
inside a page app — the App Blocks `kind: 'training'` flow, with the same upload
path and `{ air, caption }` dataset shape as Civitai's own training form. Four
steps, three hooks:

1. **Upload** — `useImageUpload({ purpose: 'trainingData' }).open()`
   (`OPEN_IMAGE_UPLOAD { purpose: 'trainingData' }`). Civitai opens an upload
   modal in **its own chrome**; the viewer picks up to 50 PNG, JPEG or WebP
   images, and each is uploaded as a private blob (not published). `open()`
   resolves with every image that uploaded, `[{ url, air }]`, or `null` when
   the viewer cancels. Pair each `air` with your caption — captions up to 8,192
   characters, one blob at most once. The host answers only when its modal
   closes, after every original has uploaded, so `open()` waits up to an hour,
   not the ten minutes the other pickers use.
2. **Quote** — `useBuzzWorkflow().estimate(body)` with a `WorkflowBodyTraining`
   (`kind: 'training'`, `items: [{ air, caption }]`, no `quoteId`). The reply
   carries `trainingQuote: { quoteId, total, imageCount, expiresAt }` — the
   orchestrator's own price for exactly this run, stored server-side for 15
   minutes.
3. **Run** — `useRunTraining().runTraining({ ...body, quoteId })` (`RUN_TRAINING`).
   **Civitai shows the viewer a consent dialog in its own chrome** — price, base
   model, length and dataset size, all read back from the server, never from
   your body, with the host's own copies of the uploads as thumbnails — and
   submits only on their click. Change nothing in the body between the estimate
   and the run; the server checks it against the quoted one.
4. **Follow** — `useBuzzWorkflow().watch(workflowId)`. Once the run's moderation
   status is approved, `trainedEpochs` lists the epochs whose checkpoint is
   ready; send the viewer to the publish wizard with one of them (see
   `trainedEpochs` on `BlockWorkflowSnapshot`).

🔴 **Upload and run in the same page session.** The host remembers the blobs
its own upload modal uploaded for this block, and **refuses a quote naming any
other** with `training data not uploaded here` — before any dialog, so no run
and no charge. A page reload forgets the uploads: ask the viewer to upload
again, then estimate again.

🔴 **Availability.** Behind the host flag **`app-blocks-training-kind`**, which
ships **off** and is evaluated per viewer. **Page apps only** — the model slot
answers `RUN_TRAINING` with an error. The manifest must declare
**`ai:write:budgeted`** and the viewer must be signed in and have granted it.
**Refused from `dev:live` and from review sessions** (the server refuses
development and review tokens); build the flow against the mock host. Requires a
civitai.com host carrying civitai/civitai#5434 (`kind: 'training'`,
`RUN_TRAINING`) and civitai/civitai#6461 (uploaded blobs as the dataset). The
server-prepared dataset this flow used before #6461 (`usePrepareTrainingDataset`,
`PREPARE_TRAINING_DATASET`) is **removed**; a host carrying #6461 answers that
message with the error `removed`.

🔴 **Money.** There is no `maxBuzz` and no timeout knob — the price is the quote.
A confirmed run may cost more than the token's per-call `buzzBudget` (the viewer
confirms the exact price), up to `BLOCK_TRAINING_MAX_BUZZ_PER_RUN` (5,000 Buzz);
an estimate above that is refused. `useBuzzWorkflow().submit()` **refuses** a
training body before sending anything: only `RUN_TRAINING`'s dialog can confirm a
quote, so a training run starts nowhere else.

`runTraining` **rejects** with a `RunTrainingError`; read the flags before
saying anything about money:

| | meaning | what to do |
|---|---|---|
| `err.declined` | the viewer dismissed the dialog — **no run was submitted** | revert, say nothing |
| `err.unconfirmed` | `submission-unconfirmed`, or no reply within the 10-min bound (`err.timedOut`) — the run **may be running and charged** | 🔴 **never retry automatically**: check the viewer's trainings first (`useAppWorkflows()` lists this app's runs). Re-running the same body after the server did start it is a **second, separately charged run** |
| `err.refused` (`code: 'refused'`) | the server refused the submit after the viewer confirmed — a **spend cap** (their daily or private-run Buzz cap, the per-app consent budget, the app's daily spend or rate limit, a dev-session cap) or a **temporary-availability** deny. Refunded: **no run, nothing charged**; the quote is used up | show `err.message` (the server's reason, e.g. `daily Buzz cap reached: …`); estimate again before any retry — buying Buzz does not lift these caps |
| `err.trainingDataNotUploaded` (`code: 'training data not uploaded here'`) | the quote names an image this host did not upload for this block (typically after a reload) — refused before any dialog: **no run, nothing charged** | ask the viewer to upload the images again, then estimate and run the new quote |
| `err.signInRequired` | no session | route into `useRequestSignIn()` |
| `err.code` set otherwise | a host refusal (`review-mode` / `block is not ready` / `invalid training request` / `no block token`) | show or ignore per case |
| `err.code === undefined`, no flag | a server refusal before any submit (expired or used quote, changed body) | estimate again, then retry |

`runTraining` never prompts for `ai:write:budgeted` or re-sends — it carries no
idempotency key and has an outcome where a run may exist.

```tsx
const { open } = useImageUpload({ purpose: 'trainingData' });
const { estimate, watch } = useBuzzWorkflow();
const { runTraining } = useRunTraining();

async function train(captionFor: (image: BlockTrainingDataImage) => string) {
  const images = await open();
  if (!images) return; // the viewer cancelled

  const body: WorkflowBodyTraining = {
    kind: 'training',
    items: images.map((image) => ({ air: image.air, caption: captionFor(image) })),
    engine: 'ai-toolkit',
    model: baseModelKey, // a key from Civitai's training catalog
    params: aiToolkitParams, // AiToolkitTrainingParams
    triggerWord: 'mystyle',
    samplePrompts: ['mystyle, a lighthouse at dusk'],
  };
  const quote = (await estimate(body)).trainingQuote;
  if (!quote) return showError('No training price came back.');
  // Show quote.total; the host's dialog will show the same number.

  try {
    const started = await runTraining({ ...body, quoteId: quote.quoteId });
    const done = await watch(started.workflowId, { onUpdate: render });
    setEpochs(done.trainedEpochs ?? []);
  } catch (err) {
    if (!(err instanceof RunTrainingError)) throw err;
    if (err.declined) return; // no run
    if (err.unconfirmed) return showCheckYourTrainings(); // may be running — never auto-retry
    if (err.refused) return showError(err.message); // a cap / availability refusal; no run, nothing charged
    if (err.trainingDataNotUploaded) return showError('Upload the images again.'); // no run
    if (err.signInRequired) return requestSignIn();
    showError('Could not start training. Get a new price and try again.');
  }
}
```

With the mock host — `createMockHost` or `Harness` from
`@civitai/blocks-react/testing` — the training path is **kind-faithful**: it
remembers the blob keys its uploads handed out and refuses a run naming any
other (`training data not uploaded here`, quote kept), refuses items outside the
server's schema at the estimate, a quote above 5,000, a quote run twice and a
body that differs from the quoted one, and needs `ai:write:budgeted` on the
token and a signed-in viewer. Its knobs are `cannedTrainingDataUpload` (the
images an upload returns; default three fresh ones per upload, `null` for a
cancel), `trainingDataNotUploadedHere` (refuse every run as a host that forgot
its uploads would), `trainingQuoteTotal`, `runTrainingError` (`'declined'`,
`'submission-unconfirmed'`, or any server message), `runTrainingCapRefusal` (the
server's resolved cap / availability refusal, which consumes the quote →
`err.refused`) and `generation.trainedEpochs` for the finished run. It has no
upload modal and no consent dialog, so `open()` and `runTraining` settle at once
where the real host waits on the viewer; and it accepts any https blob url as an
`air`, where the server accepts only Civitai-hosted ones — name items by `air`.
**`dev:live` refuses the run** (the server refuses every training request from a
dev token) and answers the upload as a cancel.

### `useRunConfirmedStep()` — one job above the per-call budget

A pass-through `step` job (`{ kind: 'step', $type, input, maxBuzz }`) that costs
more than the app may spend without asking is refused by `submit()` — unless the
**viewer confirms that exact price** in Civitai's own dialog. This hook is that
path. It is the training run's confirm applied to any pass-through `$type`
(`polyGen`, a long video job, …). Three steps, two hooks:

1. **Quote** — `useBuzzWorkflow().estimate(body)`, the body you would submit. When
   the job qualifies the reply carries `stepQuote: { quoteId, total, stepType,
   expiresAt }`. `total` is the price the viewer will confirm and be charged.
2. **Run** — `useRunConfirmedStep().runConfirmedStep({ ...body, quoteId })`
   (`RUN_CONFIRMED_STEP`). Civitai reads the quote back from the server, shows
   the viewer the price in **its** chrome and submits on their click. Resolves
   with the submitted workflow's snapshot.
3. **Watch** — `useBuzzWorkflow().watch(snapshot.workflowId)`, as for any job.

No `stepQuote` on the estimate means the ordinary rules apply: submit it if it
fits the budget, and otherwise it cannot run from an app. Change nothing in the
body between the estimate and the run — the server checks it against the quoted
one.

🔴 **Only a fixed price is confirmable.** `stepQuote` is present when the
orchestrator quoted a **fixed** price (positive, not variable or metered) that is
above the token's per-call `buzzBudget` and at most
`BLOCK_CONFIRMED_STEP_MAX_BUZZ_PER_JOB` (5,000 Buzz). The viewer confirms what
they are charged, so a price that may move, or no price at all, gets no quote.
`stepQuote.total` can differ from `cost.total` on the same snapshot (which stays
what an unconfirmed submit would reserve) — put `stepQuote.total` on your button.

🔴 **Estimate it on its own.** Only a single `estimate()` returns a `stepQuote`.
A batch estimate (`useBatchEstimate()`) stores nothing, so its cells never carry
one: price the grid in a batch, then estimate the one body you want to run.

🔴 **Two bodies make the estimate reject instead of returning a price.** Only
where a quote would otherwise be granted, so not below the budget and not in a
batch. `estimate()` rejects with a `WorkflowEstimateError` whose
`snapshot.error` is the server's message; the same text is the
`RunConfirmedStepError`'s `message` if such a body is run. Neither has a code or
a flag — they are server messages, so match on the text:

| `snapshot.error` / `err.message` | cause | fix |
|---|---|---|
| `a training step type cannot run as a confirmed step — use kind:'training'` | `$type` is `training` or `imageResourceTraining`, in any casing | train with [`kind: 'training'`](#usepreparetrainingdataset-and-useruntraining--lora-training), which has its own dataset and checks |
| starts with `a confirmed step needs plain JSON input (objects, arrays, strings, finite numbers, booleans, null) — ` and ends with the offending path, e.g. `body.input.when is a Date` | `input` holds something that is not plain JSON: a `Date`, `Map`, `Set`, class instance, `BigInt`, `NaN`/`Infinity`, an `undefined` array element, or an empty slot in a sparse array (`… is an empty array slot`). The quote is bound to the exact body, so the body must be exactly representable | send plain JSON (an ISO string for a date, an array for a set). The suffix varies, so match on the part **before the dash** |

🔴 **Single-use, and it expires.** A quote is good for one run and for **15
minutes** (`stepQuote.expiresAt`). The server prices the job again at submit and
refuses a higher price. Estimate again to get a new one.

🔴 **Availability.** Behind the host flag **`app-blocks-confirmed-step`**, which
ships **off** and is evaluated per viewer; requires a civitai.com host carrying
civitai/civitai#5786. **Page apps only** — the model slot answers with an error.
The manifest must declare **`ai:write:budgeted`** and the viewer must be signed
in and have granted it. **Refused for development, dev-tunnel and review
tokens**, so **`dev:live` cannot exercise it**: the estimate there never carries
a `stepQuote` and the bridge replies with a refusal. Build the flow against the
mock host (below). Where the feature is unavailable nothing errors — the estimate
simply has no `stepQuote`, which is also what an older host sends.

🔴 **No retry, ever.** Every confirmation is its own job: there is no idempotency
key, and confirming the same body twice starts and charges two jobs. The hook
never re-sends and never prompts for consent, and `useBuzzWorkflow().submit()`
**refuses** a step body that carries a `quoteId` before sending anything — only
`RUN_CONFIRMED_STEP`'s dialog can confirm a quote. `runConfirmedStep` also
refuses, before sending, a body whose `quoteId` is missing or is not an
`sq_`-shaped id (a training `tq_…` quote, or `undefined` from an estimate that
returned no `stepQuote`).

`runConfirmedStep` **rejects** with a `RunConfirmedStepError`; read the flags
before saying anything about money:

| | meaning | what to do |
|---|---|---|
| `err.declined` | the viewer dismissed the confirm — **no job was submitted**; the quote is still good until it expires | revert, say nothing |
| `err.dailyLimitExceeded` | the job would exceed what remains today of the daily Buzz limit **the viewer** set for this app — **no job, nothing charged**. Civitai has already told the viewer and linked to where the limit is raised | say nothing more; do **not** retry and do **not** offer a Buzz purchase (more Buzz does not lift a limit) |
| `err.unconfirmed` | `submission-unconfirmed`, or no reply within the 10-min bound (`err.timedOut`) — the job **may be running and charged** | 🔴 **never retry automatically**: check the viewer's generations first (`useAppWorkflows()` lists this app's runs). A retry needs a new estimate and a new confirmation, and is a **second, separately charged job** if the first one started |
| `err.refused` (`code: 'refused'`) | the server refused the submit after the viewer confirmed — a **spend cap** (their daily or private-run Buzz cap, the app's daily spend or rate limit). Refunded: **no job, nothing charged**; the quote is used up | show `err.message` (the server's reason); a retry needs a new estimate and usually a later time |
| `err.signInRequired` | no session | route into `useRequestSignIn()` |
| `err.code` set otherwise | a host refusal (`review-mode` / `block is not ready` / `invalid confirmed step request` / `no block token`) | show or ignore per case |
| `err.code === undefined`, no flag | a server refusal with no job started (expired or used quote, changed body, changed price, a training `$type`, non-plain-JSON `input`, the flag is off) | fix the body if the message names it, estimate again, then retry |

```tsx
const { estimate, submit, watch } = useBuzzWorkflow();
const { runConfirmedStep } = useRunConfirmedStep();
const { requestSignIn } = useRequestSignIn();

async function generate3d(prompt: string) {
  const body: WorkflowBodyPassThroughStep = {
    kind: 'step',
    $type: 'polyGen',
    input: { prompt },
    maxBuzz: 250,
  };
  const quote = (await estimate(body)).stepQuote;

  try {
    const started = quote
      ? // Over the per-call budget: the viewer confirms `quote.total` in Civitai's dialog.
        await runConfirmedStep({ ...body, quoteId: quote.quoteId })
      : // Within it (or not confirmable): the ordinary path.
        await submit(body);
    return await watch(started.workflowId);
  } catch (err) {
    if (!(err instanceof RunConfirmedStepError)) throw err;
    if (err.declined) return; // no job — say nothing
    if (err.dailyLimitExceeded) return; // no job — Civitai already told the viewer
    if (err.signInRequired) return requestSignIn();
    if (err.unconfirmed) return showCheckYourGenerations(); // may be running — never auto-retry
    if (err.refused) return showError(err.message); // a cap refusal; no job, nothing charged
    showError('Could not start this job. Get a new price and try again.');
  }
}
```

**With the mock host** — `createMockHost` or `Harness` from
`@civitai/blocks-react/testing` — this is the only place the flow can be
exercised before a production host has it. A pass-through `step` estimate carries
a `stepQuote` whenever the mock's price for it (`generation.costPerGen`, or
`cost`) is above the token's per-call budget (`buzzBudget`, default 200) and at
most 5,000, for a signed-in viewer; there is no separate switch. As on the
server, a batch-estimate cell never carries one, and where a quote would be
granted the estimate fails instead, with the server's message, for a training
`$type` and for non-plain-JSON `input`. The mock holds the quotes it stored and
refuses an unknown, expired or already-run one, a body that differs from the
quoted one, and a plain `SUBMIT_WORKFLOW` carrying a `quoteId`. How the run
settles is `runConfirmedStepError`:

| `runConfirmedStepError` | URL | outcome |
|---|---|---|
| unset | — | the viewer confirms; the job starts, charged `stepQuote.total` |
| `'declined'` | `?confirmedStep=declined` | `err.declined`; the quote survives |
| `'daily-limit-exceeded'` | `?confirmedStep=daily-limit` | `err.dailyLimitExceeded`; the quote survives |
| `'submission-unconfirmed'` | `?confirmedStep=unconfirmed` | `err.unconfirmed`; the quote is used up |
| any other string | — | a server message; the quote is used up |

`runConfirmedStepCapRefusal` resolves the server's refunded cap refusal
(`err.refused`), and both knobs are live-tunable with `host.setScenario(...)`.

```tsx
import { createMockHost } from '@civitai/blocks-react/testing';

const host = createMockHost({
  consentGranted: true,
  generation: { costPerGen: 800 }, // above the default 200 per-call budget → quoted
  runConfirmedStepError: 'declined',
});
const uninstall = host.install();
// …later: the viewer confirms this time.
host.setScenario({ runConfirmedStepError: undefined });
```

What the mock does **not** model: it has no dialog, so the run settles at once
where the real host waits on a click; it prices every estimate as fixed, where
the real host gives a variable or metered price no `stepQuote`; and the flag, the
page-only rule and the submit-time re-price are server-side.

#### 3D outputs: `model3dOutputs`

A step that produces 3D models (`polyGen`) lists every model url in
`snapshot.imageUrls`, as before. `snapshot.model3dOutputs` says which is which:
one `{ url, format, variant }` per model, where `format` is the model's own file
format (`'glb'`, `'fbx'`, …) and `variant` is the output it came from (`'model'`,
`'riggedFbxModel'`, `'basicAnimations.walkingModel'`, …). Both are open sets
named by the orchestrator. The field is **omitted** when the workflow produced no
3D model and on hosts that predate it, and the same field is on each
`useAppWorkflows()` row.

```tsx
function modelsOf(snapshot: BlockWorkflowSnapshot) {
  const models = snapshot.model3dOutputs ?? [];
  return {
    // The plain mesh, in the format a web viewer loads.
    glb: models.find((m) => m.format === 'glb' && m.variant === 'model')?.url,
    // The rigged export, for a download button.
    riggedFbx: models.find((m) => m.variant === 'riggedFbxModel')?.url,
    // Every animation clip, whatever the host named them.
    animations: models.filter((m) => m.variant.startsWith('basicAnimations.')),
  };
}
```

In the mock host, `generation.model3dOutputs` puts labels (and their urls in
`imageUrls`) on a succeeded pass-through step.

### `useAppWorkflows(params?)`

The calling app's **own** generator subqueue — the tag-scoped list of generations
**this app** produced for the viewer (newest-first), plus a fail-closed `cancel`.
The host self-binds the account off the block token and **forces** the per-app tag
filter, so a block only ever sees the queue it produced — never the viewer's
personal queue or another app's. Returns `{ workflows, cursor, loading, error,
refetch, cancel }`; each `AppWorkflow` is `{ workflowId, status, images[], cost,
createdAt }`. Pass the returned `cursor` back as `params.cursor` to page forward.
Requires `ai:write:budgeted` (same trust boundary as submit); host-mediated over
`QUERY_APP_WORKFLOWS` / `CANCEL_APP_WORKFLOW`.

`cancel(workflowId)` sends `CANCEL_APP_WORKFLOW`, resolves once the host confirms
the terminal state (which is optimistically spliced into `workflows` in place — no
refetch round-trip), and rejects with the host's error on failure.

```tsx
const { workflows, cursor, loading, error, refetch, cancel } = useAppWorkflows({ limit: 20 });
if (!loading && !error) {
  workflows.forEach((w) => console.log(w.workflowId, w.status, w.images.length, w.cost));
}
async function onCancel(id: string) {
  try {
    await cancel(id); // optimistically flips the row to `canceled`
  } catch (err) {
    console.error('cancel failed', err);
  }
}
```

### `useAppStorage()`

KV datastore, host-mediated. Keys are **namespaced** per (block instance,
viewer); the byte and row **budgets** are enforced per (**app**, viewer), so
every instance of one app shares one budget for that viewer.

```tsx
import {
  APP_STORAGE_MAX_VALUE_BYTES, // largest single value, in wire bytes
  APP_STORAGE_MAX_BYTES,       // total stored bytes per (app, viewer)
  APP_STORAGE_MAX_ROWS,        // total rows per (app, viewer)
} from '@civitai/app-sdk/blocks';

const storage = useAppStorage();
await storage.set('key', { any: 'json' });   // rejects over ANY of the three — and on a >200-char key
const v = await storage.get<MyShape>('key'); // null if unset / anon
await storage.delete('key');                  // idempotent
const { keys } = await storage.list({ prefix: 'note-' });
const quota = await storage.getQuota();       // { usedBytes, rowCount, limitBytes, limitRows }
```

🔴 **For the byte/row budget, `getQuota()` is the authority for those two
numbers and the constants are a snapshot.** All three above are compiled-in
figures **as of the version of `@civitai/app-sdk` you installed** — which is the
same frozen-number failure mode this page used to demonstrate, just with one
copy instead of nine. The host can move any of them without your lockfile
changing. So:

- **Render `getQuota()`'s reply**, never a constant, anywhere a viewer sees a
  number or a code path decides whether a write will fit.
- **Reach for the constants only where no quota reply is available** — a
  build-time sanity check, a test fixture, a rough design-time estimate — and
  treat the answer as "roughly, at install time".
- **Re-check after any SDK bump**, and expect movement: the per-viewer clamp
  was sized against a measured distribution and the host says to expect a
  re-measure. `appStorageLimits.ts` in `@civitai/app-sdk` carries the
  provenance and a one-liner that re-derives the current values from the host.

Never hard-code a figure of your own: the docs here used to quote the app-wide
umbrella instead of the per-viewer clamp and were **25x** out on bytes and
**1000x** out on rows.

🔴 **That authority stops at the budget, and so does the list above.**
`getQuota()` answers `{ usedBytes, rowCount, limitBytes, limitRows }` and
nothing more, so it reports neither of the other two ceilings: the host's
**200-character cap on `key`**, nor `APP_STORAGE_MAX_VALUE_BYTES`, which is a
per-**write** cap rather than part of the per-(app, viewer) budget. A write that
fits the quota reply is still refused if its key is too long or its value is
over the per-value cap — and for the key, nothing local catches it
([#370](https://github.com/civitai/civitai-app-starters/issues/370), detailed
below). Cap or hash long keys in your block.

🔴 **The ROW ceiling is usually the binding one, and a byte-based "x of y used"
readout will not see it coming.** A block caching one modest record per item a
viewer touches exhausts `limitRows` while still holding a small fraction of
`limitBytes`. Show rows too.

`createMockHost()` defaults to these same ceilings and enforces the per-value
cap, the byte budget and — since it was added — the **row** budget on write, so
a row-limit overrun now fails under `dev:mock` where it previously passed and
failed only in production. Pass `storage: { quotaBytes, limitRows }` to
simulate something smaller.

⚠️ The mock is **not** gate-for-gate identical to the host. Five known
divergences:

- the byte gate refusing a shrinking overwrite that the host admits
  ([#345](https://github.com/civitai/civitai-app-starters/issues/345));
- 🔴 the byte gate counting **wire** bytes where the host counts **stored**
  bytes — `octet_length(value::jsonb::text)`, larger for every container: ~1.5x
  for a long array of small integers, and measured up to 44.4x for a
  numeric-heavy one (an array of `1e308`)
  ([#347](https://github.com/civitai/civitai-app-starters/issues/347));
- nothing models the **app-wide** umbrella, so `app quota exceeded` and `app row
  limit exceeded` cannot be produced here at all
  ([#368](https://github.com/civitai/civitai-app-starters/issues/368));
- lowering `valueCapBytes` moves the **gate** but not the **message**, which
  keeps naming the host's real cap
  ([#369](https://github.com/civitai/civitai-app-starters/issues/369));
- 🔴 no key-length cap: the host refuses a `key` over **200 characters**
  zod-side, and neither the mock nor `useAppStorage` does
  ([#370](https://github.com/civitai/civitai-app-starters/issues/370)).

Passing under `dev:mock` is evidence, not proof — and note that the second, the
third and the fifth are **permissive**: each lets a write pass locally that
production will reject. (#347 under-counts the bytes; #368 models no app-wide
ceiling at all, so a write the host would refuse with `app quota exceeded`
succeeds here; #370 admits an over-length key the host refuses outright.)
Size your fixtures against `getQuota()`, not against what the mock accepted.

🔴 **A rejection carries a host-authored MESSAGE, not a code.** There is no
`PAYLOAD_TOO_LARGE` on the wire — that is the TRPC *code*, and the host's
bridge forwards `err.message`. Six **ceiling** strings are measured and
single-sourced in the app-sdk's `blocks/appStorageErrors.ts` — one per
`PAYLOAD_TOO_LARGE` site in the host's router, plus the bridge's `storage
request failed` fallback — and `createMockHost` draws its rejections from that
same module, so for the ceilings the mock HAS it answers the message production
would send, and `classifyAppStorageError(err)` picks the same branch in both.

🔴 **Those six are not every string a block can receive — and nothing here
enumerates the rest.** The bridge catches every rejection out of
`apps.storage.*` with a *blanket* `catch` and puts its message on the same
`error` field, so the host's authorization, approval and feature-flag prose —
**plus tRPC's own zod input-validation messages, which never reach a handler at
all** — travel the identical path. **Every one of them classifies `null`.**

🔴 **One of those zod bounds is a ceiling a real block hits with no local
warning: `key` is capped at 200 characters** (`z.string().min(1).max(200)` on
the host's `get`/`set`/`delete` input schema; `list` also caps `prefix` at 200
and `cursor` at 400). Neither `useAppStorage` nor `createMockHost` caps the key
— both forward it verbatim and the mock has no length gate
([#370](https://github.com/civitai/civitai-app-starters/issues/370)) — so a key
built from a URL or a model name can save fine under `dev:mock` and fail
forever in production, classified `null`. **The reload the `null` arm below
recommends does not fix it.** Cap or hash long keys in your block.

That is the whole rule, and it is stated structurally on purpose: the SDK owns
a chosen slice of the ceiling vocabulary, not the host's error surface, so the
honest claim is "**these six** classify, everything else is `null`" — which
needs no list and stays true when the host adds or rewords a message. Note it
is deliberately *not* "every ceiling classifies": the zod key cap above is a
ceiling that lands on `null` like everything else. Two earlier drafts of this
section tried instead to enumerate the non-ceiling strings, and **both lists
were short**; see the header of `blocks/appStorageErrors.ts` for what they
missed and why no third list replaced them. `invalid block token` (an expired
token mid-session) and `block instance revoked` are *illustrations* of what
lands on `null`, never a bound on it. The practical consequence: `null` is a
busy bucket, so see the `default` arm note below before writing copy for it.

⚠️ **The mock reaches four of the six.** It models no app-wide umbrella
([#368](https://github.com/civitai/civitai-app-starters/issues/368)), so
`app quota exceeded` and `app row limit exceeded` are production-only: a block
must still handle them, and no local run will ever exercise that branch. The
other four are covered — the three ceilings, plus `storage request failed` via
`storage: { failNext }`.

Branch on the classifier's **reason**, never on the string. The reason is this
SDK's and cannot move; the message is the host's and can. (That is also why the
SDK exports `classifyAppStorageError` and the reason type, but deliberately does
*not* export the array of messages: `MESSAGES.includes(err.message)` is equality
against a snapshot, and the per-value message is a template over a cap the host
is free to change.)

```ts
import { classifyAppStorageError } from '@civitai/app-sdk/blocks';

let status = 'Saved.';
try {
  await storage.set(key, note);
} catch (err) {
  console.warn('[my-block] save failed:', err);  // log the host's words
  switch (classifyAppStorageError(err)) {        // never render them
    case 'value-too-large':
      status = 'That note is too long to save. Try shortening it.';
      break;
    case 'user-row-limit':
      status = 'You have no note slots left. Delete one to make room.';
      break;
    case 'request-failed':
      // The bridge's fallback — a transport fault. Genuinely retryable.
      status = 'Could not save that note. Please try again.';
      break;
    default:
      // `null`: an unknown ceiling, or (more often) an expired/revoked token.
      status =
        'Could not save that note. Try reloading the page — if that does not ' +
        'help, storage may be unavailable for this app right now.';
  }
}
```

🔴 **Keep the `default` arm, and do not put "please try again" in it.**
`classifyAppStorageError` answers `null` both for a ceiling message this SDK
version does not know (the host can reword one in any deploy) *and* for the
whole authorization family listed above — an expired block token, a revoked
instance, an unapproved block, a missing storage scope. Retrying fixes none of
the second group, so the generic arm should offer a **reload** (which re-mints
the token, and covers a transport blip too) and concede that storage may be
unavailable. Split `'request-failed'` out if you want honest retry copy: that
reason really is the transport one.

The mock emitted the *code* until
[#343](https://github.com/civitai/civitai-app-starters/issues/343), which is
how a block's error branch could pass every local run and never fire in
production.

### `useSharedStorage()`

App-scoped, append-only, community-votable SHARED datastore (every viewer sees
the same list). Sibling of `useAppStorage`; anonymous viewers get the read path
and a hard reject on mutations.

```tsx
const shared = useSharedStorage();
const { key } = await shared.append({ title: 'Add dark mode', body: 'please' });
const { items } = await shared.list({ limit: 20 });   // newest-first
const count = await shared.vote(key);                 // idempotent up-vote
await shared.unvote(key);
await shared.withdraw(key);                            // remove my own entry
```

#### Shared-storage write limits

Every write is budgeted per **(viewer, app)** on the server. One viewer
exhausting their budget in your app costs them nothing in another app, and
re-minting the block token does not reset it.

| Writes | Budget |
|---|---|
| `append` + `update` (one shared budget) | a **burst of 10**, refilling **1 every 6 minutes**, and a **daily bucket of 50**, refilling continuously (one every ~29 minutes). A write needs a token from both. |
| — writes the server **refused** (moderation block, the 50-entry cap, quota, not found, …) | also charged to a **rejection bucket of 10**, refilling **1 every 30 minutes**. No `append`/`update` is accepted while it is empty. Concurrent refused writes can drive it into debt, down to −10, which has to refill first. |
| `vote` + `unvote` | 30 a minute, shared |
| `withdraw` | 30 a minute |
| `report` | 20 a day |

Only writes that **land** spend the `append`/`update` budget: a write that fails
without landing gets its token back. The few failures the platform marks as its
own fault are refunded without a rejection charge too.

A write refused for budget arrives with retry metadata, and the hook rejects with
**`SharedStorageRateLimitError`**. It extends the plain `Error` every other
refusal is thrown as, so existing `catch` code keeps working, and `.message` is
still the server's text (`Too many submissions — retry in 312s`, or `votes`,
`withdrawals`, `reports`). Branch on the class to render the wait instead of
parsing the message:

```tsx
import { SharedStorageRateLimitError, useSharedStorage } from '@civitai/blocks-react';

const shared = useSharedStorage();
try {
  await shared.append({ title: 'Add dark mode' });
} catch (err) {
  if (err instanceof SharedStorageRateLimitError) {
    // err.retryAt: ISO-8601 instant a retry can succeed; err.retryAfterSeconds: whole seconds, ≥ 1.
    const at = new Date(err.retryAt).toLocaleTimeString();
    showNotice(`You're posting fast. Try again at ${at}.`);
  } else {
    throw err;
  }
}
```

- **Don't retry before `retryAt`.** A refused retry gets nothing, and once the
  budget is empty every attempt is refused until it refills.
- **Absent metadata is not "retry now".** A host that predates it, or a refusal
  that is not a rate limit, throws the plain `Error`. The hook also ignores a
  malformed `rateLimit` and throws the plain `Error`, rather than hand you
  something you would render.
- On the wire the refusal reply is `{ requestId, error, rateLimit?: { retryAfterSeconds, retryAt } }`
  (type `SharedStorageRateLimit` in `@civitai/app-sdk/blocks`) on the six write
  replies.
- `createMockHost({ shared: { rateLimitNext: 1, rateLimit: { retryAfterSeconds: 312 } } })`
  refuses the next write this way, so you can test the branch locally
  (`setScenario({ shared: { rateLimitNext } })` arms it mid-session).

### `useCheckpointPicker()`

Drive the platform Checkpoint picker + persist a viewer override.

🔴 **OMIT `baseModelGroup` BY DEFAULT.** It is an ecosystem-family FILTER, not a
label: the host HIDES every checkpoint outside the family you pass, so passing the
family you are already in is a trap — the picker then offers only the ecosystem the
user is trying to leave. Omit it for an unconstrained pick and the host applies no
narrowing at all, offering every checkpoint the viewer can generate with. Pass it
ONLY when the block must stay inside a family it already holds — a
regenerate/variation flow, say — and then DERIVE it from that checkpoint, never a
hardcoded ecosystem string: a literal pins every viewer to whichever family the
author happened to test with. `''` is **not** an escape hatch — it does not even
mean the same thing on both hosts. On a **model slot** the host normalises whatever
string you send, so `''` resolves to the real ecosystem key `Other` and NARROWS to
that one family. On a **page** the host drops a zero-length value, so `''` behaves
exactly like omitting it. Neither is what you meant on at least one surface: omit
the key, or pass a family derived from a real checkpoint, and never `''`.

```tsx
import { isModelSlotContext } from '@civitai/app-sdk/blocks';

const { context } = useBlockContext();
const { open, persist } = useCheckpointPicker();

// DEFAULT — pass no baseModelGroup. The viewer can reach every family.
if (isModelSlotContext(context) && context.checkpoint) {
  const { selected } = await open({ currentVersionId: context.checkpoint.versionId });
  if (selected) await persist(selected.versionId);   // null clears the override
}
```

Pass `baseModelGroup` **only** when the block must stay inside a family it already
holds — a regenerate or variation flow pinned to one checkpoint's ecosystem — and
then derive it from that checkpoint, never from a literal:

```tsx
import { isModelSlotContext } from '@civitai/app-sdk/blocks';

const { context } = useBlockContext();
const { open, persist } = useCheckpointPicker();

// ONLY to stay inside the family the block already holds — derived, never a literal.
if (isModelSlotContext(context) && context.checkpoint) {
  const { selected } = await open({ baseModelGroup: context.checkpoint.baseModel });
  if (selected) await persist(selected.versionId);
}
```

🔴 **`persist()` works on a model slot only. On a page it always rejects.** A
full-page app (`app.page`) is bound to no model, so the host has nowhere to write
the override: it answers every `persist()`, including `persist(null)`, with
`ok: false`, and the promise rejects with `page blocks cannot persist a
checkpoint override (no model binding)`. A page app keeps the checkpoint `open()`
returned in its own state (or in `useAppStorage()`).

Both dev hosts (`createMockHost` / `Harness` and `dev:live`) refuse it the same
way, and both default to a page context. Pass a complete `ModelSlotContext` as
`context` to exercise a block that persists. A test that expected `persist()` to
resolve under the default mock context was asserting something a page app never
gets: give it the model slot the block really runs in, or, for a page app, drop
the `persist()` call.

### `useResourcePicker()`

Drive the platform resource picker for page blocks — `'Checkpoint' | 'LORA'`.
The viewer searches in host chrome; the block only ever sees what the viewer
picked: one resource, or with `multiple` the few LoRAs they chose. DISCOVERY
ONLY — a returned `versionId` is re-validated + re-priced server-side at
estimate/submit.

🔴 **OMIT `baseModelGroup` BY DEFAULT, and never pass a HARDCODED ecosystem.** It
is an ecosystem-family FILTER, not a label: the host hides every resource outside
the family you pass, so a literal ecosystem string makes the viewer's own valid
LoRAs invisible and the picker look empty or broken. Omit it for an unconstrained
pick and the viewer sees everything of that type. Pass it ONLY when the block
already holds a chosen checkpoint the pick has to match, and then DERIVE it from
that checkpoint (`checkpoint.baseModel`). For stack and matrix apps that pair
LoRAs with a checkpoint, this is the recommended pattern: a derived family keeps
incompatible LoRAs out of the picker. This hook is PAGE-ONLY, and a page slot has
no `context.checkpoint` (that field lives on `ModelSlotContext` alone), so the
family comes from `BlockResourceInfo.baseModel`, the `baseModel` of a Checkpoint
a picker returned earlier.

For a complete multi-LoRA app, see
[`starters/examples/generate-studio`](https://github.com/civitai/civitai-app-starters/tree/main/starters/examples/generate-studio):
`src/components/ModelSection.tsx` fills one LoRA slot per picker session, up to
`MAX_LORAS`, with a `baseModelGroup` derived from the selected checkpoint, and
`keepCompatibleLoras` (`src/studio/setup.ts`) re-filters the stack when the
checkpoint changes, dropping LoRAs made for another family. To fill several
slots in ONE session, use `multiple` (below).

```tsx
const { open } = useResourcePicker();
const picked = await open({ resourceType: 'LORA' });   // unconstrained — the default
if (picked) {
  const versionId = picked.versionId;   // feed into body.additionalResources
  const weight = picked.strength;        // recommended default weight (may be undefined)
}
```

Constrained to the family of a checkpoint the block already holds, derived from
that checkpoint, never from a literal:

```tsx
const { open } = useResourcePicker();

const checkpoint = await open({ resourceType: 'Checkpoint' });
if (checkpoint) {
  const matching = await open({
    resourceType: 'LORA',
    baseModelGroup: checkpoint.baseModel,   // from the pick above — BlockResourceInfo.baseModel
  });
}
```

**Several LoRAs in one session — `multiple: { max }`.** The viewer stages up to
`max` LoRAs in the picker and confirms once; `open` resolves with a **list**, in
the order the viewer picked them, instead of a single resource. Dismissing
resolves with `[]`.

```tsx
const { open } = useResourcePicker();

const loras = await open({ resourceType: 'LORA', multiple: { max: 3 } });
// [] when dismissed; otherwise up to 3 BlockResourceInfo, in pick order
const additionalResources = loras.map((lora) => ({
  modelVersionId: lora.versionId,
  strength: lora.strength ?? 1,
}));
```

- **LoRA only.** `multiple` with `resourceType: 'Checkpoint'` is a type error and
  rejects at runtime — it is never quietly treated as a single pick.
- **`max` is a whole number of at least 1, capped at 5** (the cap on
  `additionalResources`, exported as `RESOURCE_PICKER_MULTIPLE_MAX`). A larger
  value is clamped to 5; `0`, a negative or a fraction rejects.
- **`baseModelGroup` works the same** — pass the family derived from the
  checkpoint the block holds and every LoRA offered matches it.
- **Each entry is the same `BlockResourceInfo`** a single pick returns, and every
  id is still re-validated at estimate/submit.
- **Without `multiple`, nothing changes**: `open` resolves with one resource or
  `null`, exactly as before.
- **On a host that predates multi-select** the viewer gets the single-pick
  picker, and `open` still resolves with a list: of the one LoRA they picked, or
  `[]`. The result does not say which kind of host answered, so a one-item
  list is not a signal to open the picker again: on a current host it means the
  viewer chose one. Let the viewer add more with their own action instead.

With the mock host — `createMockHost` or `Harness` from
`@civitai/blocks-react/testing` — a `multiple` request resolves with two curated
LoRAs by default. Pass `cannedMultiPicks: [...]` to choose the list (it is cut to
the request's `max`), or `cannedMultiPicks: null` for a dismissed picker. The mock
answers a raw `multiple` + Checkpoint request with the host's error.

### `useImageUpload()`

Host-mediated image upload — the host opens its native upload modal and the
iframe never handles the bytes. Resolves with a moderated image (or `null` on
dismiss); pass `{ purpose: 'generationSource' }` for an unscanned img2img source,
`{ purpose: 'trainingData' }` for several private training images in one call
(`[{ url, air }] | null` — see the LoRA training section), or
`{ asyncScan: true }` for the early-resolve + `scanStatus()` flow.

```tsx
const { open } = useImageUpload();
const img = await open();               // BlockUploadedImageInfo | null
if (img) {
  await submit({
    kind: 'textToImage',
    modelId,
    modelVersionId,
    sourceImage: { url: img.url, width: 1024, height: 1024 },
    params: { prompt },
  });
}
```

### `useUploadImageBytes()`

Upload an image the block **produced in the tab** (a healed PNG, an edited
render), with no picker, so the app can then post it. Returns `{ upload }`.
`upload(bytes, { filename? })` resolves with the same moderated image a picked
`useImageUpload()` upload returns (`imageId`, `nsfwLevel`, `contentRating`,
`url`). That `imageId` is postable by this app through
`useCreatePostFromApp()` as a `{ kind: 'published', imageIds }` source.

- 🔴 **Page apps only.** A slot (model) block's host has no handler for it. The
  host answers an unhandled request at once with its generic refusal, so on a
  slot `upload` rejects immediately with `unsupported on this host` rather than
  waiting out the 10-minute timeout.
- 🔴 **Requires `posts:write:self`.** The server refuses the upload without
  it, and this hook does not prompt. Ask for the scope first with
  `useRequestConsent()` and upload only once `useBlockToken().scopes` holds it
  (the example below), because the upload runs before the `createPost()` call
  that would otherwise prompt.
- **Images only:** PNG, WebP or JPEG by magic bytes. Anything else is refused
  with `file type is not allowed`. The host names the stored file from the
  sniffed type, whatever `filename` says.
- **The cap is 40 MiB.** The hook refuses a larger buffer before sending it,
  with the host's error `file exceeds the maximum upload size`. The host also
  allows at most 8 uploads and 80 MiB per 60 seconds per page, and replies
  `busy` past that.
- **The upload is blocking.** The host replies once the image is scanned, so
  allow for a wait of up to a few minutes. An image above the SFW ceiling or
  flagged by the scan is refused with the scan's message.
- Pass an `ArrayBuffer` (`await blob.arrayBuffer()`). A `Blob`, a
  `Uint8Array` or an empty buffer is refused with
  `invalid image-upload request`. The buffer is copied, not transferred.

`upload` **rejects** with the host's error string on every refusal: the ones
above, `no block token`, or a server message passed through verbatim (the
missing scope, the posting flag, page-only, a rate limit, the scan). It
rejects with `the host returned no uploaded image` if the reply carries
neither an image nor an error. If no reply arrives within 10 minutes it
rejects with a `RequestTimeoutError`; the host may still have stored the
image, so retrying after a timeout can create a duplicate.

The hook ships in `@civitai/blocks-react` 0.67.0, and the `bytes` payload type
it sends is in `@civitai/app-sdk` 0.62.0.

What the upload does and does not give you on civitai.com:

- 🔴 **Generation metadata embedded in the file is not read.** The posted
  image has no generation details (prompt, resources, sampler settings),
  whatever the PNG or JPEG carries. In the example below the healed pixels are
  posted, and the metadata the app repaired is not shown on the post.
- 🔴 **Each uploaded image goes into exactly one post.** Once a post holds it,
  `createPost()` refuses that `imageId` with `an image is not available to post`.
  To post the same picture again, upload it again.
- **An uploaded image never appears in `useGatedImages()`.** That read returns
  only what the app published with `usePublishGenerationOutputs()`. Keep the
  `imageId` and `url` that `upload` resolves with if you need to show it.
- **A post holds at most 20 images and names at most 10 sources.** Past 20
  images the server refuses with `a post may contain at most 20 images`.
- **Posting from apps is still being rolled out.** A viewer who does not have it
  yet is refused with `posting from apps is not enabled`, and the refusal
  arrives from `upload` as well as from `createPost()`. Handle it as an
  ordinary error branch, not as a bug in your app.
- **Creating the post needs an account with a verified email or a linked
  sign-in provider.** Other account checks apply too: onboarding must be
  finished, the account must not be brand new, and it must not be muted or
  banned. `upload` refuses a banned account but checks none of the rest, so a
  viewer can upload and then be refused at `createPost()`.
- **Server-side limits also apply**, to the upload and to the post, beyond the
  host's per-page window above. A `busy` reply or a rate-limit error such as
  `Rate limit exceeded, please retry shortly.` means wait and retry.

```tsx
import {
  CreatePostError,
  useBlockToken,
  useCreatePostFromApp,
  useRequestConsent,
  useUploadImageBytes,
} from '@civitai/blocks-react';

function PostHealedButton({ healed }: { healed: Blob }) {
  const { scopes } = useBlockToken();
  const { requestConsent } = useRequestConsent();
  const { upload } = useUploadImageBytes();
  const { createPost } = useCreatePostFromApp();
  const canPost = scopes.includes('posts:write:self');

  async function onClick() {
    if (!canPost) {
      // Fire-and-forget: this opens the host's consent dialog and returns
      // nothing. On a grant the host pushes a new token, `scopes` updates and
      // the button re-renders as "Post". Never upload before that: the server
      // refuses the upload without the scope.
      requestConsent({ scopes: ['posts:write:self'] });
      return;
    }
    try {
      // 1. Bytes made in the tab, uploaded and scanned by the host.
      const image = await upload(await healed.arrayBuffer(), { filename: 'healed.png' });
      // 2. Posted through the existing bridge, with its own confirm.
      const post = await createPost({
        sources: [{ kind: 'published', imageIds: [image.imageId] }],
        title: 'Fixed with Metadata Healer',
      });
      showToast(`Posted! ${post.url}`);
    } catch (err) {
      if (err instanceof CreatePostError && err.declined) return; // the viewer said no
      showToast((err as Error).message); // e.g. 'busy', 'file type is not allowed'
    }
  }

  return <button onClick={onClick}>{canPost ? 'Post' : 'Allow posting'}</button>;
}
```

Under `createMockHost` / `Harness` the host's checks run in the host's order:
the cap, then the window, then the type. `uploadImageBytesResult` sets the
image an accepted upload returns, `uploadImageBytesError` forces a refusal
(for example `block lacks posts:write:self scope`), and `onUploadImageBytes`
reports what was accepted. The mock's `CREATE_POST_FROM_APP` checks a
`published` source with the server's rule and refusal strings, but not its
data. Production accepts the viewer's own images that this app stamped and that
are not in a post yet, including ones from earlier sessions. The mock has no
earlier sessions, so it accepts only ids it issued as postable in this session
(an accepted bytes upload, or a `PUBLISH_GENERATION_OUTPUTS` reply) plus the
ids you seed with `createMockHost({ postableImageIds: [...] })`, each in one
post only. Any other id, a picked `useImageUpload()` id (production leaves it
unstamped) or an already-posted id is refused with
`an image is not available to post`. The mock does not model the page-only
rule, the scope check, the real scan, or an older host's picker. `dev:live` has
no bytes path: `upload` rejects with `the host returned no uploaded image`.

### `useImagePicker()`

Let the viewer pick one of their **existing** Civitai images: the ones they have
posted, and the ones they made with the Civitai generator. The host opens its own
picker over the viewer's library, and your app receives only what the viewer
picked. Returns `{ open }`. `open()` resolves with one image, or `null` if
nothing was picked.

```tsx
const { open } = useImagePicker();

const image = await open();   // BlockPickedImageInfo | null
if (image) {
  // image.source     'posted' | 'generated'
  // image.url        a Civitai-hosted image URL
  // image.width, image.height
  // image.nsfwLevel  the image's rating; it can be a mature level
  // image.imageId    set for a posted image, undefined for a generated one
}
```

**Several images in one session: `multiple: { max }`.** `open` then resolves with
a **list** of up to `max` images instead of a single image, or `[]` if nothing
was picked.

```tsx
const { open } = useImagePicker();

const images = await open({ multiple: { max: 5 } });
// [] when nothing was picked; otherwise 1 to 5 images
const urls = images.map((image) => image.url);
```

**One library only: `sources`.** Pass `['posted']` or `['generated']` to offer
just that library. Leave it out to offer both.

```tsx
const { open } = useImagePicker();

const output = await open({ sources: ['generated'] });
// output?.imageId is always undefined here: a generator output has no image id
```

If your app decides at runtime whether to ask for one image or several, pass
`multiple` as a value that may be `undefined`. The result is then either shape,
so narrow it with `Array.isArray`:

```tsx
const { open } = useImagePicker();

const picked = await open({ multiple: allowSeveral ? { max: 3 } : undefined });
const images = Array.isArray(picked) ? picked : picked ? [picked] : [];
```

What the viewer can pick, and what you get back:

- **The host decides what is pickable.** Posted images: the viewer's own, in a
  published post, fully scanned, not flagged and rated. Generated images: the
  viewer's own finished generator outputs that have a rating. In both cases the
  viewer is offered only what their own browsing settings on Civitai allow them
  to see. An unrated image is never offered. Images only, no video. Your app
  never sees the rest of the library.
- 🔴 **A pick can be a mature image.** `nsfwLevel` is the image's rating, and it
  is never `0`. The image was offered to this viewer under this viewer's own
  settings. That says nothing about anyone else. If your app shows a pick to
  anybody other than the viewer who picked it (a shared board, a gallery, a
  public post), it is your app's job to check `nsfwLevel` and decide who may
  see it.
- **`imageId` is set only on a posted image.** A generator output that was never
  posted has no image id, so check `image.source` or `image.imageId` before you
  use it.
- **A posted pick's `url` is a resized copy, not the original file.** `width` and
  `height` are the size that copy is requested at. The host chooses one with both
  sides between 64 and 2048 pixels, and a small original is scaled up. The image
  server normally returns exactly that size, but it can return the original
  while the resized copy is still being produced. A posted image that has no
  size in that range (a very long or very wide one) is not offered.
- 🔴 **A generated pick's `url` is the generator's own output link and may stop
  working after a while.** Use it soon after the pick and do not store it for
  later. Its `width` and `height` are the output's own size.

What `open` resolves and rejects with:

- **`null` (or `[]` with `multiple`) means nothing was picked.** Usually the
  viewer closed the picker. A signed-out viewer sees the picker with a sign-in
  button, and closing it gives the same result. The host also answers this way
  immediately, without showing a picker, while your app is being viewed in
  review mode or is not ready yet.
- **`max` is a whole number of at least 1, capped at 20** (exported as
  `IMAGE_PICKER_MULTIPLE_MAX`). A larger value is clamped to 20. `0`, a negative
  number or a fraction rejects before anything is sent, and so does an empty
  `sources` or a value other than `'posted'` and `'generated'`.
- **A refusal rejects.** If the host refuses the request, `open` rejects with an
  `Error` carrying the host's message. It never resolves with `null` for a
  refusal.
- **Page apps only.** On any other surface the host answers at once and `open`
  rejects with `unsupported on this host`.
- **On a host that does not have the picker yet**, the request gets no answer and
  `open` rejects with a `RequestTimeoutError` after 10 minutes.

Using a pick as the source image of a generation: a pick's `url` is hosted by
Civitai, so `{ url, width, height }` passes the address check a generation body
makes on its `sourceImage`. That is the only thing this hook settles. The
generation body has its own rules, including 64 to 2048 pixels per side. A posted
pick is already within that range. A generated pick can be larger, and a
generation body refuses a size above 2048.

With the mock host (`createMockHost` or `Harness` from
`@civitai/blocks-react/testing`) there is no picker to click through: `open`
resolves at once. By default the mock holds one posted image and one generated
image. Pass `cannedImagePicks: [...]` to set the viewer's library. The mock keeps
only the images matching the request's `sources`, then answers a single pick with
the first one and a `multiple` pick with the first `max`. `cannedImagePicks: null`
is a viewer who always closes the picker. Like the host, the mock offers a
repeated image once and drops an `imageId` from a generated image. It does not
model browsing settings or ratings: it returns whatever `nsfwLevel` you give an
image, so use that to test how your app handles a mature pick. The mock refuses
an invalid `sources` or `multiple` with an error, and answers
`unsupported on this host` when its `context` is a model slot. `dev:live` cannot
list the viewer's images, so there `open` rejects with a message saying to use
the mock host.

### `useMediaUpload()`

**The way to pass any media (image, video or audio) into a workflow step.** The
host refuses data URIs and inline base64 in step inputs, so upload the file
with this hook and pass the `url` it returns into the step input. Returns
`{ open, upload }`.

- **`open({ kind })`** opens the host's own file picker for that kind. The
  viewer picks a file, the host uploads it, and `open` resolves with the
  upload, or `null` if nothing was uploaded.
- **`upload({ kind, bytes, mimeType? })`** uploads media your app already
  holds in the tab, with no picker: a canvas export, a crop, a `MediaRecorder`
  recording. It resolves with the upload, and never resolves without one.

```tsx
import { useMediaUpload } from '@civitai/blocks-react';

function UseRecording({ recording }: { recording: Blob }) {
  const { upload } = useMediaUpload();

  async function onClick() {
    const audio = await upload({
      kind: 'audio',
      bytes: await recording.arrayBuffer(),
      mimeType: recording.type, // optional; checked against the content
    });
    // audio.url goes into the step's audio input
    startStep({ audioUrl: audio.url });
  }

  return <button onClick={onClick}>Use this recording</button>;
}
```

```tsx
const { open } = useMediaUpload();

const video = await open({ kind: 'video' }); // BlockMediaUploadInfo | null
if (video) {
  // video.url, video.width, video.height, video.durationMs (when known)
}
```

What each kind accepts, decided by the file's **content** (its first bytes),
never by its name or declared type:

| `kind` | Accepted | What you get back |
|---|---|---|
| `'image'` | PNG, JPEG, WebP | Resized so both sides are 64 to 2048 pixels and re-encoded as JPEG: `mimeType` is always `'image/jpeg'`, and `sizeBytes`, `width` and `height` describe that JPEG. |
| `'video'` | MP4, WebM | Uploaded as sent. `width` and `height` are always set (a file with no video track is refused). `durationMs` when the browser reports a duration. |
| `'audio'` | MP3, WAV, WebM | Uploaded as sent. No `width` or `height`. `durationMs` when the browser reports a duration: a `MediaRecorder` WebM often reports none, so do not rely on it. |

- **At most 24 MB per image, and 64 MB per video or audio file.** The image
  cap is lower because the host decodes an image in full before it resizes it.
  `upload` refuses a larger buffer before sending it, with the host's own
  message: `file exceeds the 24 MB image upload limit` or
  `file exceeds the 64 MB upload limit`.
- **`upload` is rate-limited:** at most 8 uploads and 128 MB per 60 seconds
  per page. Past that the host replies `busy`; wait and retry. A refused upload
  does not count. `open` is not limited this way, because a person picks each
  file.
- **`mimeType` is optional.** When you pass it (for example `blob.type`) it
  must match the content, or the upload is refused with
  `mimeType does not match the file's content`. Case and parameters such as
  `;codecs=opus` are ignored, and `audio/x-wav` counts as `audio/wav`.
- Pass an `ArrayBuffer` (`await blob.arrayBuffer()`). A `Blob`, a typed array
  or an empty buffer is refused before sending with
  `invalid media-upload request`. The buffer is copied, not transferred.
- A file whose content is not one of its kind's types is refused with
  `images must be PNG, JPEG or WebP`, `videos must be MP4 or WebM` or
  `audio must be MP3, WAV or WebM`. The host also refuses a file it cannot
  read (`could not read this video file`, `could not read this audio file`), a
  video with no video track (`this file has no video track`), and an image too
  small to resize to 64 pixels. A failed upload rejects with
  `media upload failed — please try again`, and a file the upload service
  refuses with `this video was refused by the upload service` or
  `this audio was refused by the upload service`. A bytes upload made while
  the host holds no block token rejects with `no block token`.

What `open` and `upload` resolve and reject with:

- **`open` resolves `null` when nothing was uploaded.** Usually the viewer
  closed the picker. The host also answers that way at once, without showing a
  picker, while your app is viewed in review mode or is not ready yet. A
  problem with the picked file is shown in the picker, where the viewer can
  pick another one.
- **`upload` never resolves `null`.** When the host declines without
  uploading (review mode, not ready), `upload` rejects with
  `the host did not upload the media (the app is in review mode or not ready)`.
- **A refusal rejects** with the host's message, in both modes. On a surface
  other than a page app the host answers at once with
  `unsupported on this host`.
- **Both wait up to 10 minutes** for the host (a person picking a file, or a
  large upload), then reject with a `RequestTimeoutError`.

For images only, `useImageUpload().open({ purpose: 'generationSource' })` still
works and returns `{ url, width, height }`. Use `useMediaUpload` for video,
audio, or bytes your app made in the tab.

🔴 **Needs a host that answers `OPEN_MEDIA_UPLOAD`** (civitai/civitai#6149).
On a civitai.com that predates it, the request gets no answer and both calls reject with a
`RequestTimeoutError` after 10 minutes.

With the mock host (`createMockHost` or `Harness` from
`@civitai/blocks-react/testing`) there is no picker: `open` resolves at once
with a built-in upload for the kind. Set `cannedMediaUploads: { video: {...} }`
to choose what a kind returns, or `{ audio: null }` for a viewer who closes
that picker. `upload` runs the host's checks in the host's order (kind,
purpose, an invalid buffer, the per-kind cap, the rate window, the content type,
a mismatching `mimeType`) and answers with that kind's upload, carrying the
sniffed `mimeType` and the buffer's size for video and audio. The mock cannot
decode media, so it never produces the host's decode-time refusals (an
unreadable file, no video track, an image too small, an upload failure): set
`mediaUploadError: 'this file has no video track'` to force one.
`mediaUploadError: 'no block token'` is checked where the host checks it: a
bytes upload is refused before the cap and the window, and is not counted. A model-slot
`context` answers `unsupported on this host`. `dev:live` cannot upload
generation inputs, so there both calls reject with a message saying to use the
mock host.

### `useSaveImage()`

Ask the host to download a file to the viewer's device. **A block cannot
download anything itself.** Its sandbox lacks `allow-downloads`, and the
validator refuses that token for unverified blocks, so an
`<a href="blob:…" download>` click silently does nothing. 🔴 **This hook is the
sanctioned way to deliver a file**, including one the block produced in the tab.
Pass exactly ONE of three inputs, each gated differently by the host:

- **`{ url }`**: the block's own generation output. The host allowlists the
  origin to the civitai image CDN and refuses any other.
- **`{ imageId }`**: an image from another user, read through the same
  per-viewer gate as `useGatedImages()`. A withheld image is never saved.
- **`{ bytes }`**: an `ArrayBuffer` the block made in the tab, such as a healed
  image or a JSON sidecar. 🔴 **Page apps only.** The host classifies it by
  CONTENT. It accepts PNG, WebP and JPEG by magic bytes. Anything else must be
  valid UTF-8 with no NUL byte: it is saved as JSON when it parses and
  `filename` ends `.json` (any case) once the host has replaced each `?` and
  `#` with `_`, and as plain text otherwise. A GIF, a zip
  or other binary is refused with `file type is not allowed`. The host forces
  the extension from the classified type. The cap is 50 MiB, and the hook
  refuses a larger buffer before sending it: `file exceeds the maximum save
  size`. The buffer is copied, not transferred, so you can keep displaying it.

🔴 **On a host that predates the `bytes` variant, `saveImage({ bytes })` rejects
with `invalid save-image request`.** The host also replies that when the input
is not exactly one variant, or when `bytes` is empty or not an `ArrayBuffer`.
Pass `await blob.arrayBuffer()`, not the `Blob` or a `Uint8Array`. The promise
resolves once the host has started the download. On any refusal it rejects with
the host's error string, which can also be `busy` when too many saves are in
flight.

```tsx
import { useSaveImage } from '@civitai/blocks-react';

const { saveImage } = useSaveImage();

// A file healed in the tab. It never leaves the device except to the viewer's disk.
const healed: Blob = await healPngMetadata(file);
await saveImage({ bytes: await healed.arrayBuffer(), filename: 'healed.png' });

// Its JSON sidecar. The .json filename makes valid JSON save as .json rather than .txt.
const sidecar = new TextEncoder().encode(JSON.stringify(metadata, null, 2));
try {
  await saveImage({ bytes: sidecar.slice().buffer, filename: 'healed.json' });
} catch (err) {
  // 'invalid save-image request' here means this host cannot save bytes yet.
  setStatus(`Could not save the sidecar: ${(err as Error).message}`);
}

// The block's own generation output, or another user's image.
await saveImage({ url: output.url, filename: 'render.png' });
await saveImage({ imageId: cell.imageId });
```

Under `createMockHost` / `Harness` the `bytes` variant is classified the same
way. `onSaveBytes` reports what would have been downloaded, and `saveImageError`
forces a refusal. Pass `saveImageError: 'invalid save-image request'` to test a
host without the variant. `dev:live` refuses every save.

### `useGenerationResources()`

Rehydrate a saved set of generation resources by version id — WITHOUT re-opening
the picker. Returns the same widened projection `useResourcePicker` yields
(recommended weights, trigger words, clipSkip). DISCOVERY ONLY.

```tsx
const { fetch } = useGenerationResources();
const resources = await fetch([691639, 666002]);   // by saved versionIds
const first = resources[0];             // .versionId / .strength / .trainedWords / .clipSkip
```

### `useCivitaiNavigate()`

Request a navigation from the host. The hook sends a `NAVIGATE` message and
returns — fire-and-forget, so the block never learns what the host did,
including when the host **refuses** the request.

`scope` selects the **space** `path` is resolved in, and it **defaults to
`'app'`**:

| `scope` | `path` resolves | The viewer |
|---|---|---|
| `'app'` *(default)* | under **this app's own route**, as a sub-path of it | stays in your app; the page stays mounted |
| `'site'` | at the **civitai.com root** | leaves your app for a site page |

> 🔴 **A leading slash carries no meaning.** The host normalises it away in
> **both** scopes, so `'/settings'` and `'settings'` are one request within
> whichever scope you chose. That means `navigate('/models/12345')` asks for
> **your app's** `/models/12345` — *not* civitai's model page. To reach the
> civitai.com page, say so: `navigate('models/12345', { scope: 'site' })`.
>
> Both spellings were app-scoped before `scope` existed, so no call you have
> already written changed meaning — that is the point of the default.

`'site'` is granted **per-surface**: the public run page and the dev tunnel allow
it, and a private run or a moderator's review preview refuse it. A refusal is
silent, so do not build a flow that needs to know it happened.

`target` is a REQUEST, not a guarantee. How the host acts on `'current'` vs
`'new_tab'` is host-side behaviour and the host is the authority on it; this
package sends the message and makes no promise about the outcome.

> 🔴 **Nothing in your manifest enables `'new_tab'`.** In particular, do **not**
> declare `allow-popups-to-escape-sandbox`: the host intersects a manifest's
> `iframe.sandbox` with a fixed allowlist that does not contain that token, so it
> is dropped for every block at every trust tier and declaring it has no effect.
> Earlier versions of this page said `'new_tab'` required it — that was wrong.

```tsx
const { navigate } = useCivitaiNavigate();

// Your app's own pages — the default.
navigate('settings');                    // this app's /settings
navigate('/settings');                   // identical; the slash means nothing

// A civitai.com page — needs an explicit scope.
navigate('models/12345', { scope: 'site' });
navigate('models/12345', { scope: 'site', target: 'new_tab' });

// The pre-`scope` two-argument shape still works, and is still app-scoped.
navigate('detail/7', 'new_tab');
```

An app-scoped `navigate()` is **half** of a round trip. The host owns the
history, so the way your block learns where it ended up is
[`useCivitaiRoute()`](#usecivitairoute) — read that next if you are routing.

### `useCivitaiRoute()`

The sub-path below your app's root that is **currently showing**. This is the
other half of an app-scoped [`useCivitaiNavigate()`](#usecivitainavigate): you
ask the host to move, the host pushes it shallowly so your frame stays mounted,
and this is how you find out where you went.

```tsx
function Router() {
  const subPath = useCivitaiRoute(); // '' on your app's index
  const [view, id] = subPath.split('/');
  return view === 'compare' ? <Compare id={id} /> : <Index />;
}
```

It also reports the moves you **did not** ask for: the viewer's own
back/forward, and a deep link the host resolved after init.

Two things set the value — `BLOCK_INIT`'s `context.subPath` at mount, and the
host's `ROUTE_CHANGED` push on every later change. **The first value is never a
message**, which is why this is a value hook rather than an `onRouteChanged`
callback: a callback alone cannot see where the block started, and a change that
lands before its subscription effect runs is lost. It is the same value as
`useBlockContext().context.subPath` on a page slot — reach for this when the
route is all you need, and because its return type is a plain `string` instead of
a field on a union you have to narrow.

> 🔴 **No leading slash.** The host sends the segment below your app root, so
> `subPath === 'compare/42'` is the comparison that works and
> `subPath === '/compare/42'` is the one that silently never matches.

> 🔴 **`''` is a real route — your app's index — and it is also the pre-init
> value.** The two are indistinguishable from this hook alone, exactly as
> `'light'` is both a real theme and [`useBlockTheme()`](#useblocktheme)'s
> pre-init value. Gate on `useBlockContext().ready` if your first paint must tell
> them apart.

> 🔴 **Read it on every render.** A block that copies the value into state once
> at mount, or routes imperatively in a mount-only effect, stays on the route it
> started with — the URL moves and nothing renders, which is the exact symptom
> this message exists to end.

**Page slot only.** A model-page slot has no route of its own, so this returns
`''` there and never moves. Against a host that predates `ROUTE_CHANGED` the
value simply stays at the init sub-path (the old behaviour); nothing awaits the
message, so there is no hang either way.

Exercise it locally with `pnpm dev:live`, where `navigate()` drives the real
message end-to-end. `createMockHost` has **no** route control, deliberately: it
does not handle `NAVIGATE` at all and has no URL to move, so a synthetic setter
there would be a second, weaker way to produce a message the live host already
produces from the call a block actually makes.

### `useBlockAnalytics()`

Custom events for your app's analytics panel. Fire-and-forget: no reply, no
acknowledgement.

```tsx
const { track } = useBlockAnalytics();
track('generate_clicked', { mode: 'txt2img', batch: 4 });
```

🔴 **Only what your manifest DECLARES is recorded.** Declare every event, and
every property it carries, under `analytics.events` in `block.manifest.json`.
Events are accepted against the APPROVED manifest, so a reviewer sees what your
app tracks:

```json
"analytics": {
  "events": {
    "generate_clicked": {
      "description": "User pressed Generate",
      "properties": {
        "mode": { "type": "enum", "values": ["txt2img", "img2img"] },
        "batch": { "type": "number" },
        "advanced": { "type": "boolean" }
      }
    }
  }
}
```

| You send | Production |
|---|---|
| A declared event, declared properties of the declared type | Recorded |
| An event the manifest does not declare | Counted as a drop; its name and properties are not stored |
| A property the event does not declare | Dropped; the rest of the event is recorded |
| A value of the wrong type, or a string that is not one of the enum's values | Dropped; the rest of the event is recorded |

- **Types are `enum`, `number` and `boolean`.** There is no free-text string, so
  a prompt, an email or a username cannot be recorded. A `number` is not
  range-limited: do not use one to carry an identifier.
- **Names** are lowercase snake_case (a letter, then up to 63 of `a-z`, `0-9`,
  `_`). At most 50 events per app and 10 properties per event.
- **Limits.** Each mount of your app may send 10 events a second and 500 in
  total, in bodies of at most 32 KiB. An event over a limit is dropped in the
  browser and counted nowhere, so the panel's numbers are floors.
- **Where.** Events are recorded only from the production site.
- **What owners see.** Aggregates in the app's analytics panel: per declared
  event, counts, unique signed-in viewers and property breakdowns. Signed-out
  viewers are counted as events, never identified. The team's own activity is
  excluded by default. Individual events are never shown.

**Check it locally.** Pass your manifest to `createLiveHost` (see
[`/live`](#in-a-devlive-harness)); in `dev:live` the console then warns once per
undeclared event, undeclared property, or value of the wrong type. Every
`starters/examples/*` harness does this.

### `useRequestSignIn()`

Ask the host to open its sign-in flow for an ANONYMOUS viewer (fire-and-forget).
On sign-in the host re-inits the block with the now-authenticated viewer.

```tsx
const { requestSignIn } = useRequestSignIn();
// e.g. onClick of a "Sign in to generate" button:
requestSignIn();
```

### Automatic consent prompt-and-retry (on by default)

**You usually do not need to write any of this.** Since `1.0.0` the
consent-gated calls below handle a missing scope themselves: the call fails, the
SDK opens the host's consent dialog naming the scope the call needs, waits for
the grant, and then **retries the original call once** so it resolves as if it
had just worked.

| Hook | Call | Scope it prompts for |
|---|---|---|
| `useBuzzWorkflow()` | `submit()` | `ai:write:budgeted` |
| `useCreatePostFromApp()` | `createPost()` | `posts:write:self` |
| `useGoodPurchase()` | `purchase()` | `goods:purchase:self` |
| `useTip()` | `tip()` | `social:tip:self` |

🔴 **`estimate()` is deliberately NOT in that table.** It is a price READ, and
blocks call it from an effect keyed on the generation form — on mount, and again
on every parameter change. Prompting there would open a consent dialog with no
user gesture behind it, once per edit. A failed `estimate()` rejects exactly as
it always has; show no price and let `submit()` do the asking.

The same goes for `useBatchEstimate()`. Until the viewer grants
`ai:write:budgeted` the host refuses **every** estimate, single and batch, with
`block lacks ai:write:budgeted scope` (`WorkflowEstimateError` / `BatchEstimateError`,
code `'failed'`). To show a price before the first Generate, ask on a user
gesture and estimate again once the grant lands:

```tsx
import { useEffect, useState } from 'react';
import { useBlockToken, useBuzzWorkflow, useRequestConsent } from '@civitai/blocks-react';
import type { WorkflowBody } from '@civitai/app-sdk/blocks';

function Price({ body }: { body: WorkflowBody }) {
  const token = useBlockToken();
  const { requestConsent } = useRequestConsent();
  const { estimate } = useBuzzWorkflow();
  const [price, setPrice] = useState<number | null>(null);
  const canPrice = token.scopes.includes('ai:write:budgeted');

  // Keyed on `canPrice`, so the quote is fetched again when the grant lands.
  useEffect(() => {
    if (!canPrice) return;
    estimate(body).then((s) => setPrice(s.cost?.total ?? null), () => setPrice(null));
  }, [canPrice, body, estimate]);

  if (!canPrice) {
    return (
      <button onClick={() => requestConsent({ scopes: ['ai:write:budgeted'] })}>
        Allow generations
      </button>
    );
  }
  return <span>{price === null ? '…' : `${price} Buzz`}</span>;
}
```

The mock host enforces this too (since `@civitai/blocks-react` 0.70.0, #608): with
the default `consentGranted: false` its estimate, batch estimate and submit
refuse exactly as the host does, `REQUEST_CONSENT` grants and pushes the
refreshed token, and `consentGrantable: false` keeps the refusal in place.

```tsx
// This is the whole thing. No try/catch around a consent prompt, no watching
// useBlockToken().scopes, no manual retry.
const { submit } = useBuzzWorkflow();
const snapshot = await submit(body);
```

🔴 **The retry re-sends the FIRST attempt's `idempotencyKey`.** That is what
makes it safe on the money paths: `submit()`, `purchase()` and `tip()` mint the
key once, before the first attempt, so however many attempts one call makes the
server sees **one** logical operation and charges once. A retry with a fresh key
would be a second reservation against the viewer's Buzz.

It **never** retries when:

- the token already holds every scope the call needs (so the failure was not
  about consent — a rate limit, a 5xx, a bad body all behave exactly as before);
- the call failed **before `BLOCK_INIT`** landed. There is no real token yet, so
  "the token is missing this scope" is not a fact about consent;
- the host has pushed `CONSENT_UNAVAILABLE` **naming a scope this call needs** —
  that scope can never be granted here, so a retry is a guaranteed second
  failure. A refusal that names *other* scopes leaves this call alone, and one
  that names **none** (the payload's `scopes` is documented as advisory and may
  be empty) is treated as covering everything, which is the safe reading;
- the viewer dismissed a host confirm (`declined`), or there is no session to
  grant anything to (`signInRequired` — route that into `useRequestSignIn()`);
- the component **unmounted** — including *during* the 60 s wait, so a grant that
  arrives after your component is gone does not spend anything;
- the request timed out on a bridge with **no idempotency key** (`createPost()`,
  collection follow) — the retry would be a genuine second write, i.e. a second
  public post. A timeout on a call that HAS a key — `submit()`, `purchase()`,
  `tip()` — *is* retried, because the retry re-sends that key and the server
  collapses the two into one operation;
- **a second time.** One retry, never a loop. A second consent failure surfaces
  to you unchanged.

If the viewer never answers the dialog, the **original** error is re-thrown after
60 s and your `catch` sees exactly what it would have seen before.

⚠️ **One failure is deliberately NOT excluded:** a host refusal about the
*payload* rather than the token — `createPost()`'s `'no images to post'` — still
prompts, because nothing distinguishes it structurally from a genuine consent
failure without string-matching server copy. The cost is one needless dialog; the
retry re-opens the host's own confirm and cannot publish anything new.

**Concurrent callers share one dialog.** `N` calls that are in flight together and
need the same scope post **one** `REQUEST_CONSENT` and wait on it together — a
feed of tip buttons does not open a dialog per button. Each call still retries its
**own** request with its **own** idempotency key, so *N* tips remain *N* transfers.
⚠️ This is de-duplication of *concurrent* waits only: calls made one after another
each get their own prompt, which is the shape that keeps `estimate()` out of the
table above.

Opt out per call — the same single option on every hook above:

```tsx
await submit(body, { autoRequestConsent: false });   // pre-1.0 behaviour
```

⚠️ **Not covered:** a scope your **manifest** never declared can never be granted
either, and a block cannot see its own manifest at runtime — so that case is
caught one round-trip late, by the host's `CONSENT_UNAVAILABLE`, rather than
before the first attempt. Declare the scopes your app uses.

### `useRequestConsent()`

The manual version of the above — still exported, still the right tool when you
want to prompt *before* a call (e.g. on an onboarding screen) rather than after
one fails.

Lazy consent: ask the host to open its consent UI when a LOGGED-IN viewer takes
an action whose consent-gated scope the block token is missing (e.g. Generate
needs `ai:write:budgeted` but the viewer hasn't granted it). Fire-and-forget —
on grant the host pushes a new token; observe `useBlockToken().scopes` and retry.

```tsx
import { useRequestConsent } from '@civitai/blocks-react';

const { requestConsent } = useRequestConsent();
requestConsent({ scopes: ['ai:write:budgeted', 'buzz:read:self'] });
```

🔴 **Always pass `scopes`, with a real scope name in it — it is optional in the
signature but a precondition for the refusal path below.** The host grants the
missing set it computed at mint, so a bare `requestConsent()` still opens the
consent dialog. But `CONSENT_UNAVAILABLE` is computed *from the hint*: with no
explicit scope proven un-grantable, the host cannot tell "can never be granted"
from "the viewer hasn't confirmed yet", so it stays silent rather than guess.

The bar is an array holding **at least one non-empty string** — not merely "an
array is present". `undefined`, a non-array, `[]`, `['']` and `[1, 2]` all
produce silence, in `pnpm dev` and in production alike, so
`requestConsent({ scopes: [] })` follows the instruction and still receives
nothing. To its author that reads as a broken message rather than a thin
argument.

### `useConsentUnavailable()`

Some environments withhold a scope at mint (a dev-tunnel preview token, a surface
that carries no money scope), so no consent round-trip can ever add it. The host
then pushes an uncorrelated `CONSENT_UNAVAILABLE` — *not* a reply, because
`REQUEST_CONSENT` carries no `requestId`. Consume it and stop telling the user to
retry something that can't succeed:

```tsx
import { useConsentUnavailable, useRequestConsent } from '@civitai/blocks-react';

function ConsentAwareGenerate() {
  const { requestConsent } = useRequestConsent();
  const { refusal, reset } = useConsentUnavailable();

  // 🔴 Branch on `refusal !== null`, NEVER on `refusal.scopes.length`. The host
  // refuses on its own unfiltered set but names only scopes in the public
  // vocabulary, so `scopes: []` is a legitimate refusal — gating on the length
  // silently drops the very message you subscribed for. Use the names for copy.
  if (refusal) {
    return (
      <div>
        <p>Generating isn't available on this page.</p>
        <button onClick={reset}>Try again</button>
      </div>
    );
  }
  // 🔴 `scopes` is REQUIRED for a refusal to ever arrive — see above.
  return <button onClick={() => requestConsent({ scopes: ['ai:write:budgeted'] })}>Generate</button>;
}
```

`refusal` holds the latest `ConsentUnavailablePayload` (`{ reason, scopes }`) or
`null`; `reset()` clears it, since a refusal is scoped to the scopes that were
asked for and shouldn't latch for the life of the block. Against a host that
never sends the message the hook simply stays `null` — nothing awaits it, so
there is no timeout to hit.

🔴 **The push is UNCORRELATED, and that is the permanent shape of this API.**
`REQUEST_CONSENT` carries no `requestId`, so a refusal cannot be matched to the
request that provoked it. Two consequences to design around:

- **Every mounted `useConsentUnavailable()` sees every refusal.** There is no
  reliable filter: `scopes` is advisory and may legitimately be `[]`, so it
  cannot serve as a correlation key. If two independent parts of your block
  request different scopes, both will see both refusals. Keep a request and its
  refusal UI in one component, or track the outstanding request yourself.
- **A refusal is buffered across mounts, so one that arrives while the consumer
  is unmounted is not lost.** The transport hands an unsolicited push only to
  handlers registered at the instant it arrives, so without this a refusal that
  landed before the consumer mounted — the requester and the consumer being
  different components, or the consumer being conditionally rendered — vanished,
  and the block went back to showing "click Generate again" beside the host's
  "unavailable". `requestConsent()` arms the buffer as it sends. It keeps only
  the latest refusal, is dropped when the block token changes (a refusal is a
  claim about *that* token's scopes, and the grant path re-mints), and is cleared
  by `reset()` — so the "Try again" button above genuinely resets, rather than
  having the refusal reappear on the next mount. A `REQUEST_CONSENT` you post
  through the raw transport instead of the hook does not arm it.

Without the hook (a non-React consumer, or one wiring the transport directly),
the same push is available untyped — note the explicit type import, which the
cast needs and which the hook makes unnecessary:

```tsx
import { getTransport } from '@civitai/blocks-react';
import type { ConsentUnavailablePayload } from '@civitai/app-sdk/blocks';

const unsubscribe = getTransport().onMessage('CONSENT_UNAVAILABLE', (payload) => {
  // `onMessage` hands you `unknown`; this cast is UNCHECKED, which is why
  // `useConsentUnavailable()` is the preferred path.
  const { reason, scopes } = payload as ConsentUnavailablePayload;
  console.info('permission unavailable', reason, scopes);
});
```

To exercise the refusal locally, run the mock host with
`createMockHost({ consentGrantable: false })`, flip it live with
`host.setScenario({ consentGrantable: false })`, or append `?consent=ungrantable`
to the dev harness URL — the `<Harness>` chrome then reads `consent=ungrantable`
rather than `withheld`. `dev:live` emits it too: live mode can grant nothing, so
any request for a scope your dev token lacks produces one.

### `useDomainMaturity()`

Read the maturity ceiling in force for the current viewer, so a block can
hide/blur mature affordances. **Fail-closed SFW** until `BLOCK_INIT` lands or
against a host that projects no ceiling.

```tsx
const { isSfw, isLevelAllowed } = useDomainMaturity();
const showRSlider = isLevelAllowed(BrowsingLevel.R);   // false on a SFW domain
```

The gates account for **two** things, and the distinction matters:

| field | answers |
| --- | --- |
| `maxBrowsingLevel` | what this **domain** permits anybody (identical for every viewer on it) |
| `effectiveBrowsingLevel` | what **this viewer** may be shown here — the domain ceiling narrowed by their own NSFW setting |

`isSfw` / `isLevelAllowed` gate on the second, so a viewer who turned NSFW off
sees SFW affordances even on a mature domain. `effectiveBrowsingLevel` is always
a subset of `maxBrowsingLevel`, so reading these can only ever show the viewer
**less** — never more. Compare the two when you want to explain *why* something
is hidden:

```tsx
const { maxBrowsingLevel, effectiveBrowsingLevel } = useDomainMaturity();
const hiddenByYourSettings = effectiveBrowsingLevel !== maxBrowsingLevel;
```

The hook's name is historic — it shipped when the domain ceiling was the only
signal. There is deliberately no separate viewer-maturity hook: two hooks would
mean two answers to "may I show this", and the one named for the domain would be
the wider of the pair.

Drive it locally with `createMockHost({ domain: 'red', viewerBrowsingLevel: BrowsingLevel.PG })`.
The mock clamps that option to its own ceiling exactly as the real host does, so
you cannot test against a viewer wider than the domain — production cannot
produce one either.

### `SfwGate`

Convenience component that renders `children` only when the current viewer may be
shown them — no `level` prop gates on `isSfw`, a `level` prop gates on that
browsing-level bit. Both account for the domain **and** the viewer. Fail-closed SFW.

```tsx
function MatureSection() {
  return (
    <SfwGate level={BrowsingLevel.R} fallback={<SafePlaceholder />}>
      <RRatedControl />
    </SfwGate>
  );
}
```

## Direct-load fallback ("Open on Civitai")

A block is served from its own origin `<slug>.civit.ai` but is designed to run
**embedded** in the Civitai host iframe at `civitai.com/apps/run/<slug>`, which
delivers the runtime context via the `BLOCK_INIT` handshake. If someone opens the
bare `<slug>.civit.ai` URL **directly** (a shared link, a social crawl), no parent
ever sends `BLOCK_INIT`, so `ready` never flips and the block hangs on its loading
spinner forever.

Wrap your app root once in `<BlockGate>` (from `/ui`) to degrade that into a
branded landing instead:

```tsx
import { BlockGate } from '@civitai/blocks-react/ui';

// A DIRECT (unembedded) top-level load shows an "Open on Civitai" card linking to
// civitai.com/apps/run/<slug>. Embedded — and the dev harness, which posts a fake
// BLOCK_INIT — are a transparent pass-through, so the happy path is unchanged.
createRoot(container).render(
  <BlockGate>
    <App />
  </BlockGate>,
);
```

The trigger is precise: the fallback shows **only** when the block is top-level
(`window.self === window.top`) **and** no `BLOCK_INIT` arrives within a short
timeout (`~2s`, override with `<BlockGate timeoutMs={…}>`). Framed blocks never
trip it; the harness posts `BLOCK_INIT` immediately, so it never trips there
either. On a non-`*.civit.ai` host (e.g. `localhost` in dev), it shows a neutral
"waiting for the host" state — never a broken `apps/run/localhost` link.

Building your own landing? The primitives are exported from the package root:

```tsx
import { useDirectLoad, hostToRunUrl } from '@civitai/blocks-react';

const directLoad = useDirectLoad();            // true iff top-level AND no BLOCK_INIT within the timeout
const runUrl = hostToRunUrl('my-app.civit.ai'); // 'https://civitai.com/apps/run/my-app' | null (null = not a civit.ai host)
```

## Embedding your own nested document

🔴 **A nested `<iframe src="…">` pointing at your own bundled content cannot
load, and no manifest change fixes it** — your block document's origin is opaque
and the static host stamps `frame-ancestors` + `X-Frame-Options` on every path
it serves. The full derivation, the dated external browser matrix (an
observation of the platform — nothing in this repo verifies it) and the known
limits
live in one place: the header of `@civitai/app-sdk`'s
`src/blocks/nestedDocument.ts`.

**Prefer a single-document design.** An engine build (Defold, Unity WebGL,
Phaser) is a `<canvas>` plus a JS loader that normally mounts straight into the
document you hand it; point it at your block's own root element and the problem
class disappears.

When a separate document is genuinely required, fetch it and inline it as the
iframe's `srcdoc` — a `srcdoc` frame inherits your opaque origin and carries no
response headers, so neither policy applies:

```tsx
import { useNestedDocument } from '@civitai/blocks-react';

function Game() {
  const { srcDoc, status, error } = useNestedDocument({ src: '/game/index.html' });
  if (status === 'error') return <p>Could not load: {error?.message}</p>;
  if (status !== 'ready') return <p>Loading…</p>;
  // Your own sandbox — the nested frame does not inherit the outer one's.
  return <iframe title="game" sandbox="allow-scripts" srcDoc={srcDoc ?? undefined} />;
}
```

`status` is `'idle'` (no `src`), `'loading'`, `'ready'` or `'error'`; `srcDoc` is
non-null exactly when `ready`, `error` exactly when `error`. Changing `src`
restarts the fetch and aborts the previous one — `status` returns to `'loading'`
in the same render that changes `src`, so no frame ever shows the previous
document as `'ready'` beside a new `src`. Unmounting aborts it and writes no
state. The fetch has a **30-second deadline**: a response that never arrives
becomes `status: 'error'` with a message naming the timeout, rather than
`'loading'` forever.

The helper injects an absolute `<base href="…/game/">` — the directory of the
**response's final URL**, so a redirect is followed rather than resolved one
directory too high — because a `srcdoc` document's base URL is `about:srcdoc`,
inheriting yours, so relative asset loads would otherwise resolve to nothing. A
document that already declares a `<base href>` has that one resolved against the
final URL and replaced, so the base the parser uses is always absolute. It is
**not** a de-duplication: markup declaring two `<base href>` tags comes back
with two, the first (the only one a parser honours) rewritten and the second
left inert. Only real markup counts — a `<base>` or a `<head>` inside a comment
or an inline `<script>`/`<style>` body is ignored.

**The string is not sanitized**, on purpose: it is your own markup and scripts,
verbatim. Only pass a `src` you control. Outside React, `fetchNestedDocument`
from `@civitai/app-sdk/blocks` is the same thing without the hook.

## The `/ui` subexport

Opinionated components, imported separately so a transport-only block stays lean.
Three surfaces live here:

1. The **W6 component pack** — a small, Civitai-looking, self-styled component
   set you drop straight into a block.
2. **`WorkflowPicker`** — lets the viewer pick a posted workflow, theirs or
   anyone's, from the Civitai catalog.
3. The headless, manifest-driven **`SettingsForm`** (host-themed native controls).

### W6 component pack

A drop-in set of primitives that match Civitai's look — **with zero setup**:

- **No Mantine dependency, no CSS import, no setup step.** The pack ships its
  CSS as a string and injects it into your block document's `<head>` the first
  time you render any component (idempotent). There's nothing to wire up.
- **First paint is briefly unstyled (FOUC).** Because the CSS injects in a
  `useEffect` (after the first paint), the very first frame of a pack component
  renders unstyled, then snaps to themed. It's a single frame and usually
  unnoticeable. To eliminate it, call `injectBlocksStyles()` at module init in
  your entry file (before the first render) so the stylesheet is present up
  front — see `injectBlocksStyles` below (already exported).
- **Auto-themed via your block's `data-theme`.** Set `data-theme={theme}` on
  your block's own root (from `useBlockContext().theme` — gotcha #60; the host
  can't reach across the iframe to set it for you). The components read an
  ancestor `[data-theme='dark']` / `[data-theme='light']`; default (no
  attribute) is the **dark** palette, and nothing consults the OS preference.

```tsx
import { useRef } from 'react';
import { useBlockContext } from '@civitai/blocks-react';
import {
  Button, TextInput, Textarea, Card, Stack, Group,
  Alert, Loader, Badge, Modal,
  Slider, NumberInput, Select, Collapse,
} from '@civitai/blocks-react/ui';

export function App() {
  const { ready, theme } = useBlockContext();
  const rootRef = useRef<HTMLDivElement>(null);
  if (!ready) return <div>Loading…</div>;

  return (
    // GOTCHA #60 — theme your OWN root; that's what the pack reads.
    <div ref={rootRef} data-theme={theme}>
      <Card>
        <Stack gap={12}>
          <Group justify="space-between">
            <strong>My block</strong>
            <Badge color="success">ready</Badge>
          </Group>
          <TextInput label="Prompt" description="What to generate" />
          <Alert color="info" title="Heads up">Costs Buzz.</Alert>
          <Button fullWidth onClick={() => {/* … */}}>Generate</Button>
        </Stack>
      </Card>
    </div>
  );
}
```

**The components** (each with an exported props interface):

| Component | Highlights |
|---|---|
| `Button` | `variant` (`filled`/`light`/`outline`/`subtle`), `size`, `color`, `loading` (shows a `Loader`, disables + `aria-busy`), `fullWidth`, `leftSection`/`rightSection`. Defaults to `type="button"`. |
| `TextInput` / `Textarea` | `label` / `description` / `error` / `required`, wired via `htmlFor` + `aria-describedby` + `aria-invalid`. `Textarea` takes `minRows`. |
| `Card` | themed surface; `withBorder`, `padding`, `radius`. |
| `Stack` / `Group` | vertical / horizontal flex; `gap`, `align`, `justify` (+ `Group` `wrap`). |
| `Alert` | `color` (`info`/`success`/`warning`/`error`), `title`, `withCloseButton` + `onClose`. ARIA role defaults by color — `error`/`warning` → `role="alert"` (assertive), `info`/`success` → `role="status"` (polite); pass `role` to override. |
| `Loader` | CSS-keyframe spinner; `size`, `color`; `role="status"`. |
| `Badge` | `variant`, `size`, `color`. |
| `Modal` | `opened` + `onClose`, `title`, `size`; `role="dialog"` + `aria-modal`, Escape- and overlay-click-to-close, focuses the panel on open and restores focus on close. |
| `Slider` | controlled range (`value: number`, `onChange`, `min`/`max`/`step`, `showValue`). Native `input[type=range]` — keyboard-operable, implicit `role="slider"`; accent tracks `--civitai-color-primary`. Same `label`/`description`/`error`/`required` wiring as `TextInput`. |
| `NumberInput` | controlled numeric (`value: number \| null`, `onChange`, `min`/`max`/`step`). Rejects non-numeric (never emits `NaN`), clamps to `[min,max]` on blur, empty → `null`. Same label/description/error wiring. |
| `Select` | controlled dropdown (`value: string`, `onChange`, `options: {value,label,disabled}[]` **or** `<option>` children, `placeholder`). Native `<select>`, `role="combobox"`. Same label/description/error wiring. |
| `Collapse` | controlled disclosure (`open` + `onOpenChange`, `title`, `disabled`) for the "advanced params reveal". `aria-expanded` + `aria-controls`; content region `role="region"`, `hidden` when closed. |
| `SegmentedControl` | controlled view/tab switcher (`value` + `onChange`, `data: {value,label,disabled}[]`, `fullWidth`, `size`). `role="tablist"` of `role="tab"` buttons; ArrowLeft/ArrowRight rove selection. |
| `ReportButton` | two-step control that files a shared-board row for platform moderator review via `useSharedStorage().report()`. `noun` + `onReport` (+ `reported` for server truth). 🔴 Its visible copy is deliberately **not** overridable — see the component's JSDoc. |
| `FollowButton` | follow/unfollow a collection over the host bridge. `collectionId` + `followed` (+ `onChange`, `collectionName`). Flips optimistically, then adopts the **host's echo**; reverts on failure. 🔴 It exists because three outcomes are easy to get wrong: `declined` reverts **silently** (the viewer dismissed the host's confirm — nothing was written), `sign-in-required` routes into `REQUEST_SIGN_IN` rather than an error line, and every other rejection reverts with a `role="alert"` note. |
| `TipButton` | two-step Buzz tip via `useTip()`. `toUserId` + `amount` + `noun` (+ `entityType`/`entityId`, `tipped`, `remaining`, `disabledReason`, `onTipped`). 🔴 **The confirm is the component's, not host chrome** — `useTip` posts directly with the block token, so a one-press money spend is reachable without it. It mints **one idempotency key per logical tip and reuses it on retry**, so a retry after a *lost* response cannot become a second transfer. Pass `remaining` from ONE `useTipAllowance()` held by the view — it deliberately does not fetch, or a screen of cards becomes N HTTP reads. |
| `ResourceCard` | a picked generation resource (`BlockResourceInfo`) as a grid tile (`variant="card"`) or a compact line (`variant="row"`). `interactive` is an explicit discriminant that requires `onSelect` (+ `selected`/`disabled`); `thumbnailUrl` is optional because **`BlockResourceInfo` carries no image field**, and a missing *or failed* image falls back to a frozen "No preview" frame. `actions` is the trailing flow slot on both variants; `overlay` is the decorative corner badge over the thumbnail and is **`card`-only — a type error on a `row`**. Both render as siblings of the hit area, never inside it. The name fallback, type label, placeholder copy, selected mark and accessible-name order are frozen, not props. |

Every component carries a `data-civitai-ui="<name>"` hook. Most also forward
`className` + `style` and forward a `ref` to their DOM node. **Two do not:**
`ReportButton` renders a different element per handshake state and forwards none
of the three (only its `data-testid`, from which the other four hooks are derived
by suffix); `Modal` forwards `className` + `style` but takes no `ref` — it holds
its panel node internally, so `<Modal ref={…}>` is a type error. Need
to inject the CSS yourself (SSR, or a non-React shell)? Call
`injectBlocksStyles(doc?)` once, or read the raw `BLOCKS_UI_STYLES` string.
`useBlocksStyles()` is the hook the components call internally.

> **Modal focus limitation (v0):** the modal focuses its panel on open and
> restores focus on close, but it does **not** trap focus — Tab can still reach
> content behind the overlay. That's fine for a simple confirm/settings dialog
> inside the sandboxed block; a full focus-trap is a v1 follow-up (kept
> dependency-free here on purpose).

### `WorkflowPicker`

`<civitai-resource-picker>` from `@civitai/components`, set up for workflows: it
lists `Workflows` and the retired `ComfyWorkflows` type (so older posts can be
picked), lets the viewer switch between **their own** published workflows and
**anyone's**, and picks one **version** (the newest by default). It calls
`GET /api/v1/blocks/models` at `useHostOrigin()` with `useBlockToken().raw` —
no host bridge, no extra scope.

```tsx
import { useState } from 'react';
import { WorkflowPicker, type PickedResource } from '@civitai/blocks-react/ui';

export function ChooseWorkflow() {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<PickedResource | null>(null);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Use a workflow</button>
      <WorkflowPicker
        open={open}
        owner="mine"
        onPick={(workflow) => {
          setPicked(workflow);
          setOpen(false);
        }}
        onDismiss={() => setOpen(false)}
      />
      {picked && <p>{picked.name} — {picked.versionName}</p>}
    </>
  );
}
```

A pick is a `PickedResource` — `{ modelId, modelVersionId, name, versionName,
creatorUsername, baseModel, earlyAccessDeadline?, access, owner }`; `/ui`
re-exports it and the picker's other data types (`ResourceItem`,
`ResourceSource`, …). Close the picker yourself in
**both** callbacks: `open` is controlled. The picker closes itself on Escape or
a backdrop click, and re-opens on the next render if `open` still says `true`.

- 🔴 **`owner` is a UX hint, never proof of ownership.** It says which list the
  viewer was looking at, and your app's own code can set it to anything. A
  server that must know "this is the viewer's own workflow" checks that itself.
- 🔴 **A "mine" list is only ever the server's.** The picker shows an error, not
  a list, when a `mine` search comes back without `metadata.owner: 'mine'` — a
  server older than the parameter ignores it and returns everybody's. It never
  falls back to the public `/api/v1/models`.
- **Early-access and paid versions are listed, with a badge.** `access` on a
  pick is `'early-access'` (a timed paid-access gate, with its end date in
  `earlyAccessDeadline` when the server knows it), `'paid'` (a permanent gate)
  or `'open'`. The viewer may not be able to download a gated version later.
- **Search is debounced** (300 ms), and a newer search cancels the one in
  flight. A busy catalog (`429` / `503`, rate limit 150 requests per 10 s per
  block) is retried after its `Retry-After`, twice, then offered as "Try again".
- **An anonymous viewer** gets a sign-in message on the "mine" list as soon as
  the catalog answers `401`, with no `REQUEST_TOKEN` to the host first — the
  picker knows the viewer is anonymous from `useBlockContext()`. "All" works. An expired block token is not mistaken for
  that: for a signed-in viewer, or on "All", a `401` makes the picker mint a
  fresh token through `useBlockToken().refresh()` and retry once.
- **Before `BLOCK_INIT`** the picker says it is not connected yet, and lists as
  soon as the host origin lands.
- **Under the mock host** there is no catalog to call. Pass canned results from
  `/testing`:

```tsx
import { WorkflowPicker } from '@civitai/blocks-react/ui';
import { fakeResourceSource } from '@civitai/blocks-react/testing';

const source = fakeResourceSource({
  mine: [
    {
      modelId: 1,
      name: 'My upscale chain',
      type: 'Workflows',
      creatorUsername: 'me',
      versions: [{ id: 11, name: 'v2', baseModel: 'SDXL 1.0' }],
    },
  ],
});

export const Picker = () => <WorkflowPicker open source={source} onPick={console.log} />;
```

Under `dev:live` it works for real: the dev token can read `/blocks/models`.

### `SettingsForm`

The headless, manifest-driven settings form (its contract is intentionally
**unstyled native controls** — the host page themes it, so it does *not* use the
W6 pack):

```tsx
import { SettingsForm } from '@civitai/blocks-react/ui';

<SettingsForm
  manifestSettings={manifest.settings}
  declaredScopes={manifest.scopes}
  forScope="viewer"               // or "publisher"
  initialValues={settings.userSettings}
  onSubmit={async (values) => { /* persist (platform page) */ }}
/>
```

`isFieldVisible` + `SettingsFormError` are also exported. See the `settings`
example.

## Lower-level transport

For non-React or advanced use, the transport primitives are exported too:
`IframeTransport`, `InlineTransport`, `BlockTransportDetector`,
`readAllowedOriginsFromEnv`, `getTransport`, and `sendTypedRequest`. Hooks are the
recommended surface; reach for these only when a hook doesn't fit.

### How `allowedParentOrigins` entries are read

Each entry is canonicalised with the URL parser before it is compared to
`event.origin`, so these spellings all mean the same thing and all match a host
frame at `https://civitai.com`:

| Written as | Also matches |
|---|---|
| `https://civitai.com/` | trailing slash is ignored |
| `HTTPS://CIVITAI.COM` | scheme and host are case-insensitive |
| `https://civitai.com:443`, `http://x:80` | an explicit **default** port is ignored |
| `https://пример.com` | normalised to the punycode a browser reports |

These stay **significant** — they are different origins, not spellings:

- a **non-default** port: `https://civitai.com:8443` does not match `https://civitai.com`
- the scheme: `http://` never matches `https://`
- a trailing-dot host: `https://civitai.com.` is its own origin
- any host that merely *contains* an allowed one: `https://civitai.com.evil.com`
  never matches `https://civitai.com`

An entry that is not a bare origin **throws at construction** rather than being
quietly skipped — no scheme (`civitai.com`), a path/query/fragment
(`https://civitai.com/embed`), credentials (`https://u:p@civitai.com`), or a
scheme with no origin of its own (`file://…`). A silently dropped entry is the
failure this rule exists to prevent: the allowlist would be missing an origin
you believe is on it.

If `BLOCK_INIT` never lands, the 10s timeout error names the origins that
actually arrived and were rejected, next to the allowlist it checked them
against — start there.

## The `/testing` subexport

`@civitai/blocks-react/testing` is the **host-simulation** entry point: it stands
in for civitai.com so your block can run in `vitest`/`happy-dom` and in a local
dev harness. It is a normal, published subpath of a `0.x` package — see
[Stability](#stability-of-testing) below for exactly what that does and does not
promise.

**Everything on this subpath is a mock.** No network, no Buzz, no real backend.
Until `0.55.0` that was not true: `createLiveHost`, which talks to the real
Civitai backend and spends the token holder's own Buzz, was exported from here
too, one autocomplete entry from `createMockHost`. It now lives on its own
subpath — see [The `/live` subexport](#the-live-subexport) below.

### The whole surface

This section is **the one place the surface is written down**, and it is not
prose: `test/subpathSurfaces.test.ts` parses the two marked regions below and
fails if they disagree with what `src/testing.tsx` actually exports — in either
direction. Every other mention of this subpath (module docblock, `AGENTS.md`)
points here rather than repeating the list, because a second copy is exactly
what went stale in [#334](https://github.com/civitai/civitai-app-starters/issues/334).

**Values**

<!-- TESTING-SURFACE:VALUES:BEGIN -->

| Export | What it is |
|---|---|
| `resetTransport` | Drops the cached singleton transport. Call it in `beforeEach` so each test starts clean. |
| `createMockHost` | A framework-agnostic fake of the embedding host — answers every `*_RESULT` message, with knobs for generation cost/latency/failure, Buzz balance, app + shared storage, consent, maturity. Returns a `MockHost`; call `.install()` and keep the returned teardown. **No network, no Buzz.** |
| `readMockHostUrlOptions` | Reads the harness URL toggles (`?viewer` `?consent` `?fail` `?theme` `?pick` `?balance` `?latency` `?seed` …) into a `Partial<MockHostOptions>`. `Harness` applies it for you; call it directly only in a hand-rolled harness. |
| `Harness` | The React wrapper: installs a `createMockHost` on mount, tears it down on unmount, and renders an optional on-screen outbound-message log. Takes every `MockHostOptions` field plus `applyUrlToggles` and `showLog`. |
| `fakeResourceSource` | Canned results for `<WorkflowPicker>` (from `/ui`) or `<civitai-resource-picker>`: `fakeResourceSource({ mine, any })` filters by owner, type and query, echoes the owner it applied, and records each search on `.calls`. The mock host has no catalog, so pass it as the picker's `source`. **No network.** |
| `installPopoverShim` | Stands in for the HTML popover API, which neither `jsdom` nor `happy-dom` implements at any version. Needed only if your own code calls `showPopover`/`hidePopover`/`togglePopover` or queries `:popover-open` — `@civitai/components`' own elements do not. Returns a `PopoverShimHandle`; inert (`installed: false`) in a real browser. **Read [Testing overlay elements](#testing-overlay-elements) first: it does not make trigger clicks work.** |

<!-- TESTING-SURFACE:VALUES:END -->

**Types** — the transitive closure that makes those values nameable: each is the
declared type of an option, of a `MockHost` member, or of a property of one of
those, so you can hoist a sub-object out of an options literal and give it a
type.

<!-- TESTING-SURFACE:TYPES:BEGIN -->

```text
CannedPick
CostSpec
FakeResourceCanned
FakeResourceSource
HarnessProps
ImageSpec
MockBuzzBalance
MockBuzzHandle
MockBuzzScenario
MockCannedImageScan
MockGenerationScenario
MockHost
MockHostFailMode
MockHostOptions
MockHostScenarioPatch
MockMediaUploads
MockReactionSeed
MockSharedScenario
MockSharedSeed
MockStorageScenario
MockWorkflowQuoteFailure
MockWorkflowStepInfo
PopoverShimHandle
PopoverShimOptions
```

<!-- TESTING-SURFACE:TYPES:END -->

That is the complete list. Nothing else is exported.

### In a test

```ts
import {
  createMockHost,
  resetTransport,
  type MockHostOptions,
  type MockGenerationScenario,
} from '@civitai/blocks-react/testing';

resetTransport();

// Hoisting a sub-object out of the options literal is why the scenario types
// are exported.
const generation: MockGenerationScenario = { costPerGen: 12, latencyMs: 0 };
const options: MockHostOptions = { viewer: null, failMode: 'some', generation };

const host = createMockHost(options);
const uninstall = host.install();
host.setScenario({ failMode: 'none' });   // live-tune mid-test
uninstall();
```

🔴 **The mock enforces the spend scope, as the host does** (since `0.70.0`,
[#608](https://github.com/civitai/civitai-app-starters/issues/608)).
`consentGranted` defaults to `false` — production's first token does not carry
`ai:write:budgeted` — and while it is `false`, an estimate, a batch estimate and
a submit are refused with `block lacks ai:write:budgeted scope`, each in the
shape the host sends:

| Call | What your code sees before consent |
|---|---|
| `estimate()` | rejects `WorkflowEstimateError`, code `'failed'`, reason on `err.snapshot.error` |
| `estimateBatch()` | rejects `BatchEstimateError`, code `'failed'`, reason on `err.hostError` |
| `submit()` | prompts for consent, the mock grants it and pushes a refreshed token, and the call is retried once with the **same** idempotency key — it resolves, and is charged once |

`consentGrantable: false` (or `?consent=ungrantable`) keeps the refusal: the
prompt is answered with `CONSENT_UNAVAILABLE` and `submit()` rejects with code
`'exception'`.

**Migrating a test:** one that estimates or submits and is not *about* consent
passes `consentGranted: true` (or uses `?consent=granted` in a harness). One that
is about consent drives it: estimate, see the refusal, call
`requestConsent({ scopes: ['ai:write:budgeted'] })`, wait for
`useBlockToken().scopes` to include it, estimate again.

### Testing overlay elements

`<civitai-menu>`, and anything else that opens a panel, live in an environment
that is **incomplete** rather than merely different. Two facts, both measured on
happy-dom 20.9.0; neither is a bug in the components.

**1. There is no popover API.** `showPopover`, `hidePopover` and `togglePopover`
are `undefined` on happy-dom 20.x and on jsdom 25 and 30 alike. `:popover-open`
is worse than absent: it is **unreliable**, and the unreliability is not a
property of your runner's version. It resolves through `nwsapi` under jsdom, so
the same jsdom 25.0.1 both throws `DOMException: unknown pseudo-class selector`
and returns `false` depending on which `nwsapi` your lockfile pulled in
(measured: `false` on nwsapi 2.2.28). `@civitai/components`' own elements no
longer read it, which is what takes that variable off the table for them. Install
the shim if **your** code touches the API:

```ts
import { installPopoverShim } from '@civitai/blocks-react/testing';

const shim = installPopoverShim();
// …
shim.uninstall();
```

It is inert in a real browser (`installed: false`), so it is safe to call from a
setup file shared between a happy-dom project and a browser-mode project.

**2. 🔴 UNDER happy-dom A TRIGGER CLICK DOES NOTHING, and the shim does not change
that.** A click on light-DOM content assigned to a `<slot>` reaches the **host** (a
listener there fires once) but **not** a listener on the `<slot>` element — and
that is the node Lit binds `@click` to. So the click dispatches, bubbles, and
then the handler is never called: no throw, no state change, a test that quietly
does nothing. jsdom (25 and 30) *does* deliver it, so this one is happy-dom's
alone — which is exactly why the shim **measures** it rather than asserting it:
`installPopoverShim` probes on install, reports the answer as
`handle.slottedClicksReachSlots`, and `console.warn`s when it is `false`.

**Drive overlay elements through their methods:**

```ts
menu.show();                 // ✅ works in every DOM
await menu.updateComplete;

triggerButton.click();       // ❌ silently does nothing under happy-dom
```

Also absent, because they need layout and a hit-testing event path: the top
layer, anchor positioning, and **light dismiss** (a click outside a shown panel
does not close it). If what you are testing is one of those, use a real browser —
this repo's own `browser` vitest project is the worked example.

### In a dev harness

```tsx
import { Harness } from '@civitai/blocks-react/testing';

export function DevRoot() {
  return (
    <Harness failMode="some" showLog>
      <App />
    </Harness>
  );
}
```

`<Harness>` fires host messages from `window.location.origin`, and the transport
drops inbound messages from origins outside its allowlist — so a dev harness
must include its own origin, e.g. `VITE_BLOCK_ALLOWED_PARENT_ORIGINS=http://localhost:5173`.
Otherwise `BLOCK_INIT` never lands.

### Stability of `/testing`

[#334](https://github.com/civitai/civitai-app-starters/issues/334) offered a
fork: *document the undocumented surface*, **or** *mark the subpath explicitly
unstable*. This package took the **first** branch, and only the first. The
section above is that documentation.

Concretely, and with no guarantee beyond what is actually enforced:

- **It is a normal subpath of a `0.x` package**, on the same footing as `.`,
  `./ui` and `./live` — no stronger, no weaker. Under semver `0.x`, a **minor
  may break it**. It is not `@internal`, and it is not "unsupported": fleet
  blocks import it from their dev harnesses and from their test suites.
- **What is enforced** is that a change to the exported *symbol set* cannot ship
  silently. `test/subpathSurfaces.test.ts` fails on growth and on shrinkage, and
  it fails again unless the README section above is updated to match — so any
  such change is a deliberate edit that a reviewer sees and a changeset names.
- **What is *not* promised** is the *shape* of the mock-host option and result
  types. They describe a fake host whose fidelity tracks the real one; a
  property may be added, tightened or renamed in a minor. The ledger asserts
  names, not shapes, and deliberately so.

What is *not* listed above is genuinely internal and carries no guarantee. Until
`0.55.0` this subpath also re-exported 25 symbols with no documentation — the
catalog client (`fetchCatalog`, `buildCatalogUrl`, `edgeThumb`, `modelToCard`,
`DEFAULT_LIMIT`, …), the in-harness picker overlay (`openPickerOverlay`),
`decodeBlockTokenPayload`, `disallowedAccountError`, `mockParentMessage`, and
the `MockHostProvider` alias — plus `createLiveHost` / `LiveHostOptions`, which
moved to `./live` rather than disappearing. See the `0.55.0` changelog entry for
the full list and for the three removals that had a measured fleet consumer. If
you were importing one of the internal ones, it lives at a path this package
does not publish — open an issue rather than reaching into `dist/internal/`.

## The `/live` subexport

> ### 🔴 `@civitai/blocks-react/live` spends real Buzz
>
> `createLiveHost` forwards the App-Block postMessage protocol to the **real
> Civitai backend** over a pasted short-lived dev block token —
> `blocks.submitWorkflow` included — and a successful generation **debits the
> token holder's own Buzz**. There is no dry-run mode and no confirmation. It
> exists for one caller: a `pnpm dev:live` harness. **It must never appear in a
> test suite.** The free one is `createMockHost`, on `./testing`.

### The whole surface

One value and one type. `test/subpathSurfaces.test.ts` pins the runtime export
set, failing on growth and on shrinkage.

| Export | What it is |
|---|---|
| `createLiveHost` | 🔴 **Real backend, real Buzz.** Installs a host that proxies the block's `postMessage` traffic to civitai.com using a dev block token. Returns a handle; call `.install()` and keep the teardown, exactly like `createMockHost`. |
| `LiveHostOptions` *(type)* | Options for the above. `blockToken` is required; everything else (`backendBaseUrl`, `viewer`, `theme`, `context`, `onOutbound`, `manifest`, …) has a default. Pass `manifest` to have `TRACK_EVENT` checked against `analytics.events`. |

### In a `dev:live` harness

```ts
import { createLiveHost, type LiveHostOptions } from '@civitai/blocks-react/live';

// The token is a SHORT-LIVED dev block token pasted into the harness env, never
// an API key: `POST /api/v1/blocks/dev-token`, ~4h, re-minted by hand.
const options: LiveHostOptions = {
  blockToken: devBlockToken,
  theme: 'dark',
  // Your block.manifest.json, as imported. Each `track()` is checked against its
  // `analytics.events`, and the console warns once per undeclared event,
  // undeclared property, or value of the wrong type — what production drops.
  manifest,
};

const host = createLiveHost(options);
const uninstall = host.install();
```

What `dev:live` forwards, and how it answers the one call it does not:

- **`useCheckpointPicker().persist()` on a page** is refused with no backend
  call, as the page host refuses it (see
  [`useCheckpointPicker()`](#usecheckpointpicker)). The default `context` is a
  page, because a dev token is a page token.
- **`submit()`'s `idempotencyKey` reaches the server**, as it does from the
  production hosts. A retry with the same key is deduplicated there, and a key in
  a format the server refuses fails the submit with the server's message.
- **`watch()`'s `waitSeconds` reaches the server**, so a poll is held open
  instead of answered at once, and the server decides the actual hold. This
  matches the production hosts as of
  [civitai/civitai#5798](https://github.com/civitai/civitai/pull/5798); a
  production host without that change drops the field and answers at once.

### Stability of `/live`

The same terms as `./testing`: a normal subpath of a `0.x` package where a minor
may break it, with the runtime symbol set pinned by
`test/subpathSurfaces.test.ts` so it cannot change silently.

It moved off `./testing` in `0.55.0`: an import path named `testing` asserts the
opposite of what this module does, and the import line is the one piece of context
that travels with every call site.

🔴 One cost worth stating plainly: publishing and documenting this subpath makes
[#334](https://github.com/civitai/civitai-app-starters/issues/334) **item 3** —
getting the live-host code out of the tarball entirely — *harder*, not easier.
`./live` is now a named public entry point, so removing it later is a breaking
change on a surface consumers pin against, where before it was one export among
many on a subpath nobody was told to rely on.

## What the host-simulation subpaths cost you

The `dist/` modules reachable only from `./testing` and `./live`, and from nothing
under `.` or `./ui`, **ship in every install**, production dependency trees
included. They are tree-shaken out of application *bundles* — no block ships a
mock host to a browser — so this is `node_modules` weight, not bundle weight.

`files` is `["dist", "README.md"]` and `tsconfig` compiles all of `src/**/*`, so
the `exports` map has no bearing whatsoever on tarball contents; it decides only
what a consumer can *name*.
**The `/live` split buys safety, not size.** Moving these bytes needs the code
deleted or published as a second artifact; that is
[#334](https://github.com/civitai/civitai-app-starters/issues/334) item 3, and it
is not done here.

## Examples

Runnable, minimal blocks — one per feature, each with its own README:

- [`hello-world`](https://github.com/civitai/civitai-app-starters/tree/main/starters/examples/hello-world) — `useBlockContext`, lifecycle, `data-theme` (#60)
- [`settings`](https://github.com/civitai/civitai-app-starters/tree/main/starters/examples/settings) — manifest settings + `SettingsForm`
- [`buzz-workflow`](https://github.com/civitai/civitai-app-starters/tree/main/starters/examples/buzz-workflow) — `useBuzzWorkflow` (#59, #8/#9/#10, #19)
- [`kv-storage`](https://github.com/civitai/civitai-app-starters/tree/main/starters/examples/kv-storage) — `useAppStorage`
- [`scopes-api`](https://github.com/civitai/civitai-app-starters/tree/main/starters/examples/scopes-api) — scopes + REST + `useBlockToken`
- [`buzz-purchase`](https://github.com/civitai/civitai-app-starters/tree/main/starters/examples/buzz-purchase) — `useBuzzPurchase`

## Version compatibility

| `@civitai/blocks-react` | pairs with `@civitai/app-sdk` | adds |
|---|---|---|
| `0.78.x` | `^0.79.0` | `useResourceFile()` (`GET_RESOURCE_FILE`). Its types (`BlockResourceFile` and friends) come from the SDK's `0.79.0`; the hook imports no SDK value, so the declared peer floor is unchanged. |
| `0.50.x` | `^0.40.0` | `useCreatePostFromApp()` (`CREATE_POST_FROM_APP`) + the `posts:write:self` scope. Pairing `0.50.x` with an SDK below `0.40.0` fails at `tsc` with `Cannot find name 'BlockCreatePostHostError'`, not at install. |
| `0.48.x` | `^0.38.0` | `useCollectionFollow()` + `<FollowButton>` / `<TipButton>` (`SET_COLLECTION_FOLLOW`). Pairing `0.48.x` with an SDK below `0.38.0` fails at `tsc` with `Cannot find name 'BlockCollectionFollowErrorCode'`, not at install — the floor those releases declared was deliberately wide (#206 — a per-minor floor forced a major on consumers). |
| `0.36.x` | `^0.27.0` | auto-installs the SDK's opaque-origin web-storage shim (`@civitai/app-sdk/safe-storage`) on import |
| `0.29.x` | `^0.24.0` | `useAppWorkflows()` — app generator subqueue read + cancel (`QUERY_APP_WORKFLOWS` / `CANCEL_APP_WORKFLOW`) |
| `0.27.x`–`0.28.x` | `^0.23.0` | async-scan image upload; transport validators for all `SHARED_*` / `APP_STORAGE_*` / picker replies |
| `0.26.x` | `^0.22.0` | `useViewer()` (`GET_VIEWER`) |
| `0.25.x` | `^0.21.0` | `useBuzzTransactions`, `useBuzzAccounts`, `useDailyCompensation`, `useWildcardPack` |
| `0.5.0` | `^0.7.0` | `useBuzzWorkflow().cancel()` (real server-side cancel, gotcha #51) |
| `0.4.x` | `^0.6.0` | `useAppStorage`, `SettingsForm` (`/ui`) |
| `0.3.x` | `^0.5.0` | earlier hook set |

Always keep `@civitai/app-sdk` at or above the paired minor — the React package
peer-depends on the SDK's message/type contract.

## License

MIT — see [`LICENSE`](../../LICENSE).
