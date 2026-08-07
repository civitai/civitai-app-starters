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
| `cookies/*` — `sealCookie`, `unsealCookie`, `buildSetCookieHeader`, `readCookie` | AES-256-CTR encrypted cookie crypto. Use to seal a session blob (refresh token, expiry, scope) into an `httpOnly` cookie with zero external session store. |
| `orchestrator/*` — `createOrchestratorClient`, `estimateWorkflow`, `submitWorkflow`, `getWorkflow`, `pollWorkflow`, `buildTextToImageBody`, `buildImageGenBody`, `buildWorkflowBody`, `WORKFLOW_STEP_TYPES`, `IMAGE_GEN_ENGINES`, `isTerminal`, `extractImageUrls`, `OrchestratorError`, `WorkflowSnapshot`, `GenerateInput`, `ImageGenInput`, `WorkflowStepType`, `ImageGenEngine`, `DEFAULT_MODEL_AIR` | Orchestrator workflow glue — types, body builders, raw HTTP, and long-poll helper. Client + server safe (fetch-only). `estimateWorkflow` calls `?whatif=true` to preview Buzz cost without spending. `pollWorkflow` long-polls to terminal status. `WORKFLOW_STEP_TYPES` is the catalog of every step `$type` the orchestrator accepts. |
| `blocks/*` — `defineBlock`, `BlockManifestError`, `BLOCK_SCOPES`, `BLOCK_SCOPE_PATTERN`, `isMessage`, types (`BlockManifestV1`, `BlockContext`, `BlockToken`, `BlockSettings`, `ViewerInfo`, `ThemeInfo`, `BlockWorkflowSnapshot`, `BlockInitPayload`, `ParentToBlockMessage`, `BlockToParentMessage`, …) | Framework-agnostic contract for [Civitai Apps](https://github.com/civitai/civitai-app-starters/blob/main/docs/build-your-first-app-block.md). `defineBlock(config)` validates a `BlockManifestV1` at startup so authoring mistakes surface in `pnpm dev` instead of at `civitai app validate`/submit. Ships a byte-identical copy of the server-published canonical JSON Schema (draft 2020-12, https://civitai.com/schemas/app-block/v1.json) at the `./schemas/app-block/v1.json` subpath for offline validation; a CI drift-check keeps it in sync. Runtime-agnostic — no React or DOM types. Hooks and the iframe transport live in a separate package. |

## Subpath imports

```ts
import { defineBlock, BLOCK_SCOPES } from '@civitai/app-sdk/blocks';
// Opaque-origin storage shim — see "Web storage in a block" below:
import '@civitai/app-sdk/safe-storage';
// JSON Schema for the manifest, e.g. for IDE validation:
import manifestSchema from '@civitai/app-sdk/schemas/app-block/v1.json' with { type: 'json' };
```

## Civitai Apps contract (`@civitai/app-sdk/blocks`)

> Building a **Civitai App** (an iframe-embedded UI on a civitai.com page)? This
> subpath is the framework-agnostic contract — manifest types, scope strings,
> the `postMessage` protocol, and the `defineBlock` validator. The React hooks +
> transport that consume it live in
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
  `APP_STORAGE_*_RESULT`, `SUSPEND`, `RESUME`, `THEME_CHANGE`
  (`ParentToBlockMessage`).
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
  viewer: ViewerInfo | null;           // null = anonymous
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
| `defineBlock({ manifest })` | Validates a `BlockManifestV1` (subset of the server checks) and returns it. Call at module scope so authoring mistakes throw before mount. Throws `BlockManifestError` (has a `.field` dot-path). |
| `BLOCK_SCOPES` / `BLOCK_SCOPE_PATTERN` | The 15 known block scope strings (the authoritative enum `defineBlock` validates against) + the `domain:verb:target` format-helper regex. A scope is valid only if it's a member of `BLOCK_SCOPES`, matching the [canonical schema](https://civitai.com/schemas/app-block/v1.json). |
| `isMessage(data, type)` | Discriminator-only message narrowing (see above). |
| types | `BlockManifestV1`, `ManifestSettings` (+ field types), `BlockContext`, `ModelSlotContext`, `BlockCheckpointInfo`, `ShowcaseImage`, `BlockToken`, `WrappedToken`, `BlockSettings`, `ViewerInfo`, `Theme`, `WorkflowBody`, `BlockTextToImageParams`, `WorkflowBodyCustomComfy` (+ its two arms `WorkflowBodyCustomComfyRecipe` / `WorkflowBodyCustomComfyInline`, and `InlineComfyNode`), `BlockWorkflowSnapshot`, `WorkflowStatus`, `BlockInitPayload`, `ParentToBlockMessage`, `BlockToParentMessage`. |

`WorkflowBody`'s `customComfy` member is a discriminated union on `mode`, mirroring
the host's `blockCustomComfyMemberSchema`. Narrow on the VALUE (`body.mode === 'inline'`),
never on the presence of a `mode` key — the recipe arm may carry `mode: 'recipe'` as an
own key:

- **`WorkflowBodyCustomComfyRecipe`** (the default; `mode` omitted or `'recipe'`) — names a
  server-registered, code-reviewed recipe. A body written before the inline arm existed
  omits `mode` entirely and still lands here, unchanged.
- **`WorkflowBodyCustomComfyInline`** (`mode: 'inline'`) — the block ships the ComfyUI graph
  itself as `workflow`, with a declared `resources` AIR manifest and a `maxBuzz` ceiling
  that is **also the step timeout in seconds**. Server-side this arm is **app-developer-only
  and page-token-only**, and code review is replaced by three fail-closed gates (AIR
  containment, entitlement, and a moderation sweep over every string leaf in the graph). A
  registered recipe remains the way to reach every viewer.

### `defineBlock` validator rules

Mirrors a strict subset of the civitai/civitai server gate. It throws on:

- A missing **required** field: `$schema`, `appId`, `blockId`, `version`, `name`,
  `type`, `targets`, `scopes`, `iframe`, `contentRating`, `minApiVersion`.
- `$schema` ≠ `https://civitai.com/schemas/app-block/v1.json`.
- `blockId` not matching the canonical `/^[a-z][a-z0-9-]*[a-z0-9]$/` (DNS-subdomain-safe:
  lowercase, starts with a letter, ends alphanumeric) or outside 3–40 chars —
  the blockId becomes `<blockId>.civit.ai`; `version` not semver; `name` > 80 chars.
- `type` not `block` | `embed`; `contentRating` not `g|pg|pg13|r|x`.
- **Empty `scopes`** (must be a non-empty array) or any scope that isn't one of
  the 15 known block scopes (`BLOCK_SCOPES`). The [canonical schema](https://civitai.com/schemas/app-block/v1.json)
  validates `scopes` by **enum membership**, so a well-formed but unknown scope
  (e.g. `models:read:all`) is rejected; PascalCase like `ModelsReadSelf` gets a
  pointed error.
- **Empty `targets`**, or a target with a non-string `slotId` / non-integer `priority`.
- `iframe.src` not https (http only for `localhost`/`127.0.0.1`/`[::1]`/`*.localhost`);
  a banned sandbox token (`allow-same-origin`, any `allow-top-navigation*`);
  non-positive integer `minHeight`; bad `maxHeight`; non-boolean `resizable`.
- `settings` with a bad key (must be `snake_case`), > 32 fields, or a field
  missing/mis-typed `scope` / `type` / `label` / `description`.

> The validator does **not** check that `iframe.src` hostname equals
> `<blockId>.<APPS_DOMAIN>` or that the path is root — those are enforced
> **server-side** at submit time (gotcha #33). Keep `iframe.src` =
> `https://<blockId>.civit.ai/` (root, no path prefix) and your Vite `base: '/'`.

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

The orchestrator is a workflow API: each request submits a list of typed steps. `WORKFLOW_STEP_TYPES` is the in-code catalog of every step `$type` it accepts, with a one-line description for each — `textToImage`, `imageGen`, `videoGen`, `comfy`, `textToSpeech`, `aceStepAudio`, `transcription`, `imageUpscaler`, and ~25 more.

Find the step you want, then pick a builder:

| Step type | Builder | When |
|---|---|---|
| `textToImage` | `buildTextToImageBody` | Diffusion checkpoints (SDXL / Flux.1 / Pony / SD1.5) via AIR URN |
| `imageGen` | `buildImageGenBody` | Closed-source image-gen APIs — Nano Banana, Gemini, GPT-Image, Flux.1 Kontext, Flux.2, Seedream, Grok, fal. `IMAGE_GEN_ENGINES` lists the engines. |
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
