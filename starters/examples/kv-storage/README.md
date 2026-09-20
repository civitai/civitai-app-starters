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
one it was, do not assume it was the value's size. **Under `dev:mock` and this
example's harness the error string is `"PAYLOAD_TOO_LARGE"` for all three, so
the mock does not distinguish them.** That is a property of the mock. The real
host forwards its own per-gate message instead, which would make them
distinguishable in production; reconciling the two is tracked in
[#343](https://github.com/civitai/civitai-app-starters/issues/343).

🔴 **So `storageFailureMessage()` in `src/App.tsx` is MOCK-ONLY today, and the
example is honest about it.** Its `/payload_too_large/i` arm matches the mock's
string and nothing the live host sends, so in production that function has one
branch — the generic fallback. Copy its **shape** (own your viewer copy, log
the host's words with `console.warn`, never render them); do not copy the
pattern expecting it to fire against the host. Widening it means guessing at
host prose nobody has enumerated, which fails the same way while looking
handled — do it in the change that closes #343, against the real strings.

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

⚠️ It is a simulation, not a replica. Three known divergences from the host:

- the error string a rejection carries
  ([#343](https://github.com/civitai/civitai-app-starters/issues/343));
- whether a shrinking overwrite is admitted when the store is already over the
  byte budget ([#345](https://github.com/civitai/civitai-app-starters/issues/345)
  — the host admits it, the harness does not);
- 🔴 the UNIT the byte budget is counted in: wire bytes here, `octet_length(
  value::jsonb::text)` on the host, which is larger for every container — up to
  ~1.5x ([#347](https://github.com/civitai/civitai-app-starters/issues/347)).

Passing here is evidence, not proof — and the third one is **permissive**: it
lets a write through locally that production will reject, which is the failure
direction that costs you a production incident rather than a confusing local
error. See the [root README](../../../README.md) for submit → review → deploy.
