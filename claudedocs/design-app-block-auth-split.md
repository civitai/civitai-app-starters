# Design review — the app-block token split

**Originally written:** **2026-09-25T03:02:50Z** · **Refreshed:** 2026-09-25T05:10Z · **As of:** 2026-09-25 ~05:10Z.

**Refreshed against:**

| What | Ref / reading |
|---|---|
| `civitai/civitai` | `origin/main` = `6ff7aff2ab` (original review measured `54bcbd7d45`) |
| `civitai/civitai-app-starters` | `origin/main` = `3898978` (unchanged since the original review) |
| `datapacket-talos` (Flux GitOps for prod) | `origin/trunk` = `d88232eee` |
| **the live `civitai-dp-prod` cluster** | read 2026-09-25 ~04:55Z — see §0.0 |
| PRs | civitai#5097 MERGED · civitai#5122 MERGED · starters#442 MERGED · starters#451 MERGED · starters#453 OPEN |

⚠ **Size: this doc is over the arc's 65,536 B readability cap** (~80 KB), because the standard here is
one command and one value per claim and there are a lot of claims. **Reading path if you only read
part of it: §0.0 (the flag is on in production) → §6.3 (the recommendation) → §9 (action items) → §10
(bottom line).** Everything else is the evidence those four rest on.

⚠ **The original timestamp was being read an hour-zone wrong, and it matters.** The file's mtime is
`2026-09-24 22:02:50 **-0500**` = **2026-09-25T03:02:50Z**. Reading the local clock as UTC made the
review look five hours older than it is, and produced three false "this landed after the review"
claims in the refresh brief. Corrected timeline, all measured:

| Event | UTC | vs. the review (03:02:50Z) |
|---|---|---|
| civitai#5097 merged (the OAuth mint) | 2026-09-24T15:31:53Z | 11 h 31 m **before** |
| `APP_BLOCK_OAUTH_TOKENS_ENABLED=true` committed to prod GitOps | 2026-09-24T22:10:50Z | 4 h 52 m **before** |
| starters#442 merged (the token-kind guard) | 2026-09-24T22:06:19Z | 56 m **before** |
| `@civitai/sdk@0.4.0` published to npm | 2026-09-24T22:21:27Z | 41 m **before** |
| starters#451 merged (`<civitai-video>`/`<civitai-audio>`) | 2026-09-24T23:39:46Z | 3 h 23 m **before** |
| **civitai#5122 merged (dev-tunnel OAuth)** | **2026-09-25T00:19:03Z** | **2 h 44 m BEFORE** |
| starters#448 merged (= starters `origin/main`) | 2026-09-25T02:41:12Z | 21 m **before** |
| **the review was written** | **2026-09-25T03:02:50Z** | — |
| starters#453 opened (narrows the guard) | 2026-09-25T04:01:26Z | 59 m **after** |

Commands: `stat -c '%y' <file>`; `gh pr view <n> --json mergedAt`; `git -C <datapacket> log -S'APP_BLOCK_OAUTH_TOKENS_ENABLED' --format='%h %cI %s' -- clusters/`; `npm view @civitai/sdk time --json`.

✅ **So #5122 was not new to the review — it was already in the tree the review measured.**
`git -C <civitai> merge-base --is-ancestor 1cfaa043f1 54bcbd7d45` → **rc=0**. The review even cites
one of #5122's own new files (`dev-tunnel-oauth.service.ts`, created by that commit:
`git log --diff-filter=A --format='%h %cI' origin/main -- src/server/services/blocks/dev-tunnel-oauth.service.ts`).
What the review did *not* do is state what #5122 changed about the dev tunnel's token kind. §0.1 does.

**Only one thing in this arc is genuinely newer than the review: starters#453.** It is the open PR
that implements this review's own rank-1 item. Its results are folded in at §6.3.

🔴 **Nothing in this arc has been exercised against a live civitai HOST.** The one live reading is
the Kubernetes control-plane read in §0.0 — deployment/pod env and image tags. No HTTP request was
made to civitai.com, no block was loaded, no token was minted, no test was run.

---

## 0.0 🔴 READ THIS FIRST — the flag is ON in production, and that inverts which half of the review is live

The original review's single largest caveat was *"the live value of `APP_BLOCK_OAUTH_TOKENS_ENABLED`
is UNKNOWN — its name appears in no deploy config in `datapacket-talos` or `homelab-talos`."*

⚠ **That claim was FALSE, and it was already false 4 h 52 m before the review was written.**

| Claim | Command | Value |
|---|---|---|
| The flag is in the prod GitOps repo | `git -C <datapacket> grep -n -A1 APP_BLOCK_OAUTH_TOKENS_ENABLED origin/trunk -- clusters/` | **3 files**, each `value: "true"` — `deployment.yaml:777`, `deployment-api.yaml:718`, `deployment-api-heavy.yaml:770` |
| …enabled deliberately, by Koen | `git -C <datapacket> log -S'APP_BLOCK_OAUTH_TOKENS_ENABLED' --format='%h %cI %an %s' -- clusters/` | `ca2b3ee43 2026-09-24T22:10:50Z Koen  civitai-dp-prod: enable OAuth access tokens for opted-in app blocks` — body: *"Turns on APP_BLOCK_OAUTH_TOKENS_ENABLED on the SSR, api and api-heavy pools. Only a block whose manifest declares auth: \"oauth\" is affected; none does yet."* |
| …and it is on `trunk`, which is the deploy | `git -C <datapacket> merge-base --is-ancestor ca2b3ee43 origin/trunk` | **rc=0** |
| **…and it is live** | `kubectl -n civitai-dp-prod get deploy -A -o json` filtered on the env name | **5 of 253** deployments cluster-wide carry the var; **all 5 are in `civitai-dp-prod` and all 5 are `'true'`**: `civitai-dp-prod`, `-api`, `-api-heavy`, `-api-primary`, `-primary`. (253 = the positive control that the filter can see deployments at all.) |
| …on a running pod, not just a spec | `kubectl -n civitai-dp-prod get pod/civitai-dp-prod-api-primary-5f8ffdd5c5-28czt -o json` | `phase: Running`, `startTime 2026-09-25T00:30:02Z`, `APP_BLOCK_OAUTH_TOKENS_ENABLED='true'` |
| The deployed image contains #5097 | `git merge-base --is-ancestor 0ce9854e3b 87b975d4a4` | **rc=0** — image `ghcr.io/civitai/civitai-prod:20260924232242-87b975d` |
| **The deployed image does NOT contain #5122** | `git merge-base --is-ancestor 1cfaa043f1 87b975d4a4` | **rc=1** |
| The hub credential the mint needs is configured | `kubectl -n civitai-dp-prod get cm civitai-cfg-primary -o json` | `AUTH_INTERNAL_TOKEN` present, non-empty, 64 chars (310 keys in the map = positive control) |

⚠ **Methodology note, because it nearly produced a false alarm here:** `AUTH_INTERNAL_TOKEN` is
**absent** from the deployment's explicit `env:` list (74 entries) and arrives via
`envFrom: configMapRef: civitai-cfg-primary`. An `env:`-only read would have reported the hub
credential missing and the mint path broken. Read `envFrom` too.

### What this changes

> **§1's hypothesis (flag OFF) is not the production state. §2's hypothesis (the `consent_required`
> / no-grant fallback) IS — it is reachable only when the flag is ON.**

Both hypotheses remain correct **as code**. What moves is which one is armed where:

- **§1 (flag off → signed-in viewer of an `auth: "oauth"` block gets `kind:'block'` → the SDK guard
  throws)** still holds for the **default** configuration — `server-schema.ts:957` defaults `false` —
  so it governs self-hosted, preview and any environment not in the manifest above. It is **not**
  what civitai.com does.
- **§2 (a signed-in viewer with no usable grant gets `kind:'block'` + `needsConsent`, and the guard
  throws before the block can ask for consent)** requires `oauth` to have been *attempted*, which
  requires the flag **on**. On civitai.com it is on. §2 is the live one.

🔴 **And §2 is worse than the review framed it.** The review reached the deadlock through a
*revocation*. It does not need one. With the flag on, the **first** load by any signed-in viewer who
has never granted this app reaches the same state: `syncOauthConsentFromGrant` returns `null` →
`{ outcome: 'consent_required' }` (`block-tokens/index.ts:398-400`) → `needsConsent = true`,
`kind: 'block'` (`:1336-1341`, `:1368`) → `viewer !== null && token.kind === 'block'` → the SDK
throws. On the model-slot surface the block is the only thing that can ask for consent (§2), and it
never runs. **So on civitai.com today, a viewer cannot bootstrap consent for an `auth: "oauth"`
block from a model slot at all** — not "after withdrawing permissions", but ever.

**Two independent conditions keep that from being a live outage right now, and both are one commit
wide:**

1. **No manifest declares `auth: "oauth"`.** Koen's own deploy commit says so, and the review
   measured 0 of 7 fleet manifests (re-measured — §4).
2. **No app runs `@civitai/sdk` ≥ 0.4.0, the version with the guard.** All three dependent apps pin
   `^0.2.0`/`^0.3.0`, and under 0.x caret rules a `^0.2.0` pin resolves `>=0.2.0 <0.3.0` — it
   **cannot** reach 0.4.0 without a deliberate range bump (`npm view @civitai/sdk versions` →
   `["0.2.0","0.3.0","0.4.0"]`; 0.4.0 published 2026-09-24T22:21:27Z).

⚠ **Correction to the original §0's framing of the fuse.** It said app-requests *"hard-fails on its
next SDK bump to ≥0.4.0"*, which is right, and *"a one-line-bump fuse"*, which overstates the
automaticity: a routine `pnpm update` cannot cross `^0.2.0 → 0.4.0`. The fuse is real but it needs a
hand on it.

### One new finding that the flag being on makes live

`mintOauthAppToken` (`block-tokens/index.ts:385-406`) returns a **two-arm** outcome —
`'minted' | 'consent_required'` — and **re-throws anything else** (`:401-405`,
`if (isConsentRequiredError(err)) … ; throw err`). `mintAppToken` is a cross-service HTTP POST to
the hub (`packages/civitai-auth/src/app-token.ts:29` `hubFetch('/api/auth/oauth/app-token', …)`),
which throws `AppTokenError` on any non-ok response and on a network failure.

**There is no `try`/`catch` at the call site** (`:1327-1335`) **and none in the handler.** Measured:
the only `try {` / `} catch` pairs in the whole 1500-line file are at `213/216`, `325/334` and
`398/401`, all inside helpers; the handler starts at `:787` (`export default withAxiom(async function handler…`)
and has none. So the docblock's *"a missing grant or a hub `consent_required` refusal falls back to
the JWT path with the consent signal set, **never a 500**"* is true of `consent_required` only. A hub
outage, a 5xx, or a malformed hub response turns **block-token minting into an unhandled throw** for
every `auth: "oauth"` block — no JWT fallback. A comment is a claim; this one is narrower than it
reads. Nothing is exposed today because no manifest opts in.

---

## 0.1 What #5122 changed, since the review measured it without saying so

civitai#5122 — *"mint OAuth tokens in the author's dev tunnel at any app status"*, merged
2026-09-25T00:19:03Z, 16 files, +635/−66 — rewires **both** dev-tunnel mint branches.

Before it, a dev tunnel always handed back `kind: 'block'`. After it, when
`APP_BLOCK_OAUTH_TOKENS_ENABLED` is on and the tunnel's `declaredAuth` (CLI-supplied, falling back
to the stored/pending manifest) is `'oauth'`, both branches mint a hub OAuth token instead:

| Branch | Before | After (`git show 77271ab5bd -- src/pages/api/v1/block-tokens/index.ts`) |
|---|---|---|
| `tryDevTunnelScopedMint` (ephemeral, never-submitted) | always `kind: 'block'`, 4 h JWT | `wantsOauth && env.APP_BLOCK_OAUTH_TOKENS_ENABLED ? await mintDevTunnelOauth(…) : null`, then `result = oauth ?? await signDevScopedPageToken(…)`; response `kind: oauth ? 'oauth' : 'block'` |
| `tryDevTunnelOwnedNonApprovedMint` (owned, submitted, not approved) | `mintOauthAppToken` with its three-way outcome, so `needsConsent` could be `true` | `mintDevTunnelOauth`, which returns `{token, expiresAt}` with **no** `consent_required` arm — the response is now **unconditionally** `needsConsent: false, missingScopes: []` |

**Three consequences the review should have drawn and did not:**

1. ⚠ **"The dev tunnel keeps the JWT" is no longer true on `main`.** It is true of *production*,
   because the deployed image predates #5122 (§0.0) — so this is a claim that is right about the
   fleet today and wrong about the code.
2. ✅ **#5122 makes the §2 deadlock unreachable in the dev tunnel** — that branch can no longer
   return `needsConsent: true`, and with the flag on the author gets `kind:'oauth'`, which the SDK
   guard accepts. The tunnel is the one surface where the split is now closed. It is closed by
   writing consent for the author directly, not by fixing the consent round trip.
3. ⚠ **It narrows, but does not remove, §5's 4-hour tail.** With the flag on and `auth: "oauth"`
   declared, the dev path yields a ≤1 h hub token rather than a 4 h JWT. With the flag off — the
   default, and every environment other than `civitai-dp-prod` — the 4 h JWT branch is unchanged.

---

## 0.2 The hypothesis, and the correction that carries forward

The operator's hypothesis was that `@civitai/sdk`'s single token-kind guard rejects an opted-in block
in the default configuration. **Both limbs are confirmed in code, end to end** (§1, §2). Re-verified:
the guard is still at `packages/civitai-sdk/src/app/index.ts:91` on starters `origin/main` —
`if (snapshot().viewer !== null && snapshot().token.kind === 'block') {`.

The guard's own justification is the thing that is false for the routes that matter.
`packages/civitai-sdk/CHANGELOG.md` 0.4.0: *"`/api/v1`, the orchestrator and the MCP reject that
token."* `/api/v1/blocks/*` **is** `/api/v1`, and it accepts the token — that is what it was minted
for. The block JWT's acceptance surface is 35 `withBlockScope` routes (§4), 34 of them under
`/api/v1/blocks/`.

⚠ **Correction — the blast radius is three apps, not one.** The original review asserted
`civitai-app-requests` was *the only* fleet app depending on `@civitai/sdk`. See §4 for the measured
table. The direction of the correction is *against* the guard, not for it: 0.4.0 was armed under
three apps.

### A category correction worth carrying forward

There is **no `kind` claim in the JWT.**
`git grep -c "kind" origin/main -- src/server/services/block-token.service.ts src/server/middleware/block-scope.middleware.ts`
→ **rc=1, 0 hits in both**. Positive control `claims` in the same two files → **8**
(`block-token.service.ts`) and **69** (`block-scope.middleware.ts`).
⚠ The original review reported those controls as "69 and 8" — **transposed**; corrected above.

`kind` is a **mint-endpoint response-body discriminator**, not a claim. The JWT *is* the block kind.
Likewise the JWT's `aud` is one global constant — `BLOCK_TOKEN_AUDIENCE = 'civitai-app-block'`,
`block-token.service.ts:11`, consumed at `.setAudience(…)` `:299` — so it is **not** a route or
resource audience and constrains nothing about which endpoint accepts the token. The real constraint
is `scopes` plus which routes opt into `withBlockScope`.

---

## 1. Hypothesis 1 — flag off + signed-in viewer + `auth: "oauth"` → `initialize()` rejects

**CONFIRMED in code.** 🔴 **But see §0.0: this is the DEFAULT configuration, not production's.**
Every link re-measured at civitai `origin/main`:

1. **Mint.** `src/pages/api/v1/block-tokens/index.ts:1327-1335` — the condition at **:1328** is
   `userId != null && manifestWantsOauthToken(block.manifest) && env.APP_BLOCK_OAUTH_TOKENS_ENABLED`.
   ⚠ The original cited ":1328-1330"; the ternary actually spans **1327-1335**. Response at **:1368**:
   `kind: oauth?.outcome === 'minted' ? 'oauth' : 'block'`. With the flag off, `oauth` is `null` →
   `kind: 'block'`.
2. **The host's own test pins this as a 200 success.**
   `src/tests/api/v1/block-tokens/oauth-mint.test.ts` — `it('auth: "oauth" with the flag off still
   mints the JWT')` at **:172**, asserting `{ token: 'jwt.signed.value', kind: 'block' }` at **:176**,
   with `mockSession.value = VIEWER` (a signed-in viewer) set in `beforeEach` at **:144**.
3. **Both host surfaces forward `kind` onto the wire.** `...(tokenKind ? { kind: tokenKind } : {})` —
   `IframeHost.tsx:1497, 1567, 1666` and `PageBlockHost.tsx:1192, 1414, 1468` (3 each, `git grep -c`
   = 3 / 3). BLOCK_INIT plus both refresh messages.
4. **`viewer` is non-null exactly when signed in.**
   ⚠ `src/components/AppBlocks/projectBlockInit.ts:254` — `if (typeof source.viewerUserId !== 'number') return null;`
   (the original review filed this under `src/utils/`; the file is under `src/components/AppBlocks/`).
5. **The guard fires.** `viewer !== null && kind === 'block'` → `throw new CivitaiError(...)`.

**The flag defaults off:** `src/env/server-schema.ts:957`
`APP_BLOCK_OAUTH_TOKENS_ENABLED: zc.booleanString.optional().default(false)`.
✅ **The live value is no longer unknown — it is `true` in `civitai-dp-prod` (§0.0).**

### The error message is wrong in precisely this case

The guard says: *"Declare `auth: "oauth"` in block.manifest.json to use @civitai/sdk."* In the
flag-off case the manifest **already** declares it. The message instructs the developer to do the
thing they have already done, and names a cause that is not the cause — a server-side env var they
cannot see. `BREAKING.md` already documents that "signed in, `token.kind` absent or `'block'`" is
**not separable** between the flag and a missing grant; the guard collapses that documented ambiguity
into one confidently-wrong message. ✅ **starters#453 fixes exactly this** — see §6.3.

---

## 2. Hypothesis 2 — the no-grant / `consent_required` fallback deadlocks

**CONFIRMED, surface-dependent, and — per §0.0 — the LIVE one.** This is the sharper of the two.

`block-tokens/index.ts:1336-1341`: when the grant is missing or the hub answers `consent_required`,
the host deliberately withholds the ungranted scopes, sets `needsConsent = true`, and **falls back to
signing a block JWT** so the block can render and ask for consent. `:1343-1357` is that fallback;
`:1368` then stamps `kind: 'block'`. Pinned by `oauth-mint.test.ts:219` (*"hub consent_required falls
back to the JWT with the consent signal, not a 500"*, body asserted at **:232-237**) and by `:240`
(*"no active grant to mirror is reported as needsConsent"*, asserted at **:247**).

Crucially, the fallback is reachable **only** when `userId != null` (the leading conjunct at
**:1328**; `userId` is defined at **:827**). So `viewer` is non-null **by construction**, not by
coincidence. The guard therefore fires 100% of the time on this path — it is not a probabilistic case
like hypothesis 1.

⚠ **Correction to the original's line set.** It listed `oauth-mint.test.ts:167, 172, 214, 247` as the
four places a signed-in viewer gets `{ kind: 'block' }`. The actual set is **{167, 176, 234, 247}**:
`:172` is a title line (the assertion is `:176`), and `:214` sits inside the **anonymous** test
(`mockSession.value = null` at `:208`) so it is not a signed-in case at all. The anonymous no-mint
test is at **:206** (the original said :205).

### Can the block still reach consent after the throw?

`initialize()` throws, so the block never receives an `app`. Re-measured, the public API offers no
other route:

| | Command | Value |
|---|---|---|
| `requestGrants` lives on the **session**, not the host | read of `packages/civitai-sdk/src/host/index.ts` | `createHostSession` at **:404**, `requestGrants:` at **:412** (helper at `:421`) |
| `createHostSession` is **not exported** | `git grep -c createHostSession origin/main -- packages/civitai-sdk/src/index.ts` | **rc=1, 0** |
| positive control, same file | `… -c createHost` | **1** (`export { createHost } from './host/index.js';` at `:40`) |
| `createHost()` returns no consent member | read of `host/index.ts:130-171` | `resize, autoResize, reportError, navigate, onVisibilityChange, requestSignIn, download, openResourcePicker, openBuzzPurchase, publishGenerationOutputs, openImageUpload` — no consent member |

So a block that catches the `CivitaiError` can reach `getTransport()` and `createHost()`, but
**cannot ask for consent through any public export.** The escape hatch does not exist.

### The host-side escape hatch exists on only ONE of the two surfaces

This is the part that decides how bad hypothesis 2 actually is.

* **`PageBlockHost`** (the full-page `/apps/run/<slug>` surface) renders host chrome **outside** the
  iframe: `PageBlockHost.tsx:4536` gates on `needsConsent &&`, `:4540` is
  `data-testid="block-consent-notice"`, `:4549` is *"{appName} is missing permissions it needs to work
  fully"*, with a Review button at `:4554`. This runs regardless of whether the block's JS threw.
  **Degraded but recoverable.**
* **`IframeHost`** (the model-slot surface) has **no such notice.** Its only consent path is the
  handler at `IframeHost.tsx:1939-1964` for a **block-initiated** `REQUEST_CONSENT`. The block must
  ask. After the throw, the block's code never runs. **True deadlock.**

| | Command | Value |
|---|---|---|
| zero under test | `git grep -c "needsConsent" origin/main -- src/components/AppBlocks/IframeHost.tsx` | **rc=1, 0 hits** |
| positive control (same token, other file) | `… -- PageBlockHost.tsx` | **7** |
| positive control (same file, sibling token) | `git grep -c "missingScopes" … IframeHost.tsx` | **11** |
| positive control (same file, sibling token) | `git grep -c "REQUEST_CONSENT" … IframeHost.tsx` | **5** |

`@civitai/sdk`'s `requestGrants` does send that exact message — `host/index.ts:448`:
`notify('REQUEST_CONSENT', { scopes: [...scopes] }, { transport })` (⚠ the original said :450). The
mechanism is correctly wired on both sides. It is simply unreachable, because `initialize()` throws
before the block can call it.

### The steady state is this deadlock — and it does not need a revocation to get there

⚠ **Correction to the original framing.** The original reached this state via a permission
withdrawal. **It does not need one.** With the flag on, the *first* load by any signed-in viewer who
has never granted this app produces `syncOauthConsentFromGrant → null` →
`{ outcome: 'consent_required' }` → `needsConsent: true`, `kind: 'block'` → the guard throws. Pinned
by the host's own test at `oauth-mint.test.ts:240/:247`. Any later withdrawal re-enters the same
state; it is not the only way in.

So on the model-slot surface, a viewer cannot **acquire** consent for an `auth: "oauth"` block, not
merely fail to **re-acquire** it. On `/apps/run/<slug>` the host-side notice still works.

---

## 3. A third seam: `requestGrants` cannot resolve `false` on the model-slot surface

The SDK documents *"a refusal is an answer, not a throw"* — `requestGrants` resolves `false` rather
than rejecting. It does so on exactly one signal: `host/index.ts:441`
`release.push(on(transport, 'CONSENT_UNAVAILABLE', () => settle(() => resolve(false))));`

**Only `PageBlockHost` ever sends that message.**

| | Command | Value |
|---|---|---|
| zero under test | `git grep -c "CONSENT_UNAVAILABLE" origin/main -- src/components/AppBlocks/IframeHost.tsx` | **rc=1, 0** |
| positive control (same file, sibling msg) | `git grep -c "REQUEST_CONSENT" … IframeHost.tsx` | **5** |
| positive control (same token, other file) | `git grep -c "CONSENT_UNAVAILABLE" … PageBlockHost.tsx` | **2** — sender at `:1821`, `send('CONSENT_UNAVAILABLE', { reason: 'ungrantable', scopes: ungrantable.scopes })` |

`IframeHost.tsx:1949` drops an ungrantable `REQUEST_CONSENT` silently —
`if (scopesToGrant == null) return; // not ready, or nothing missing — drop`. On the model-slot
surface, therefore, `app.requestGrants()` **never settles** unless the viewer grants or the caller
passed an `AbortSignal`.

### 🔴 The comment that licenses this is false for `@civitai/sdk`

⚠ The original cited the licensing comment at `IframeHost.tsx:1949`; it is at **`:1943-1947`** (`:1949`
is the drop itself). Verbatim:

> *"NO NACK HERE, deliberately. REQUEST_CONSENT is fire-and-forget in both directions: the SDK sends
> it with `dispatch` (blocks-react 0.39.0 `useRequestConsent`), its payload is `{ scopes? }` with NO
> requestId, and there is no host→block reply message for it — so there is nothing to reply TO and no
> promise to fail fast. Dropping it cannot hang the block."*

That is true of `@civitai/blocks-react`'s fire-and-forget `useRequestConsent()`. It is **false for
`@civitai/sdk`**, whose `requestGrants` returns a promise that awaits either a snapshot change or
`CONSENT_UNAVAILABLE`. The comment names the package it was true of, which is exactly why it reads as
still-current. A comment is a claim; this one licenses a hang.

`hostHandlerParity.ts:189-197` carries the matching claim (*"the SDK's `useRequestConsent()` posts it
with `sendMessage` and AWAITS nothing, so an unhandled one can never hang a block"*) — and its own
table entry at `:198-204` marks `REQUEST_CONSENT` as **`IframeHost: 'required'`**, while the counts
above show IframeHost carries neither `needsConsent` nor `CONSENT_UNAVAILABLE`.

### Why no gate caught it

`packages/civitai-sdk/snapshots/host-messages.json` is generated from `hostHandlerParity.ts` — and it
**flattens the surface dimension away.** The upstream inventory is per-surface
(`hostHandlerParity.ts:45` `export type HostFile = 'IframeHost.tsx' | 'PageBlockHost.tsx' | 'InlineHost.tsx'`,
with `IframeHost: 'required'` / `PageBlockHost: 'required'` per entry). The snapshot keeps only
`{ request, reply }`: measured, its **46** message entries have a key union of exactly
`['reply','replyNote','request']` — **zero** keys containing `Host`.

✅ **And a second, sharper hole the original missed:** `CONSENT_UNAVAILABLE` is **absent from the
snapshot entirely**. The one host→block push that `PageBlockHost` actually sends, and that
`requestGrants` depends on to resolve `false`, is not in the mirrored contract at all. So
`check:parity` is blind both to *which surface* implements a message and to *this message existing*.
Per the rules: a suite whose config pins a dimension is blind to that dimension's bugs, and every
future per-surface divergence passes this gate vacuously.

---

## 4. The three options, measured

### Option (a) — widen the block JWT's acceptance

🔴 **REFUTED as the cheap option.** The repo refutes it in its own words.

The acceptance surface today, re-measured:

| | Command | Value |
|---|---|---|
| route files mentioning `withBlockScope` under `/api/v1` | `git grep -l withBlockScope origin/main -- src/pages/api/v1 \| wc -l` | **36** |
| …minus `/api/v1/me.ts`, where all hits are **comment-only** (handler is `AuthedEndpoint` at `:12`) | read of `me.ts` | **35** |
| …of which outside `/api/v1/blocks/*` | filter the list | **exactly 1**: `src/pages/api/v1/models/[id].ts` — `withBlockScope(baseHandler, {` at `:299`, `PublicEndpoint` at `:181` |

✅ This independently reproduces the Round 0 audit figure quoted on starters#453 (*"35 `withBlockScope` routes, exactly one of which — `src/pages/api/v1/models/[id].ts:299` — sits outside `blocks/`"*), and it reproduces `BREAKING.md`'s "35 routes" and its "🔴 Not `/api/v1/me`".

⚠ **A pathspec trap worth recording, because it silently undercounts.**
`git grep -l withBlockScope origin/main -- 'src/pages/api/v1/**/*.ts'` returns **35**, not 36 — git's
`**/` cannot match the empty path, so it drops `src/pages/api/v1/me.ts`, the one file whose
presence-vs-absence the whole census turns on. Use the **directory** pathspec (`-- src/pages/api/v1`).
A census that counts 35 for the wrong reason lands on the right number by cancelling its own error.

**The clause that fails.** Widening was argued to "reach the same destination" because `withBlockScope`
has no path assertion. The no-path-assertion half is true and independently confirmed
(`git grep -n "startsWith('/api\|pathname" origin/main -- src/server/middleware/block-scope.middleware.ts`
→ **rc=1, 0 matches**; positive control `startsWith` in the same file → **3**). But it does not imply
what was drawn from it:

> 🔴 **`withBlockScope` is a COMPOSITION, not a SUBSTITUTION.** At `block-scope.middleware.ts:1408` it
> attaches `(req as BlockScopedNextApiRequest).blockClaims = claims` and invokes the wrapped handler at
> `:1521` as `return handler(req, res)` — two arguments, **no session injected**. The wrapped handler
> then runs its own independent auth.

So wrapping a `PublicEndpoint` works, and wrapping an authenticated endpoint **dead-codes the block
path**. The repo says so verbatim at `src/pages/api/v1/me.ts:8-11`:

> *"App Blocks do NOT call /api/v1/me directly. Layering withBlockScope over AuthedEndpoint would
> dead-code the block-token path (the inner session check 401s before block claims do anything).
> Blocks use the dedicated /api/v1/blocks/me route which is built on top of withBlockScope."*

That is decisive: the single `/api/v1` route a block would most want is **already documented as not
widenable by annotation**, and the chosen remedy was a parallel route — which is exactly what the 34
`/api/v1/blocks/*` routes are. The parallel-route set *is* the widening program, already executed.

**And the one non-`blocks/*` precedent is a weak one.** `models/[id].ts:181` is `PublicEndpoint`,
wrapped at `:299`; the inner handler resolves no identity (`getServerAuthSession` in that file → **0**;
positive control in `src/server/utils/endpoint-helpers.ts` → **8** — ⚠ the original said 4). So the only
widened route is one where the block token **grants nothing an anonymous caller lacks.**

**Measured cost of real widening.** The block JWT is not a recognised credential in the generic
authenticator at all. Pattern used: `-E "verifyBlockToken|blockClaims|BLOCK_TOKEN|withBlockScope|blockToken"`.

| generic-chain file | block-JWT refs | positive control, same file |
|---|---|---|
| `src/server/utils/endpoint-helpers.ts` | **0** | `Endpoint` → **35** |
| `src/server/trpc.ts` | **0** | `tokenScope\|TokenScope` → **7** |
| `src/server/auth/get-server-auth-session.ts` | **0** | `session` → **17** (⚠ original said 18) |
| `src/server/auth/bearer-token.ts` | **0** | `session` → **3** (⚠ original said 5) |

`getSessionFromBearerToken` (`bearer-token.ts:49-61`) emits a **two-arm** subject —
`{ type: 'oauth', id: apiKey.clientId }` at `:52` or `{ type: 'apiKey', id: apiKey.id }` at `:59`.
**There is no `block` subject type.** Widening authenticated routes therefore means adding a third
subject type to the shared bearer authenticator and to the `Subject` vocabulary
(`api-key.schema.ts:135-136`) that `api-key-spend.ts` shares with the orchestrator.

⚠ **Two blast-radius numbers in the original have to be withdrawn or restated.**

| Original claim | Status |
|---|---|
| "**91** route files under `src/pages/api/`" | 🔴 **No support.** `git ls-tree -r --name-only origin/main -- src/pages/api \| wc -l` → **369** (and all 369 contain `export default`, so 369 is the route-file count). Five separate derivations of the subset were tried — 95, 88, 96, 86, 79 — and **none produces 91**. The number is withdrawn; it has no command behind it. |
| "**~870** tRPC procedures via `enforceTokenScope`" | ⚠ **Wrong and drifting.** `enforceTokenScope` is in the base chain (`src/server/trpc.ts:344`, applied to `publicProcedure` at `:339`; `protectedProcedure = publicProcedure.use(isAuthed)` at `:466`), so the count is *every* procedure: **995** in `src/server/routers/*.router.ts`, **1010** across `src/server/routers/*.ts`. Cite the structural fact — "every procedure in the `publicProcedure` base chain" — not a number that moves every sprint. |

The qualitative conclusion survives both corrections intact: **widening means editing the one
authenticator every REST route and every tRPC procedure in the repo shares.** That is the
highest-blast-radius edit available in the auth surface, whatever the exact denominators.

**It also cannot reach the destinations that motivate the exercise.** The block JWT is **terminated at
civitai's edge and exchanged**, never forwarded: `src/pages/api/v1/blocks/workflows/submit.ts:150`
reads `req.blockClaims`, and `blocks.router.ts:5747` then calls `getOrchestratorToken(userId, ctx)` — a
different, opaque per-user credential. `git grep -n 'Authorization: \`Bearer' origin/main -- src` → **31
hits**, all read: every one interpolates an env/orchestrator/vendor token, **none** a block JWT.
Orchestrator/MCP acceptance of a block JWT is **UNVERIFIABLE from this repo** (§8).

*What remains true and useful:* for a block whose calls live inside `/api/v1/blocks/*`, the block JWT
**already reaches everything it needs, with no widening at all.** That is `civitai-app-requests`
exactly (§4.1). This is the fact §6 is built on — and it is not the same proposition as "widen".

*Residual cost even in the cheap case:* 🔴 **silent wrong answers, not errors.** The SDK's
`README.md:70-77` warns that *"a public route such as `/api/v1/images` ignores the token and answers
anonymously instead of erroring, so prefer the `blocks/*` twin"* (a single-line grep misses it — the
sentence wraps). Verified: `src/pages/api/v1/images/index.ts:112` is `PublicEndpoint(...)`, which never
inspects `Authorization`. Under `/api/v1`: **12** `PublicEndpoint` files (✅ as originally stated),
**10** `MixedAuthEndpoint` (✅), ⚠ **9** `AuthedEndpoint` (original said 5 — four of the nine are
`.tsx`, the likely source of the undercount), of ⚠ **79** route files (original said 75). So a dozen
routes will hand an authenticated block a **200 with anonymous data**: the empty-result failure mode,
worse than a 401, and invisible.

### 4.1 ⚠ CORRECTED — the fleet dependency table

The original table was wrong in **nine cells**, and wrong about the headline. Re-measured by reading
each repo's `package.json` at its **own** default branch:

| repo | ref | `@civitai/app-sdk` | `@civitai/blocks-react` | `@civitai/sdk` |
|---|---|---|---|---|
| custom-generators | `main` `24c2a11` | ⚠ **^0.42.0** (was "^0.35.0") | ⚠ **none at all** (was "^0.46.0") | 🔴 **^0.3.0** (was "—") |
| gen-matrix | `main` `7c1c53e` | ^0.37.0 ✅ | ^0.47.0 ✅ | — ✅ |
| sensei | ⚠ **`trunk`** `11b2c77` | ^0.45.0 ✅ | ^0.53.1 ✅ | — ✅ |
| model-benchmarking | `main` `246406b` | ⚠ **^0.42.0** | ⚠ **^0.51.0** | — ✅ |
| playable-collections | `main` `65b0028` | ⚠ **0.42.0** exact | ⚠ **0.51.0** exact | — ✅ |
| requests | `main` `a419306` | ^0.42.0 ✅ | — ✅ | **^0.2.0** ✅ |
| generate-from-model | `main` `200617e` | ⚠ **^0.36.0, and a `devDependency`** (was "^0.7.0") | ⚠ **none at all** | 🔴 **^0.2.0** (was "—") |

🔴 **Three fleet apps depend on `@civitai/sdk`, not one** — `custom-generators`, `requests`,
`generate-from-model`. This matches the Round 0 audit on starters#453 exactly, and it cuts **against**
the 0.4.0 guard: it was armed under three apps.
⚠ Also note `civitai-app-sensei`'s default branch is **`trunk`**, not `main` — `git fetch origin main`
fails on that repo, which is how a census silently skips it.

**But the fuse needs a hand on it.** Lockfiles: requests → `@civitai/sdk@0.2.0`, custom-generators →
`0.3.0`, generate-from-model → `0.2.0`. Under 0.x caret rules the minor acts as the major, so
`^0.2.0` resolves `>=0.2.0 <0.3.0` and `^0.3.0` resolves `>=0.3.0 <0.4.0`. **Neither can reach 0.4.0**
— the pin itself must be edited. (The transitive *peer* range in the same locks is
`'@civitai/sdk': '>=0.1.0 <1.0.0'`, which would admit it; the app's own direct caret is what binds.)

**0 of 7 fleet manifests declare `auth`.** Measured by parsing all seven `block.manifest.json` with
`json.load` and printing `d.get('auth','<<ABSENT>>')` → absent **7/7**. Positive control, same parse,
same files: `name` → 7/7 real values, `scopes` → 7/7 non-empty arrays. The reader sees manifest fields;
`auth` is genuinely absent everywhere.

🔴 **A consequence that ties the two together:** the grant→consent mirror at `blocks.router.ts:3134`
requires `manifest.auth === 'oauth'`. With `auth` absent fleet-wide, **no fleet app's grant is
mirrored into a consent today** — while #5122's CLI-supplied `declaredAuth` can now switch a dev
tunnel onto the OAuth path **without the manifest changing at all**.

### Option (b) — the OAuth mint (civitai#5097, MERGED, and now LIVE)

⚠ **No longer "shipped, dark."** #5097 merged 2026-09-24T15:31:53Z and the flag is `true` in
production (§0.0). It is shipped and **armed**; what keeps it unexercised is that no manifest opts in.

*For:*
- It is the only option that produces a credential the orchestrator and MCP already accept.
- 🔴 **The phishing bar is respected, and this is load-bearing.**
  `apps/auth/src/lib/server/oauth/block-guard.ts` bars `appblk-*` clients from the interactive
  `authorization_code`/device flows: *"an app-block owner could otherwise phish a user through the
  consent screen → account takeover"* (`:8-12`). #5097 does not touch it — it mints server-side
  through an internal hub endpoint that re-checks consent (`app-token/+server.ts:65`
  `if (!consent || !hasScope(consent.scope, scope)) return bad('consent_required', undefined, 403)`).
  **No option below reopens those flows, and any future proposal that does is out of bounds.**
  ⚠ Two corrections to how the original described this guard: it implements **zero** gates itself — it
  is a 17-line file holding one prefix constant and one predicate; the gating happens at **three
  consumers** (`api/auth/oauth/authorize/+server.ts:69`, `api/auth/oauth/device/+server.ts:49`,
  `login/oauth/authorize/+page.server.ts:52`). And the predicate is **open-coded twice** —
  `block-guard.ts:15-16` and `src/shared/constants/block-scope.constants.ts:474-477`. One rule, two
  places, which is how the `appdev-*` gap below survives.

*Against:*
- It introduces the dual consent record (§5) and the granularity mismatch.
- It loses the host-side spend policy when the SDK routes around `/api/v1/blocks/*` (§7).
- Its failure modes are §1–§3, and §0.0 shows §2's is the live one.

### Option (c) — collapse to one kind

**Collapse to `oauth`:** breaks anonymous viewers by construction. No OAuth token is minted for an
anonymous viewer, whatever the flag (`oauth-mint.test.ts:206` — the no-mint assertion is at `:212`,
`mockSession.value = null` at `:208`), and `BREAKING.md` calls `viewer === null` *"Definitive — no
OAuth token is minted for one"*. Signed-out browsing is a shipped app's premise, so this is a
non-starter unless a second anonymous credential is kept — which is the split again, renamed.

**Collapse to `block`:** this is option (a) taken to its conclusion, and it forfeits the orchestrator,
MCP, and any without-an-open-page capability. It also strands #5097's shipped, now-live work.

**Migration cost:** 4 of 7 fleet apps carry no `@civitai/sdk` dependency at all and are unaffected by
either kind today; 3 are mid-migration and all three are pinned below the guard (§4.1). **A collapse
is cheap right now and gets more expensive with every port** — an argument for deciding now, not for
any particular answer.

---

## 5. The dual-record assessment

### The mirror is the wrong shape, and the shape is the finding

`oauth-consent-sync.service.ts` treats `AppUserScopeGrant` as authoritative and `OauthConsent` as
derived — it reads the grant (`:41-44`), returns `null` if `grant?.revokedAt` (`:46`), and writes the
consent (`:55`), never the reverse. **That direction is right.** What is wrong is that "derived" is
asserted in prose and implemented at a handful of call sites, rather than enforced.

**Every consent writer in the repo — measured, not assumed.** There are exactly **five** non-test
write sites:

| # | Site | What it writes | Reads the grant? |
|---|---|---|---|
| 1 | `apps/auth/.../api/auth/oauth/authorize/+server.ts:158` | `insertInto('OauthConsent')` on the ordinary consent screen, **only if `params.remember === 'true'`** (`:156`); leaves `buzzLimit` null unconditionally (`:154-155`) | **No.** `git grep -ni 'appUserScopeGrant\|app_user_scope_grants' origin/main -- 'apps/auth/**'` → **0**; positive control `OauthConsent` in the same pathspec → **3 files, 6 hits** |
| 2 | `oauth-consent.router.ts:80` (`setBuzzLimit`) | only `OauthConsent.buzzLimit` | **No** — and `app_user_scope_grants.buzz_budget_per_day`, the row the spend path actually reads via `getConsentBuzzBudget` (`scope-grant.service.ts:193`, read at `:201-204`, consumed at `blocks.router.ts:1311-1312`), is untouched |
| 3 | `oauth-consent.router.ts:137` (`revokeApp`) | `oauthConsent.delete` | **No** — no grant write on this path |
| 4 | `oauth-consent-sync.service.ts:70` (`writeOauthConsent`) | the upsert | via its caller only |
| 5 | `oauth-consent-sync.service.ts:107` (`revokeOauthConsentForBlock`) | `oauthConsent.deleteMany` | — |

🔴 **And a new finding the original missed: writer 5 has ZERO production callers.**
`git grep -n 'revokeOauthConsentForBlock' origin/main` returns its own definition plus two test files
and nothing else. **Nothing in the product ever deletes a consent when a block grant is revoked.**

🔴 **The upsert is an unconditional overwrite, and wider than the original said.**
`oauth-consent-sync.service.ts:70-75`:

```ts
await dbWrite.oauthConsent.upsert({
  where: { userId_clientId: { userId, clientId } },
  create: { userId, clientId, scope, buzzLimit: buzzLimit ?? Prisma.DbNull },
  update: { scope, buzzLimit: buzzLimit ?? Prisma.DbNull },
  select: { id: true },
});
```

The `update` clobbers **`buzzLimit` as well as `scope`** — so a limit the viewer set through
`setBuzzLimit` (writer 2) is silently overwritten by the next grant mirror. The original said the
overwrite hit `scope`; it hits the money field too.

**Grant writers that never mirror.** `recordScopeGrant` (`scope-grant.service.ts:276`) writes the grant
at `:300` (update), `:309` (create) and `:331` (P2002 race) and writes **no** consent. The mirror lives
in the caller, and only two callers do it:

- `blocks.router.ts:3119` → mirror at `:3132-3140`, guarded by
  `env.APP_BLOCK_OAUTH_TOKENS_ENABLED && (block.manifest as {auth?: unknown}).auth === 'oauth'`.
- `block-tokens/index.ts:392-396`, at mint time.
- 🔴 **`block-registry.service.ts:2334` (`recordInstallConsent`) calls `recordScopeGrant` and does NOT
  mirror at all** — there is no `syncOauthConsentFromGrant` in that file. **So the install/subscribe
  path writes a grant with no consent row, ever.** This is a third unmirrored writer the original did
  not name.

**Granularity mismatch, which no amount of dual-write discipline fixes.** All three halves confirmed in
`packages/civitai-db-schema/prisma/schema.full.prisma`: `AppUserScopeGrant` (`:4001`) keys
`@@unique([userId, appBlockId])` at `:4021`; `OauthConsent` (`:4048`) keys
`@@unique([userId, clientId])` at `:4059`; `AppBlock` (`:2566`) is `@@unique([appId, blockId])` at
**`:2683`** — so one `OauthClient` may own many blocks. `block-scope.middleware.ts:971` explicitly
contemplates it (*"With several blocks on one client the oldest approved one is chosen"*, implemented
at `:1060-1062` as `orderBy: [{createdAt:'asc'},{id:'asc'}]`). The mirror is therefore **N grants → 1
consent, written by overwrite.** Block B's load clobbers the consent scope written for block A, so A's
next hub mint fails `hasScope` → `consent_required` → JWT fallback → **§2's deadlock**, which §0.0
shows is live.

**Does anything union sibling blocks' scopes? No — load-bearing zero, with the pair.** Each of the five
writers keys on a single `(userId, clientId)` and derives `scope` from **one** block (or, for writer 1,
from the request's `scope` param). The only non-test `appUserScopeGrant.findMany` in the repo is
`user-app-surface.service.ts:393`, the read-only permissions UI, which contains **0** references to
`oauthConsent`. Positive control: the same grep class finds `oauthConsent.upsert` → 1 and
`appUserScopeGrant.findMany` → 1 non-test hit (plus 23 test hits across 2 files), so both greps
demonstrably see the constructs whose *co-occurrence* is zero. **No union exists, in code or in tests.**

**Assessment: one record should be derived, and the derivation should be a function, not a
convention.** Two shapes, in preference order:

- **(i) Derive `OauthConsent` on read.** The hub's only uses of it are the `hasScope` gate at
  `app-token/+server.ts:65` and the `buzzLimit` read in `bearer-token.ts`. If the hub resolved both
  from the grant(s) — unioned across sibling blocks — the mirror row, the dual-write, the revocation
  coupling and the clobber all disappear together. Cost: a cross-service read the hub does not have
  today. **No new stateful infra** — it replaces a table with a query.
- **(ii) Keep the row as a cache, but make one writer own it.** Funnel every write through
  `writeOauthConsent`, make it union rather than overwrite, stop it clobbering `buzzLimit`, and make
  `revokedAt` the single authority both sides read. Cheaper; leaves the granularity mismatch and the
  cache-coherence class intact.

### The revocation tail: the trade is sound, the number is not

**The trade is sound.** Paying a Redis read on every authenticated REST *and* bridge request to close a
short window on an already-issued, already-consented, scope-limited token is a bad exchange. Deleting
the consent plus the `ApiKey` row stops hub-minted tokens on their **next** request —
`bearer-token.ts:15` resolves the bearer with `dbWrite.apiKey.findFirst` and no cache — so the tail
applies only to legacy JWTs. Accepting it is the right call.

🔴 **But "15 minutes" is the wrong number for that tail, and this repo has been bitten by it before.**
`src/server/services/block-token-lifetimes.ts:12-18`:

```ts
export const BLOCK_TOKEN_LIFETIMES_SECONDS = { default: 900, settings: 300, dev: 4 * 60 * 60 };
export const MAX_BLOCK_TOKEN_LIFETIME_SECONDS = Math.max(...Object.values(...)); // :20-22 → 14400
```

The dev lifetime is **4 hours**, and the owned-but-not-approved dev-tunnel branch signs with the app's
**real** ids, so a grant-bearing `appBlockId` can carry a 4 h token. The true worst-case tail for a JWT
is **4 h, not 15 min** — a 16× understatement on a security boundary. The file says so itself at
`:4-8`: restating the number as a literal *"is what let the revocation TTL sit at 15min for the whole
time dev:live tokens lived 4h"*, and `block-registry.service.ts:2407` carries
*"MAX_BLOCK_TOKEN_LIFETIME_SECONDS, not the 15 minutes this line claimed."*
**Anything that states this tail should cite `MAX_BLOCK_TOKEN_LIFETIME_SECONDS`, never a literal.**

⚠ **#5122 narrows this without closing it** (§0.1): with the flag on and `auth: "oauth"` declared, the
dev path returns a ≤15 min hub token instead. With the flag off — the default everywhere but
`civitai-dp-prod` — the 4 h branch is unchanged.

### 🔴 Two comment-is-a-claim defects #5122 introduced, both in the mint endpoint

1. `block-tokens/index.ts:538` and `:738` still describe the dev token as *"dev:true (**4h**)"*. When
   the OAuth branch fires, the token's TTL is **15 minutes** — `mintDevTunnelOauthToken` calls
   `mintAppToken` with no `ttlSeconds` (`dev-tunnel-oauth.service.ts:78`), so the hub applies
   `APP_TOKEN_DEFAULT_TTL = 15 * 60` (`apps/auth/src/lib/server/oauth/constants.ts:10`). The 4 h now
   describes only the JWT fallback.
2. `:578-579` says *"there is no per-user consent ledger for a synthetic pre-approval app, so no
   consent signal is surfaced."* That is now false for the OAuth path: `mintDevTunnelOauthToken` writes
   exactly such a ledger row (`dev-tunnel-oauth.service.ts:76`) — and it writes it with **no flag
   check, no grant read and no `revokedAt` check** in that function.

### 🔴 `appdev-*` is a real client-id population outside the A1 discriminator

`devTunnelClientId(userId, slug)` → `` `appdev-${userId}-${slug}` `` (`dev-tunnel-oauth.service.ts:13-15`),
with its own reverse parser at `:17-24`. `mintDevTunnelOauthToken` **upserts a real `OauthClient` row**
for it (`:54-70`) with `secret: null`, `redirectUris: []`, `allowedOrigins: []`,
`isConfidential: false`, `grants: []`, `allowedScopes: scope`.

`isAppBlockOauthClientId` matches only the `appblk-` prefix, so **none of the three consumer gates
fires for a dev-tunnel client.** They are closed today only by the incidental shape of the row
(`grants: []`, `redirectUris: []`) — one accidental layer instead of the deliberate predicate that
exists for the purpose. This is not hypothetical: `appdev-*` is a live population with a live parser.

### Test coverage for the dual record — measured

`git grep -l -i 'appUserScopeGrant' origin/main -- 'src/**/*test*'` → **15** files;
`git grep -l -i 'oauthConsent' origin/main -- 'src/**/*test*'` → **4**; `comm -12` → **exactly 3**:
`block-scope.hub-token.test.ts`, `oauth-consent-sync.service.test.ts`, `oauth-mint.test.ts`.

🔴 **No test anywhere exercises the `revokeApp` router path, and none asserts what happens to the grant
when the consent is deleted, or the reverse.** The nearest thing,
`oauth-consent-sync.service.test.ts:82` (*"returns null and writes nothing when the grant is
revoked"*), **hands the service a pre-revoked grant** via `mockResolvedValue` — it never runs a revoker
to produce that state. Per the rules that is an **invariant guard, not regression coverage**. The other
two only set `revokedAt: null` (`block-scope.hub-token.test.ts:95`, `oauth-mint.test.ts:148`) and stub
`revokeOauthConsentForBlock: vi.fn()` (`oauth-mint.test.ts:76`).

**And there is no real-DB tier for these paths.** `git grep -l 'dbMock' origin/main -- src/ | wc -l` →
**582** (⚠ original said 581); positive control `git grep -l 'describe(' origin/main -- src/ | wc -l` →
2313. Of the 28 paths matching `integration|testcontainer|\.int\.test`, exactly **3** are real
integration tests (`redis/__tests__/queues.integration.test.ts`,
`app-blocks-flag.real-flipt-client.integration.test.ts`,
`listing-meta.datauri-raster.integration.test.ts`) and **none touches consent, grants or token
minting**; positive control, 2600 `*.test.ts(x)` files in the tree. So "both rows exist, then revoke"
is unobservable anywhere in the suite — every assertion is about which Prisma method was called with
what, on a mock.

**Other untested combined states:** sibling blocks on one `OauthClient` (the scope clobber); the
`appdev-*` consent write; `setBuzzLimit` divergence from `buzzBudgetPerDay`; and the 4 h tail.

---

## 6. The product question, answered — and the recommendation that follows

### 6.1 ✅ RESOLVED: a block does NOT need to act without an open host page

The original review posed this as the hinge and made its recommendation conditional on it.
**The operator has decided: no.** A block acts only while its host page is open.

That closes the review's one genuinely open question, and it turns the review's most awkward
measurement into a *confirmation* rather than a gap:

| credential | TTL | refresh credential held by the block? |
|---|---|---|
| block JWT | `default: 900` (15 min); `settings: 300`; `dev: 14400` (4 h) — `block-token-lifetimes.ts:12-18` | **No.** Refreshed by the host page's session |
| #5097 OAuth app token | `APP_TOKEN_DEFAULT_TTL = 15 * 60`; max `APP_TOKEN_MAX_TTL = ACCESS_TOKEN_TTL = 60 * 60` — `apps/auth/src/lib/server/oauth/constants.ts:5, 10, 11` | **No.** `createAppAccessToken` (`token-helpers.ts:78-93`) returns `{ accessToken, expiresAt }` and inserts **only** `type: 'Access'` (`:89`) |

🔴 **Keep this measurement — it is what makes the answer safe rather than lucky.** The absence of a
refresh token is a deliberate design choice, not a grep miss. **Positive control in the same file:**
the ordinary OAuth flow at `token-helpers.ts:65-72` *does* insert `type: 'Refresh'` with
`REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60` (`constants.ts:6`) and return it. `createAppAccessToken`
pointedly does not. (It also ORs in `scope | TokenScope.UserRead`, which the original omitted.)

And the renewal authority it *does* have is the host page, by design: `IframeHost.tsx` pushes
`TOKEN_REFRESH` on rotation (`:1562`, `:1670`) and answers a block-initiated `REQUEST_TOKEN` with
`TOKEN_REFRESH_RESPONSE` (`:1673`), with the whole flow documented at `:311-315`.

> **So: a ≤1 h non-renewable token whose renewal authority is the open host page is the CORRECT design
> for a block, not a shortfall.** The credential's lifetime and the block's lifetime are deliberately
> the same thing. Under the original's "if YES" branch this would have opened a third, unbuilt design
> problem — how to give a block a renewable credential without an interactive consent screen, which
> `block-guard.ts` exists to prevent. **That branch is now closed and should not be reopened.**

### 6.2 🔴 The fact that dominates the whole review

> **`withBlockScope` already accepts BOTH token kinds — and reconstructs the spend budget for the OAuth
> one.**

`src/server/middleware/block-scope.middleware.ts:1155-1159`, re-verified verbatim at both the original
ref and current `origin/main`:

```ts
const claims = isJwt
  ? await verifyBlockToken(bearer)
  : env.APP_BLOCK_OAUTH_TOKENS_ENABLED
  ? await resolveHubTokenClaims(bearer, req)
  : null;
```

and `:1105` `...(scopes.includes('ai:write:budgeted') ? { buzzBudget: hubBuzzBudget(manifest) } : {})`
(cap `HUB_BUZZ_BUDGET_CAP = 1000` at `:958`) rebuilds the per-call budget claim that an opaque OAuth
`ApiKey` row cannot carry.

**So `/api/v1/blocks/*` is a single enforcement point that both credentials already pass through, with
every spend control in §7 intact.** A block holding an OAuth token that submits via
`POST /api/v1/blocks/workflows/submit` gets the complete host-path control set verbatim — per-call
budget, per-viewer daily cap, per-app aggregate + velocity, the mandatory whatIf estimate, and the
`app-block:<appId>` attribution tag.

The direct-to-orchestrator call does not reach that point. **It is the SDK's choice of base URL — not
the token kind — that loses the policy.** `@civitai/sdk` points
`DEFAULT_SITE_URL = 'https://civitai.com/api/v1'` (`site/index.ts:3`) and
`DEFAULT_ORCHESTRATION_URL = 'https://orchestration.civitai.com'` (`orchestration/index.ts:26`), i.e.
deliberately *around* the blocks routes.

This reframes "the auth mechanism feels split." **The credential split is defensible — the two kinds
serve genuinely different tenancy models (anonymous/host-bound vs. viewer-consented). What is actually
broken is that the new SDK routes around the one place where the split is already reconciled.**

### 6.3 Recommendation — now UNCONDITIONAL

> ## Adopt **(b)** as the credential, route its data path through `/api/v1/blocks/*`, and reject **(c)**.
>
> Keep both kinds. Make the split invisible to app authors by converging both on the single
> enforcement point that already accepts both.

✅ **This is no longer conditional on anything.** The product answer (§6.1) removes the one branch on
which the original hedged, and it removes it in the direction that *supports* this recommendation: a
host-bound credential with a host-bound lifetime is exactly what (b) provides.

Mapping to the taxonomy:

- **(a) is rejected as a widening program.** Measured in §4: not a route-annotation change for anything
  authenticated; a third subject type in the authenticator every REST route and tRPC procedure shares;
  and it cannot reach the orchestrator, which has no block subject type. The repo refutes it at
  `src/pages/api/v1/me.ts:8-11`. *What survives of (a) is not widening:* for a block whose calls live in
  `/api/v1/blocks/*`, the block JWT already suffices — a status-quo observation, not a project.
- **(b) is adopted, amended.** It is the only credential that keeps the orchestrator/MCP option open,
  and the phishing bar is respected. But it must not ship pointed at raw `/api/v1` +
  `orchestration.civitai.com`.
- **(c) is rejected.** Collapse-to-`oauth` breaks anonymous viewers by construction; collapse-to-`block`
  forfeits the orchestrator and MCP and strands #5097's now-live work. **The migration window is open
  and closing:** 4 of 7 fleet apps carry no `@civitai/sdk` dependency, 3 are mid-port (§4.1).

**Sequenced, ordered by what unarms damage first:**

1. ✅ **Unarm the guard — `starters#453` does this, and it is OPEN.** Opened 2026-09-25T04:01:26Z,
   7 files, +535/−28, branch `fix/sdk-narrow-block-token-guard`, titled *"narrow the block-token guard —
   reject at the surface, not at `initialize()`"*. It keeps the predicate
   (`viewer !== null && token.kind === 'block'`, now named `holdsBlockToken`) and moves *where it is
   consulted*: eager for `app.orchestration` (the one statically-known destination), deferred and
   *explaining rather than predicting* for `app.site` (a 401/403 outside the `blocks/*` namespace gets
   the opt-in appended to the API's own message, with `status` and `body` untouched), nothing for
   `app.storage` (every route is `blocks/app-storage/*`), and nothing for `initialize()`.
   Two Round 0 results this document has absorbed: the corrected three-app blast radius (§4.1, which
   this review independently reproduced) and the 35/1 `withBlockScope` census (§4, likewise).
   🔴 **It is the right shape and it does NOT deliver step 2** — it deliberately refuses to re-spell the
   server's route table, so `app.site` still points at raw `/api/v1`.
2. **Point the SDK's block path at the blocks routes.** This is the change that makes (b) safe: with
   `app.site` and `app.orchestration` resolving to `/api/v1/blocks/*` for a block, §7's spend-cap gap
   does not arise, attribution is preserved, and the token-kind guard has no reason to exist. It also
   deletes the silent-anonymous hazard (§4), since the blocks routes 401 rather than answering
   anonymously. **Open after #453.**
3. 🔴 **Fix the consent deadlock — and per §0.0 this is now the first *live* item, not a pre-flight
   one.** Port `PageBlockHost.tsx:4536`'s host-side notice to `IframeHost` so a viewer's ability to
   consent never depends on the block's JS having survived startup. Strictly better than fixing only
   the SDK side, because it holds even when the block crashes for an unrelated reason. The flag is
   already on in production; what is protecting this today is that no manifest declares `auth`.
4. **Make `CONSENT_UNAVAILABLE` required on every surface**, and stop the parity snapshot discarding the
   surface dimension (§3) — and note that `CONSENT_UNAVAILABLE` is missing from the snapshot entirely,
   so the gate cannot see either half. Until then `app.requestGrants()` can hang on the model-slot
   surface and no gate can observe it.
5. **Derive the consent record instead of mirroring it** (§5 shape (i)). The minimum viable version:
   make `writeOauthConsent` union rather than overwrite, stop it clobbering `buzzLimit`, and give
   `recordInstallConsent` the mirror it is missing.
6. **Keep the flag off for spend-driving apps until §7's closing condition is met — and make that a
   gate, not a note in a PR body.** ⚠ The flag is now **on** in `civitai-dp-prod`, so this is a
   statement about which *manifests* may declare `auth: "oauth"`, not about the env var.

**Unconditional, regardless of anything else:**
- Land step 1 (starters#453).
- Correct `blocks.router.ts:7225`, which still claims `appblk-*` clients *"carry `grants: []` so they
  cannot mint an account bearer token at all."* 🔴 **Confirmed false**, not merely suspect: the
  `app-token` route selects only `['allowedScopes','accessMode']` from `OauthClient` and **never reads
  `grants`** (grepped across non-test `apps/auth/src`: `grants` appears in `model.ts`, `first-party.ts`
  and `device/+server.ts:61`, never in `app-token/+server.ts`), and `createAppAccessToken` then inserts
  a real `type: 'Access'` bearer that `getSessionFromBearerToken` accepts. `grants: []` blocks the
  authorization_code/device flows, which *do* check it; it does not block `/api/auth/oauth/app-token`.
  Mitigating and worth stating alongside the correction: that route requires `isInternalRequest`
  (`AUTH_INTERNAL_TOKEN`), an existing consent covering the scope, and a non-banned user — so it is not
  third-party-reachable. The substitute control is sound; the comment describing the old invariant is
  not, and the route's own header admits its threat model is a *leaked* `AUTH_INTERNAL_TOKEN`.
- Bring `appdev-*` under the A1 discriminator, and **consolidate the predicate** — it is open-coded in
  `block-guard.ts:15-16` and `src/shared/constants/block-scope.constants.ts:474-477` (§5).
- Fix the two stale comments #5122 left in the mint endpoint (`:538`/`:738` "4h", `:578-579` "no consent
  ledger") — §5.
- Wherever the revocation tail is stated, cite `MAX_BLOCK_TOKEN_LIFETIME_SECONDS`, never a literal (§5).

---

## 7. FINDING (not a fix) — the spend-cap gap

*Measured; deliberately not fixed. Building it reaches into the orchestrator, a separate service.*

### 7.1 What exists on the host path

All enforcement lives in **one file**, `src/server/routers/blocks.router.ts` — verified by enumerating
the reservation call sites rather than assuming. Both ledgers re-measured with **zero drift**:
`await reserveAppSpend(` → `:6040, :8493, :9729, :10550`;
`await reserveBlockBuzzSpendForClaims(` → `:5954, :8440, :9673, :9949, :10498`.
Positive control: `git grep -l getOrchestratorToken origin/main -- src | grep -v tests | wc -l` → **24**
files, so pathspec and grep resolve. Four handlers = the four workflow kinds.

| # | Control | Limit expression | Where the value comes from |
|---|---|---|---|
| 1 | **Per-call `buzzBudget`** — `blocks.router.ts:5862`; presence gate `:5556, :8241, :9435, :10382` (missing ⇒ FORBIDDEN) | `cost > claims.buzzBudget` | **JWT claim** from `manifest.page.buzzBudgetPerGen`; default **10**, cap **1000**; dev cap **250**. For OAuth tokens **reconstructed** as `hubBuzzBudget(manifest)` (`block-scope.middleware.ts:1105`, cap `HUB_BUZZ_BUDGET_CAP = 1000` at `:958`) |
| 2 | **Per-viewer platform daily cap** — reserve `:1121`, key `…BUZZ_CAP:<userId>:<UTC-day>`, check `:5960` | `total > BLOCK_BUZZ_CAP_PER_DAY` | ⚠ **Hardcoded `50_000` at `src/shared/constants/block-scope.constants.ts:181`** — the original filed this under `src/server/middleware/`, where **no such file exists**; it was moved deliberately into the client-safe shared module. `appBlockId` is deliberately NOT in the key, so N blocks share one ceiling |
| 2b | **Per-(viewer, app) consent budget** — key `…CONSENT_BUDGET:<userId>:<appBlockId>:<UTC-day>` | `consent.total > consent.cap` | **DB column** `app_user_scope_grants.buzz_budget_per_day`; UI default 1000. **NULL ⇒ no reservation at all** |
| 3 | **Per-app aggregate daily + velocity (G8)** — `:6039-6072` → `app-spend-cap.service.ts:246` | `dailyBuzz` + `velocityMaxGens` per app | **DB tier** `app_blocks.spend_tier` + mod overrides. standard **5,000,000/day, 120/60 s**; ⚠ **`trusted` 5,000,000 / 600 — a middle tier the original omitted**; platform 25,000,000/3,000. Fails **closed** to `STRICTEST_APP_CAP_LIMITS` (pre-seeded at `:258`, computed as the per-field min at `app-cap-limits.constants.ts:408-415`) |
| 4 | **`app-block:<appId>` attribution tag** — ⚠ literal at `src/server/services/blocks/workflow.service.ts:247` (original said `:246` and omitted `services/blocks/`), stamped by `buildWorkflowTags` (`blocks.router.ts:10887`) | `workflow.tags` incl. `app-block`, `app-block:<appId>`, `:block:<blockId>`, `:instance:<id>` | `appId` from the **verified token**, never client input. Same helper is the read filter (`:4354`) — stamp and read cannot desync |
| 5 | **Mandatory server-side whatIf gate** — `:5806-5814` `query: { whatif: true }`; `cost` at `:5856` | every cap above compares against the orchestrator's own price | not a client number |
| 6 | Gen-idempotency (Redis SET-NX + `externalId` dedupe), review-session cap (5000), dev-tunnel session cap (`DEV_TUNNEL_SESSION_BUZZ_CAP = 5000`, `dev-tunnel-session.ts:4`), mint rate limits | | constants |
| — | **Submit rate limit: NONE, deliberately** — `:5427` is `🔴 RATE LIMIT: NONE, DELIBERATELY — AND HERE IS WHAT BOUNDS IT INSTEAD`, opening a docblock that runs to `:5490+`. ⚠ The *"THE VELOCITY COUNTER IS NEVER REFUNDED, AND IT IS APP-WIDE"* line the original attributed to `:5427` is at **`:5466`** | | |
| — | **Per-app spend attribution row** — ⚠ `recordSpendAttribution` at `:6544, :8830, :10158` **and a fourth site at `:10777` the original omitted** (definition: `src/server/services/blocks/buzz-attribution.service.ts:506`), aggregated by `src/server/services/blocks/app-analytics.service.ts:408` | | host-path only |

⚠ **One note on the "no rate limit" argument:** the docblock at `:5466` says its own reasoning is
**tier-scoped** and weakens as apps are promoted — which is why the omitted `trusted` tier matters.

The REST twin `POST /api/v1/blocks/workflows/submit` is a **thin adapter over the same procedure** — not
a second copy, not a gap.

### 7.2 Exactly what a direct-to-orchestrator call escapes

An `appblk-*` OAuth access token is an **`ApiKey` row**, not a JWT (`token-helpers.ts:78`), and
`model ApiKey` (`packages/civitai-db-schema/prisma/schema.full.prisma:2472`) has exactly one money
field: `buzzLimit Json?`. There is **no per-call budget field anywhere on the token**, and
`POST /api/auth/oauth/app-token` accepts no budget parameter.

| Host control | Survives a direct call? |
|---|---|
| per-call `buzzBudget` | **NO** — no such claim exists on an opaque ApiKey row |
| per-viewer 50,000/day platform cap | **NO** — the Redis counter is incremented only in `blocks.router.ts` |
| per-app aggregate + velocity (G8) | **NO** — same |
| mandatory whatIf estimate, maturity clamp | **NO** |
| `app-block:<appId>` attribution tag | **NO** — see below |
| dev-tunnel session backstop | **NO** |
| **viewer's per-app consent budget** | **YES** — `oauth-consent-sync.service.ts:50-53` mirrors `getConsentBuzzBudget` into `OauthConsent.buzzLimit` as a sliding day window via `simpleBuzzLimitToBudgets` (`api-key.schema.ts:86-96`). 🔴 A `null` budget ⇒ `Prisma.DbNull` ⇒ **no limit at all**. ⚠ Line moved: the mirror is at `:50-53`, not `:52-56` |

**Attribution — measured with a positive control:**
`git grep -c "app-block" origin/main -- packages/civitai-sdk/src` → **rc=1, 0 matches**; positive
control `orchestration` in the same pathspec → **4 files**. The SDK's submit is
`orchestration/index.ts:121-122` `submitWorkflow: (template, { wait, signal } = {}) => http<Workflow>('POST', WORKFLOWS, { body: template, query: { wait }, signal })`
— the body is **whatever the app passes**; no tag injection, nothing derived from the token. So the
orchestrator *does* learn the client (civitai hands it `subject: { type:'oauth', id: apiKey.clientId }`
via `bearer-token.ts:52` → `me.ts:42`, which returns `{ tokenScope, buzzLimit, subject }` — ⚠ three
fields, not the two the original named), but nothing puts it on the workflow.

**Second-order consequence: per-app *reporting* breaks too, not just caps.** `recordSpendAttribution`
runs only in `blocks.router.ts`, and `block_spend_attribution` is what the publisher dashboard
aggregates. Direct-path spend is invisible to it **and** unreadable by the per-app subqueue
(`blocks.router.ts:4354` filters on the missing tag). So a viewer's Buzz can be spent by an app with no
row, no tag, and no dashboard line.

**Buzz tenancy is NOT violated** — worth stating, since it is the one constraint that would make this
fatal rather than serious. On both paths the spend is debited against the **viewer's**
token/consent, never the developer's.

### 7.3 Where one shared rule would have to live

**The two paths do not present the same principal to the orchestrator — that is the root obstacle, and
it is upstream of any cap.**

- **Host path:** ⚠ `src/server/orchestrator/get-orchestrator-token.ts:107-114` mints via
  `getTemporaryUserApiKey({ … type: 'System', userId })` (`type: 'System'` at `:111`) → an `ApiKey` with
  `clientId` and `buzzLimit` unset → per `bearer-token.ts:59-60` the orchestrator sees
  `{ type: 'apiKey', id }` with `buzzLimit = null`, i.e. **applies no per-subject budget at all**.
  Civitai's Redis is the entire control. (The original cited `src/server/services/orchestrator/…:44`;
  both the path and the line are wrong — there is no `services/` segment and the mint is at `:107-114`.)
- **Direct path:** `{ type:'oauth', id:'appblk-<slug>' }` with `buzzLimit` from consent — the
  orchestrator is the entire control.

The narrowest single place is therefore **the orchestrator's per-subject limit resolution, fed by
civitai's `/api/v1/me` `{ subject, buzzLimit }` contract**. Three things would have to change, and two
are not civitai's to make:

1. The host path must present the **same subject** (an OAuth-client-bound token, not a `System` ApiKey),
   or one rule cannot see both paths wherever it is written.
2. 🔴 **The `BuzzBudget[]` vocabulary cannot express two of the three caps.**
   `SubjectType = 'apiKey' | 'oauth'` (`api-key.schema.ts:135`),
   `Subject = { type:'apiKey'; id:number } | { type:'oauth'; id:string }` (`:136`), and every
   orchestrator route is user-scoped —
   `` `/v1/manager/users/${userId}/auth/${subject.type}/${encodeURIComponent(String(subject.id))}` ``
   (`api-key-spend.ts:42-48`). There is **no subject for "this user across all apps"** (the 50k/day
   platform cap) and **none for "this app across all users"** (the G8 aggregate + velocity). That is an
   orchestrator change — a new subject type / cross-user aggregation — not a civitai patch.
3. Attribution needs the orchestrator to stamp the authenticated subject onto the workflow, or to honour
   a server-forced tag, because `tags` are caller-controlled on the direct path.

**The cheap interim, and it is §6's recommendation restated:** the OAuth token is *already* accepted by
`withBlockScope`, which *already* reconstructs the budget. **The single rule already exists — it is
`/api/v1/blocks/workflows/submit`. The direct call simply walks past it.** No orchestrator change is
needed to close the gap for blocks; only a base-URL decision in the SDK. (Stated as the measurement.
Not implemented.)

### 7.4 Closing condition

> **This finding is closed when a direct-to-orchestrator submit by an `auth: "oauth"` block is subject to
> the same per-viewer daily cap, per-app aggregate cap and `app-block:<appId>` attribution as a
> `blocks.submitWorkflow` submit — or when the direct path is removed for blocks so the question cannot
> arise.**
>
> **Mechanical check (either satisfies):**
> - **(A) Route convergence — checkable in CI, no orchestrator access needed.** A test asserts that a
>   block-mode `@civitai/sdk` client resolves `app.orchestration`'s base URL to a `/api/v1/blocks/*`
>   path, with a negative control proving the assertion fails when it is pointed at
>   `orchestration.civitai.com`. Plus a ledger test over the reservation call sites (`reserveAppSpend` /
>   `reserveBlockBuzzSpendForClaims`, currently **4** and **5** sites) that fails when the set **grows or
>   shrinks** — so a new submit path cannot be added without touching it.
> - **(B) Orchestrator-side enforcement.** Two new subject types exist and are enforced:
>   per-user-across-apps and per-app-across-users. Verified by a live probe that exceeds each cap and
>   observes a refusal, with the pair reported (refused above the cap, permitted below it).
>
> **Named human judgement over named evidence, if neither lands:** **Koen reads §7.2 and §7.3 of this
> document** and states in writing either (i) the direct path will carry the caps and by when, or
> (ii) the direct path is not intended for spend and no manifest may declare `auth: "oauth"` for a
> spend-driving app — in which case that becomes an enforced gate, not a PR note. Koen is named because
> his own handoff's closing line explicitly invites exactly this question: *"Questions are welcome —
> particularly on the spend caps and attribution above, where you know what the host was protecting and
> I only know what the code does."* (Re-verified: `diff -u datapacket-talos/koen-app-handoff.md
> civit/koen-app-handoff-2026-09-22.md` → that sentence is the **only** delta between the two copies,
> present in the 09-22 copy and removed from the 09-24 one. No technical claim differs.)

### 7.5 The seam lens — which surface each suite does not load

Each of #5097 and #442 is green on its own surface; the defects are in the combined states none of their
fixtures builds.

| PR | Test surface it loads | Surface it does **not** load |
|---|---|---|
| **civitai#5097** (MERGED, 33 files, 6 new test files) | the mint endpoint's **response body**; the hub endpoint's gates; the consent-sync service | the **consumer**. Nothing asserts what the SDK does with the body it returns |
| **civitai#5122** (MERGED, 16 files) | both dev-tunnel mint branches; `withBlockScope`'s new dev-tunnel resolver | the **public** mint path's interaction with it, and the 15 min-vs-4 h TTL the comments still misstate (§5) |
| **starters#442** (MERGED, 1 test file, +25 lines) | the guard against a **hand-built** `createFakeTransport` snapshot (confirmed: `test/app/initialize.test.ts:5` imports it from `../../src/testing.js`) | the **host**. Nothing asserts the real mint's `kind` survives `projectBlockInit` → `BLOCK_INIT` → `tokenFromWrapped` |

**🔴 The seam, in one sentence:** `oauth-mint.test.ts` asserts **as a 200 success** four host responses
that `initialize.test.ts` asserts **as a correct rejection** — and no test loads both. Specifically
`oauth-mint.test.ts:167, 176, 234, 247` all produce `{ kind: 'block' }` for a **signed-in** viewer,
which is exactly the state #442's guard refuses. Two independently green suites, opposite verdicts on
the same state, zero overlap. ✅ starters#453 closes the SDK half of this seam; the host half (a test
that drives the real mint response through `projectBlockInit` into the SDK) still does not exist.

---

## 8. What I could not verify

1. ✅ **RESOLVED — `APP_BLOCK_OAUTH_TOKENS_ENABLED`.** The original review's largest caveat. It is
   **`true`** in `civitai-dp-prod`, in the GitOps manifest and on a running pod (§0.0). Scope of that
   claim: a Kubernetes control-plane read of deployment specs, one pod spec, and one ConfigMap, at
   ~04:55Z on 2026-09-25. Not a live HTTP observation of a mint.
2. **Nothing was executed against civitai itself.** No test run, no typecheck, no HTTP probe, no block
   loaded, no token minted. Every code claim is source-reading plus `gh`/`npm` metadata plus the one
   `kubectl` read. I did not watch the guard throw, nor any described green test pass. The chains in §1
   and §2 are *verified in code*, not *reproduced at runtime*.
3. **Whether the three `@civitai/sdk` apps are deployed with a signed-in-viewer path in active use.** I
   verified their dependencies, lockfile resolutions, and (for `requests`) its `initialize()` call and
   all 7 `app.site` paths in source. I did not check any live deployment or release state.
4. 🔴 **Orchestrator and MCP behaviour — the largest remaining gap, and it bounds several conclusions.**
   The orchestrator is a **separate service** whose code is not in this repo: `.cs` files at
   `origin/main` → **0**; positive control `src/**/*.ts` → **4797** (⚠ the original said 4789 — that was
   read off a stale working tree). The in-repo `apps/orchestrator-gateway` is a 21-file skeleton whose
   entire router (`src/trpc/router.ts`, 22 lines) is `health` + `ping`, with a comment saying the real
   procedures "land here in P1/P2". So **UNVERIFIABLE from here:**
   - whether `OauthConsent.buzzLimit` is actually enforced, and with what window semantics;
   - whether the orchestrator would accept a civitai block JWT if presented (do **not** infer it from
     the fact that nothing forwards one today).

   **MCP is worse: there is no MCP surface in this repo at all.**
   `git ls-tree -r --name-only origin/main | grep -ci mcp` → **0**, positive control
   `grep -ci "block-token"` → **14**; `git grep -lIi "modelcontextprotocol" origin/main | wc -l` → **0**,
   positive control `git grep -lIi "orchestrator" origin/main | wc -l` → **946**. **Every claim in this
   document about MCP — including the 0.4.0 CHANGELOG's justification for the guard — is
   documentation-derived, not measured.**

4b. **A token-cache staleness note I did not pursue.** ⚠ Path corrected:
   `src/server/orchestrator/get-orchestrator-token.ts:97-105` (no `services/` segment) documents that its
   per-pod cache *"is NOT invalidated by ban / logout / API-key-rotation … a revoked user keeps
   minting/using a valid orchestrator token for up to `ORCHESTRATOR_TOKEN_CACHE_TTL_MS` per pod across
   all ~220 pods (api + jobs + ssr)"*, and that the 401 handlers *"only `throw` — they do not invalidate
   this cache or the sysRedis hash."* This interacts with any revocation story and I did not measure it.
   Flagging, not concluding.

5. **Whether any production `OauthClient` owns more than one `AppBlock`.** The schema permits it and
   `block-scope.middleware.ts:971` contemplates it; I did not query the database, so the sibling-clobber
   in §5 is **structural rather than observed**.
6. **Whether grant and consent have already diverged in the live database.** Needs a DB query I did not
   run.
7. **Whether a 4 h `dev:true` JWT is ever issued for a grant-bearing `appBlockId` in practice.** The
   code path exists; I did not establish a real instance.
8. 🔴 **"91 route files under `src/pages/api/`" is WITHDRAWN, not merely unverified.** Five derivations
   were attempted and none reproduces it (§4). A number with no command behind it should not be quoted
   again. The denominator that *is* solid is **369**.
9. **Whether the guard has ever fired in production.** It cannot have, on the fleet: no app can resolve
   `@civitai/sdk@0.4.0` without a hand-edited pin (§4.1), and no manifest declares `auth` (§4.1).
   That is an argument from two measured absences, not an observation.
10. **When the deployed image will pick up #5122.** Prod runs `87b975d`, which predates it (§0.0). Flux's
   `civitai-prod-release` image policy will roll it forward on its own schedule; I did not read that
   policy's cadence.
11. **The primary `civitai-app-starters` clone is stale** (on `docs/handoff-app-platform-migration`).
   Every starters-side claim here is read from `origin/main`, never the tree. Anyone re-checking must do
   the same or they will conclude the SDK guard does not exist. ⚠ The same trap bit the civitai clone
   during this refresh: its working tree sat at `02e057b3` while `origin/main` was `6ff7aff2`, which is
   where the stale `4789`/`4790` file counts in item 4 came from.

---

## 9. ACTION ITEMS

Ordered by what unarms damage first. Each has a closing condition.

| # | Do | Why it matters | Closing condition |
|---|---|---|---|
| **1** | **Land `starters#453`.** | It is the only thing that unarms the 0.4.0 guard, and the guard's message names a cause that is false in both the flag-off and the no-grant cases. Three apps sit under it, not one. | **PR `civitai/civitai-app-starters#453` merged**, and a release published so the narrowed behaviour is reachable. Mechanical. |
| **2** | 🔴 **Port `PageBlockHost.tsx:4536`'s `block-consent-notice` to `IframeHost`.** | With the flag **on in production**, a signed-in viewer of an `auth: "oauth"` block on a model slot cannot acquire consent at all — the block is the only thing that can ask, and the guard stops it running. The host-side notice holds even when the block crashes for an unrelated reason. | A merged civitai PR in which `git grep -c needsConsent -- src/components/AppBlocks/IframeHost.tsx` returns **non-zero** (it is **0** today, against **7** in `PageBlockHost.tsx`), **plus** a test that drives the no-grant mint response through `projectBlockInit` → `BLOCK_INIT` and asserts the notice renders. Mechanical. |
| **3** | **Gate which manifests may declare `auth: "oauth"` until §7.4 closes.** The env flag is already on; the remaining lever is the manifest. | A manifest that declares `auth: "oauth"` and submits generations directly to `orchestration.civitai.com` escapes every control in §7.1 and appears in no attribution row. 0 of 7 fleet manifests declare it today — that is the only thing holding. | Either §7.4's (A) or (B) lands, **or** the validator/approval path refuses `auth: "oauth"` for a manifest requesting `ai:write:budgeted`, pinned by a test that is watched red without it. Mechanical either way. |
| **4** | **Point `@civitai/sdk`'s block-mode `app.site` / `app.orchestration` at `/api/v1/blocks/*`.** | This is the whole recommendation (§6.2/§6.3 step 2). It closes §7's spend gap with no orchestrator change, restores attribution, deletes the silent-anonymous hazard, and removes the token-kind guard's reason to exist. #453 deliberately does **not** do it. | §7.4 check **(A)**: a merged starters PR with a test asserting a block-mode client resolves to a `/api/v1/blocks/*` base, with a negative control proving it fails when pointed at `orchestration.civitai.com`, plus a grows-or-shrinks ledger test over the 4 + 5 reservation sites. Mechanical. |
| **5** | **Correct `blocks.router.ts:7225`.** Its `grants: []` "cannot mint an account bearer token at all" is **confirmed false** for `/api/auth/oauth/app-token`. | A maintainer reading it could delete the substitute control (the consent re-check) believing `grants: []` already closes the hole. A comment is a claim. | A merged civitai PR where that comment states the actual control (`isInternalRequest` + consent + non-banned), verified by reading the merged text. Mechanical. |
| **6** | **Consolidate `isAppBlockOauthClientId` and bring `appdev-*` under it.** | The predicate is open-coded in `block-guard.ts:15-16` and `src/shared/constants/block-scope.constants.ts:474-477`; `appdev-<userId>-<slug>` is a live client-id population outside all three consumer gates, closed today only by the incidental shape of the row. | A merged civitai PR with **one** definition (`git grep -c 'startsWith(APP_BLOCK_OAUTH_CLIENT_ID_PREFIX)'` → 1) that covers both prefixes, plus a test per consumer gate watched red first. Mechanical. |
| **7** | **Fix the three stale comments #5122 and #5097 left**: `block-tokens/index.ts:538` and `:738` ("dev:true (4h)" — it is 15 min on the OAuth path), `:578-579` ("no per-user consent ledger" — `dev-tunnel-oauth.service.ts:76` writes one). | Each one is load-bearing for a reader reasoning about TTLs or about whether a dev tunnel leaves a consent row behind. | A merged civitai PR; verify by reading the three sites. Mechanical. |
| **8** | **Make `writeOauthConsent` union rather than overwrite, stop it clobbering `buzzLimit`, and give `recordInstallConsent` the mirror it lacks.** | Three measured defects in one function's neighbourhood: sibling blocks clobber each other's consent scope (→ §2's deadlock), a viewer's `setBuzzLimit` is silently overwritten by the next mirror, and the install path writes a grant with no consent row ever. | A merged civitai PR **plus** a test that builds *both* rows for *two* sibling blocks on one client and asserts the union survives — the intersection of tests touching both records is **3 files today and none of them revokes**, so this must add the first such test. Mechanical. |
| **9** | **Add `CONSENT_UNAVAILABLE` to the parity snapshot and keep the surface dimension.** | `app.requestGrants()` can never resolve `false` on the model-slot surface, and the gate that exists to catch exactly this is blind twice over: the snapshot's 46 entries carry only `['reply','replyNote','request']`, and `CONSENT_UNAVAILABLE` is absent from it entirely. | A merged starters PR where the snapshot contains a `CONSENT_UNAVAILABLE` entry **and** a per-surface key, with `check:parity` watched red against the current snapshot first. Mechanical. |
| **10** | **Decide the spend-cap question.** | §7 is measured but not owned; it is the only item here that no code change can close on its own. | **Named human judgement over named evidence: Koen reads §7.2 and §7.3 and answers in writing** — either the direct path will carry the caps and by when, or it is not for spend and item 3's gate becomes permanent. He is named because his handoff's closing line invites exactly this question. |

**One thing I will not turn into an item.** *"Verify the orchestrator's and MCP's acceptance of a block
JWT."* I cannot name a closing condition for it: the orchestrator's source is not in any repo here
(`.cs` → 0), there is no MCP surface at all (`ls-tree | grep -ci mcp` → 0 against a control of 14), and
the only check I can imagine is a live probe against a service I have no access to and no owner for. It
is a **known unknown to be carried**, not a work item — minting one would create an object nobody can
close. Every claim in this document about either service is documentation-derived, and §8.4 says so at
the claim.

---

## 10. BOTTOM LINE

**The credential split is not the problem — it is defensible, because a host-bound anonymous token and a
viewer-consented OAuth token serve genuinely different tenancy models, and `/api/v1/blocks/*` already
accepts both and rebuilds the spend budget for the OAuth one.** The problem is that
`APP_BLOCK_OAUTH_TOKENS_ENABLED` has been **`true` in production since 2026-09-24T22:10:50Z** — measured
live on a running pod, not inferred — which arms the one failure mode where the two halves compose
badly: a signed-in viewer with no grant yet gets `kind: 'block'` plus `needsConsent`, and
`@civitai/sdk@0.4.0`'s guard throws before the block can ask for the consent that would fix it, on the
model-slot surface where the host renders no notice of its own. **Two measured absences are the only
things keeping that from being a live outage — no manifest declares `auth: "oauth"` (0 of 7) and no app
can resolve 0.4.0 without a hand-edited pin (3 of 3 below it) — and each is one commit wide.** The
product question is answered and it helps: because a block only acts while its host page is open, the
refresh-less ≤1 h token is the *correct* design rather than a gap, and the recommendation — adopt the
OAuth credential but route its data path through `/api/v1/blocks/*` — is now unconditional. **Land
starters#453, put the consent notice on `IframeHost`, and keep `auth: "oauth"` off spend-driving
manifests until someone owns §7.**
