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
| `blocks/*` — `defineBlock`, `BlockManifestError`, `BLOCK_SCOPES`, `BLOCK_SCOPE_PATTERN`, `isMessage`, types (`BlockManifestV1`, `BlockContext`, `BlockToken`, `BlockSettings`, `ViewerInfo`, `ThemeInfo`, `BlockWorkflowSnapshot`, `BlockInitPayload`, `ParentToBlockMessage`, `BlockToParentMessage`, …) | Framework-agnostic contract for [Civitai App Blocks](https://github.com/civitai/civitai-app-starters/blob/main/docs/build-your-first-app-block.md). `defineBlock(config)` validates a `BlockManifestV1` at startup so authoring mistakes surface in `pnpm dev` instead of at `civitai app validate`/submit. Ships the JSON Schema (draft-07) at the `./schemas/app-block/v1.json` subpath for offline validation. Runtime-agnostic — no React or DOM types. Hooks and the iframe transport live in a separate package. |

## Subpath imports

```ts
import { defineBlock, BLOCK_SCOPES } from '@civitai/app-sdk/blocks';
// JSON Schema for the manifest, e.g. for IDE validation:
import manifestSchema from '@civitai/app-sdk/schemas/app-block/v1.json' with { type: 'json' };
```

## App Blocks contract (`@civitai/app-sdk/blocks`)

> Building an **App Block** (an iframe-embedded UI on a civitai.com page)? This
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
  `APP_STORAGE_*_RESULT`, `SUSPEND`, `RESUME` (`ParentToBlockMessage`).
- **block → parent**: `BLOCK_READY`, `BLOCK_ERROR`, `REQUEST_TOKEN`,
  `RESIZE_IFRAME`, `SUBMIT_WORKFLOW`, `ESTIMATE_WORKFLOW`, `POLL_WORKFLOW`,
  `OPEN_BUZZ_PURCHASE`, `OPEN_CHECKPOINT_PICKER`, `SET_USER_CHECKPOINT`,
  `NAVIGATE`, `TRACK_EVENT`, `APP_STORAGE_*` (`BlockToParentMessage`).

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
| `BLOCK_SCOPES` / `BLOCK_SCOPE_PATTERN` | The known block scope strings + the `domain:verb:target` regex. |
| `isMessage(data, type)` | Discriminator-only message narrowing (see above). |
| types | `BlockManifestV1`, `ManifestSettings` (+ field types), `BlockContext`, `ModelSlotContext`, `BlockCheckpointInfo`, `ShowcaseImage`, `BlockToken`, `WrappedToken`, `BlockSettings`, `ViewerInfo`, `Theme`, `WorkflowBody`, `BlockTextToImageParams`, `BlockWorkflowSnapshot`, `WorkflowStatus`, `BlockInitPayload`, `ParentToBlockMessage`, `BlockToParentMessage`. |

### `defineBlock` validator rules

Mirrors a strict subset of the civitai/civitai server gate. It throws on:

- A missing **required** field: `$schema`, `appId`, `blockId`, `version`, `name`,
  `type`, `targets`, `scopes`, `iframe`, `contentRating`, `minApiVersion`.
- `$schema` ≠ `https://civitai.com/schemas/app-block/v1.json`.
- `blockId` not matching `/^[a-z0-9-]{3,64}$/`; `version` not semver; `name` > 80 chars.
- `type` not `block` | `embed`; `contentRating` not `g|pg|pg13|r|x`.
- **Empty `scopes`** (must be a non-empty array) or any scope not matching
  `domain:verb:target` lowercase — PascalCase like `ModelsReadSelf` gets a
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

### Version compatibility

| `@civitai/app-sdk` | adds (blocks surface) |
|---|---|
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

// 5. Estimate cost, then submit
const body = buildTextToImageBody({ prompt: 'a fox' }, { tags: ['my-app'] });
const estimate = await estimateWorkflow(client, body);
console.log(`This will cost ${estimate.cost?.total ?? 0} Buzz`);
// ...show to user, get confirmation...
const submitted = await submitWorkflow(client, body);
const finished = await pollWorkflow(client, submitted.id, { timeoutMs: 30_000 });
```

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
2. **Show cost before spending.** Call `estimateCost` first — it returns `cost.total` in Buzz without debiting. Display it. Let the user confirm.
3. **Show balance.** Request `BuzzRead` scope, then call Civitai's balance endpoint. Don't surprise users.
4. **Handle the cap-denial case.** Per-app spending caps (set by the user at consent and at Account → Connected Apps) can cause a successful `whatif` to be rejected at real submit time with a generic `BAD_REQUEST`. Treat that as "insufficient or denied" in your UI.

## TODOs / future work

- `scopes/index.ts` is hand-copied from `civitai/civitai`'s `src/shared/constants/token-scope.constants.ts`. Plan: replace with build-time codegen from `/.well-known/openid-configuration`.
- Add a `tokenStore/` abstraction so starters can plug in alternative storage (Redis, KV) without rewriting auth handlers.
- Static-PWA helpers for the public-client flow (browser-side token exchange via CORS, in-memory token storage, no refresh persistence).
