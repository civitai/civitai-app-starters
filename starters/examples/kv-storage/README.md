# kv-storage — per-block key-value store

`useAppStorage()` — a small KV datastore scoped to (this block instance, this
viewer). A tiny notes pad here.

## What it shows

| Concept | Where |
|---|---|
| `useAppStorage()` — get / set / delete / list / getQuota | `src/App.tsx` |
| Quota + per-value cap handling | `save()` |
| Anon viewer handling | `src/App.tsx` |

## The store

```tsx
const storage = useAppStorage();

await storage.set('note-1', { text: 'hi', savedAt: Date.now() });
const note = await storage.get<{ text: string }>('note-1');  // null if unset/anon
await storage.delete('note-1');                               // idempotent
const { keys, nextCursor } = await storage.list({ prefix: 'note-', limit: 50 });
const quota = await storage.getQuota();  // { usedBytes, rowCount, limitBytes, limitRows }
```

Calls flow through the host's postMessage bridge — **the block never sees the
apps DB credentials**. The host stores arbitrary JSON.

### Scope & isolation

The store is keyed on (block instance, viewer): two users of the same block get
isolated stores; the same user on a different model install gets a different
store. This is the `apps:storage` capability — at v0 it's **ambient** (every
block can call it; the host gates it, it's not a declared manifest scope). A
future version may turn it into a real declared scope.

### Limits

Three ceilings, all exported from `@civitai/app-sdk/blocks` — **import them, do
not retype the numbers**:

| Constant | Caps |
|---|---|
| `APP_STORAGE_MAX_VALUE_BYTES` | one value, in wire bytes |
| `APP_STORAGE_MAX_BYTES` | total stored bytes per (**app**, viewer) |
| `APP_STORAGE_MAX_ROWS` | total rows per (**app**, viewer) |

🔴 **Note the scope difference.** The store above is *namespaced* per (block
instance, viewer), but the byte and row *budgets* are per (**app**, viewer) —
every instance of this app shares one budget for a given viewer. The docs used
to quote a far larger app-wide umbrella here, which is why they were **25x**
out on bytes and **1000x** out on rows.

🔴 **Rows run out before bytes do.** One small record per item a viewer touches
exhausts `APP_STORAGE_MAX_ROWS` while using a small fraction of
`APP_STORAGE_MAX_BYTES`, so a bytes-only usage readout shows plenty of headroom
right up to the rejection. This example prints both.

On a write that would cross any of the three, `set()` rejects with the host's
error string `"PAYLOAD_TOO_LARGE"` — the host deliberately doesn't leak *which*
limit tripped, so do not assume it was the value's size. Surface `getQuota()`
in your UI (`"X of {limitBytes}"`, `"N of {limitRows} rows"`) rather than
hard-coding anything: the ceilings move.

### Anon viewers

`get`/`list` no-op (resolve `null` / empty); writes reject. Gate your UI on
`useBlockContext().viewer` (this example shows a "sign in to save" state).

## Run it

```bash
cp .env.example .env
pnpm install
pnpm dev:harness   # → http://localhost:5183
```

The harness backs the bridge with an in-memory Map that enforces all three
caps against the same SDK constants — **including the row limit**, which it
reported but did not enforce until recently, so a row-limit overrun used to
pass here and fail only in production. set/get/delete/list/quota all work
offline. See the
[root README](../../../README.md) for submit → review → deploy.
