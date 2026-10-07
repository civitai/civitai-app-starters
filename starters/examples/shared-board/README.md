# shared-board — cross-viewer shared storage

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

Read from `civitai/civitai` `main` at `494941446d`. Paths are in that repo.

**Append never overwrites.** `append` is an `INSERT` with a ULID key the server
generates (`src/server/routers/apps-shared.router.ts:791-801`). There is no
"set this key" on the shared store, so two viewers can never write the same
row.

**Edits are author-only and last-write-wins.** `update` checks the row exists
and that you wrote it (`:864-879`), then runs a plain `UPDATE … WHERE key AND
author_user_id` (`:1013-1018`). No version and no compare-and-swap: the only
writer who can race your edit is you in a second tab, and the later save wins.
The key, `createdAt`, votes and reports survive an edit. The SDK hands the
block no `updatedAt` it can trust as an edit marker in the dev harness (the mock
bumps it on every vote), so this example writes `data.editedAt` itself.

**Votes are one per viewer and atomic.** The vote row and the counter change in
one statement and the counter only moves if the vote row actually changed
(`:1063-1077`, `:1106-1117`). `vote` and `unvote` are idempotent and resolve
with the total after the change. Render that number; don't add 1 locally.

**Withdraw only deletes your own row.** `DELETE … WHERE key AND author_user_id`
(`:1152`), so withdrawing someone else's row resolves `{ deleted: false }`
rather than throwing. It is a hard delete and takes the row's votes with it.

**Reports are deduplicated per viewer** (`:1202`): reporting the same row twice
files one report. A report doesn't hide anything; a moderator decides. The
shared store doesn't tell you whether you already reported a row, so this
example keeps that list in the viewer's private store.

**Listing.** Newest-first by key (`:602`), keyset-paginated: `nextCursor` is the
last key you saw (`:608-611`), so a post made after page 1 loaded doesn't shift
page 2. It shows up at the top on the next refresh. The bridge clamps `limit`
to 1–100 and defaults to 50 (`src/components/AppBlocks/IframeHost.tsx:2705-2708`).
Rows a moderator hid are never returned. `prefix` matches against the
server-minted key, so it isn't a namespace your app controls. There are **no
app-defined key namespaces** in the shared store: it is one list per app. Put
anything you'd filter by in `data` (this example stores the `modelId` it was
posted from) and filter on the client.

**`data` is not moderated.** `title` and `body` go through the host's blocking
content-safety check. `data` is stored as-is (`:423-444`). Keep every word
another viewer will read in `title`/`body`.

**The private store is an upsert.** `useAppStorage().set` is `INSERT … ON
CONFLICT … DO UPDATE` keyed on (block instance, viewer, key)
(`src/server/services/apps/app-storage.service.ts:968-971`): last write wins,
and nobody else's writes can reach it.

### Limits

| Limit | Value | Source |
|---|---|---|
| `title` / `body` length | 200 / 4096 characters | `src/server/services/apps/shared-content-safety.ts:47-48` |
| One whole value (`title` + `body` + `data`) | 64 KB, wire bytes | `apps-shared.router.ts:88` |
| Entries per viewer, per app | 50 | `apps-shared.router.ts:91`, `:755-760` |
| App-wide bytes / rows (shared **with** the per-viewer store) | 50 MB / 1,000,000 | `apps-shared.router.ts:70-71`, `:784-789` |
| Posts + edits per viewer | 20 a day | `src/server/utils/shared-storage-rate-limit.ts:35-36` |
| Votes + unvotes | 30 a minute | `shared-storage-rate-limit.ts:41-42` |
| Reports | 20 a day | `shared-storage-rate-limit.ts:50-51` |
| Withdrawals | 30 a minute | `shared-storage-rate-limit.ts:73-74` |
| Page size | 1–100, default 50 | `apps-shared.router.ts:408-409` |

`@civitai/app-sdk` doesn't export any of these yet, so `src/App.tsx` states the
two it relies on once, with their source. The inputs are capped at 200 and
4096 characters. That keeps every value far below the 64 KB cap, so this UI
can't hit it.

### Who can write

Every write (`append`, `update`, `vote`, `unvote`, `withdraw`, `report`) needs
a signed-in viewer (`apps-shared.router.ts:362-369`) who also passes an
account-trust check: not banned or muted, onboarding complete, a verified email
or linked OAuth account, and an account at least 7 days old
(`src/server/services/blocks/block-write-trust.service.ts:52-80`). Reads
(`list`, `get`, `getCount(s)`) are allowed for anonymous viewers by design
(`apps-shared.router.ts:226`), subject to the flag below.

## 🔴 Who can use this today

Shared storage works in production, but it isn't open to every app or every
viewer yet. Check these before you debug your code:

- **A feature flag gates every call, reads included.**
  `resolveSharedContext` refuses with `shared storage is not enabled` unless
  the `app-blocks-shared-storage` flag is on for the token's subject
  (`apps-shared.router.ts:358-360`). The flag is off by default and enabled for
  a limited cohort. An anonymous viewer gets the flag's base value, which the
  host source describes as closed today
  (`src/server/services/app-blocks-flag.ts:997`). So an anonymous viewer can't
  read the board yet either. This example renders the board's error state in
  that case, not a fake list.
- **Only an approved app.** The shared resolver refuses any block whose app
  isn't `approved` (`apps-shared.router.ts:276-283`). It exempts nothing.
- **Not under `dev:live` or the dev tunnel.** The shared scopes are left out
  of the dev-token, dev-tunnel and review-sandbox allowlists on purpose
  (`src/server/services/blocks/dev-scoped-mint.service.ts:85-152`, `:164-191`,
  `:208`, `:260`). With `npm run dev:live`, every board call is refused with
  the scope message. Only the per-viewer draft goes through, and see
  [kv-storage](../kv-storage) for why App Storage refuses there too.
  `dev:harness` is the only local way to run this example.
- **`user:read:self` needs consent.** The shared scopes don't need a consent
  grant (`src/server/services/blocks/scope-grant.service.ts:1466-1477`), but
  `user:read:self` does, so until the viewer grants it the token doesn't carry
  it and `useViewer()` fails (`src/server/routers/blocks.router.ts:7859`). In
  that case the example can't tell which ideas are yours: it hides Edit/Remove
  and shows an "Allow" button that calls `useRequestConsent()` with that
  scope, then reads the identity again once the refreshed token carries it.

## Errors

`boardFailureMessage()` follows the [kv-storage](../kv-storage) pattern: call
`classifyAppStorageError(err)`, branch on the reason, log the host's words with
`console.warn` and render copy the app owns.

🔴 **That classifier was written for the per-viewer store, and on the shared
store it recognises three things:** `app quota exceeded` and `app row limit
exceeded` (the shared router throws the same strings, `:785`, `:788`), and
the bridge's `storage request failed` fallback (`IframeHost.tsx:311-317`).
Every other shared refusal classifies `null`. That includes the 50-entry cap,
the rate limits, the trust check, the feature flag, a missing scope and an
anonymous writer. The shared whole-value cap's message (`value exceeds size
cap`, `:1628`) is also worded differently from the per-viewer one, so
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
  50-entry cap, no rate limits, no trust check, no feature flag.
- **It lets anonymous viewers write.** The host refuses
  (`apps-shared.router.ts:364-369`). This example never offers the write.
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
