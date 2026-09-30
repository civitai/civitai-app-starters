# `@civitai/blocks-client-react`

React bindings for [`@civitai/blocks-client`](../civitai-blocks-client). **One
primitive per call shape, not a hook per endpoint.**

```bash
npm install @civitai/blocks-client @civitai/blocks-client-react
```

## Why four

`@civitai/blocks-client` is framework-free by construction, and it has exactly
four call shapes. So this package has exactly four hooks:

| Client shape | Hook | Used for |
|---|---|---|
| snapshot store | `useBlockSnapshot` | `ready`, `context`, `viewer`, `theme`, `token` — the handshake |
| `Promise<T>` | `useBridgeCall` | `buzz.getAccounts`, `storage.get`, `orchestration.estimateWorkflow`, … |
| `Live<T>` | `useLive` | `buzz.watchAccounts` |
| `AsyncIterable<T>` | `useAsyncIterable` | `buzz.listTransactions`, `orchestration.listWorkflows`, `orchestration.watchWorkflow` |

Everything else a block does is a plain call and needs no React help:
`storage.set(k, v)`, `host.resize(h)`, `viewer.requestSignIn()`.

The predecessor shipped **38 hooks**, one per capability, each re-implementing
request sequencing and cancellation — and getting them wrong independently.
Seven of them had no sequencing guard at all
([#392](https://github.com/civitai/civitai-app-starters/issues/392)). Collapsing
to one-per-shape fixes that class **once**, instead of once per endpoint.

## No compatibility shims, and why

A `useBuzzAccounts`-style shim layer was considered and rejected on measurement,
not preference. Across this repo the only first-party consumer of the blocks
hooks is `starters/civitai-block-starter/src`, and it uses **three** of the 36:
`useBlockContext`, `useBlockResize`, `useViewer`. The four OAuth starters import
`@civitai/blocks-react` in **zero** files (control: `react-pwa` imports
`@civitai/app-sdk` in 14).

All three port to one line each:

| Old hook | New |
|---|---|
| `useBlockContext()` | `useBlockSnapshot()` |
| `useBlockResize(ref)` | `host.resize(h)` in a `ResizeObserver`, or keep a local hook |
| `useViewer()` | `useBridgeCall((o) => viewer.getViewer(o), [])` |

A 38-hook shim layer for three call sites is dead code that rebuilds the surface
this consolidation exists to delete. The migration is a map, not a shim.

## Usage

```tsx
import { buzz, storage, orchestration } from '@civitai/blocks-client';
import { useBridgeCall, useLive, useAsyncIterable } from '@civitai/blocks-client-react';

function Balance() {
  const { value, loading } = useLive(buzz.watchAccounts());
  if (loading && !value) return <Spinner />;
  return <span>{value?.[0]?.balance ?? 0}</span>;
}

function SavedPrompt({ key }: { key: string }) {
  const { data, error, loading, refetch } = useBridgeCall(
    (opts) => storage.get<string>(key, opts),
    [key],                      // same contract as useEffect's dep list
  );
  // ...
}

function History() {
  const { items, loading } = useAsyncIterable(
    (opts) => buzz.listTransactions({ limit: 50 }, opts),
    [],
  );
  // ...
}
```

Create the `Live` once and keep it stable — `useLive(buzz.watchAccounts())`
inline in a component body makes a new one every render. Hoist it to a module
constant, or memoize it.

## What each primitive guarantees

### `useBridgeCall(call, deps)`

- **A superseded reply can never write state.** Each run takes a ticket; a reply
  whose ticket is stale is dropped. Without this, changing `deps` mid-flight lets
  the *older* reply land second and overwrite the newer state.
- **A superseded request is aborted**, not merely ignored, so the host stops
  doing work nobody will read.
- There is deliberately **no `mountedRef`**. React 18 made `setState` after
  unmount a silent no-op, so that guard pins a hazard that no longer exists — a
  mutation sweep confirmed it survived deletion with every test still green. It
  was removed rather than kept with a test written to justify it.

### `useLive(live)`

Built on `useSyncExternalStore`, which is what `Live<T>` is already shaped for:
an `EventTarget` dispatching `change`, with stable value identity between
changes. That is what makes concurrent React read a consistent value instead of
tearing mid-render.

🔴 **Three subscriptions, on purpose — do not tidy them into one.**
`useSyncExternalStore` calls `getSnapshot` every render and bails out only on
`Object.is` equality. A composed `{ value, error, loading }` snapshot allocates a
fresh object each call, never compares equal, and re-renders forever. Each field
gets its own store so every snapshot stays a stable reference or a primitive.

A `getServerSnapshot` is supplied because `useSyncExternalStore` throws without
one in an SSR bundle. It is not because blocks are server-rendered — they are
iframes and never are. (An earlier draft of this line claimed `next-app` renders
blocks; measured, `next-app` imports `@civitai/blocks-react` in zero files.)

### `useBlockSnapshot(transport?)`

The handshake store — `BlockTransport.snapshot` is `{ get(), subscribe() }`,
already `useSyncExternalStore`'s contract. Identity is stable by construction:
the transport holds one snapshot field and replaces it wholesale, so `get()`
returns the same reference until something moves. If that ever changes, this
hook re-renders forever and `useLive`'s docblock explains the same trap.

Blocks render in an iframe and are never server-rendered; the `getServerSnapshot`
here exists only so importing the hook into an SSR bundle does not throw. It
returns a frozen module constant rather than a fresh object, for the same
identity reason. `@civitai/blocks-client` has an `EMPTY_SNAPSHOT` it does not
export — exporting it would remove this copy and the chance of drift.

### `useAsyncIterable(create, deps)`

Cancellation is the whole job, and it takes **both** halves: abort the signal (so
the generator's in-flight bridge request stops) *and* flip a `cancelled` flag (so
a generator that ignores its signal still cannot write into the next run's
state). `items` resets when a run supersedes.

`items` is copied per yield so React renders progressively — O(n²) over a very
long stream. Pass a `limit` for endless ones; `watchWorkflow` is endless by
design and is usually read for its latest item rather than accumulated.

## Testing

```bash
pnpm --filter @civitai/blocks-client-react test
```

20 tests, happy-dom, no browser tier. The six guards above are
**mutation-tested**: each is broken on purpose and the sweep asserts a test fails
with *that test's own* assertion, with the mutation's occurrence count asserted
before writing and the file restored byte-identical by sha256. Two mutants survived the first sweep and both
were real gaps, not noise — the `mountedRef` check was unnecessary (deleted), and
the `cancelled` flag was unreachable through unmount (the test was rewritten to
supersede while mounted, which is the case that actually needs it). The sweep
lives in the PR that introduced this package.
