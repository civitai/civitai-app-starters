# `@civitai/app-sdk`

Shared OAuth + orchestrator glue for building third-party [Civitai](https://civitai.com) apps. Used internally by every starter in [`civitai/civitai-app-starters`](https://github.com/civitai/civitai-app-starters), and publishable for direct use in your own app.

This package is **runtime-agnostic** — Node 20+ APIs only. There is no Next.js, SvelteKit, or Express coupling. Each starter writes a ~30-line framework adapter that calls into these primitives.

## Install

```bash
pnpm add @civitai/app-sdk
```

## What it does

| Surface | Why it exists |
|---|---|
| `oauth/*` — `generatePkce`, `buildAuthorizeUrl`, `exchangeCode`, `refreshToken`, `revokeToken`, `fetchMe` | The Civitai OAuth flow (Authorization Code + PKCE S256), as a set of stateless functions you call from your server-side handlers. |
| `scopes/*` — `TokenScope`, `TokenScopePresets`, `bitmaskFromScopes`, `scopesFromBitmask`, `hasScope`, `getScopeLabel` | Civitai scopes are stored as bitmasks. These helpers let you compose scope sets from named flags rather than magic numbers. |
| `cookies/*` — `sealCookie`, `unsealCookie`, `buildSetCookieHeader`, `readCookie` | AES-256-GCM authenticated cookie crypto. Use to seal a session blob (refresh token, expiry, scope) into an `httpOnly` cookie with zero external session store. |
| `orchestrator/*` — `createOrchestratorClient`, `estimateWorkflow`, `submitWorkflow`, `getWorkflow`, `pollWorkflow`, `buildTextToImageBody`, `buildImageGenBody`, `buildWorkflowBody`, `WORKFLOW_STEP_TYPES`, `IMAGE_GEN_ENGINES`, `isTerminal`, `extractImageUrls`, `OrchestratorError`, `WorkflowSnapshot`, `GenerateInput`, `ImageGenInput`, `WorkflowStepType`, `ImageGenEngine`, `DEFAULT_MODEL_AIR` | Orchestrator workflow glue — types, body builders, raw HTTP, and long-poll helper. Client + server safe (fetch-only). `estimateWorkflow` calls `?whatif=true` to preview Buzz cost without spending. `pollWorkflow` long-polls to terminal status. `WORKFLOW_STEP_TYPES` is the catalog of every step `$type` the orchestrator accepts. |
| `orchestrator/steps` — `WorkflowStepTemplates`, `WorkflowStepTemplateFor`, `WorkflowStepInputFor`, `AnyWorkflowStepTemplate`, `TypedWorkflowTemplate` | **Type-only** subpath (0 runtime bytes) keying the orchestrator's generated workflow-step shapes from `@civitai/client` by wire `$type`, so apps compose real step bodies against types that track the spec instead of hand-maintained copies. Requires the optional peer `@civitai/client@beta`. Type surface only — it grants no submit permission; see "Typed step shapes" below. |
| `blocks/*` — `BlockManifestError`, `BLOCK_SCOPES`, `BLOCK_SCOPE_PATTERN`, `isMessage`, types (`BlockManifestV1`, `BlockContext`, `BlockToken`, `BlockSettings`, `ViewerInfo`, `ThemeInfo`, `BlockWorkflowSnapshot`, `BlockInitPayload`, `ParentToBlockMessage`, `BlockToParentMessage`, …) | Framework-agnostic contract for [Civitai Apps](https://github.com/civitai/civitai-app-starters/blob/main/docs/build-your-first-app-block.md). Ships a byte-identical copy of the server-published canonical JSON Schema (draft 2020-12, https://civitai.com/schemas/app-block/v1.json) at the `./schemas/app-block/v1.json` subpath for offline validation; a CI drift-check keeps it in sync. Runtime-agnostic and **zero runtime dependencies** — no React, no DOM types, nothing in your install graph. Hooks and the iframe transport live in a separate package. |
| `manifest/*` — `defineBlock`, `SCHEMA_DIVERGENCES`, `KNOWN_GAPS` (**Node only**) | Build-time manifest validation. `defineBlock(config)` compiles the vendored canonical schema with [Ajv](https://ajv.js.org) and validates a `BlockManifestV1` against it, so authoring mistakes surface in `pnpm dev` instead of at `civitai app validate`/submit. It is **derived from the schema, not a hand-written mirror of it** — that mirror is what produced [#330](https://github.com/civitai/civitai-app-starters/issues/330). Needs `node:fs` and the optional peer `ajv`, which is why it is not on the browser-facing `./blocks` surface. |
| `vite/*` — `blockManifestPlugin` (**Node only**) | A Vite plugin wrapping `defineBlock`, firing from `configResolved` — the one hook Vite calls on both the dev-server and the build path. Every block scaffold registers it, so `pnpm dev`, `pnpm dev:harness` and `pnpm build` all fail on a bad manifest with the offending field path. Optional peers: `ajv` (runtime) and `vite` (types only). |

## Entry points, and what the root barrel is

The root — `import … from '@civitai/app-sdk'` — is **exactly the union of four subpaths**: `@civitai/app-sdk/oauth`, `/scopes`, `/cookies` and `/orchestrator`. All of each, and nothing else. Import from the root when you want the OAuth-app surface in one specifier; import a subpath when you want only that slice. The two are the same symbols either way, which is asserted in both directions by `test/export-surface.test.ts` — the root cannot quietly gain a symbol none of those four exports, or miss one they do.

The other five subpaths are **deliberately not on the root**, each for a concrete cost it would push onto every consumer:

| Subpath | Why it is not on the root |
|---|---|
| `@civitai/app-sdk/blocks` | Importing it runs `/safe-storage` for its side effect, and it is the Civitai-Apps contract — a disjoint audience from OAuth apps. |
| `@civitai/app-sdk/safe-storage` | Its purpose *is* the module side effect. A side effect on the root barrel is not something a consumer can opt out of. |
| `@civitai/app-sdk/orchestrator/steps` | Type-only, and its declarations name `@civitai/client` — an **optional** peer that the root would make mandatory for everyone. |
| `@civitai/app-sdk/manifest` | **Node only** — needs `node:fs` and the optional peer `ajv`. |
| `@civitai/app-sdk/vite` | **Node only** — optional peers `ajv` (runtime) and `vite` (types). |

> One name is declared twice on purpose: `BuzzAccountType` is the full set of Civitai Buzz pools on the root and `/oauth`, and a narrower three-pool union on `/blocks` — a block can neither prefer nor read the others. Same name, two subpaths, two types; the divergence is pinned rather than merged.

## Subpath imports

```ts
// The OAuth-app surface, also available whole from the root specifier:
import { buildAuthorizeUrl, exchangeCode, type OAuthTokens } from '@civitai/app-sdk/oauth';
import { TokenScope, bitmaskFromScopes } from '@civitai/app-sdk/scopes';
import { sealCookie, unsealCookie } from '@civitai/app-sdk/cookies';
import { submitWorkflow, WORKFLOW_STEP_TYPES } from '@civitai/app-sdk/orchestrator';
// The Civitai Apps contract (a different audience — see above):
import { BLOCK_SCOPES, isSignedIn } from '@civitai/app-sdk/blocks';
// Build-time manifest validation (NODE ONLY — needs the optional peer `ajv`).
// Most projects want the Vite plugin below rather than calling this directly:
import { defineBlock } from '@civitai/app-sdk/manifest';
// The same gate as a Vite plugin (NODE ONLY — optional peers `ajv` + `vite`):
import { blockManifestPlugin } from '@civitai/app-sdk/vite';
// Type-only: the orchestrator's generated per-step shapes. Needs the optional
// peer `@civitai/client@beta` — see "Typed step shapes" below:
import type { TypedWorkflowTemplate } from '@civitai/app-sdk/orchestrator/steps';
// Opaque-origin storage shim — see "Web storage in a block" below:
import '@civitai/app-sdk/safe-storage';
// JSON Schema for the manifest, e.g. for IDE validation:
import manifestSchema from '@civitai/app-sdk/schemas/app-block/v1.json' with { type: 'json' };
```

## Civitai Apps contract (`@civitai/app-sdk/blocks`)

> Building a **Civitai App** (an iframe-embedded UI on a civitai.com page)? This
> subpath is the framework-agnostic contract — manifest types, scope strings and
> the `postMessage` protocol. (The `defineBlock` validator moved to the node-only
> [`@civitai/app-sdk/manifest`](#defineblock-validator-rules) subpath; `./blocks`
> keeps zero runtime dependencies.) The React hooks + transport that consume it
> live in
> [`@civitai/blocks-react`](https://www.npmjs.com/package/@civitai/blocks-react).
> Start from the runnable [examples](https://github.com/civitai/civitai-app-starters/tree/main/starters/examples).
>
> This is distinct from the OAuth flow above: a *block* runs inside civitai.com
> and gets a short-lived block-scoped JWT handed to it; an *app* (the OAuth
> starters) runs on your own domain and does the Authorization-Code dance.

### The transport / message contract

A block runs in a sandboxed iframe. The host (civitai.com) and the block speak
over `window.postMessage({ type, payload }, targetOrigin)`, discriminated by
`type`. The full union is exported:

- **parent → block**: `BLOCK_INIT`, `TOKEN_REFRESH`, `TOKEN_REFRESH_RESPONSE`,
  `ESTIMATE_RESULT`, `WORKFLOW_SUBMITTED`, `WORKFLOW_STATUS`,
  `BUZZ_PURCHASE_RESULT`, `CHECKPOINT_PICKER_RESULT`, `USER_CHECKPOINT_SET`,
  `APP_STORAGE_*_RESULT`, `SUSPEND`, `RESUME`, `THEME_CHANGE`,
  `CONSENT_UNAVAILABLE` (`ParentToBlockMessage`).
- **block → parent**: `BLOCK_READY`, `BLOCK_ERROR`, `REQUEST_TOKEN`,
  `RESIZE_IFRAME`, `SUBMIT_WORKFLOW`, `ESTIMATE_WORKFLOW`, `POLL_WORKFLOW`,
  `QUERY_APP_WORKFLOWS`, `CANCEL_APP_WORKFLOW`, `OPEN_BUZZ_PURCHASE`,
  `OPEN_CHECKPOINT_PICKER`, `SET_USER_CHECKPOINT`, `NAVIGATE`, `TRACK_EVENT`,
  `APP_STORAGE_*` (`BlockToParentMessage`).

The app generator **subqueue** pair — `QUERY_APP_WORKFLOWS` →
`APP_WORKFLOWS_RESULT` and `CANCEL_APP_WORKFLOW` → `CANCEL_APP_WORKFLOW_RESULT` —
lets an app read + cancel its **own** tag-scoped generations (the `AppWorkflow`
projection: `workflowId`, `status`, `images[]`, `cost`, `createdAt`). The host
forces the per-app tag filter off the block token, so a block only ever sees the
queue it produced. Mirrors civitai/civitai PR #3164; the `@civitai/blocks-react`
`useAppWorkflows()` hook wraps both.

`isMessage(data, 'BLOCK_INIT')` is a **discriminator-only** narrowing helper — it
checks `data.type`, NOT the payload shape. Anything crossing the iframe trust
boundary must be payload-validated at the boundary (the React transport does this
for you).

### `BLOCK_INIT` — the first message

The host waits for the iframe `load` event AND a minted token, then posts:

```ts
interface BlockInitPayload {
  blockInstanceId: string;
  blockId: string;
  appId: string;                       // the OauthClient (app) this block belongs to
  token: WrappedToken;                 // { raw, scopes[], expiresAt (ISO), buzzBudget? }
  context: BlockContext;               // { slotId, … } — narrow to ModelSlotContext
  settings: BlockSettings;             // { publisherSettings, userSettings }
  viewer: ViewerInfo | null;           // null = anonymous — gate with isSignedIn(viewer)
  theme: 'light' | 'dark';
  renderMode: 'iframe' | 'inline';
}
```

`token.buzzBudget` is only present when the manifest declares `ai:write:budgeted`.
`expiresAt` is an ISO string on the wire; the React transport rehydrates it to a
`Date`.

### Primitives

| Export | What |
|---|---|
| `BLOCK_SCOPES` / `BLOCK_SCOPE_PATTERN` | Every known block scope string (the authoritative enum the canonical schema validates `scopes` against) + the `domain:verb:target` format-helper regex. Read the current set from `BLOCK_SCOPES` itself — scopes are added and retired, so no count is quoted here. A scope is valid only if it's a member of `BLOCK_SCOPES`, matching the [canonical schema](https://civitai.com/schemas/app-block/v1.json). |
| `isMessage(data, type)` | Discriminator-only message narrowing (see above). |
| `isModelSlotContext(ctx)` / `isPageSlotContext(ctx)` | Runtime narrowing for the `slotId`-discriminated `BlockContext` union. Real checks on a value that crossed a `postMessage` boundary — they verify every field they assert, not just `slotId`. |
| `isSignedIn(viewer)` | **The sign-in gate.** `isSignedIn(useBlockContext().viewer)` — do not open-code it as `viewer !== null` or `viewer?.signedIn === true`. Which of those is correct has already changed once with the host contract, and this is the one place it is decided. It reads neither `viewer.id` nor `viewer.username` (both `@deprecated`), so nothing written through it changes when those are removed. Need the identity rather than the presence? `useViewer()` — scope-gated and audited per call. |
| types | `BlockManifestV1`, `ManifestSettings` (+ field types), `BlockContext`, `ModelSlotContext`, `BlockCheckpointInfo`, `ShowcaseImage`, `BlockToken`, `WrappedToken`, `BlockSettings`, `ViewerInfo`, `Theme`, `WorkflowBody`, `BlockTextToImageParams`, `WorkflowBodyCustomComfy` (+ its two arms `WorkflowBodyCustomComfyRecipe` / `WorkflowBodyCustomComfyInline`, and `InlineComfyNode`), `WorkflowBodyStep` / `WorkflowBodyPassThroughStep` (the two arms of `kind: 'step'`), `BlockWorkflowSnapshot`, `WorkflowStatus`, `BlockInitPayload`, `ParentToBlockMessage`, `BlockToParentMessage`. |

`WorkflowBody`'s `customComfy` member is a discriminated union on `mode`, mirroring
the host's `blockCustomComfyMemberSchema`. Narrow on the VALUE (`body.mode === 'inline'`),
never on the presence of a `mode` key — the recipe arm may carry `mode: 'recipe'` as an
own key:

- **`WorkflowBodyCustomComfyRecipe`** (the default; `mode` omitted or `'recipe'`) — names a
  server-registered, code-reviewed recipe. A body written before the inline arm existed
  omits `mode` entirely and still lands here, unchanged.
- **`WorkflowBodyCustomComfyInline`** (`mode: 'inline'`) — the block ships the ComfyUI graph
  itself as `workflow`, with a declared `resources` AIR manifest and a `maxBuzz` ceiling
  that is **also the step timeout in seconds**. Server-side this arm is **page-token-only**,
  and code review is replaced by three fail-closed gates (AIR containment, entitlement, and a
  moderation sweep over every string leaf in the graph). 🔴 It is **not** app-developer-only —
  this line said it was, and nothing on either `customComfy` arm checks app-developer status,
  so an ordinary viewer of your published block can reach it. `WorkflowBodyCustomComfyInline`'s
  doc comment enumerates the refusals that DO run. A registered recipe is how you get a
  reviewed graph you do not have to ship in the body, not a way onto a surface inline cannot
  reach.

`WorkflowBody`'s `step` member is likewise a union of two arms, mirroring the host's
`blockStepMemberSchema`. Here the discriminator is the **presence of `step`**, so narrow with
`'$type' in body` (or `body.step === undefined`) — `kind === 'step'` alone leaves both arms:

- **`WorkflowBodyStep`** (`step` PRESENT) — names a **registered** step id (`'convert-image'`,
  `'chat-completion'`, …). The wire enum is derived from the host's step registry, so an
  unregistered id is rejected fail-closed at the schema, and `params` are validated by that
  step's own `.strict()` schema.
- **`WorkflowBodyPassThroughStep`** (`step` ABSENT) — names an **orchestrator `$type`** directly
  and the host forwards `input` unmodified. There is no registry lookup, no param schema, no
  prompt audit and no AIR scan; what bounds it is a denylist of platform-internal `$type`s
  (scanners, moderation classifiers, hashing/model ingestion, web egress), a 64-character
  `$type` cap, a 256 KB `input` cap, and `maxBuzz` — which, as on the inline arm, is **also the
  step timeout in seconds**.

```ts
import type { WorkflowBody } from '@civitai/app-sdk/blocks';

// Pass-through: note there is NO `step` key.
const body: WorkflowBody = {
  kind: 'step',
  $type: 'imageBackgroundRemoval',
  input: { image: imageUrl },
  maxBuzz: 10,
};
```

### `defineBlock` validator rules

**There is no rule list here, and that is the point.** `defineBlock` does not
maintain one: it compiles the vendored copy of the
[canonical schema](https://civitai.com/schemas/app-block/v1.json) with
[Ajv](https://ajv.js.org) and validates against **that**. Every `required`,
`enum`, `pattern`, bound, `additionalProperties` and `allOf` the canonical
expresses is enforced, and moves when the canonical moves. The schema is the
rule list; read it, or read the errors.

That is [#330](https://github.com/civitai/civitai-app-starters/issues/330)'s own
proposed fix. The previous implementation hand-mirrored the schema, and the
mirror diverged exactly as the issue predicted: it required 11 fields where the
canonical requires **five** (`blockId`, `version`, `name`, `contentRating`,
`scopes`), required `appId` — not a canonical property at all — and *required*
the SERVER-OWNED `iframe.src` that `civitai app submit` refuses, so it rejected
every `block.manifest.json` this repo ships.

On top of the schema, `defineBlock` applies exactly five extra rules, each
mirroring a server rejection the canonical states only in **prose**:

| Rule | The canonical prose it mirrors |
|---|---|
| a dev-set **`iframe.src`** is rejected | *"SERVER-OWNED. Do NOT set `iframe.src` — the platform assigns it."* The JSON-Schema `not` is deliberately absent; the top-level `allOf` `$comment` says the platform validator and the Go CLI reject it instead. |
| a dev-set **`trustTier`** is rejected | *"SERVER-OWNED … the platform assigns the trust tier during review."* Same shape. |
| **`iframe.sandbox`** rejects `allow-same-origin` and every `allow-top-navigation*` token | *"Never combine allow-same-origin with allow-scripts."* Top-navigation is refused because a block must route navigation through the `NAVIGATE` postMessage. |
| every **`scopeJustifications`** key must be a scope in `scopes` | *"The requirement is enforced imperatively by the manifest validator (not expressed as JSON-Schema conditionals here)."* |
| **`settings`** is validated against the W3 settings meta-schema | Not in the app-block schema at all — settings are validated server-side by `manifest-settings.meta.schema.ts`. |

Each is **strictly additive**: it can only reject a manifest Ajv accepted, never
relax a canonical rule. `test/manifest/divergences.test.ts` asserts exactly that
per entry — the fixture must be schema-VALID and `defineBlock`-REJECTED — and the
table and the fixture set must be the same set, so a sixth hand-written rule with
no entry fails the suite.

> **Passing is necessary, not sufficient**, and it is **not** a replacement for
> `civitai app validate` (the Go CLI's local pre-check against the same
> canonical). Run that before `civitai app submit`. `KNOWN_GAPS` in
> `src/manifest/defineBlock.ts` names each thing only the server can check —
> including one that cuts the *other* way: the canonical's sandbox description is
> an **allowlist** (*"Unverified tier allows only: allow-scripts, allow-forms"*)
> while the rule above is a denylist, so `allow-popups`, `allow-modals` and
> `allow-downloads` **pass here and may be refused at review**. The tier is
> assigned server-side, so it cannot be enforced locally.

**Where it runs.** Every scaffold that ships a `block.manifest.json`
(`starters/civitai-block-starter` and all six `starters/examples/*`) registers
`blockManifestPlugin` from `@civitai/app-sdk/vite` in its `vite.config.ts`. It
fires from Vite's `configResolved`, the one hook called on both the dev-server
and the build path — so `pnpm dev`, `pnpm dev:harness` and `pnpm build` all fail
loudly on a bad manifest, with the offending field path in the message. Add
`ajv` to your devDependencies (it is an optional peer):

```bash
pnpm add -D ajv
```

```ts
// vite.config.ts — drop this into your existing `defineConfig({ plugins: [...] })`.
import { blockManifestPlugin } from '@civitai/app-sdk/vite';

const plugins = [blockManifestPlugin()];
```

### Web storage in a block (`@civitai/app-sdk/safe-storage`)

Block iframes are sandboxed **without `allow-same-origin`**, so the document has
an *opaque origin*. There is no origin to key web storage against, and the
platform doesn't hand back an empty store — merely **reading** the property
throws:

```
SecurityError: Failed to read the 'localStorage' property from 'Window':
The document is sandboxed and lacks the 'allow-same-origin' flag.
```

> **The usual guard does not work here.** `typeof localStorage === 'undefined'`
> **also throws** in the sandbox — `typeof` still resolves the property and runs
> the throwing getter; only `typeof` of an *undeclared identifier* is safe.
> `'localStorage' in window` is the check that survives, and it returns `true`:
> the global exists, it's just unreadable.

Guarding your own call sites isn't enough anyway: **any dependency** that
touches storage unguarded takes the app down, and libraries routinely mislabel
the failure — one popular viewer catches the SecurityError and reports "your browser
does not support WebGL", so the app's own fallback never runs and the user
dead-ends on a wrong error message.

So the SDK repairs it for you. Importing `@civitai/app-sdk/blocks` (or
`@civitai/blocks-react`, which imports it) installs a spec-shaped in-memory
`Storage` over `localStorage` / `sessionStorage` — **only** when a real
round-trip probe shows they're unusable. Rules:

- **No-op where storage works.** A healthy `Storage` is never replaced, and its
  contents are never read or written (beyond a probe key it removes).
- **No-op where storage is absent** (Node / SSR / workers). Nothing is
  fabricated, so `typeof localStorage === 'undefined'` feature detection keeps
  working server-side.
- **Idempotent**, and safe to call as often as you like.
- **Never loses readable data.** A store that reads fine but refuses writes (a
  full quota, storage disabled) still gets replaced — writes have to stop
  throwing — but the fallback **inherits its entries first**, so the shim can't
  shadow a live session.
- **Never throws.** It installs at import, so an error escaping it would reject
  `import '@civitai/app-sdk/blocks'` and take the whole block down. Even a
  revoked `Proxy` or a throwing getter sitting on `localStorage` is classified,
  not propagated.
- The fallback is **session-scoped** — nothing survives a reload. That's the
  honest semantic at an opaque origin. Treat storage as a cache; use the
  platform's app-storage messages (`useAppStorage` in `@civitai/blocks-react`)
  for anything durable.

Most apps need to do nothing. Two cases where you reach for it explicitly:

```ts
// 1. A dependency reads storage while its module EVALUATES, and it's imported
//    before anything from the SDK. Import statements are hoisted above every
//    statement, so only another import can win the race — put this first in
//    your entry file.
import '@civitai/app-sdk/safe-storage';
```

```ts
// 2. Right before dynamically importing such a dependency.
import { installSafeStorage } from '@civitai/app-sdk/blocks';

installSafeStorage(); // no-op if already healthy
const { Viewer } = await import(viewerModuleSpecifier);
```

`installSafeStorage(scope?)` returns `{ localStorage, sessionStorage }` — `true`
for each global it actually replaced. `createMemoryStorage()` is exported too,
if you want the standalone `Storage` work-alike.

### Version compatibility

| `@civitai/app-sdk` | adds (blocks surface) |
|---|---|
| `0.27.0` | `@civitai/app-sdk/safe-storage` — opaque-origin `localStorage`/`sessionStorage` shim, auto-installed by the `blocks` subpath |
| `0.24.0` | `QUERY_APP_WORKFLOWS` / `CANCEL_APP_WORKFLOW` messages + the `AppWorkflow` type (app generator subqueue, PR #3164) |
| `0.7.0` | `CANCEL_WORKFLOW` / `WORKFLOW_CANCELED` messages (real cancel, gotcha #51) |
| `0.6.0` | `APP_STORAGE_*` messages, `ManifestSettings` types |
| `0.5.0` | settings types, earlier message set |

Pair with `@civitai/blocks-react` at the matching minor (it peer-depends on this
contract). See the blocks-react README's compatibility table.

## Minimal usage example

```ts
import {
  buildAuthorizeUrl, generatePkce, generateState,
  exchangeCode, fetchMe,
  TokenScope, bitmaskFromScopes,
  sealCookie, unsealCookie, buildSetCookieHeader,
  createOrchestratorClient, buildTextToImageBody,
  estimateWorkflow, submitWorkflow, pollWorkflow,
} from '@civitai/app-sdk';

// 1. Kick off OAuth login from your server-side handler
const { verifier, challenge } = generatePkce();
const state = generateState();
const scope = bitmaskFromScopes(['AIServicesWrite', 'BuzzRead', 'UserRead']);

// Persist { verifier, state, scope } against the user's session — e.g. in an
// encrypted cookie sealed with `sealCookie`. Then redirect to:
const authorizeUrl = buildAuthorizeUrl({
  clientId: process.env.CIVITAI_CLIENT_ID!,
  redirectUri: 'https://your-app.com/api/auth/callback/civitai',
  scope,
  state,
  codeChallenge: challenge,
});

// 2. In your callback handler, exchange the code for tokens
const tokens = await exchangeCode({
  clientId: process.env.CIVITAI_CLIENT_ID!,
  clientSecret: process.env.CIVITAI_CLIENT_SECRET, // omit for public clients
  redirectUri: 'https://your-app.com/api/auth/callback/civitai',
  code: codeFromQuery,
  codeVerifier: verifierFromSealedCookie,
  fallbackScope: scope, // used if the response's `scope` is absent or unreadable
});

// 3. Store tokens in an encrypted httpOnly cookie
const sealed = sealCookie(JSON.stringify(tokens), process.env.SESSION_SECRET!);
const setCookie = buildSetCookieHeader('civ_session', sealed, { maxAge: 3600 });

// 4. Use the token to make orchestrator calls
const client = createOrchestratorClient({ accessToken: tokens.access_token });
// fetchMe returns `unknown` — narrow it to the fields you read. Note `/api/v1/me`
// does NOT include Buzz balance; use `fetchBuzzAccount` (needs `BuzzRead`) for that.
const me = (await fetchMe({ accessToken: tokens.access_token })) as { username: string };
console.log(`Hi ${me.username}`);
```

> **Two base URLs.** The OAuth endpoints moved to a standalone auth hub, so
> `buildAuthorizeUrl` / `exchangeCode` / `refreshToken` / `revokeToken` default
> `baseUrl` to `https://auth.civitai.com`, while `fetchMe` (`/api/v1/me`) and
> `fetchBuzzAccount` (buzz tRPC) default to `https://civitai.com`. Pass an
> explicit `baseUrl` to each call only when targeting a local / self-hosted
> instance (e.g. a dev auth hub vs a dev main app).

> **`fallbackScope`, and what happens to a `scope` we cannot read.** Civitai's
> token endpoint returns `scope` as a decimal bitmask in a JSON *string*
> (`"scope": "114689"` — see the
> [endpoint reference](https://developer.civitai.com/site/oauth/endpoints)),
> matching the decimal `scope` `buildAuthorizeUrl` puts on the authorize URL,
> and that is what `exchangeCode` / `refreshToken` read. Anything that is not a
> whole number in `[0, 2**31-1]` is **not** used: `Number()` of
> [RFC 6749 §5.1](https://datatracker.ietf.org/doc/html/rfc6749#section-5.1)'s
> space-delimited form is `NaN`, and `NaN & anything` is `0`, so `hasScope()`
> would answer `false` for every scope and tell a user who just consented that
> they granted nothing. A wrong *type* is rejected on the same grounds:
> `Number(['65537'])` is `65537` and `Number(true)` is `1` (i.e.
> `TokenScope.UserRead`), so an un-guarded coercion would invent a
> valid-looking grant rather than fail. Such a value is replaced by
> `fallbackScope` and a warning naming the value received — not an exception,
> which on the token path would turn a degraded-but-working session into a hard
> login failure.
>
> Pass `fallbackScope: REQUESTED_SCOPES` on exchange and
> `fallbackScope: tokens.scope` on refresh — without it, either case resolves to
> `0`, and a caller that persists the whole refreshed token blob would lock the
> user out of features their token still grants. `fallbackScope` must itself be
> a whole number in `[0, 2**31-1]`; `NaN` (what `Number(stored.scope)` gives you
> on a half-populated store — and `??` does not catch it), a negative, a
> fraction or an over-ceiling value is **discarded in favour of `0`** with its
> own warning, rather than being handed back as the scope.
>
> **The two fallback paths are not equally sound.** An **omitted** `scope` is
> not a fault at all: RFC 6749 §5.1/§6 make it optional *precisely when the
> grant matches the request*, so the requested scope is the granted scope and
> `fallbackScope` is exactly right — that path is silent. A **present but
> unreadable** `scope` carries no such guarantee: the server is describing the
> grant in terms this SDK cannot read, and it may be a *reduced* grant, so
> falling back to the requested scope can **over-state** what the user granted.
> All four starters render `scopesFromBitmask(tokens.scope)` to the user as
> "Granted scopes", so the over-statement is user-visible. It is a deliberate
> trade (`0` and a thrown error are both worse here), which is why this path
> always warns — if you gate anything security-relevant on `tokens.scope`,
> treat that warning as "re-authenticate", not as noise.

```ts

// 5. Estimate cost, then submit
const body = buildTextToImageBody({ prompt: 'a fox' }, { tags: ['my-app'] });
const estimate = await estimateWorkflow(client, body);
console.log(`This will cost ${estimate.cost?.total ?? 0} Buzz`);
// ...show to user, get confirmation...
const submitted = await submitWorkflow(client, body);
const finished = await pollWorkflow(client, submitted.id, { timeoutMs: 30_000 });
```

`pollWorkflow` is a real **long poll**: it sends the orchestrator's `?wait=<seconds>` parameter (20s per attempt by default) so the request returns the moment the workflow ends, and re-arms across each 202 until the `timeoutMs` budget runs out. On the budget above that is ~2 requests rather than ~30. Pass `waitSeconds: 0` for the older immediate-read-per-`intervalMs` behaviour, and keep `timeoutMs` under your platform's request budget on serverless (see PORTING.md).

The starters in `civitai/civitai-app-starters` wire this into framework-specific route handlers (Next.js App Router, SvelteKit `+server.ts`, Hono inside a Vite-built PWA). Read those for end-to-end reference implementations.

## Choosing a workflow step type

The orchestrator is a workflow API: each request submits a list of typed steps. `WORKFLOW_STEP_TYPES` is the in-code catalog of every step `$type` it accepts, with a one-line description for each — `textToImage`, `imageGen`, `videoGen`, `comfy`, `customComfy`, `textToSpeech`, `aceStepAudio`, `transcription`, `imageUpscaler` among them (50 in total).

The catalog is pinned to the orchestrator's published OpenAPI spec two ways — an offline unit test against a transcribed copy of the spec's `WorkflowStepTemplate` discriminator mapping, and a CI job (`pnpm check:catalogs`) that re-fetches the live spec and diffs it. If a `$type` is listed here, the orchestrator accepts it.

Find the step you want, then pick a builder:

| Step type | Builder | When |
|---|---|---|
| `textToImage` | `buildTextToImageBody` | Diffusion checkpoints (SDXL / Flux.1 / Pony / SD1.5) via AIR URN |
| `imageGen` | `buildImageGenBody` | Engine-routed image gen — hosted third-party APIs (e.g. Nano Banana, Gemini, GPT-Image, Flux.1 Kontext, Seedream) and self-hosted engines (e.g. SDCpp, Comfy graphs). `IMAGE_GEN_ENGINES` is the authoritative list; this row is illustrative and deliberately not exhaustive. |
| Any other (`videoGen`, `comfy`, `textToSpeech`, `transcription`, …) | `buildWorkflowBody` | Generic single-step envelope — pass `{ $type, input }`, the SDK adds `name`/`timeout` defaults. |

For multi-step workflows, hand-build `{ tags?, steps: [step1, step2, ...] }` — no special envelope work beyond a JSON array.

**Reference-image gen (the Nano Banana / Gemini / Kontext use case):**

```ts
import { buildImageGenBody, estimateWorkflow, submitWorkflow } from '@civitai/app-sdk/orchestrator';

const body = buildImageGenBody({
  engine: 'google',
  model: 'nano-banana-2',
  prompt: 'turn this person into a cartoon sticker',
  images: ['data:image/png;base64,...', 'https://example.com/style-ref.jpg'],
  aspectRatio: '1:1',
  numImages: 1,
  resolution: '1K',
}, { tags: ['my-app'] });

const estimate = await estimateWorkflow(client, body);
console.log(`This will cost ${estimate.cost?.total ?? 0} Buzz`);
const submitted = await submitWorkflow(client, body);
```

Per-engine input shapes (`aspectRatio`, `resolution`, `numImages`, etc.) come from the OpenAPI spec at <https://orchestration.civitai.com/openapi/v2-consumers.json> — `ImageGenInput` is intentionally pass-through so new engine fields work without an SDK release.

## Typed step shapes (`@civitai/app-sdk/orchestrator/steps`)

`WORKFLOW_STEP_TYPES` tells you which `$type`s exist; the body builders above take `input: unknown`. This subpath is the other half: the real per-step input shapes, keyed by wire `$type` over the orchestrator's own generated client (`@civitai/client`) so they track the spec by codegen rather than by hand.

It is **type-only** — every export is a `type`, the built `dist/orchestrator/steps.js` is an empty module, and bundling it yields 0 bytes. Nothing is added to your runtime.

```ts
import { createOrchestratorClient, estimateWorkflow, submitWorkflow } from '@civitai/app-sdk/orchestrator';
import type { TypedWorkflowTemplate, WorkflowStepTemplateFor } from '@civitai/app-sdk/orchestrator/steps';

declare const accessToken: string;
const client = createOrchestratorClient({ accessToken });

// Fully typed — `$type` is a literal, and `input` is checked field by field.
// `cfgScale` and `seed` are REQUIRED on `textToImage`, which is easy to miss
// when hand-writing the body.
const step: WorkflowStepTemplateFor<'textToImage'> = {
  $type: 'textToImage',
  name: 'step_0',
  timeout: '00:10:00',
  input: {
    prompt: 'a fox in the snow',
    model: 'urn:air:sdxl:checkpoint:civitai:101055@128078',
    cfgScale: 5,
    seed: 1234,
    width: 1024,
    height: 1024,
  },
};

const body: TypedWorkflowTemplate = { steps: [step], tags: ['my-app'] };
const estimate = await estimateWorkflow(client, body);
const submitted = await submitWorkflow(client, body);
```

What it exports:

| Export | What |
|---|---|
| `WorkflowStepTemplates` | `$type` → template type, for 47 of the catalog's 50 step types. Keyed by the WIRE name, which the generated type names don't always match (`model3DPreview` → `Model3dPreviewStepTemplate`). |
| `WorkflowStepTemplateFor<'videoGen'>` | One step's template. |
| `WorkflowStepInputFor<'videoGen'>` | One step's `input` shape, without needing the generated `*Input` name. |
| `AnyWorkflowStepTemplate` | Discriminated union of all 47 mapped templates — `Extract<…, { $type: 'comfy' }>` and exhaustive `switch` work. `@civitai/client`'s base `WorkflowStepTemplate` has `$type` as a bare `string`, so it narrows nothing. |
| `TypedWorkflowTemplate` | The submit envelope with `steps` narrowed to that union. Pass it straight to `submitWorkflow` / `estimateWorkflow`. |

> 🔴 **The map is not total over the catalog, and that is the expected state.** `WORKFLOW_STEP_TYPES` documents 50 `$type`s; this map covers 47. The 3 with no generated template in the pinned `@civitai/client` are `imageScanning`, `preprocessVideo`, `yuE2`, and `WorkflowStepTemplateFor<…>` is a compile error for each of them.
>
> The two surfaces move independently on purpose: the catalog tracks the **live** orchestrator spec (a daily job syncs it), while these types track whatever `@civitai/client` was last published from. So the catalog runs ahead and the client catches up. The gap is never silent — `test/orchestrator/step-templates.test-d.ts` carries it as a `never` ledger plus one `@ts-expect-error` per gap `$type`, and `test/orchestrator/step-count-prose.test.ts` derives all four numbers (50, 47, 3, and the names) from `WORKFLOW_STEP_TYPES` and the map's own AST, then fails if this paragraph or its twin in `src/orchestrator/steps.ts` disagrees by one character.

The generated `*StepTemplate` and `*Input` types are **not** re-exported individually. Using this subpath already requires `@civitai/client` installed, so if you want one by name, import it straight from there — `import type { TextToImageStepTemplate } from '@civitai/client'`.

In practice `WorkflowStepTemplateFor<T>` and `WorkflowStepInputFor<T>` are the better route: they take the wire `$type` you already have, rather than the generated name you would otherwise have to go look up (`model3DPreview` → `Model3dPreviewStepTemplate`).

### Installing the peer

`@civitai/client` is an **optional peer dependency**, not a dependency: `@civitai/app-sdk` has an empty `dependencies` and this keeps it that way for every app that doesn't want the step types. Install it only if you import this subpath:

```sh
pnpm add -D @civitai/client@beta
```

> 🔴 **Use the `beta` tag, not `latest`.** `@civitai/client`'s npm `latest` dist-tag points at `0.1.1-beta.0`, roughly 97 betas behind the `beta` tag the orchestrator is actually generated against — and missing most of the step types above. A plain `pnpm add @civitai/client` installs the stale one with no error; the first symptom is `TextToImageStepTemplate` not existing.

> 🔴 **If the peer's types don't resolve, these types tell you — they used to just stop checking.** The unresolved `@civitai/client` import is in the SDK's shipped `steps.d.ts`, so `skipLibCheck: true` — the default for a TypeScript app, and set by every starter in this repo — suppresses the `TS2307` along with every other declaration-file diagnostic, and the types above degrade to an error type that behaves like `any`. Measured on a consumer with the peer uninstalled, against the subpath as it stood before the guard existed: **1 diagnostic** — a planted `const x: number = 's'` — on a project that also had a deliberately wrong `$type`. The wrong `$type` reported nothing.
>
> The subpath now carries a compile-time guard for exactly this. `keyof` over TypeScript's unresolved-import error type is `string | number | symbol`, not `any`, so `string extends keyof <template>` separates "resolved" from "not resolved" — it is `false` for all 47 generated templates (none has a string index signature; enumerated, not sampled) and `true` for the error type. When it fires, **all five exports above** collapse to a message type, so you get a `TS2322` **in your own file** naming the install command instead of silence. Same consumer with the guard: every annotation reports when the peer is missing, and when it is installed the output is the same, character for character, as the pre-guard build's. `test/orchestrator/steps-peer-guard.test.ts` pins both arms — and pins the export list itself, by reading the module's exported symbols through the TypeScript API and failing if any of them has no consumer file asserted to report, so a sixth export cannot arrive unguarded.

> 🔴 **Use `"moduleResolution": "Bundler"` for this subpath.** `@civitai/client@0.2.0-beta.98` is published with `"type": "module"`, no `exports` map, and extensionless relative re-exports (`export * from './generated'`), which Node's ESM resolution does not resolve. Under `NodeNext`/`Node16` the peer therefore degrades to the same error type *even when it is correctly installed* — measured: 1 diagnostic (the planted control alone) before the guard, and every annotation reporting afterwards. That arm is a test too, with the same directory compiled under `Bundler` as its control. Every starter in this repo, and this package itself, use `Bundler`.

### `currencies` is optional here, and required in the spec

`TypedWorkflowTemplate` makes `currencies` optional where the generated `WorkflowTemplate` has it required. The helpers in `@civitai/app-sdk/orchestrator` have never emitted it and every starter submits through them, so requiring it would break every existing caller for a field none of them sends.

The spec describes `currencies` as *"Limit the currencies that can be used to pay for this workflow."* — that is what the field does when it is **present**. What the orchestrator does when it is **omitted** is not verified, and the spec licenses no inference about it. Pass it explicitly if you want a workflow's payment scoped to particular currencies. This divergence is reasoned from the spec, this package's helpers and civitai's call sites — not from a live submit, which costs real Buzz.

### These are types, not permissions

A `$type` having a type here says nothing about whether you may submit it.

- **App Blocks** don't reach the orchestrator at all. A block posts a `WorkflowBody` to the host, which validates it server-side against its own schema. That contract is `@civitai/app-sdk/blocks` and is completely unaffected by this subpath.
- **Standalone apps / BFFs** submit directly with the user's OAuth token, and the orchestrator applies its own authorization. A body that compiles can still come back 400 or 403.

Several of the 47 exist to serve Civitai's own pipelines rather than third-party apps — `modelPickleScan`, `xGuardModeration`, `training`, `comfyNodepackSnapshot`, `qwenImageBench`, the `model*`/`media*` hashing and classification steps. They're in the consumer spec, so they're typed here. They are not an invitation.

Note that `WORKFLOW_STEP_TYPES` does **not** mark most of them: of its 50 entries exactly two — `comfyNodepackSnapshot` and `qwenImageBench` — sit under its "Platform internals" heading, and the rest are ordinary documented entries (`webScrape` even carries usage notes). The reason the platform steps are typed anyway is not that the catalog flags them as internal; it's that the catalog *documents* them, so skipping them would make `WorkflowStepTemplateFor<'training'>` a compile error for a step type the SDK documents — which is exactly what is live today for the 3 `$type`s the pinned client cannot type, and is why that gap is spelled out above rather than left to be discovered.

## Public vs. confidential clients

Civitai's OAuth server supports both:

- **Confidential** — your server holds `CIVITAI_CLIENT_SECRET`. Use this for any starter that has a server side at all (Next.js, SvelteKit, or PWAs with a BFF). This is what every current starter uses.
- **Public** — no `client_secret`, PKCE alone is the security boundary. Civitai's token endpoint supports CORS for browser-direct exchange. Useful for fully static PWAs. We don't currently ship a static-PWA starter; planned for a later milestone.

Pass `clientSecret` to `exchangeCode` / `refreshToken` / `revokeToken` for confidential, omit for public.

## Buzz mechanics (important)

When your app calls the orchestrator with a user's OAuth access token, the orchestrator debits **the user's Buzz**, not yours. This is the right tenant model for a third-party app, but it means:

1. **Request `AIServicesWrite` scope at consent time.** Without it the user can't grant their Buzz for generation.
2. **Show cost before spending.** Call `estimateWorkflow` first — it returns `cost.total` in Buzz without debiting. Display it. Let the user confirm.
3. **Show balance.** Request `BuzzRead` scope, then call Civitai's balance endpoint. Don't surprise users.
4. **Handle the cap-denial case.** Per-app spending caps (set by the user at consent and at Account → Connected Apps) can cause a successful `whatif` to be rejected at real submit time with a generic `BAD_REQUEST`. Treat that as "insufficient or denied" in your UI.

## TODOs / future work

- `scopes/index.ts` is hand-copied from `civitai/civitai`'s `src/shared/constants/token-scope.constants.ts`. Plan: replace with build-time codegen from `/.well-known/openid-configuration`.
- Add a `tokenStore/` abstraction so starters can plug in alternative storage (Redis, KV) without rewriting auth handlers.
- Static-PWA helpers for the public-client flow (browser-side token exchange via CORS, in-memory token storage, no refresh persistence).
