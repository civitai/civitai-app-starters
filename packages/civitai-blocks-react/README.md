# `@civitai/blocks-react`

React hooks and iframe transport for [Civitai App Blocks](https://github.com/civitai/civitai-app-starters/blob/main/docs/build-your-first-app-block.md).

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

```tsx
import { useRef } from 'react';
import { useBlockContext, useBlockResize, useBuzzWorkflow } from '@civitai/blocks-react';
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
      <button
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
      </button>
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
const { estimate, submit, poll, status, result } = useBuzzWorkflow();
const body = { kind: 'textToImage', modelId, modelVersionId, params: { prompt } };
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
v0 ships the headless, manifest-driven `SettingsForm`:

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

Unstyled native controls (host themes them). `isFieldVisible` + `SettingsFormError`
are also exported. See the `settings` example.

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
