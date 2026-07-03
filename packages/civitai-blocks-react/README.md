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

### `useCheckpointPicker()`

Drive the platform Checkpoint picker + persist a viewer override.

```tsx
const { open, persist } = useCheckpointPicker();
const { selected } = await open({ baseModelGroup: 'SDXL', currentVersionId });
if (selected) await persist(selected.versionId);   // null clears the override
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
| `0.5.0` | `^0.7.0` | `useBuzzWorkflow().cancel()` (real server-side cancel, gotcha #51) |
| `0.4.x` | `^0.6.0` | `useAppStorage`, `SettingsForm` (`/ui`) |
| `0.3.x` | `^0.5.0` | earlier hook set |

Always keep `@civitai/app-sdk` at or above the paired minor — the React package
peer-depends on the SDK's message/type contract.

## License

MIT — see [`LICENSE`](../../LICENSE).
