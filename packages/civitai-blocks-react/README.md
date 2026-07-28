# `@civitai/blocks-react`

React hooks and iframe transport for [Civitai Apps](https://github.com/civitai/civitai-app-starters/blob/main/docs/build-your-first-app-block.md).

Pairs with [`@civitai/app-sdk`](https://www.npmjs.com/package/@civitai/app-sdk)'s
`/blocks` subpath, which carries the framework-agnostic manifest, scope, and
`postMessage` contract. This package adds the transport that actually moves bytes
and the React hooks block authors call.

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
import type { ModelSlotContext } from '@civitai/app-sdk/blocks';

export function App() {
  const { ready, context, viewer, theme } = useBlockContext();
  const { submit, status, result } = useBuzzWorkflow();
  const rootRef = useRef<HTMLDivElement>(null);
  useBlockResize(rootRef);                 // host fits the iframe to content

  if (!ready) return <div ref={rootRef}>Loading…</div>;
  const model = context as ModelSlotContext;

  return (
    // GOTCHA #60: set data-theme on YOUR OWN root — the host can't reach into
    // the iframe to set it. Without this any [data-theme="dark"] CSS is dormant.
    <div ref={rootRef} data-theme={theme}>
      <p>Block for model {model.modelName} ({viewer?.username ?? 'anon'})</p>
      {/* `/ui` Button — themed by the data-theme above; `loading` disables + shows a spinner */}
      <Button
        loading={status === 'submitting' || status === 'polling'}
        onClick={() =>
          submit({
            kind: 'textToImage',
            modelId: model.modelId,
            modelVersionId: model.modelVersionId,
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
component without prop-drilling. Below: one minimal snippet each.

### `useBlockContext()`

The primary hook. Returns everything the host delivered in `BLOCK_INIT` plus a
`ready` gate — fields are sentinel-empty before init, so gate your UI on `ready`.

```tsx
const { ready, context, viewer, theme, settings, blockId, blockInstanceId, appId, token, renderMode } =
  useBlockContext();
```

- `context` — `BlockContext` (`{ slotId, … }`); narrow to `ModelSlotContext` for
  model-page slots.
- `viewer` — `ViewerInfo | null` (`null` = anonymous).
- `theme` — `'light' | 'dark'`. **Set `data-theme={theme}` on your root** (gotcha #60).
- `settings` — `{ publisherSettings, userSettings }`.

### `useBlockResize(ref)`

Attach to your root element. Observes its height and posts `RESIZE_IFRAME` so the
host sizes the iframe to fit. No-op on the inline transport (host DOM reflows
naturally).

```tsx
const rootRef = useRef<HTMLDivElement>(null);
useBlockResize(rootRef);
```

> Also set `iframe.minHeight` in your manifest to the block's *real* rendered
> height — a too-small minHeight makes the iframe seed short and grow-jump on
> `BLOCK_READY` (CLS). Measure it in the dev harness (gotcha #53).

### `useBlockToken()`

Current block-scoped JWT, auto-refreshing ~2 min before expiry. Returns the token
fields plus a `refresh()` for the 401-retry path.

```tsx
const { raw, scopes, expiresAt, buzzBudget, refresh } = useBlockToken();
// after a 401: await refresh(); then retry the request once with the new `raw`.
```

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

Shorthand for `useBlockContext().settings`. Read-only from the iframe — settings
are *written* on the platform `/apps/installed` page, not via a bridge message.

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
await estimate(body);            // status 'estimating' → 'confirming' (cost in result.cost.total)
const snap = await submit(body); // status 'submitting' → 'polling'; returns a workflowId
await poll(snap.workflowId);     // you loop this on a backoff until terminal
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
- An over-budget / rejected submit comes back as a **resolved** snapshot with
  `status: 'failed'` + an `error` string — the transport resolves the reply, it
  doesn't throw. Check `snap.status`, not just `try/catch`.

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

### `useBuzzPurchase()`

Open the Buzz purchase modal — the insufficient-budget recovery path.

```tsx
const { openPurchaseModal } = useBuzzPurchase();
const { purchased, newBalance } = await openPurchaseModal(suggestedAmount);
if (purchased) { /* retry the generation */ }
```

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

Per-(block instance, viewer) KV datastore, host-mediated. 64 KB per value,
50 MB + ~1M rows per app.

```tsx
const storage = useAppStorage();
await storage.set('key', { any: 'json' });   // throws "PAYLOAD_TOO_LARGE" over a limit
const v = await storage.get<MyShape>('key'); // null if unset / anon
await storage.delete('key');                  // idempotent
const { keys } = await storage.list({ prefix: 'note-' });
const quota = await storage.getQuota();       // { usedBytes, rowCount, limitBytes, limitRows }
```

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

### `useCheckpointPicker()`

Drive the platform Checkpoint picker + persist a viewer override.

```tsx
const { open, persist } = useCheckpointPicker();
const { selected } = await open({ baseModelGroup: 'SDXL', currentVersionId });
if (selected) await persist(selected.versionId);   // null clears the override
```

### `useResourcePicker()`

Drive the platform resource picker for page blocks — `'Checkpoint' | 'LORA'`.
The viewer searches in host chrome; the block only ever sees the one resource it
picked. DISCOVERY ONLY — the returned `versionId` is re-validated + re-priced
server-side at estimate/submit.

```tsx
const { open } = useResourcePicker();
const picked = await open({ resourceType: 'LORA', baseModelGroup: 'SDXL' });
if (picked) {
  const versionId = picked.versionId;   // feed into body.additionalResources
  const weight = picked.strength;        // recommended default weight (may be undefined)
}
```

### `useImageUpload()`

Host-mediated image upload — the host opens its native upload modal and the
iframe never handles the bytes. Resolves with a moderated image (or `null` on
dismiss); pass `{ purpose: 'generationSource' }` for an unscanned img2img source
or `{ asyncScan: true }` for the early-resolve + `scanStatus()` flow.

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

Request a navigation within civitai.com (host-mediated; fire-and-forget).

```tsx
const { navigate } = useCivitaiNavigate();
navigate('/models/12345', 'new_tab');   // 'new_tab' needs allow-popups* in the manifest sandbox
```

### `useBlockAnalytics()`

Fire-and-forget event tracking into the host's analytics pipeline.

```tsx
const { track } = useBlockAnalytics();
track('generate_clicked', { modelId });
```

### `useRequestSignIn()`

Ask the host to open its sign-in flow for an ANONYMOUS viewer (fire-and-forget).
On sign-in the host re-inits the block with the now-authenticated viewer.

```tsx
const { requestSignIn } = useRequestSignIn();
// e.g. onClick of a "Sign in to generate" button:
requestSignIn();
```

### `useRequestConsent()`

Lazy consent: ask the host to open its consent UI when a LOGGED-IN viewer takes
an action whose consent-gated scope the block token is missing (e.g. Generate
needs `ai:write:budgeted` but the viewer hasn't granted it). Fire-and-forget —
on grant the host pushes a new token; observe `useBlockToken().scopes` and retry.

```tsx
const { requestConsent } = useRequestConsent();
requestConsent({ scopes: ['ai:write:budgeted', 'buzz:read:self'] });
```

### `useDomainMaturity()`

Read the surrounding color-domain's maturity ceiling (civitai #2670) so a block
can hide/blur mature affordances on a SFW domain. **Fail-closed SFW** until
`BLOCK_INIT` lands or against a host that predates the field.

```tsx
const { isSfw, isLevelAllowed } = useDomainMaturity();
const showRSlider = isLevelAllowed(BrowsingLevel.R);   // false on a SFW domain
```

### `SfwGate`

Convenience component that renders `children` only when the domain permits the
maturity — no `level` prop gates on the SFW ceiling, a `level` prop gates on that
browsing-level bit. Fail-closed SFW.

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

## The `/ui` subexport

Opinionated components, imported separately so a transport-only block stays lean.
Two surfaces live here:

1. The **W6 component pack** — a small, Civitai-looking, self-styled component
   set you drop straight into a block.
2. The headless, manifest-driven **`SettingsForm`** (host-themed native controls).

### W6 component pack

A drop-in set of primitives that match Civitai's look (8px radius, the blue
primary, the dark/light surfaces) — **with zero setup**:

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
  ancestor `[data-theme='dark']` / `[data-theme='light']`; **no attribute =
  light**, matching the starter palette.

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
  if (!ready) return <div ref={rootRef}>Loading…</div>;

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

Each component forwards `className` + `style`, forwards a `ref` to its DOM
node (where it wraps one), and carries a `data-civitai-ui="<name>"` hook. Need
to inject the CSS yourself (SSR, or a non-React shell)? Call
`injectBlocksStyles(doc?)` once, or read the raw `BLOCKS_UI_STYLES` string.
`useBlocksStyles()` is the hook the components call internally.

> **Modal focus limitation (v0):** the modal focuses its panel on open and
> restores focus on close, but it does **not** trap focus — Tab can still reach
> content behind the overlay. That's fine for a simple confirm/settings dialog
> inside the sandboxed block; a full focus-trap is a v1 follow-up (kept
> dependency-free here on purpose).

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
