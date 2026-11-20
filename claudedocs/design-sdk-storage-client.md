# Design — `AppClient.storage`, a per-viewer app-storage client on `@civitai/sdk`

**Status:** design only. No package source was modified to produce it.
**Date:** 2026-09-24.
**Decided upstream, not re-litigated here:** the client goes on `@civitai/sdk`'s `AppClient`,
alongside `site` / `orchestration` / `host`. This document settles the *shape*.

---

## 0. Two corrections to the brief, both verified first-hand

**0.1 🔴 PR #5085 is OPEN, not merged.**

```
gh pr view 5085 --json state,mergedAt,mergeCommit
→ {"state":"OPEN","mergedAt":null,"mergeCommit":null,"headRefName":"feat/app-storage-rest"}
```

Content check, not ancestry: `/home/zach/workspace/civit/civitai/src/pages/api/v1/blocks/app-storage/`
**does not exist** on the `main` clone at `438223aad9`. Every route citation below is from the
worktree `/home/zach/workspace/civit/civitai-appstorage-rest` at `58cb93144e`
(`feat/app-storage-rest`). `fleet-port-scoping-2026-09-24.md:327-369` records that branch's CI as
red on `ESLint (added files)` (7 `no-empty-function` errors in the new
`app-storage.service.ts`). **So this design is written against a branch that can still move.** If
#5085 lands with a different envelope, §4 and §5 need re-reading against what actually merged.

**0.2 The `updatedAt` seam is smaller than the brief states — and that changes the decision.**

The brief says "the bridge's superjson revived a `Date`", implying `Date` is a transport artefact.
It is not. `@civitai/blocks-react`'s hook does the revival **itself, client-side**:

- `packages/civitai-blocks-react/src/hooks/useAppStorage.ts:212` — `updatedAt: new Date(k.updatedAt)`
- its validator accepts either form: `src/transport/validate.ts:1126` — `if (!isDateLike(k.updatedAt)) return false`,
  with `:1114` saying *"the hook rehydrates `updatedAt` via `new Date`"*

So `Date` is already **the SDK layer's choice**, not the wire's. That makes §6 a continuation, not a
change of representation. Detail matters because the fleet doc framed this as a two-option fork
("#5085 serialises like the bridge, **or** gen-matrix retypes to `string`",
`fleet-port-scoping-2026-09-24.md:321-323`). There is a third option and it is where the bridge
already put it: **the client settles it.**

---

## 1. The TypeScript interface

New module `packages/civitai-sdk/src/storage/index.ts`. Written in the `site`/`orchestration`
idiom: an interface, a `createXClient(http)` factory, options object last, `signal` supported.

```ts
import { CivitaiError } from '../core/errors.js';
import type { Http } from '../http/index.js';

/** Where the five routes live under the site base URL. */
const BASE = 'blocks/app-storage';

export interface StorageCallOptions {
  signal?: AbortSignal;
}

/** One row of a key listing. Values are not returned — `get(key)` fetches them. */
export interface StorageKeyEntry {
  key: string;
  /**
   * When this key was last written. Revived here from the wire's ISO string,
   * so a caller can do date arithmetic without knowing the transport. See §6.
   */
  updatedAt: Date;
}

export interface StorageListResult {
  keys: StorageKeyEntry[];
  /**
   * 🔴 PRESENT EXACTLY WHEN THERE MAY BE MORE ROWS, and passed through
   * untouched. The server sets it iff `rows.length === limit`
   * (app-storage.service.ts:1122-1125). A caller uses its ABSENCE as proof a
   * scan completed, and for one caller that is a money decision — see §4.
   * Never default it, never normalise it.
   */
  nextCursor?: string;
}

export interface StorageListQuery {
  /** Narrows to keys starting with this. Escaped server-side against LIKE wildcards. */
  prefix?: string;
  /** 1–200. The server defaults to 50; this client sends no default of its own. */
  limit?: number;
  /** An opaque `nextCursor` from a previous page. */
  cursor?: string;
}

export interface StorageQuota {
  /**
   * 🔴 THE STORED UNIT — Postgres `octet_length(value::text)` over JSONB, the
   * unit both ceilings are enforced in. This is the authority for "how close am
   * I to my cap". It is NOT `set`'s `sizeBytes`; measured, a numeric-heavy
   * payload stores up to 44.4x its wire size (app-storage.service.ts:172-182).
   */
  usedBytes: number;
  rowCount: number;
  /** Render this, never a compiled-in figure — the ceiling can move. */
  limitBytes: number;
  /** Usually the BINDING one: many small rows exhaust this long before bytes. */
  limitRows: number;
}

/**
 * The viewer's own per-(app, block instance) key/value store.
 *
 * 🔴 EVERY FAILURE REJECTS. There is no 2xx path here that means "not written"
 * and no resolution that means "could not read". A caller that must not act on
 * a partial view branches on the rejection, never on an empty result.
 */
export interface StorageClient {
  /** The value, or `null` when the key is unset. Rejects on any refusal. */
  get<T = unknown>(key: string, opts?: StorageCallOptions): Promise<T | null>;

  /**
   * Upsert one key. Resolves only when the write landed.
   *
   * `sizeBytes` is the WIRE unit — `Buffer.byteLength(JSON.stringify(value))` —
   * so it predicts the 64 KB per-value cap and nothing else. 🔴 Do not sum it
   * to track quota; call {@link getQuota}. See `StorageQuota.usedBytes`.
   */
  set<T = unknown>(
    key: string,
    value: T,
    opts?: StorageCallOptions,
  ): Promise<{ ok: true; sizeBytes: number }>;

  /** Idempotent. `deleted: false` means the key was already absent — a success. */
  delete(key: string, opts?: StorageCallOptions): Promise<{ ok: true; deleted: boolean }>;

  /** One page of keys, ordered by key ascending. Values are not returned. */
  list(query?: StorageListQuery, opts?: StorageCallOptions): Promise<StorageListResult>;

  /** This viewer's usage against this viewer's caps. */
  getQuota(opts?: StorageCallOptions): Promise<StorageQuota>;
}

export function createStorageClient(http: Http): StorageClient { /* §3 */ }
```

**Error type: none new.** `ApiError` (`src/http/index.ts:13-24`) already carries `status` and the
parsed `body`, and `messageOf` (`:90-97`) already reads both envelope shapes these routes use —
`{ error }` from the middleware's 403 and the handlers' 400, `{ message }` from
`handleEndpointError`. A malformed **2xx** body throws `CivitaiError` (§3), which `ApiError`
extends, so one `catch (e) { if (e instanceof CivitaiError) … }` covers both.

### Naming notes

- `getQuota`, not `quota` — matches the bridge hook (`useAppStorage.ts:105`) and the tRPC procedure
  name, so the five apps' call sites are a rename of the *receiver* only.
- `list(query, opts)` rather than `list(opts)` — separates the server's query from the call's
  `signal`, matching `orchestration.queryWorkflows(query, opts)` (`orchestration/index.ts:78`).
  ⚠ This is the one signature that differs from the bridge hook's `list({prefix, limit, cursor})`;
  callers passing a single object are source-compatible because `opts` is optional.
- `StorageCallOptions` is declared locally rather than imported from `orchestration`. `check-layering.mjs`
  only constrains `core`, so an import would pass — but a cross-domain type import for one optional
  field couples two release surfaces for nothing.

---

## 2. Where it attaches, and how it gets the token and base URL

```ts
// src/app/index.ts
export interface AppClient {
  readonly site: SiteClient;
  readonly storage: StorageClient;      // NEW — between site and orchestration
  readonly orchestration: OrchestrationClient;
  requestGrants(...): Promise<boolean>;
  getToken(...): Promise<string>;
}
```

`BlockAppClient extends AppClient` (`app/index.ts:37`), so it inherits `storage` with no second
declaration. Nothing is added to `BlockAppClient` — the block-specific half of this surface is
`viewer`, which it already has (`:39-40`, `:84-86`) and which §5 makes load-bearing.

Wiring in `createAppClient` (`app/index.ts:100-108`), one shared `http` instance for both
site-hosted surfaces:

```ts
function createAppClient(session: Session, options: ClientOptions): AppClient {
  const siteHttp = createHttp({ session, baseUrl: options.siteUrl ?? DEFAULT_SITE_URL, fetch: options.fetch });
  return {
    site: createSiteClient(siteHttp),
    storage: createStorageClient(siteHttp),
    orchestration: createOrchestrationClient(
      createHttp({ session, baseUrl: options.orchestrationUrl ?? DEFAULT_ORCHESTRATION_URL, fetch: options.fetch }),
    ),
    requestGrants: (scopes, opts) => session.requestGrants(scopes, opts),
    getToken: (opts) => session.getToken(opts),
  };
}
```

- **Base URL:** `options.siteUrl ?? DEFAULT_SITE_URL` = `https://civitai.com/api/v1`
  (`site/index.ts:3`). The routes are `blocks/app-storage/*` under it. **No new option.** This also
  means `__configurePlatform({ siteUrl })` — the one-line dev-harness override the reference port
  uses (`app-requests/src/platform/client.ts:18,37`) — redirects storage too, for free.
- **Token:** `createHttp` reads `session.getToken()` per request and sends `Authorization: Bearer`
  (`http/index.ts:41,52`). Both session kinds work: `createHostSession(transport)` inside a page,
  `createTokenSession` outside. Nothing storage-specific.
- **Refresh:** inherited — one retry on 401 with `getToken({fresh:true})` (`http/index.ts:53-57`).
  Correct for `invalid block token` (`app-storage.service.ts:290`); see §5 for the one case where it
  costs a wasted round-trip.
- **Scopes:** `apps:storage:read` / `apps:storage:write` are already in `SCOPES`
  (`session/index.ts:4,7`), so `requestGrants` needs no change. Both are consent-exempt server-side,
  so in practice they arrive on the token without a prompt.

### 🔴 One honesty caveat about putting it on `AppClient` rather than `BlockAppClient`

`withBlockScope` verifies a **block JWT**: `verifyBlockToken` requires a `kid`, RS256, and a fixed
issuer/audience (`block-scope.middleware.ts:591-640`), then `blockBearerToken(req)` forwards the raw
token to the shared body which verifies it again. An `AppClient` built with
`initialize({ token: <OAuth access token> })` will therefore **always** 401 on `storage`.

This does not contradict the placement decision — `site` has the same property for any
`/blocks/*` path, and inheritance is what lets a block-shaped app and a token-shaped test share one
type. It does mean the JSDoc on `AppClient.storage` must say so: *"requires the block token the host
mints; an app authenticating with an OAuth token has no per-viewer app storage."*

### Release mechanics

- Export the five types + `createStorageClient`'s types from `src/index.ts` beside the
  `SiteClient` / `OrchestrationClient` exports (`index.ts:19-31`).
- `npm run api` regenerates `api/public-api.md`; `api:check` gates it.
- `check-layering.mjs` is unaffected (`storage/` is a domain, not `core/`).
- A changeset: **minor**. This is additive; no existing signature changes.

---

## 3. The implementation rules that are load-bearing

Not a full implementation — these are the lines where a natural-looking choice breaks a consumer.

```ts
export function createStorageClient(http: Http): StorageClient {
  const post = <T>(op: string, body: unknown, signal?: AbortSignal) =>
    http<T>('POST', `${BASE}/${op}`, { body, signal });

  return {
    async get<T>(key, { signal } = {}) {
      const res = await post<{ value: unknown }>('get', { key }, signal);
      return (res?.value ?? null) as T | null;
    },

    async set(key, value, { signal } = {}) {
      const res = await post<{ ok: true; sizeBytes: number }>('set', { key, value }, signal);
      return { ok: true as const, sizeBytes: res.sizeBytes };
    },

    async delete(key, { signal } = {}) {
      const res = await post<{ ok: true; deleted: unknown }>('delete', { key }, signal);
      // The wire always carries it on a 2xx; asserting keeps the declared
      // `boolean` honest instead of casting a guarantee we cannot see.
      // (Same call the bridge hook makes — useAppStorage.ts:190-192.)
      if (typeof res?.deleted !== 'boolean') {
        throw new CivitaiError('app-storage delete: reply carried no `deleted` flag');
      }
      return { ok: true as const, deleted: res.deleted };
    },

    async list(query = {}, { signal } = {}) {
      const res = await post<{ keys: unknown; nextCursor?: unknown }>(
        'list',
        { prefix: query.prefix, limit: query.limit, cursor: query.cursor },
        signal,
      );
      // 🔴 NO `?? []`. A malformed 200 must throw, not answer "no keys" — see §4.
      if (!Array.isArray(res?.keys)) {
        throw new CivitaiError('app-storage list: reply carried no `keys` array');
      }
      return {
        keys: res.keys.map(toEntry),
        // 🔴 Passed through, not defaulted and not normalised.
        nextCursor: res.nextCursor as string | undefined,
      };
    },

    getQuota: ({ signal } = {}) => post<StorageQuota>('quota', {}, signal),
  };
}

function toEntry(row: unknown): StorageKeyEntry {
  const r = row as { key?: unknown; updatedAt?: unknown };
  const at = new Date(r.updatedAt as string);
  if (typeof r.key !== 'string' || Number.isNaN(at.getTime())) {
    // An Invalid Date would sort and compare silently wrong forever.
    throw new CivitaiError('app-storage list: malformed key entry');
  }
  return { key: r.key, updatedAt: at };
}
```

Five rules, each with the consumer that depends on it:

1. **`list` never manufactures an empty result.** `res.keys ?? []` is the single most dangerous line
   this file could contain (§4.1). Throw instead.
2. **`nextCursor` is passed through byte-for-byte.** No `?? ''`, no `|| undefined`, no re-derivation
   from `keys.length`. Its iff-semantics are the server's (`app-storage.service.ts:1122-1125`) and
   two consumers read it in *both* directions.
3. **`cursor`, `limit` and `prefix` go on the wire when supplied.** `JSON.stringify` drops
   `undefined` properties, so a bare spread is safe and the server's `.default(50)`
   (`app-storage.service.ts:482`) applies. There is no client-side default; a second copy of a bound
   is the thing that drifts (the routes make this argument themselves, `list.ts:93-96`).
4. **`updatedAt` is revived once, here.** §6.
5. **No client-side validation of `key` length or `value` size.** Tempting — the 200-char key cap is
   a documented production trap (`useAppStorage.ts:61-70`) — but the server now answers **400** with
   the zod flatten in `body.details`, which is strictly more informative than a duplicated bound.

⚠ **Derived, not tested:** `appStorageSetInput.value` is `z.unknown()`
(`app-storage.service.ts:478`), which in zod accepts a *missing* property; `JSON.stringify` omits
`undefined`; and the service does `JSON.stringify(value ?? null)` (`:610`). So `set(key, undefined)`
stores `null` rather than erroring. Document it; do not special-case it.

---

## 4. Paging

### 4.1 The hard constraint, and why it is a rule about the CLIENT

`model-benchmarking` writes a phase-1 in-flight claim into this store **before** it spends Buzz
(`App.tsx:1395-1410`), pages `inflight:v1:` on mount to re-render running cells
(`:483-565`), and stands its per-run backstop down at `App.tsx:555` — **only** on
`scan.truncated === false`. A `{keys: []}` that looks like a completed scan therefore completes,
reports `truncated: false`, disarms the backstop, and makes every reload a clean double-charge
*with the guard explicitly disabled* (`list.ts:30-49`; table at
`fleet-port-scoping-2026-09-24.md:111-115`).

The server makes that structurally impossible: every refusal is a thrown `TRPCError` → non-2xx, and
the one 200-with-empty arm (the anon arm, `app-storage.service.ts:1099-1102`) is unreachable behind
`enforceContextBinding`'s 403 (`block-scope.middleware.ts:864-866`). **The client is the only place
that can put it back.** It can put it back three ways, and all three are forbidden:

- `res.keys ?? []` on a malformed 200 → rule 1 above.
- catching an `ApiError` and returning an empty page → never; the client catches nothing.
- translating a 403 into `{keys: []}` for anon parity → §5.

### 4.2 Shape: raw `list()` only. No `listAll`, no async iterator.

Grounded in what the five apps actually do. Only three call `list` at all:

| call site | shape it needs |
|---|---|
| `model-benchmarking/src/lib/kv.ts:58-104` `forEachStoredKey` | cursor loop, `KV_MAX_PAGES = 20`, returns `{truncated, pages}`, and deliberately distinguishes *"caller stopped"* from *"budget exhausted"* (`:31-46`, `:91`) |
| `gen-matrix/src/history.ts:272-305` `evictBeyondRetention` | cursor loop with a **progress guard** — `if (lastKey !== undefined && !(keys[0].key > lastKey)) break` (`:294`) — plus a cross-page `seen` counter and a keep-set, deleting as it walks |
| `gen-matrix/src/history.ts:196-201` `loadHistory` | a **single** over-fetch of `CAP + 1`, no paging at all, deliberately (`:180-186`) |
| `custom-generators/src/lib/drafts.ts:53` `listDrafts` | a **single** `list({prefix, limit: 200})`, no cursor |

`playable-collections/src/lib/browse-prefs.ts` and `sensei/src/lib/sessions.ts` never list.

So: **every existing loop is already written, already tested, and already owns a truncation policy
its author reasoned about.** A `listAll(prefix, {maxPages})` in the SDK would serve nobody today and
would have to pick one truncation semantics that the two real loops disagree about —
`forEachStoredKey` reports truncation as data, `evictBeyondRetention` swallows it into a `break`.
Worse, `evictBeyondRetention`'s progress guard inspects **page boundaries** and cannot be expressed
over a flattened key iterator at all; adopting one would *delete a guard whose absence was measured
to destroy an entire history* (`history.ts:283-292`: *"deleted 150, survivors 0"*).

**If an iterator is ever added it must yield PAGES, not keys, and must carry a truncation report.**
Recorded so the next person does not ship the convenient version.

⚠ **A pre-existing bug the migration surfaces but does not cause:** `custom-generators`'
`listDrafts` asks for `limit: 200`, which is exactly the server maximum
(`appStorageListInput`, `app-storage.service.ts:482`), and never reads `nextCursor`. A viewer with
more than 200 drafts silently loses the rest, today, on the bridge. Name it in that app's port; do
not fix it inside the SDK.

### 4.3 How truncation reaches the caller

Unchanged, through `nextCursor`. The contract the client must preserve verbatim:

> `nextCursor` is present iff the server may have more rows.

Both failure directions are live (`list.ts:51-57`): always returning one arms
`model-benchmarking`'s expensive per-spend backstop forever; never returning one makes a truncated
scan report `truncated: false` and disarms it. This is why §3 rule 2 forbids *any* client-side
transformation of the field, including ones that look like tidying.

---

## 5. Errors, anon, and quota

### 5.1 The full status table

Every row read from the branch; none probed against a live server (§8).

| condition | HTTP | body | client surface |
|---|---|---|---|
| anonymous viewer, any op | **403** | `{error: "apps:storage:read requires authenticated subject"}` (`block-scope.middleware.ts:864-866`, emitted `:1224`) | `ApiError` 403, `message` = that string |
| block instance revoked | 403 | `{message:"block instance revoked"}` (`app-storage.service.ts:322`) | `ApiError` 403 |
| app block not approved | 403 | `{message:"app block is not approved"}` (`:411`) | `ApiError` 403 |
| app block not found | 404 | `{message:"app block not found"}` (`:407`) | `ApiError` 404 |
| bad / expired block token | 401 | `{message:"invalid block token"}` (`:290`) | **retried once** with a fresh token (`http/index.ts:53-57`), then `ApiError` 401 |
| app-blocks kill-switch off for subject | 401 | `{message:"Apps are not enabled"}` (`:164`) | ⚠ retried once pointlessly, then `ApiError` 401 |
| anon `set` reaching the shared body | 401 | `{message}` (`:575`) | unreachable on REST (403 first) |
| key > 200 chars, or any bad body | **400** | `{error:"Invalid request body", details:<zod flatten>}` (`get.ts:80-83`) | `ApiError` 400; `err.body.details` names the field |
| value > 64 KB (wire unit) | **413** | `{message:"value exceeds 64KB cap"}` (`:612-617`) | `ApiError` 413 |
| app byte ceiling | 413 | `{message:"app quota exceeded"}` (`:831`) | `ApiError` 413 |
| app row ceiling | 413 | `{message:"app row limit exceeded"}` (`:839`) | `ApiError` 413 |
| per-user byte ceiling | 413 | `{message:"per-user storage quota exceeded"}` (`:893`) | `ApiError` 413 |
| per-user row ceiling | 413 | `{message:"per-user row limit exceeded"}` (`:901`) | `ApiError` 413 |
| request body > 256 KB | 413 | Next's own bodyParser refusal (`set.ts:65`); ⚠ **may not be JSON** | `ApiError` 413, `message` falls back to `statusText` (`http/index.ts:84`) |
| server fault | 5xx | `{code:"INTERNAL_SERVER_ERROR", message:<generic>}` — genericized (`endpoint-helpers.ts:659-663`) | `ApiError` ≥500, text is deliberately uninformative |
| network / CORS / abort | — | — | `TypeError` / `AbortError`, **not** an `ApiError` |
| malformed 2xx body | 200 | anything | `CivitaiError` (§3) |

### 5.2 What is distinguishable, and what is not

**Distinguishable structurally, by `err.status` alone:**

- `400` — the caller's own input is wrong. Retrying never helps. `body.details` says which field.
- `401` — token. Already auto-retried once; a second is the client's answer.
- `403` — authorization. No retry helps.
- `413` — 🔴 **"this write can never succeed as-is."** The single most actionable status on the
  surface, and it is stable across all five refusals plus the parser limit.
- `429` / `≥500` — transient. `orchestration/index.ts:150-152` already spells exactly this predicate
  (`!(error instanceof ApiError) || error.status >= 500 || error.status === 429`); reuse the shape
  rather than inventing a second one.
- not an `ApiError` — transport, not the server.

**Not distinguishable structurally, and deliberately not made so:**

- *Which* of the five 413 refusals fired. Only `message` says, and `message` is server prose, not a
  code (the bridge has the same property — `useAppStorage.ts:72-77`). A block can render "this is
  too big to save" from the status; anything finer needs a string match, and a string match is a
  spelled guard. If the fleet later needs the distinction, the right fix is a machine-readable
  `code` on the server's 413 body, not a regex in the SDK.
- Anon vs revoked vs unapproved inside 403 — see below.

Two optional exports, both **structural** (status only, never message), offered because their
absence is what pushes apps toward message-matching:

```ts
export const isQuotaRefusal = (e: unknown) => e instanceof ApiError && e.status === 413;
export const isTransient   = (e: unknown) => !(e instanceof ApiError) || e.status >= 500 || e.status === 429;
```

### 5.3 🔴 Anon: the client surfaces the 403. It does not translate it.

**Decision: reject. No `null`-for-anon parity shim, not even opt-in.**

Three reasons, in order of weight:

1. **A translation re-creates on the client exactly the path the server removed.** `list.ts:40-49`
   states the server's property: the only 200-with-empty arm is the anon arm, and REST makes it
   unreachable. An SDK that maps 403 → `{keys: []}` restores it — and it would be restoring it for
   `model-benchmarking`'s money path, where `fleet-port-scoping-2026-09-24.md:115` measured the
   outcome: *"scan COMPLETES, reports `truncated: false`, disarms the backstop at `:555`… Every
   reload is a clean double-charge with the guard explicitly disabled."*
2. **403 is not an anon signal.** It is also revoked (`:322`), unapproved (`:411`) and the
   scope-binding refusals. Discriminating anon would require matching the literal
   `requires authenticated subject` — the precise shape `RULES.md` calls a spelled guard, and it
   would fail open on any rewording of a security message.
3. **A structural signal already exists and is already in every app.** `BlockAppClient.viewer` is
   `null` for an anonymous viewer (`app/index.ts:39-40`, `:84-86`). Apps gate on *that*.

**Safety check against `browse-prefs.ts`, as the brief asks.** Its invariant is
*"a record is only ever written on top of a record that was actually read"* — `restoredRef` stays
`false` when the read rejects, so nothing is written and the choice stays session-local
(`browse-prefs.ts:157-187`, `:290-296`). A 403 takes **exactly that branch**. The invariant holds,
and the viewer-visible outcome is unchanged: today (bridge) anon `get` resolves `null` and `set`
rejects; tomorrow (REST) both reject, and the viewer lands on the defaults either way.

⚠ One sentence in that file becomes **false** and must be corrected as part of the port:
`browse-prefs.ts:183-185` — *"It costs little in practice — the ordinary anonymous case RESOLVES to
`null` rather than rejecting."* Under REST the ordinary anonymous case *is* the rejecting one. The
cost estimate changes; the conclusion does not.

**Two consumers where 403-instead-of-null is a real, viewer-visible regression** — migration work,
not client work:

- `gen-matrix/loadHistory` catches and returns `{kind: 'error'}` (`history.ts:204-207`), whose whole
  purpose is to render *"we could not read your past matrices"* rather than *"you have none"*
  (`:71-78`). An anonymous viewer would now see the error copy on every load. **Fix: gate the load
  on `viewer != null`.**
- `sensei`'s mount load renders the raw server string into viewer copy:
  `App.tsx:743-751` builds *"Couldn't load your saved chats — ${e.message}. Anything you send now
  may not be saved."* For anon that becomes *"— apps:storage:read requires authenticated subject."*
  **Fix: gate on `viewer != null` and show the signed-out state instead.**
- `model-benchmarking` needs nothing: both storage effects already `return` on `!viewer`
  (`App.tsx:484`, and the drafts effect at ~`:596`), and a throwing scan leaves the backstop **armed**
  (`:558-561`).

### 5.4 Quota

`getQuota()` is authoritative for `usedBytes` / `rowCount` / `limitBytes` / `limitRows`, in the
**stored** unit. `set`'s `sizeBytes` is the **wire** unit and under-counts by up to 44.4×
(`set.ts:43-49`, `app-storage.service.ts:172-182`). Neither reports the 200-char key cap nor the
64 KB per-value cap, so a write that fits the quota reply can still be refused
(`useAppStorage.ts:136-142`). The client states all three facts in JSDoc and adds no prediction
logic — a local estimator would be wrong in the direction that spends money (§7).

`quota` is not deletable dead weight: `model-benchmarking/src/drafts.test.tsx:20,397,406,444` makes
*"the quota line comes from `getQuota()`, never a hard-coded 50 MB"* an explicit test criterion.

---

## 6. The `updatedAt` decision

**Decision: the client returns a `Date`.** One `new Date()` per row, in `toEntry` (§3), with a
malformed-date throw.

### Why

1. **It is not a new choice — it is the SDK layer's existing one.** `@civitai/blocks-react` already
   does the revival client-side at `useAppStorage.ts:212`, and its validator accepts either wire form
   (`validate.ts:1114,1126`). So today's `Date` is not a superjson artefact that REST "loses"; it is
   a decision the SDK already makes, in the same place.
2. **It is what every consumer compiles against.** `gen-matrix/src/history.ts:68` (`updatedAt: Date`
   on `HistoryEntry`), `:96` (`keys: {key: string; updatedAt: Date}[]` on its structural
   `HistoryStorage`), `:201` maps it straight through, and `history.test.ts:105` and `:162` call
   `.getTime()`.
3. **The alternative fails silently.** `historyAgeLabel(updatedAt: Date | string | number, …)`
   (`history.ts:386`) routes through `timeOf` (`:308-311`), which handles a string. Ship `string`
   and the render path keeps working while the declared interface becomes a lie — degradation with
   no symptom, which `fleet-port-scoping-2026-09-24.md:308-310` already identified.
4. **One rule, one place.** Revival in the client is one line for five apps. Revival per consumer is
   N copies of a predicate, wrong at N−1 of them — the exact argument
   `model-benchmarking/src/lib/kv.ts:3-10` makes for its own existence.
5. **There is precedent for exactly this on the sibling surface.** The reference port's
   `app-requests/src/platform/sharedStorage.ts:50-60` revives `createdAt`/`updatedAt` in its client,
   and its docblock (`:39-48`) says why: *"`format.ts` calls date methods … without this the rows
   would type-check and then throw on render."*

**The one honest counter-argument:** `site` and `orchestration` pass JSON through untouched, so a
reviving client is a departure from `@civitai/sdk` idiom. It does not bind here, for a reason
specific to each: `site` is a path-addressed escape hatch that declares **no row type at all**
(`site/index.ts:9-13`), and `orchestration`'s types come from the generated orchestration client, so
whatever it declares for a date field is true by construction. `StorageClient` declares
`StorageKeyEntry` itself — it owns the representation, so it owns the obligation to make it true.

### Per-consumer migration

| app | what changes |
|---|---|
| `gen-matrix` | **Nothing.** `history.ts:68,96,201` and `history.test.ts:105,162` are already correct. This is the whole point of the choice. |
| `model-benchmarking` | Nothing — `forEachStoredKey` destructures `{ key }` only (`kv.ts:93`) and never touches `updatedAt`. |
| `custom-generators` | Nothing — `DraftStore.list` declares `keys: Array<{key: string}>` (`drafts.ts:35`), a structural subset. Its own `StoredDraft.updatedAt: number` (`:17`) is a field inside the *value*, unrelated. |
| `playable-collections` | Nothing — never lists. |
| `sensei` | Nothing — never lists. Its `Session.updatedAt` is a `number` inside the value (`sessions.ts:52,295-297`), a different thing (`fleet-port-scoping-2026-09-24.md:317-319` checked this before raising it). |

**Migration cost of this decision: zero consumer edits.** That is the evidence for it, not a
convenience — choosing `string` would require editing two declared types and two `.getTime()` call
sites in `gen-matrix` while leaving four other apps' fakes free to keep returning `Date` and stay
green.

### 🔴 The rule this decision creates for the test fake

Because `new Date(aDate)` returns a `Date`, **a fake that puts a `Date` on the wire makes the
revival unobservable** — the mutant deleting `new Date(...)` survives a fully green suite. So:

> The fake's `list` response MUST carry `updatedAt` as an **ISO string**, exactly as `res.json()`
> emits it.

See §8. This is the seam `fleet-port-scoping-2026-09-24.md:311-315` named as the vacuous-green trap.

---

## 7. What I am NOT building, and why

| not built | why |
|---|---|
| `listAll()` / async key iterator | §4.2 — no consumer needs it, and the one truncation policy it would have to pick is disputed between the two real loops. `evictBeyondRetention`'s progress guard cannot sit on a flattened iterator. |
| Response caching / read-your-writes layer | The bridge's stale-read defect (`sensei/src/lib/sessions.ts:14-29`, measured 2026-08-27) is a property of civitai's `QueryClient` with `staleTime: Infinity`. REST does not go through it. Adding a cache in the SDK would recreate, in the SDK, the exact bug five apps just designed around. |
| Client-side quota prediction / byte estimation | `sizeBytes` is the wire unit, the ceilings are the stored unit, and the ratio is measured up to 44.4× (`app-storage.service.ts:172-182`). A predictor would say "this fits" and be wrong in the direction that costs the write. |
| Client-side `key` length / `value` size validation | A second copy of a bound is the thing that drifts. The server answers 400 with a zod flatten; the routes make this argument themselves (`list.ts:93-96`). |
| A `{ok:false}` soft-failure envelope, anywhere | Constraint 3. `set.ts:34-41`: *"A soft-failure envelope would be read as a successful claim and would turn every quota rejection into a double-charge."* |
| An anon→`null` parity shim, even opt-in | §5.3. An opt-in is worse than none: it is a flag whose wrong setting silently disarms a money guard, in a package five apps share. |
| A new error class (`StorageError`, `QuotaError`) | `ApiError` already carries `status` + parsed `body` and already normalises both envelope shapes (`http/index.ts:13-24,90-97`). A new class would force every app to import it to `catch` correctly, for no information gain over `status`. |
| A shared-storage client in the same module | Different scopes (`apps:storage:shared:*`), different routes, a public/moderated row model, anon reads **allowed** (`block-scope.middleware.ts:869-874`). `app-requests` has a working one (`platform/sharedStorage.ts`). Putting a world-readable surface behind the same name as a private one is how the wrong one gets called. |
| Retry / backoff beyond the inherited 401 refresh | `orchestration` owns backoff because it *polls*; storage calls are one-shot and the callers already wrap them in their own best-effort `try` (`kv.ts:53-56` says so explicitly). |
| Anything for `usePublishGenerationOutputs`, `useGatedImages`, `useAppWorkflows`, `OPEN_IMAGE_UPLOAD` | Out of scope, and each is a genuine platform gap — `fleet-port-scoping-2026-09-24.md:277-283`. Two apps still cannot reach zero `blocks-react` importers after this ships; their PRs must say so. |

---

## 8. Test strategy

### 8.1 Where the boundary goes

**At `fetch`, not at the client.** The reference port states the reason
(`app-requests/src/platform/testing.ts:1-13`): after a port to REST, *"a mock host would answer a
conversation nobody is having any more, and the e2e tests would pass while exercising nothing."*
`initialize({ token, fetch })` already threads a fake `fetch` all the way down
(`app/index.ts:53,101`), and `test/http/http.test.ts` already uses that seam. So the client's URL
construction, body construction, status mapping, date revival and malformed-reply throws are all
**real** in every test.

### 8.2 The fake: `createFakeAppStorage()` in `@civitai/sdk/testing`

An in-memory store behind a `fetch`-shaped function, mirroring the five routes closely enough that
the client cannot tell. Sketch of its options and its ledger:

```ts
export interface FakeAppStorageOptions {
  /** Seed rows. `updatedAt` is a Date here and an ISO STRING on the wire. */
  seed?: { key: string; value: unknown; updatedAt?: Date }[];
  /** 🔴 DEFAULT 3, NOT 50 — see below. */
  pageSize?: number;
  /** `null` ⇒ every op 403s with the real middleware body. */
  viewer?: { id: number } | null;
  /** Scripted refusals, consumed in order: `{status, body}`. */
  refuse?: { status: number; body: unknown }[];
}

export interface FakeAppStorage {
  fetch: typeof fetch;
  /** 🔴 Every request the CLIENT sent, verbatim: `{op, body}[]`. */
  calls: { op: string; body: Record<string, unknown> }[];
  rows: () => { key: string; value: unknown; updatedAt: Date }[];
}
```

### 8.3 🔴 How this fake avoids the failure the reference port measured

The reference port's own finding (`gh pr view 21`, PR body):

> A mutation sweep against the REST client killed a wrong route path, broken date revival and an
> ignored `viewerVoted` — but **dropping the `cursor` query parameter survived the entire suite**.
> The board's paging tests mock the client, so they assert the board *asks* for the next page and
> never that the client *sends* the ask; every e2e seed was smaller than one page.

Five concrete properties, each aimed at one half of that sentence:

1. **`pageSize` defaults to 3, not to the server's 50.** A fake that defaults to 50 makes every
   realistic fixture fit one page, which is *precisely* the condition under which a dropped `cursor`
   survives. A small default makes multi-page the normal case rather than the exotic one.
2. **The fake HONOURS `cursor` the way the server does** — base64-decode to `afterKey`, return rows
   strictly greater, ordered by key (`app-storage.service.ts:1105,1115-1117`). A client that drops
   `cursor` therefore re-returns page 1 forever: any paging test either loops to its bound or
   observes duplicate keys. Silence becomes impossible.
3. **The `calls` ledger records what the CLIENT sent, not what the caller asked for.** This is the
   half the reference suite was missing: it asserted the board *asks*, never that the client
   *sends*. A test pins `calls[1].body.cursor` equal to `calls[0]`'s returned `nextCursor`.
4. **`nextCursor` is set iff `rows.length === limit`**, matching the server, so both failure
   directions are catchable: a client that always forwards a cursor fails a bounded-loop test; one
   that never forwards it fails the page-2 fixture.
5. **At least one fixture seeds a row that exists ONLY on page ≥ 2, and an assertion names it.**
   That is the fix the reference port actually applied — *"Added a case seeding a top-voted row on
   page 2: green at HEAD, red under that mutant."*

Plus the two rules §6 and §5.3 impose on fixture data:

6. **`updatedAt` on the wire is an ISO string**, never a `Date`. Otherwise the revival mutant
   survives. Seeded timestamps are **pairwise distinct** and **distinct from any constant an
   assertion names** — a fixture that can only produce the constant's own value cannot see a mutant
   that hardcodes the literal.
7. **`viewer: null` 403s every op** with the real body
   `{error: 'apps:storage:read requires authenticated subject'}`, so *"`list` never resolves empty
   on an auth failure"* is a test and not a docstring.

### 8.4 The mutation sweep, named in advance

Each mutant must die with **that guard's own assertion**, not with a neighbour's error, and must be
the narrowest expression that can be wrong (never a guard removed together with its enclosing
condition).

| mutant | the test that must go red |
|---|---|
| drop `cursor` from the `list` body | page-2-only row absent **and** `calls[1].body.cursor` undefined |
| `keys ?? []` instead of throwing | malformed-reply test — must assert the *throw*, not an empty result |
| delete `new Date(...)` in `toEntry` | `.getTime()` on a revived entry — only fires because the fake emits a string (§8.3 rule 6) |
| `nextCursor: res.nextCursor ?? ''` | "last page carries no cursor" |
| always emit a `nextCursor` | a bounded pager test must terminate rather than hang |
| swallow a 413 into `{ok: false}` | `set` rejection test, asserting `status === 413` |
| translate 403 → `null` / `[]` | the anon fixture, asserting a rejection for `get` **and** `list` |
| delete the 401 refresh retry | 401-then-200 fixture: assert `calls.length === 2` and the second bearer differs |
| duplicate the 401 retry (retry twice) | same fixture, assert `calls.length === 2` exactly |
| wrong route path (`app_storage/get`) | any op — cheap, and it was one of the three the reference sweep did kill |
| drop `limit` from the body | fixture seeding > `limit` rows, asserting the page length |
| drop `prefix` from the body | fixture with two prefixes, asserting the other prefix's keys are absent |

**Hygiene, from the rules this repo operates under:** run the sweep with the bytecode/module cache
disabled or cleared between mutants, and keep one mutant **known to be caught** in every batch as a
positive control — a SURVIVED result asserts the mutant actually ran.

### 8.5 Positive controls for every zero

- *"the non-truncated path performs no extra read"* → report the **pair**: a truncated fixture where
  the read count is 1, and the non-truncated one where it is 0. A lone 0 is indistinguishable from a
  ledger wired to nothing.
- *"anon `list` never resolves"* → paired with a signed-in fixture returning a non-empty page, so
  the fake is proven capable of resolving at all.
- *"no `Date` crosses the wire"* → paired with a deliberate `Date`-on-the-wire fixture asserted to
  make the revival mutant survive, proving the sweep can see the difference.

### 8.6 🔴 The seam test — the one nobody owns

`fleet-port-scoping-2026-09-24.md:298-315` names this exactly: #5085 tested its side, `gen-matrix`
was written against the other, and **no test loads both**. Two hermetically-clean suites can still
be broken together.

Add one test, in the SDK, that pins the **relationship**:

- **Compile-time:** `StorageListResult` must satisfy `gen-matrix`'s structural
  `HistoryStorage['list']` return type (`history.ts:95-97`) — expressed as a local type assertion
  duplicating that shape verbatim, with a comment naming the file it mirrors.
- **Runtime:** drive the real client against the fake with an **ISO-string** wire, then call
  `.getTime()` on `keys[0].updatedAt` and assert it equals the seeded millisecond. That is the
  assertion `history.test.ts:105,162` makes on the other side of the seam, executed here against the
  real transport.

It must fail when the relationship changes in **either** direction — a client that stops reviving,
*or* a declared type that stops promising a `Date`.

### 8.7 Contract tests against the server's schemas

Not a bound re-spelled in the SDK — a test asserting the SDK **does not** re-spell one: no literal
`200` (key length), `64 * 1024`, `2 * 1024 * 1024`, `1000` or `50` appears in `src/storage/`. A
grep-shaped guard with a positive control (insert one such literal, watch it fail).

---

## 9. Per-app migration table

Adapter shape for every app: one file, `src/platform/storage.ts`, returning
`(await getClient()).storage` — the reference port's `client.ts` singleton
(`app-requests/src/platform/client.ts:31-41`) is the pattern. No app needs a wrapper *type*: four of
the five already depend on a **structural** slice, which `StorageClient` satisfies as-is.

| app | current call sites | → client method | what it must change |
|---|---|---|---|
| **`model-benchmarking`** 🔴 money path | `kv.ts:92` `store.list({prefix, cursor})`; `App.tsx:1401,1422` `set(inflightKey)`; `:1429` `delete`; `:1541` `get<InflightRun>`; `:967,988,1011,1040,1187` `set`; `:978,999,1022,1198` `delete`; `:676` `getQuota()` | `list` / `set` / `delete` / `get` / `getQuota` | Change `UseAppStorage` → `StorageClient` in `kv.ts:18` and `App.tsx:312`. `forEachStoredKey` works **unchanged** — it already owns its cursor loop, page bound and truncation report. Anon already handled (`App.tsx:484`, `:596`). 🔴 Re-verify after the port that a throwing scan still leaves `inflightScanTruncatedRef` armed (`:558-561`) — that is the property the whole surface exists for. Still needs `usePublishGenerationOutputs`; cannot reach 0 importers. |
| **`gen-matrix`** | `history.ts:197,278` `list`; `:226,343` `get`; `:297,374` `delete`; `:366,367` `set` | `list` / `get` / `delete` / `set` | `HistoryStorage` (`:94-98`) is structural and `StorageClient` satisfies it — **no interface edit, no type edit, no test edit** (§6). Keep `evictBeyondRetention`'s progress guard (`:294`) exactly as written. **Add** a `viewer != null` gate ahead of `loadHistory` so anon does not render the error copy (§5.3). Consider dropping the defensive `res?.keys ?? []` at `:201,283` — the client now throws on a malformed reply, and the `?? []` would convert that throw into the silent-empty shape. Still needs three other surfaces; cannot reach 0 importers. |
| **`custom-generators`** | `drafts.ts:39` `set`, `:43` `get`, `:47` `delete`, `:53` `list({prefix, limit:200})` | same four | `DraftStore` (`:27-36`) is structural; `StorageClient` satisfies it. Adapter is ~1 new file + one line in `App.tsx` (`fleet-port-scoping-2026-09-24.md:214-217`). ⚠ Record — do not fix here — that `listDrafts` truncates silently past 200 (§4.2). |
| **`playable-collections`** | `browse-prefs.ts:262` `get`, `:274,296` `set` | `get` / `set` | `BrowsePrefsStore` (`:135-138`) is structural; satisfied as-is. **Correct the docblock at `:183-185`** — under REST the anonymous case rejects rather than resolving `null` (§5.3). The `restoredRef` invariant is unaffected and still safe. This app's storage dependency is soft; it can port before or after. |
| **`sensei`** | `sessions.ts:62,118` `get`; `:71,176` `set`; `:193` `delete`; `App.tsx:724` `get<AppSettings>` | `get` / `set` / `delete` | Swap the `UseAppStorage` import (`sessions.ts:1`) for `StorageClient`. Never lists, so §4 and §6 are inert here. 🔴 **Gate the mount load on `viewer != null`** — otherwise every anonymous viewer sees the raw server string in viewer copy (`App.tsx:743-751`, §5.3). The write-only design (`:7-40`) stays correct and becomes *belt-and-braces*: REST bypasses the `QueryClient` whose `staleTime: Infinity` caused the original stale-read corruption, so the four `staleReadAppStorage` tests must be **re-derived against REST's real caching**, neither deleted nor carried over (`fleet-port-scoping-2026-09-24.md:69-73`). Port last, staged. |

**Common to all five:** the scopes `apps:storage:read` / `apps:storage:write` are already in
`SCOPES` (`session/index.ts:4,7`), so no manifest or consent change.

---

## 10. Uncertainties — stated, not smoothed over

1. 🔴 **#5085 is unmerged and its CI is red** (§0.1). Every route citation is from a moving branch.
2. **Nothing here was probed against a live server.** All status claims are *derived* from reading
   `handleEndpointError` (`endpoint-helpers.ts:623-708`) plus tRPC's
   `getHTTPStatusCodeFromError` mapping, not observed. The mapping
   `PAYLOAD_TOO_LARGE → 413`, `FORBIDDEN → 403`, `UNAUTHORIZED → 401`, `NOT_FOUND → 404` is
   tRPC's standard table and I did not read tRPC's source to confirm it on the pinned version.
3. **Whether Next's 256 KB bodyParser 413 emits JSON is unverified.** I assume it may not, which is
   why §5.1 says `message` falls back to `statusText` (`http/index.ts:84`) — but the fallback path,
   not the trigger, is what I read.
4. **`set(key, undefined)` storing `null` is derived, not tested** (§3) — from `z.unknown()`'s
   optional-by-default behaviour in zod, `JSON.stringify` dropping undefined properties, and
   `JSON.stringify(value ?? null)` at `app-storage.service.ts:610`.
5. **I did not read `model-benchmarking/src/App.tsx` end to end** (3,240 LOC). The `!viewer` gates I
   cite are at `:484` (read verbatim) and ~`:596` (read verbatim); I did not enumerate every
   `appStorage` call site's viewer gating — the grep in §9 lists the call sites, not their guards.
6. **`limitBytes` / `limitRows` are per-USER** (`app-storage.service.ts:1179-1180` returns
   `USER_QUOTA_BYTES` = 2 MiB and `USER_ROW_LIMIT` = 1000), while some app-side copy still says
   "50 MB" (`model-benchmarking/src/App.tsx` quota line, `GridForm.tsx:59`). The 50 MB figure is the
   per-APP ceiling (`APP_QUOTA_BYTES`, `:170`), which `getQuota` deliberately no longer reports
   (`quota.ts:21-28`). Apps rendering `getQuota()`'s reply are correct; apps whose *prose* says
   "50 MB" are now wrong. I did not audit that copy across the fleet.
7. **`verifyBlockToken` accepting only block JWTs** (§2 caveat) is read from
   `block-scope.middleware.ts:591-640` — fixed issuer/audience/RS256/`kid`. I did not enumerate
   every token *type* that signer mints (there is a `dev:live` 4 h variant), only that an OAuth
   access token cannot satisfy it.
8. **The `calls`-ledger and `pageSize: 3` design in §8.2 is a proposal, not a measurement.** The
   measurement behind it is the reference port's surviving-`cursor` mutant (PR #21 body), which I
   read. That the proposed fake *would* have killed it is reasoning, and should be confirmed by
   running the mutant against the fake before the fake is trusted.
