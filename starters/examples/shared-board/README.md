# shared-board — cross-viewer shared storage

> 🔴 **Retired — do not start an app from this example.** It is built on `useSharedStorage()` and `useAppStorage()`; a `shared` collection has authorship, counters and marks built in.
> civitai.com removed the legacy stores on 2026-11-10: every call is refused with
> a message that starts `legacy_store_removed:`, so this example works only
> against the mock host (`npm run dev:harness`) and fails on civitai.com. Store
> data in the document store instead — declare a collection in the manifest and
> use [`app.storage.collection(name)`](https://github.com/civitai/civitai-app-starters/tree/main/packages/civitai-sdk#document-storage) from `@civitai/sdk`. Moving an app:
> https://developer.civitai.com/apps/guide/storage#moving-from-the-legacy-stores. The rest of this README describes the example as it worked before the
> removal.

An idea board: every viewer of the app reads the same list, signed-in viewers
post, vote, edit and remove their own ideas, and report anyone else's. Beside it
sits a private draft that only the current viewer can see, so the difference
between the two stores is on screen:

| | `useSharedStorage()` | `useAppStorage()` |
|---|---|---|
| Who can read it | every viewer of the app | only the viewer who wrote it |
| Scope of one store | the whole **app**: every install, every model page | one (block **instance**, viewer) pair |
| Shape | append-only `{ title, body?, data? }` records with an author and a vote count | arbitrary JSON under keys you choose |
| Keys | minted by the host on `append` | chosen by the block |
| Scopes | `apps:storage:shared:read` / `apps:storage:shared:write` | `apps:storage:read` / `apps:storage:write` |
| In this example | the board | the draft, and the ideas you reported |

## What it shows

| Feature | Where (`src/App.tsx`) |
|---|---|
| `list({ limit, cursor })`, newest-first, "Load more" from `nextCursor` | `loadBoard` |
| `append({ title, body, data })` | `post` |
| `vote` / `unvote`, rendering the count the host returns | `toggleVote` |
| `update(key, value)` on your own idea | `saveEdit` |
| `withdraw(key)` on your own idea | `withdraw` |
| `report(key)` through the `/ui` `ReportButton` | `report` |
| Draft + "already reported" list in the private store | `saveDraft`, the draft effect, `report` |
| Authorship from `useViewer()` (`"you"` vs `user #id`) | `myId` |
| Sign-in gate (`isSignedIn`) and `useRequestSignIn()` | the compose card |
| Asking for `user:read:self` when the identity read is refused | the "Allow" alert |
| Error copy from `classifyAppStorageError` | `boardFailureMessage` |

```tsx
const shared = useSharedStorage();
const { key } = await shared.append({ title: 'Add dark mode', body: 'please', data: { modelId: 1 } });
const { items, nextCursor } = await shared.list({ limit: 10 });   // newest-first
const count = await shared.vote(key);        // the total AFTER your vote
await shared.unvote(key);
await shared.update(key, { title: 'Add a dark theme' });   // your own entry only
await shared.report(key);                    // someone else's entry
await shared.withdraw(key);                  // your own entry: { deleted: true }
```

## What the host actually does

This is how the host behaved before the legacy shared store was removed on
2026-11-10; every procedure now refuses first (`assertLegacyStoreAvailable`).
Symbols are in `civitai/civitai` `main`, checked at `8d7d716787` (2026-11-14).

**Append never overwrites.** `append` is an `INSERT` with a ULID key the server
generates (`appendSharedRow` in `src/server/routers/apps-shared.router.ts`). There is no
"set this key" on the shared store, so two viewers can never write the same
row.

**Edits are author-only and last-write-wins.** `update` checks the row exists
and that you wrote it (`updateSharedRow`), then runs a plain `UPDATE … WHERE key AND
author_user_id` (also in `updateSharedRow`). No version and no compare-and-swap: the only
writer who can race your edit is you in a second tab, and the later save wins.
The key, `createdAt`, votes and reports survive an edit. The SDK hands the
block no `updatedAt` it can trust as an edit marker in the dev harness (the mock
bumps it on every vote), so this example writes `data.editedAt` itself.

**Votes are one per viewer and atomic.** The vote row and the counter change in
one statement and the counter only moves if the vote row actually changed
(`voteSharedRow`, `unvoteSharedRow`). `vote` and `unvote` are idempotent and resolve
with the total after the change. Render that number; don't add 1 locally.

**Withdraw only deletes your own row.** `DELETE … WHERE key AND author_user_id`
(`withdrawSharedRow`), so withdrawing someone else's row resolves `{ deleted: false }`
rather than throwing. It is a hard delete and takes the row's votes with it.

**Reports are deduplicated per viewer** (`insertUserSharedReportDeduped`): reporting the same row twice
files one report. A report doesn't hide anything; a moderator decides. The
shared store doesn't tell you whether you already reported a row, so this
example keeps that list in the viewer's private store.

**Listing.** Newest-first by key (`listSharedRows`), keyset-paginated: `nextCursor` is the
last key you saw (also in `listSharedRows`), so a post made after page 1 loaded doesn't shift
page 2. It shows up at the top on the next refresh. The bridge clamps `limit`
to 1–100 and defaults to 50 (the `SHARED_LIST` handler in `src/components/AppBlocks/IframeHost.tsx`).
Rows a moderator hid are never returned. `prefix` matches against the
server-minted key, so it isn't a namespace your app controls. There are **no
app-defined key namespaces** in the shared store: it is one list per app. Put
anything you'd filter by in `data` (this example stores the `modelId` it was
posted from) and filter on the client.

**`data` skips the title/body check.** `title` and `body` go through the host's
blocking content-safety check. `data` gets only a lighter per-app scan that is
off by default (`assertSharedValueSafeAndSerialize` in `apps-shared.router.ts`). Keep every word
another viewer will read in `title`/`body`.

**The private store is an upsert.** `useAppStorage().set` is `INSERT … ON
CONFLICT … DO UPDATE` keyed on (block instance, viewer, key)
(`setAppStorageValue` in `src/server/services/apps/app-storage.service.ts`): last write wins,
and nobody else's writes can reach it.

### Limits

| Limit | Value | Source |
|---|---|---|
| `title` / `body` length | 200 / 4096 characters | `SHARED_TITLE_MAX` / `SHARED_BODY_MAX` in `src/server/services/apps/shared-content-safety.ts` |
| One whole value (`title` + `body` + `data`) | 64 KB, wire bytes | `SHARED_VALUE_BYTE_CAP` in `apps-shared.router.ts` |
| Entries per viewer, per app | 50 | `SHARED_KV_PER_USER_ROW_CAP` in `apps-shared.router.ts`, checked in `appendSharedRow` |
| App-wide bytes / rows (shared **with** the per-viewer store) | 50 MB / 1,000,000 | `APP_QUOTA_BYTES` / `APP_ROW_LIMIT` in `apps-shared.router.ts`, checked in `appendSharedRow` |
| Posts, edits, votes, withdrawals, reports | rate-limited per viewer, per app | [`@civitai/blocks-react` README](https://github.com/civitai/civitai-app-starters/blob/main/packages/civitai-blocks-react/README.md#shared-storage-write-limits) |
| Page size | 1–100, default 50 | `SHARED_LIST_LIMIT_MAX` / `SHARED_LIST_LIMIT_DEFAULT` in `apps-shared.router.ts` |

A rate-limited refusal carries retry metadata. From the `@civitai/blocks-react`
release after `0.67.x` it is thrown as `SharedStorageRateLimitError` (same
README section). This example still handles it in the `null` arm below, because
it pins the published `0.67.x`.

`@civitai/app-sdk` doesn't export any of these yet, so `src/App.tsx` states the
two it relies on once, with their source. The inputs are capped at 200 and
4096 characters. That keeps every value far below the 64 KB cap, so this UI
can't hit it.

### Who can write

Every write (`append`, `update`, `vote`, `unvote`, `withdraw`, `report`) needs
a signed-in viewer (`resolveSharedContext` in `apps-shared.router.ts`) who also passes an
account-trust check: not banned or muted, onboarding complete, a verified email
or linked OAuth account, and an account at least 7 days old
(`sharedWriteTrustRefusal` in `src/server/services/blocks/block-write-trust.service.ts`). Reads
(`list`, `get`, `getCount(s)`) are allowed for anonymous viewers by design
(`READ_OPS` in `apps-shared.router.ts`), subject to the flag below.

## 🔴 Who can use this today

Shared storage works in production, but it isn't open to every app or every
viewer yet. Check these before you debug your code:

- **A feature flag gates every call, reads included.**
  `resolveSharedContext` refuses with `shared storage is not enabled` unless
  the `app-blocks-shared-storage` flag is on for the token's subject
  (`resolveSharedContext` in `apps-shared.router.ts`). The flag is off by default and enabled for
  a limited cohort. An anonymous viewer gets the flag's base value, which the
  host source describes as closed today
  (the `isAppBlocksSharedStorageEnabled` docblock in `src/server/services/app-blocks-flag.ts`). So an anonymous viewer can't
  read the board yet either. This example renders the board's error state in
  that case, not a fake list.
- **Only an approved app.** The shared resolver refuses any block whose app
  isn't `approved` (`resolveSharedContext`, `approval: 'strict'`, in `apps-shared.router.ts`). It exempts nothing.
- **Not under `dev:live` or the dev tunnel.** The shared scopes are left out
  of the dev-token, dev-tunnel and review-sandbox allowlists on purpose
  (`DEV_TOKEN_SCOPE_ALLOWLIST`, `TUNNEL_HOST_MINT_SCOPE_ALLOWLIST`,
  `REVIEW_MINT_SCOPE_ALLOWLIST` and `REVIEW_RUN_FOR_REAL_MINT_SCOPE_ALLOWLIST` in
  `src/server/services/blocks/dev-scoped-mint.service.ts`). With `npm run dev:live`, every board call is refused with
  the scope message. Only the per-viewer draft goes through, and see
  [kv-storage](../kv-storage) for why App Storage refuses there too.
  `dev:harness` is the only local way to run this example.
- **`user:read:self` needs consent.** The shared scopes don't need a consent
  grant (`CONSENT_EXEMPT_SCOPES` in `src/shared/constants/block-scope.constants.ts`), but
  `user:read:self` does, so until the viewer grants it the token doesn't carry
  it and `useViewer()` fails (`getMyViewer` in `src/server/routers/blocks.router.ts`). In
  that case the example can't tell which ideas are yours: it hides Edit/Remove
  and shows an "Allow" button that calls `useRequestConsent()` with that
  scope, then reads the identity again once the refreshed token carries it.

## Errors

`boardFailureMessage()` follows the [kv-storage](../kv-storage) pattern: call
`classifyAppStorageError(err)`, branch on the reason, log the host's words with
`console.warn` and render copy the app owns.

🔴 **That classifier was written for the per-viewer store, and on the shared
store it recognises three things:** `app quota exceeded` and `app row limit
exceeded` (the shared router throws the same strings, in `appendSharedRow`), and
the bridge's `storage request failed` fallback (`storageErrorMessage` in `src/components/AppBlocks/sharedStorageError.ts`, which `IframeHost.tsx` uses).
Every other shared refusal classifies `null`. That includes the 50-entry cap,
the rate limits, the trust check, the feature flag, a missing scope and an
anonymous writer. The shared whole-value cap's message (`value exceeds size
cap`, `SHARED_VALUE_OVER_CAP_MESSAGE`) is also worded differently from the per-viewer one, so
`value-too-large` doesn't fire for it. So:

| Case | How this example handles it |
|---|---|
| App-wide quota / rows | classified, with "this board is full" copy |
| Bridge/transport failure | classified `request-failed`, with retry copy |
| Per-value cap | can't happen: inputs are capped well below it |
| Anonymous writer | never sent: writes are only offered after `isSignedIn(viewer)`, with a Sign in button otherwise |
| Missing scope | a manifest bug; the harness refuses it like production (below) and it lands on the `null` arm |
| 50-entry cap, rate limits, trust check, flag | `null` arm: names the likely causes and suggests a reload. It never says "please try again" |

## Run it

```bash
npm install           # inside this monorepo: pnpm install, at the root
npm run dev:harness   # → http://localhost:5187
```

The harness is the SDK mock host with `declaredScopes` read from this
manifest, and a board seeded with three ideas from other users
(`src/Harness.tsx`). `?viewer=anon` shows the signed-out view and `?theme=light`
the light theme. Drop a shared or storage scope from `block.manifest.json` (and
its `scopeJustifications` entry) and every matching call is refused with the
host's scope message. That happens both here and in production.

⚠️ The mock host differs from production in ways that matter here:

- **It enforces none of the shared limits**: no length caps, no 64 KB cap, no
  50-entry cap, no rate limits, no trust check, no feature flag. (A
  rate-limited refusal can be simulated with the mock host's
  `shared.rateLimitNext` knob, from the `@civitai/blocks-react` release after
  `0.67.x`.)
- **It lets anonymous viewers write.** The host refuses
  (`resolveSharedContext` in `apps-shared.router.ts`). This example never offers the write.
- **`withdraw` deletes anyone's row.** The host deletes only your own.
- **Keys are `shared_1`, `shared_2`, …**, not ULIDs, and errors are short codes
  (`NOT_FOUND`, `FORBIDDEN`), not the host's messages.
- **`vote`/`unvote` bump `updatedAt`.** The host leaves it alone. That's why this
  example marks edits through `data.editedAt`.
- **`user:read:self` is never withheld.** `useViewer()` always answers, so the
  "Allow" path can't be reached locally.
- **One viewer.** Every seeded "other user" is static data. There's no second
  viewer whose concurrent votes you could watch.

See the [root README](../../../README.md) for submit → review → deploy.
