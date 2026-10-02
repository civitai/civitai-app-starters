---
"@civitai/blocks-react": minor
---

🔴 BREAKING (dev host): `createMockHost` now gates storage on the scopes a manifest DECLARES, and the default is NONE

**What breaks.** Any test or harness that exercises `useAppStorage()` or
`useSharedStorage()` through `createMockHost` must now pass `declaredScopes`:

```ts
import manifest from '../block.manifest.json';

createMockHost({ declaredScopes: manifest.scopes, storage: {} });
// or, in a test that only cares about storage mechanics:
createMockHost({
  declaredScopes: ['apps:storage:read', 'apps:storage:write'],
  storage: {},
});
```

Importing the manifest is the recommended form, because then the dev host and the
real one draw from the same list and cannot drift. There is deliberately **no
permissive flag** — see "why the default is empty" below.

Without it, every `APP_STORAGE_*` / `SHARED_*` call rejects with the message the
server sends (`storage set requires the apps:storage:write scope`). Blast radius
in this repo was 26 tests across 2 files, both storage-mechanics suites; 1,735
other tests were unaffected.

**Why.** An app was built from the documented onboarding prompt, saved everything
through `useAppStorage()`, and declared only `ai:write:budgeted`. It passed **198
unit tests, the dev harness, `civitai app validate`, and a full submit** — then
every save failed in production:

```
"message": "storage set requires the apps:storage:write scope",
"code": -32003,
"data": { "code": "FORBIDDEN", "httpStatus": 403, "path": "apps.storage.set" }
```

which the viewer saw as *"Saving failed for an unknown reason… try again"*.

The mock host was the reason it got that far. Its own options doc said so in as
many words — *"`APP_STORAGE_*` is answered either way (the mock host always serves
storage now)"* — so the **one storage failure mode that actually ships was the only
one the dev host could not produce**. It modelled the per-value cap, both
per-viewer budgets, the row limit and an induced transport failure, and not the
scope. The money path has had a scope model all along (`consentGranted`, a consent
round-trip, an un-grantable case); storage had none.

**Why the default is empty rather than permissive.** A permissive default would
have left the old behaviour in place for every app that did not opt in — i.e.
exactly the apps that did not know the scopes existed, which is the population
this gate is for. An opt-in gate would have protected nobody who needed it.

**What it does not change.** `ai:write:budgeted` keeps its own `consentGranted`
flag, deliberately: `buzzBudget` is conditional on it and `setScenario` can toggle
it mid-session, so folding it in would give one scope two sources of truth. Only
storage reads `declaredScopes`.

**Fidelity.** The refusal is the real host's own prose, so `classifyAppStorageError`
returns `null` for it exactly as it does in production — `appStorageErrors.ts` is
explicit that an authorization failure lands on the same field as a ceiling and
classifies `null`, and that *"please try again" is the wrong copy for that arm*. A
dev-only "scope denied" classification would have been fiction the real host never
sends, and would have taught blocks to retry a manifest defect forever. This also
means **no `@civitai/app-sdk` change and no peer-range bump** — every storage reply
already carries `error?`, which app-sdk documents as the reject signal.

**One row is measured; the rest are inferred.** The incident is direct evidence for
exactly one pair — `apps.storage.set` → `apps:storage:write`, because the server
named both. The other 14 rows read a `:read` scope onto a read op and a `:write`
scope onto a write op, which is the only split the scope names admit but is still
an inference about another service: there is no op→scope table in `@civitai/app-sdk`,
none here, and the server's is not vendored. A row that is WRONG fails a CORRECT
app, so the table is the suspect in that case, not the app. `SHARED_REPORT` is the
row to doubt first — `report()` writes a row in the shared store, but a server is
free to treat an abuse report as a moderation path outside that store's gate.
