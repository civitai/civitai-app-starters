---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

**App Storage rejections now carry the host's own message, in the mock as well as in production.** The wire has never carried `PAYLOAD_TOO_LARGE` — that is the TRPC *code*, and the host's bridge forwards `err.message`. `createMockHost` emitted the code anyway, the contract doc described it, and the `kv-storage` example branched on it, so a block's error handling passed every local run and took the wrong branch live. Closes [#343](https://github.com/civitai/civitai-app-starters/issues/343).

### Measured

`civitai/civitai` `main`, read 2026-09-20 via `gh api`. `src/server/routers/apps.router.ts` has five **`PAYLOAD_TOO_LARGE`** rejection sites, each with a distinct message:

| site | message |
| --- | --- |
| `:568` per-value cap | `` `value exceeds ${PER_VALUE_BYTE_CAP / 1024}KB cap` `` |
| `:783` app byte umbrella | `app quota exceeded` |
| `:791` app row umbrella | `app row limit exceeded` |
| `:845` per-user byte budget | `per-user storage quota exceeded` |
| `:853` per-user row budget | `per-user row limit exceeded` |

and `src/components/AppBlocks/IframeHost.tsx:282` (same pair in `PageBlockHost.tsx`) returns `err.message` when it is a non-empty string, else `'storage request failed'` — a **sixth** string, reachable on reads and deletes too.

🔴 **Those six are the CEILING family, not every string a block can receive.** `storageErrorMessage(err)` is called from *blanket* `catch (err)` arms (`IframeHost.tsx:2395` GET, `:2427` SET, `:2458` DELETE, `:2508` LIST, `:2535` QUOTA), so every rejection out of `apps.storage.*` arrives on the same `error` field — including the host's authorization prose, measured in the same read:

| site | message | code |
| --- | --- | --- |
| `:289` | `invalid block token` | UNAUTHORIZED |
| `:294` | `block id is not a valid storage slug` | INTERNAL_SERVER_ERROR |
| `:321` | `block instance revoked` | FORBIDDEN |
| `:344`, `:422` | `` `storage ${op} requires the ${scope} scope` `` | FORBIDDEN |
| `:372` | `review preview is no longer active for this request` | FORBIDDEN |
| `:406` | `app block not found` | NOT_FOUND |
| `:410` | `app block is not approved` | FORBIDDEN |
| `:528`, `:949` | `storage requires an authenticated viewer` | UNAUTHORIZED |

plus tRPC's zod input-validation messages. **All of them classify `null`** — deliberately, since this module owns the ceiling vocabulary rather than the host's whole error surface. The consequence for block authors is the important part: **`null` does not mean "transient"**, and a `default:` arm that says "please try again" is wrong advice for an expired token or a revoked instance, which is the bucket's dominant production occupant. The docs, the `kv-storage` example and the `messages.ts` contract doc all say so now, and a test pins that those eight strings classify `null`.

### `@civitai/app-sdk` — new, additive (`minor`)

`@civitai/app-sdk/blocks` gains the strings and the matcher, in a new `appStorageErrors.ts` next to `appStorageLimits.ts`:

```ts
import { classifyAppStorageError } from '@civitai/app-sdk/blocks';

try {
  await storage.set(key, note);
} catch (err) {
  console.warn('[my-block] save failed:', err);   // log the host's words
  switch (classifyAppStorageError(err)) {          // never render them
    case 'value-too-large':
      return 'That note is too long to save. Try shortening it.';
    case 'user-row-limit':
      return 'You have no note slots left. Delete one to make room.';
    case 'request-failed':
      // The bridge's fallback — a transport fault. Genuinely retryable.
      return 'Could not save that note. Please try again.';
    default:
      // `null`: an unknown ceiling, or (more often) an expired/revoked token.
      return 'Could not save that note. Try reloading the page — if that does ' +
        'not help, storage may be unavailable for this app right now.';
  }
}
```

New exports from `@civitai/app-sdk/blocks`: `classifyAppStorageError`, the type `AppStorageRejectionReason`, and the four messages a mock host has to emit — `APP_STORAGE_ERROR_VALUE_TOO_LARGE`, `APP_STORAGE_ERROR_USER_QUOTA_EXCEEDED`, `APP_STORAGE_ERROR_USER_ROW_LIMIT`, `APP_STORAGE_ERROR_REQUEST_FAILED`. Nothing is removed or renamed.

🔴 **The public branching surface is the REASON, not the string**, so the barrel deliberately exports less than `appStorageErrors.ts` does. `APP_STORAGE_HOST_ERROR_MESSAGES` is **not** published: it would invite `MESSAGES.includes(err.message)` — equality against a frozen snapshot, which stops matching the day the host moves its per-value cap, i.e. the exact matcher shape this change exists to eliminate. `isAppStorageHostErrorMessage` (a thin `classify(…) !== null` whose only caller is the guard, which imports by file path) and the app-wide pair `APP_STORAGE_ERROR_APP_QUOTA_EXCEEDED` / `APP_STORAGE_ERROR_APP_ROW_LIMIT` (no mock in this repo can emit them; a block reaches them through the `'app-quota-exceeded'` / `'app-row-limit'` reasons) stay module-internal for the same reason. Adding one to the barrel later is a `minor`; removing a published one is not.

🔴 **The per-value message is DERIVED from `APP_STORAGE_MAX_VALUE_BYTES`, not written out.** It is a template literal on the host, so `'value exceeds 64KB cap'` is true only while the cap is 64KB — and a spelling that silently stops matching the host is this bug, again. A test feeds the builder a cap the constant cannot equal and watches the output move; `classifyAppStorageError` matches the per-value message as a **family** (`value exceeds <n>KB cap`) so a host that re-measures its cap still classifies against an older SDK.

The `APP_STORAGE_SET_RESULT` contract doc in `messages.ts` and the `useAppStorage().set` doc now say the field is a host-authored **message**, name the enumerated set, and say not to render it to a viewer.

### `@civitai/blocks-react` — **BREAKING (minor, 0.x)** for tests that assert the old strings

`createMockHost`'s storage rejections now draw from that module, chosen by which ceiling tripped:

| gate | was | now |
| --- | --- | --- |
| `valueCapBytes` | `PAYLOAD_TOO_LARGE` | `value exceeds 64KB cap` |
| `quotaBytes` | `PAYLOAD_TOO_LARGE` | `per-user storage quota exceeded` |
| `limitRows` | `PAYLOAD_TOO_LARGE` | `per-user row limit exceeded` |
| `failNext` (set + delete) | `STORAGE_UNAVAILABLE` | `storage request failed` |

A suite asserting `rejects.toThrow('PAYLOAD_TOO_LARGE')` or `'STORAGE_UNAVAILABLE'` against the mock goes red, and that is the point: those assertions were pinning a string production cannot send. Replace them with the exported constant, or with `classifyAppStorageError`.

Two notes on what the mock still cannot do. It models no app-wide umbrella ([#368](https://github.com/civitai/civitai-app-starters/issues/368)), so it never emits `app quota exceeded` / `app row limit exceeded` — both remain reachable only in production, and a block must still handle them. 🔴 Note the *direction*: the host enforces two gates the mock has none of, so this is a **permissive** divergence — a write the host would refuse succeeds under `dev:mock`. And lowering `valueCapBytes` does **not** change the message ([#369](https://github.com/civitai/civitai-app-starters/issues/369)): it still names the host's real cap, because that is the string a block has to match live.

🔴 **Peer floor raised `>=0.47.0` → `>=0.49.0`.** `internal/mockHost.ts` value-imports four new peer symbols, and `changeset version` does not raise a floor that is merely too low (`onlyUpdatePeerDependentsWhenOutOfRange: true`). The same class shipped or nearly shipped three times before — #309, #317, #344.

### Guards

- `tests/guards/app-storage-error-strings.test.mjs` — new. Every rejection `createMockHost` and the `kv-storage` harness can emit must resolve to a constant exported by `appStorageErrors.ts`. Asserted **positively** (membership), not as the absence of one word: banning the literal `PAYLOAD_TOO_LARGE` is walkable by typing any other invented string, so a string literal in an `error:` position is refused outright and what remains must name an exported constant.
- `mockHostScenarios.test.tsx` — drives the mock past each of the three ceilings and asserts the three messages, that they are **distinct**, and that the shared classifier separates them. The distinctness half is what kills a mutant returning one constant from every gate.
- The `kv-storage` example's `storageFailureMessage()` branches on `classifyAppStorageError` and spells no host string; a guard asserts both, and that its `default:` arm survives — the classifier answers `null` for a message it does not recognise, and the host can reword one in any deploy.
- `#343` is deleted from the mock/host divergence ledger; #368 and #369 — both already true, both previously unlisted — are added, so the ledger and both README caveats now say **four** known divergences. `app-storage-mock-divergences.test.mjs` records #368 as **PERMISSIVE** (the mock admits a write the host's app-wide gates refuse), so the READMEs no longer claim #347 is permissive "alone among them".
