# Refactor brief — bring the App Blocks docs surface onto the `@civitai/sdk` pattern

**For:** the documentation agent operating `/manage-appblocks-docs`
(`datapacket-talos/.claude/skills/manage-appblocks-docs/SKILL.md`).
**From:** the platform-migration arc, 2026-09-24. Working record:
`civitai-app-starters/claudedocs/{handoff-civitai-app-platform-migration,fleet-port-scoping-2026-09-24}.md`
(branch `docs/handoff-app-platform-migration`, pushed).

🔴 **Read the skill first, then this.** This brief assumes its surface map, its four-repo model and
its vocabulary. Where the two disagree, **the skill's mechanism wins and this brief is the thing to
correct** — several of its statements are now stale and §6 lists them.

---

## 0. The one-sentence change

Apps no longer talk to the platform through the iframe `postMessage` bridge and
`@civitai/blocks-react` hooks. **They hold a token and call `/api/v1` REST plus the orchestrator via
`@civitai/sdk`**, and use messaging only for the things that must raise host UI. The docs describe
the old model exclusively.

**The operator's rule, verbatim, which is the editorial line to hold:**
> *"default api, and only things that must be via messaging (ex. opening resource picker) uses that
> protocol."*

---

## 1. The measurement that sizes the job

Run on `civitai-developer-docs@origin/main`, 2026-09-24 (note: the pages live at **`apps/`**, not
`site/` — a `site/**` pathspec silently matches nothing and its control returns 0 too):

```
git -C <civitai-developer-docs> grep -l "@civitai/blocks-react" origin/main | wc -l   ->  33
git -C <civitai-developer-docs> grep -l "@civitai/sdk"          origin/main | wc -l   ->   0
```

**33 files document the bridge package. Zero mention the package that replaces it.** The control is
the 33 — it proves the search works, so the zero is a real reading.

---

## 2. What actually shipped, with the evidence

All merged 2026-09-24 and verified by CONTENT (route counts on `origin/main` with unchanged sibling
directories as controls), never by exit code or ancestry.

### 2.1 New REST surface under `/api/v1/blocks/`
| surface | routes | merged |
|---|---|---|
| **app storage** (per-viewer KV) | `get` `set` `delete` `list` `quota` | `civitai#5085` → `1abd6539` |
| **workflows query** | `POST /workflows/query` | `civitai#5090` → `67c1fcdf` |
| **gated images** | per-viewer moderated image resolution | `civitai#5091` → `1b965b3d` |

Block route files went **30 → 35 → 36 → 37** across those three merges, with `shared-storage/` (11)
unchanged throughout as the control.

Already existing and documented-nowhere-useful: `workflows/{estimate,submit,poll,cancel}` (`#5068`).

### 2.2 `@civitai/sdk` gained a storage client
`civitai-app-starters#441` → `eea19074`. `AppClient.storage` with `get`/`set`/`delete`/`list`/`getQuota`,
built on the same `http` instance `site` uses. A changeset ships it as **`@civitai/sdk@0.3.0`** — at
the time of writing the Version PR has not run, so **resolve the published version before you cite
it** (the skill's own rule: never assert a version as current).

🔴 **Design decisions a reference page must carry, because they are consumer-visible and non-obvious:**
- **`list` never resolves empty on failure.** Every refusal throws. A caller uses the *absence* of
  `nextCursor` as proof a scan completed, and for one app that is a money decision.
- **`nextCursor` is passed through untouched** — present exactly when more rows may exist.
- **`updatedAt` is revived to a `Date`** by the client. The wire carries an ISO string; the bridge
  did the same revival in `useAppStorage`. Consumers need no change.
- **`sizeBytes` (from `set`) is the WIRE size and is NOT the quota unit.** Quota is
  `octet_length(value::text)` over JSONB — measured, a numeric-heavy payload stores up to **44.4×**
  its wire size. **Summing `sizeBytes` to track quota is wrong**; call `getQuota()`.
- **Anon gets 403** on these routes, where the bridge resolved an anon read to `null`. Open question
  per operation: `civitai#5089`.

### 2.3 The canonical manifest schema gained `auth`
`civitai:public/schemas/app-block/v1.json` now carries:
```json
"auth": {
  "type": "string",
  "enum": ["block-token", "oauth"],
  "description": "Which credential the host hands the block: \"block-token\" (default when omitted) …"
}
```
This is a **manifest-contract change** and therefore lands squarely in the skill's §1 single-source
model.

🔴 **Mirror state, measured 2026-09-24 — one mirror is still drifted:**

| mirror | has `auth`? |
|---|---|
| canonical `civitai:public/schemas/app-block/v1.json` | ✅ |
| `civitai-app-starters:packages/civitai-app-sdk/schemas/app-block/v1.json` | ✅ re-vendored by `#445` → `b79e12fa` |
| **`cli:schema/app-block.manifest.schema.json`** | ❌ **DRIFTED** |

**The CLI re-vendor is outstanding and is yours to trigger** (skill §3/§4). Two notes from the
starters re-vendor that will save you a trip:
- The property carries an **`enum`**, so this is a runtime **tightening** — `auth: "api-key"` used to
  be accepted locally and refused by the server. Expect the CLI's jsonschema evaluation to start
  rejecting manifests it previously passed.
- On the starters side, *"schema accepts, types reject"* was real: the canonical declares no
  `additionalProperties`, so it already tolerated `auth` with any value while `BlockManifestV1`
  rejected it outright. Fixed by adding `auth?: 'block-token' | 'oauth'` to
  `packages/civitai-app-sdk/src/blocks/types.ts`. **Check whether the CLI has an equivalent
  hand-maintained type/validator row** — skill §2 contract 4 is the precedent for "a schema change
  needs N rows in `cli`, not one", and a re-vendor that misses them **aborts without opening a PR**,
  which reads as a no-op.

### 2.4 Two fleet apps are ported, and they are the worked examples
- `ZacxDev/civitai-app-requests` — `52b7e1b`. **Verified live** against production via
  `civitai app dev-tunnel`: `shared-storage/list`, `append`, `vote`, `withdraw` all **200**, and
  `items[].viewerVoted` proven off the wire by a full page reload.
- `ZacxDev/civitai-block-generate-from-model` — `200617ef`. Its `src/platform/` layer is the
  reference shape: a thin per-app adapter over `@civitai/sdk`, plus a fake-`fetch` test server.

🔴 **`app-requests` is the ONLY thing in this entire arc exercised live against a real server.**
Everything else is green against fakes. Do not let a doc imply otherwise.

---

## 3. What to change, by surface

Ordered by "a developer following the current docs gets a wrong answer".

### 3.1 🔴 The hooks reference is now a legacy page — and its generator says so
`scripts/gen-appblocks-hooks.mjs:14` resolves `@civitai/blocks-react` and parses
`dist/index.d.ts` with ts-morph. So the generated hooks reference **can only ever document the
bridge**. It is not wrong — it is complete and correct about a model that is being retired.

**Do not delete it.** Six fleet apps still ship on it today. Instead:
- Give it a standing banner saying which model it documents and linking the SDK path.
- Add the **replacement mapping** as hand-authored content, because no generator can produce it.
  The mapping below is measured from the ported apps; re-verify before publishing.

| bridge hook | replacement |
|---|---|
| `useBlockContext` | `initialize()` → `BlockAppClient.{viewer,context,settings,theme,onChange}` |
| `useBlockResize` | `host.autoResize(el)` |
| `useRequestSignIn` | `host.requestSignIn({returnUrl})` |
| `useRequestConsent` | `app.requestGrants(scopes)` — now returns an awaited `boolean` |
| `useResourcePicker` | `host.openResourcePicker(...)` |
| `useBuzzPurchase` | `host.openBuzzPurchase(...)` — needs an explicit long timeout |
| `useCivitaiNavigate` | `host.navigate(path, target)` |
| `useSharedStorage` | `/api/v1/blocks/shared-storage/*` (11 routes) |
| `useAppStorage` | **`AppClient.storage`** (§2.2) |
| `useBuzzBalance` | `GET /api/v1/blocks/buzz` — shape is deliberately the bridge's |
| `useBuzzWorkflow` | `/api/v1/blocks/workflows/{estimate,submit,poll,cancel}` |
| `useAppWorkflows` | `POST /api/v1/blocks/workflows/query` |
| `useGatedImages` | the gated-images route (§2.1) |
| `useGenerationResources` | `GET /api/v1/blocks/generation-resources?ids=` |
| `useBlockToken` | `app.getToken()`; **`.scopes` is not on `AppClient`** — read the transport snapshot |
| `useBlockAnalytics` | **no replacement** — ship a documented no-op shim |
| `useImageUpload` | **messaging, not REST** — host-protocol addition, in flight |
| `usePublishGenerationOutputs` | **messaging, not REST** — host-protocol addition, in flight |
| `useCheckpointPicker().persist` | REST route open as `civitai#5093`; **developer-gated**, see §5 |

### 3.2 A new guide page: "Porting a block onto `@civitai/sdk`"
Hand-authored; no generator can do this. It should carry:
- the operator's api-vs-messaging rule as the decision procedure;
- the `src/platform/` adapter shape from the two ported apps, named as the pattern;
- 🔴 **the testing lesson, which is the part people will get wrong**: after the port the app sends
  no `postMessage` ops, so *a mock host answers a conversation nobody is having and the suite passes
  while exercising nothing*. The fake must move to **`fetch`**. A measured consequence: in the
  reference port, deleting the `cursor` query parameter **survived the entire suite**, because every
  fixture fit on one page.

### 3.3 The manifest reference — regenerate for `auth`
Generated from the canonical, so it should flow once the schema propagates. **Verify it actually
picked the property up** rather than assuming; and note that `auth` is the first field that changes
*which credential the block receives*, which deserves guide prose, not just a table row.

### 3.4 `apps/guide/embedding.md` and the concepts pages
These describe the bridge as *the* model. They need the two-model framing: block-token + bridge
(today, and still correct for host UI) vs token + REST (the direction). Do not present the bridge as
deprecated — it is not, and two fleet apps cannot leave it at all (§5).

### 3.5 Pins
Docs pin `@civitai/app-sdk@0.45.0` and `@civitai/blocks-react@0.53.0`. Adding `@civitai/sdk` means a
**new** pin and a new entry in whatever gates the snippet typechecks. 🔴
`typecheck-appblocks-snippets.mjs` is blocking — any `@civitai/sdk` fence you add must compile
against the pinned version, and the starters repo learned that widening a snippet gate to a new
package took **three** edits (two `ENTRYPOINTS` rows plus two tsconfig `paths`), not one, because the
package was not a dependency of the directory the script climbs from.

---

## 4. Do NOT write these things

- ❌ *"The postMessage bridge is deprecated."* It is not. Two fleet apps **cannot** leave it (§5),
  and host UI stays on it by design.
- ❌ *"Apps should use `app.orchestration` for generation."* 🔴 **This is the sharpest trap in the
  arc.** The block routes delegate to procedures carrying the buzz budget, the per-viewer and
  per-app caps, the maturity clamp and the `app-block:<appId>` attribution tag. `app.orchestration`
  is the raw orchestrator and has none of them. The substitution **type-checks and passes tests**.
  Same shape for `orchestration.queryWorkflows({tags})` vs the workflows-query route: the route
  forces the app tag server-side off the JWT; the client takes tags from the caller, which relocates
  a trust boundary into the iframe.
- ❌ Any claim that a surface works end-to-end. Only `app-requests` has been exercised live (§2.4).
- ❌ A version asserted as current without resolving it — the skill's own rule, and `@civitai/sdk`
  is mid-release.

---

## 5. Known gaps to document as gaps, not paper over

| gap | state |
|---|---|
| `useImageUpload` / `OPEN_IMAGE_UPLOAD` | no REST twin, no SDK host request. **In flight.** Blocks `custom-generators`. |
| `usePublishGenerationOutputs` | same. Blocks `gen-matrix`, `model-benchmarking`. |
| `useBlockAnalytics` | no replacement anywhere. No-op shim is the sanctioned answer. |
| `SET_USER_CHECKPOINT` | `civitai#5093` open; **developer-gated** — `assertViewerIsAppDeveloper` at `blocks.router.ts:7140`, so ordinary viewers cannot persist. The gate **is** the rate limit (`civitai#5092`). |
| anon behaviour | REST returns 403 where the bridge returned `null` for reads. `civitai#5089`. |

🔴 **Because of the first two, `gen-matrix` and `model-benchmarking` cannot reach zero
`@civitai/blocks-react` imports today.** Any doc implying a complete migration path for every app is
wrong.

---

## 6. Corrections the skill itself needs

Fold these into `/manage-appblocks-docs` — they are mechanism, and the skill is their home.

1. **`@civitai/sdk` is a fifth package in the surface map and is absent from it.** The skill's §1
   names `@civitai/app-sdk` and `@civitai/blocks-react` as what app-starters holds. It now also holds
   `@civitai/sdk`, with its own public API report (`packages/civitai-sdk/api/public-api.md`) and its
   own gates.
2. 🔴 **`pnpm check:public-types` does NOT cover `@civitai/sdk`.** Its `PACKAGES` list
   (`scripts/check-public-type-closure.mjs:157-163`) names five packages and `civitai-sdk` is not one
   — so a green there says **nothing** about that package's public surface. Measured while auditing
   `#441`, where the PR cited it as evidence. Widening it surfaces 6 pre-existing violations.
3. **`packages/civitai-sdk/README.md` is now covered** by `typecheck:readme` (`#441` widened it).
   Snippets compile at **module** scope — a top-level `return` fails.
4. **Two repo-wide red gates**, both of which will look like your PR's fault:
   - `preview / component-tests` in `civitai/civitai` — all 5 suites fail on one
     `showWarningNotification` import error. `civitai#5102`. 🔴 The symbol **is** exported (1 export,
     16 importers), so it is a resolution/transform problem, not a missing symbol.
   - `Canonical schema drift-check` in app-starters — **fixed**, `civitai-app-starters#443` closed.
5. 🔴 **"Is it red on `main`?" is not answerable by walking `git log <main>` in a merge-commit
   repo.** Merged PR *heads* are ancestors of `main` and carry their own PR's statuses; every genuine
   `main` commit in `civitai/civitai` has `total_count=0` because the preview pipeline posts on PR
   heads only. Two independent agents got this wrong in one session.
6. **A cached verdict replays a PASS computed before the condition changed.** `pnpm` prints
   `Already up to date` and skips its lockfile policy entirely when `node_modules` exists, and
   `~/.cache/pnpm/lockfile-verified.jsonl` replays a stored result as `(verified 2h ago)`. The tell
   is in the **content**, not the exit code: a real run prints `(185 entries in 637ms)`.

---

## 7. Suggested closing condition for this work

> Every `/apps/` reference page states which transport model it documents, and a developer following
> the SDK guide can port a block's storage, workflows and gated-image calls without reading this
> repo's source.
>
> **Checked by:** the `@civitai/sdk` fences in `apps/**` compiling under
> `typecheck-appblocks-snippets.mjs` (blocking, so CI proves it), **plus** a named reader confirming
> the hook→replacement table in §3.1 against the two ported apps' `src/platform/` layers. The
> compile alone does not close it — a snippet can typecheck and still describe the wrong model.
