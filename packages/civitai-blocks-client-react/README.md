# `@civitai/blocks-client-react`

React bindings for [`@civitai/blocks-client`](../civitai-blocks-client). **Three
primitives, not a hook per endpoint.**

```bash
npm install @civitai/blocks-client @civitai/blocks-client-react
```

## Why three

`@civitai/blocks-client` is framework-free by construction, and it has exactly
three call shapes. So this package has exactly three hooks:

| Client shape | Hook | Used for |
|---|---|---|
| `Promise<T>` | `useBridgeCall` | `buzz.getAccounts`, `storage.get`, `orchestration.estimateWorkflow`, … |
| `Live<T>` | `useLive` | `buzz.watchAccounts` |
| `AsyncIterable<T>` | `useAsyncIterable` | `buzz.listTransactions`, `orchestration.listWorkflows`, `orchestration.watchWorkflow` |

Everything else a block does is a plain call and needs no React help:
`storage.set(k, v)`, `host.resize(h)`, `viewer.requestSignIn()`.

The predecessor shipped **38 hooks**, one per capability, each re-implementing
request sequencing and cancellation — and getting them wrong independently.
Seven of them had no sequencing guard at all
([#392](https://github.com/civitai/civitai-app-starters/issues/392)). Collapsing
to three primitives fixes that class **once**, in one place, instead of once per
endpoint.

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

A `getServerSnapshot` is supplied, because `next-app` renders blocks on the
server and this throws there without one.

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

17 tests, happy-dom, no browser tier. The five guards above are
**mutation-tested**: each is broken on purpose and the sweep asserts a test fails
with *that test's own* assertion. Two mutants survived the first sweep and both
were real gaps, not noise — the `mountedRef` check was unnecessary (deleted), and
the `cancelled` flag was unreachable through unmount (the test was rewritten to
supersede while mounted, which is the case that actually needs it). The sweep
lives in the PR that introduced this package.
