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

Three ceilings. `@civitai/app-sdk/blocks` exports each as a constant —
**import them, never retype a number**:

| Constant | Caps |
|---|---|
| `APP_STORAGE_MAX_VALUE_BYTES` | one value, in wire bytes |
| `APP_STORAGE_MAX_BYTES` | total stored bytes per (**app**, viewer) |
| `APP_STORAGE_MAX_ROWS` | total rows per (**app**, viewer) |

🔴 **They are the ceilings as of the SDK version you installed, not live
figures.** A constant compiled into a published package is a frozen number —
the same failure mode as the stale figure this example used to print, with one
copy instead of nine. **`getQuota()` is the authority**: render its `limitBytes` /
`limitRows` anywhere a viewer sees a number or a code path decides whether a
write will fit, and use the constants only where no reply is available (a test
fixture, a design-time estimate, this example's offline harness). Re-check
after an SDK bump; the host sized the clamp against a measured distribution and
says to expect a re-measure.

🔴 **Note the scope difference.** The store above is *namespaced* per (block
instance, viewer), but the byte and row *budgets* are per (**app**, viewer) —
every instance of this app shares one budget for a given viewer. The docs used
to quote a far larger app-wide umbrella here, which is why they were **25x**
out on bytes and **1000x** out on rows.

🔴 **Rows run out before bytes do.** One small record per item a viewer touches
exhausts `APP_STORAGE_MAX_ROWS` while using a small fraction of
`APP_STORAGE_MAX_BYTES`, so a bytes-only usage readout shows plenty of headroom
right up to the rejection. This example prints both.

On a write that would cross any of the three, `set()` rejects — and whichever
one it was, do not assume it was the value's size.

🔴 **The rejection carries a host-authored MESSAGE, not a code.** There is no
`PAYLOAD_TOO_LARGE` on the wire: that is the TRPC *code*, and the host's bridge
forwards `err.message` (`per-user row limit exceeded`, `value exceeds 64KB
cap`, …). Six such strings exist; they are measured and single-sourced in the
app-sdk's `blocks/appStorageErrors.ts`, and this example's harness draws its
rejections from the same module — so the branches it CAN reach fire the same
way here and in production.

⚠️ **It reaches three of the six**, and that is a property of the harness, not
of your block. It has one rejection site, a three-way choice between the
per-value cap, the per-user byte budget and the per-user row budget. So:

| reason | reachable under `pnpm dev:harness`? |
| --- | --- |
| `value-too-large` | yes |
| `user-quota-exceeded` | yes |
| `user-row-limit` | yes |
| `app-quota-exceeded` / `app-row-limit` | **no** — nothing here models the app-wide umbrella ([#368](https://github.com/civitai/civitai-app-starters/issues/368)) |
| `request-failed`, and the `default:` arm's `null` | **no** — the harness has no forced-failure knob (`createMockHost` does, via `storage: { failNext }`) |

Those arms are still correct and still required — a block that drops them
renders nothing at all for a real production rejection. They are simply not
exercised by running this example locally, which is the #343 lesson with its
polarity reversed: there, a branch fired locally and never live.

`storageFailureMessage()` in `src/App.tsx` is the shape to copy: it calls
`classifyAppStorageError(err)`, branches on the REASON, logs the host's words
with `console.warn` and renders copy the app owns. Note which remedies it keeps
apart — four of them, because they are four different fixes: shorten the value,
free a row, free bytes, and "this is the developer's problem, do not send the
viewer on an errand". A `bytes`-only readout gives no warning about the second.
Keep its `default:` arm: the classifier answers `null` for a message it does
not recognise, and the host can reword one in any deploy.

It did not always work this way. The arm used to be `/payload_too_large/i`,
matching the mock's invented string and nothing the live host sends — so the
useful copy was unreachable in production while passing every local run
([#343](https://github.com/civitai/civitai-app-starters/issues/343)).

Surface `getQuota()` in your UI (`"X of {limitBytes}"`, `"N of {limitRows}
rows"`) rather than hard-coding anything: the ceilings move.

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
offline.

⚠️ It is a simulation, not a replica. Four known divergences from the host:

- whether a shrinking overwrite is admitted when the store is already over the
  byte budget ([#345](https://github.com/civitai/civitai-app-starters/issues/345)
  — the host admits it, the harness does not);
- 🔴 the UNIT the byte budget is counted in: wire bytes here, `octet_length(
  value::jsonb::text)` on the host, which is larger for every container — up to
  ~1.5x ([#347](https://github.com/civitai/civitai-app-starters/issues/347));
- the **app-wide** ceilings do not exist here at all, so `app quota exceeded`
  and `app row limit exceeded` can never be produced locally
  ([#368](https://github.com/civitai/civitai-app-starters/issues/368));
- in `createMockHost`, lowering `valueCapBytes` moves the gate but not the
  message ([#369](https://github.com/civitai/civitai-app-starters/issues/369)).

Passing here is evidence, not proof — and the second is **permissive**: it lets
a write through locally that production will reject, which is the failure
direction that costs you a production incident rather than a confusing local
error. See the [root README](../../../README.md) for submit → review → deploy.
