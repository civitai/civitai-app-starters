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

🔴 **Those six are the `PAYLOAD_TOO_LARGE` family plus the bridge's fallback — not every string a block can receive, and not even every ceiling — and this changeset deliberately does not list the rest.** `storageErrorMessage(err)` is called from *blanket* `catch (err)` arms (`IframeHost.tsx:2395` GET, `:2427` SET, `:2458` DELETE, `:2508` LIST, `:2535` QUOTA), so every rejection out of `apps.storage.*` arrives on the same `error` field — including tRPC's own zod input-validation messages, which never reach a handler at all. **All of them classify `null`.**

🔴 **The six are a set this repository CHOSE, not a set the host guarantees closed.** The host enforces size ceilings zod-side too, which throw no `TRPCError` and so are invisible to a `grep "new TRPCError"` re-derivation: `const keyInput = z.string().min(1).max(200)` (`apps.router.ts:460`) on `get`/`set`/`delete`, and `prefix` ≤ 200 / `cursor` ≤ 400 / `limit` ≤ 200 on `list`. The **200-character key cap** is the one a real block hits with no local warning — nothing in this repo caps a key, so a key derived from a URL or a model name saves under `dev:mock` and fails forever live, classified `null`, where the recommended "try reloading" copy is permanently wrong. Recorded as [#370](https://github.com/civitai/civitai-app-starters/issues/370) and documented in `appStorageErrors.ts`, `messages.ts` and both READMEs.

That claim is structural, and it is stated that way on purpose. Two earlier drafts of this section tried to enumerate the non-ceiling strings instead — the first missed the whole authorization family, the second added a table of eight and still missed four more (`Apps are not enabled`, thrown from two gates with one spelling: the `enforceAppBlocksFlag` middleware `.use()`d before `.input()` on all five storage procedures, *and* `assertAppBlocksEnabledForTokenUser` at `:153`, which grepping the middleware name does not find; `block token subject could not be resolved`; `review token subject could not be resolved`; `Apps authoring is not enabled for this account`). The router carries **21** `throw new TRPCError` sites and **17** distinct messages. A third list would be the same mistake again, so the rule replaces it: *these six classify, everything else is `null`* — true without enumeration, and still true after the host adds or rewords a message. Note it is deliberately **not** "every ceiling classifies" — see the zod caps above. The re-derivation recipe in `appStorageErrors.ts` beats any prose in this repo, but it is **necessary, not sufficient**: it greps `TRPCError` throws, so it cannot see a zod cap or the bridge's own fallback literal. The strings named anywhere in these docs are illustrations, never a bound.

The consequence for block authors is the important part: **`null` does not mean "transient"**, and a `default:` arm that says "please try again" is wrong advice for an expired token or a revoked instance, which is the bucket's dominant production occupant. The docs, the `kv-storage` example and the `messages.ts` contract doc all say so now, and a test pins that a sample of known host strings classifies `null`.

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

The `APP_STORAGE_SET_RESULT` contract doc in `messages.ts` and the `useAppStorage().set` doc now say the field is a host-authored **message**, name the ceiling set this module classifies (and say plainly that it is not a bound on what arrives, naming the zod key cap as the case it does not cover), and say not to render it to a viewer.

🔴 **The "`getQuota()` is the authority" sentences are now scoped to the byte/row budget** — in the `blocks-react` README, the `kv-storage` README and the `useAppStorage` hook doc. They read as unrestricted before, and that is false for the key cap in a way a reader cannot recover from: the host's procedure returns exactly `{ usedBytes, rowCount, limitBytes, limitRows }`, so there is no key-length field for `getQuota()` to render and no quota reply that predicts the refusal. Each now names what it covers and points at the key cap for what it does not; the `getQuota()` doc says the reply carries those two ceilings and no others.

### `@civitai/blocks-react` — **BREAKING (minor, 0.x)** for tests that assert the old strings

`createMockHost`'s storage rejections now draw from that module, chosen by which ceiling tripped:

| gate | was | now |
| --- | --- | --- |
| `valueCapBytes` | `PAYLOAD_TOO_LARGE` | `value exceeds 64KB cap` |
| `quotaBytes` | `PAYLOAD_TOO_LARGE` | `per-user storage quota exceeded` |
| `limitRows` | `PAYLOAD_TOO_LARGE` | `per-user row limit exceeded` |
| `failNext` (set + delete) | `STORAGE_UNAVAILABLE` | `storage request failed` |

A suite asserting `rejects.toThrow('PAYLOAD_TOO_LARGE')` or `'STORAGE_UNAVAILABLE'` against the mock goes red, and that is the point: those assertions were pinning a string production cannot send. Replace them with the exported constant, or with `classifyAppStorageError`.

Three notes on what the mock still cannot do. It models no app-wide umbrella ([#368](https://github.com/civitai/civitai-app-starters/issues/368)), so it never emits `app quota exceeded` / `app row limit exceeded` — both remain reachable only in production, and a block must still handle them. 🔴 Note the *direction*: the host enforces two gates the mock has none of, so this is a **permissive** divergence — a write the host would refuse succeeds under `dev:mock`. It also enforces no **key-length** cap where the host refuses a `key` over 200 characters ([#370](https://github.com/civitai/civitai-app-starters/issues/370)) — permissive for the same reason, and invisible to the `TRPCError` recipe because the host's gate is a zod bound. And lowering `valueCapBytes` does **not** change the message ([#369](https://github.com/civitai/civitai-app-starters/issues/369)): it still names the host's real cap, because that is the string a block has to match live.

🔴 **Peer floor raised `>=0.47.0` → `>=0.49.0`.** `internal/mockHost.ts` value-imports four new peer symbols, and `changeset version` does not raise a floor that is merely too low (`onlyUpdatePeerDependentsWhenOutOfRange: true`). The same class shipped or nearly shipped three times before — #309, #317, #344.

### Guards

- `tests/guards/app-storage-error-strings.test.mjs` — new. Every rejection `createMockHost` and the `kv-storage` harness can emit must resolve to a constant exported by `appStorageErrors.ts`. Asserted **positively** (membership), not as the absence of one word: banning the literal `PAYLOAD_TOO_LARGE` is walkable by typing any other invented string, so a string literal in an `error:` position is refused outright and what remains must name an exported constant.
- `mockHostScenarios.test.tsx` — drives the mock past each of the three ceilings and asserts the three messages, that they are **distinct**, and that the shared classifier separates them. The distinctness half is what kills a mutant returning one constant from every gate.
- The `kv-storage` example's `storageFailureMessage()` branches on `classifyAppStorageError` and spells no host string; a guard asserts both, and that its `default:` arm survives — the classifier answers `null` for a message it does not recognise, and the host can reword one in any deploy.
- `#343` is deleted from the mock/host divergence ledger; #368, #369 and #370 — all three already true, all three previously unlisted — are added, so the ledger and both README caveats now say **five** known divergences. `app-storage-mock-divergences.test.mjs` records #368 and #370 as **PERMISSIVE** (the mock admits a write the host's app-wide gates, respectively its 200-char key cap, refuse), so the READMEs no longer claim #347 is permissive "alone among them".
