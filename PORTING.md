# Porting an existing app to Civitai OAuth + `@civitai/app-sdk`

You already have an app. You want to:

- **Add "Sign in with Civitai"** — let users connect their Civitai account so your app can spend *their* Buzz on *their* generations.
- **Swap or supplement your current image-gen provider** (Gemini, OpenAI, Replicate, fal, …) with Civitai's orchestrator — same OAuth token, hundreds of models, no per-app cost to you.

This guide walks through both. It assumes you've already read the [main README](./README.md) and just want the porting recipe for an existing codebase — not a fresh clone of a starter.

> The four starters in [`starters/*`](./starters) are *the reference implementation*. When this doc says "do X like the SvelteKit starter does," you can copy verbatim. The patterns below are stack-agnostic; concrete code lives in the starters.

---

## TL;DR

1. `pnpm add @civitai/app-sdk`
2. Register an OAuth app at <https://civitai.com/user/account> → **OAuth Apps** → **Create** (confidential client, redirect URI `https://your-app/api/auth/callback/civitai`).
3. Add four server-side routes: `/api/auth/login`, `/api/auth/callback/civitai`, `/api/auth/logout`, `/api/auth/revoke`.
4. Add an encrypted-cookie session helper (use SDK's `sealCookie`/`unsealCookie`).
5. Read the session in your auth middleware. Refresh tokens transparently when they're <30s from expiry.
6. To call the orchestrator: `createOrchestratorClient({ accessToken: session.tokens.access_token })` → `estimateWorkflow` → show cost → `submitWorkflow` → poll.

That's it. The SDK is ~30 lines of plumbing per framework — the starters' framework adapters are literally that small.

---

## Pick your integration mode

Two ways to integrate, with different scope:

### Mode A — "Sign in with Civitai" as an additional provider

Your app keeps its current auth (email/password, Google, magic links, whatever). You **add** Civitai as one more provider. After a user connects, their session also holds Civitai OAuth tokens, and your app can call the orchestrator on their behalf.

**Pick this when:** you don't want to disturb existing users / sessions, you want to A/B Civitai-powered generation against your current provider, or your app's identity isn't tied to image generation (Civitai is just the gen backend).

**Auth model:** Civitai tokens are stored *alongside* your existing session, scoped to a single user row in your DB. The user can connect/disconnect Civitai without losing their account.

### Mode B — Civitai is the *only* auth provider

You rip out your current auth. Civitai OAuth becomes the login. Your app has no password DB, no email verification, no JWT-of-your-own — just an encrypted session cookie holding Civitai tokens.

**Pick this when:** the app is generation-first, your user base is happy to log in with Civitai, you don't want to maintain auth infra. This is what every starter in this repo does.

**Auth model:** session cookie *is* the Civitai token blob. No DB needed for auth.

The recipes below cover both. Mode A is additive; Mode B is what the starters demonstrate end-to-end.

---

## Step 1 — Install and configure

```bash
pnpm add @civitai/app-sdk
```

Register an OAuth app:

1. <https://civitai.com/user/account> → **OAuth Apps** → **Create**.
2. **Confidential** client (every starter is confidential; the BFF holds the secret).
3. Redirect URI: `https://your-app.com/api/auth/callback/civitai` (and a localhost variant for dev).
4. Copy the client id + secret.

Add to `.env`:

```bash
CIVITAI_CLIENT_ID=...
CIVITAI_CLIENT_SECRET=...
# 32+ char hex string. Used to AES-encrypt session cookies.
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_SECRET=...
# Your app's public URL. Used to build the redirect_uri.
APP_URL=http://localhost:3000
# Auth hub — OAuth endpoints (authorize / token / revoke) live here.
CIVITAI_AUTH_URL=https://auth.civitai.com
# Main app — ONLY /api/v1/me and tRPC/buzz calls (NOT oauth). Override only for
# self-hosted Civitai instances.
CIVITAI_BASE_URL=https://civitai.com
ORCHESTRATOR_URL=https://orchestration.civitai.com
```

Civitai's auth server was broken out into a standalone hub, so the base URL is
split in two: OAuth endpoints target `CIVITAI_AUTH_URL` (default
`https://auth.civitai.com`), while `/api/v1/me` and any tRPC/buzz calls stay on
`CIVITAI_BASE_URL` (default `https://civitai.com`). The orchestrator has always
been separate (`ORCHESTRATOR_URL`).

**Never** put `CIVITAI_CLIENT_SECRET` in client-side bundles, `next.config.js`'s `env` block, Vite's `import.meta.env`, or anywhere shipped to the browser. The token exchange runs server-side only.

---

## Step 2 — Pick your scopes

Scopes are bitmask flags. For the standard "generate images on the user's behalf" flow:

```ts
import { bitmaskFromScopes } from '@civitai/app-sdk/scopes';

export const REQUESTED_SCOPES = bitmaskFromScopes([
  'UserRead',         // /api/v1/me + /userinfo — username, id, email, profile photo (always granted)
  'BuzzRead',         // buzz.getUserAccount — the user's Buzz balance (NOT on /api/v1/me)
  'AIServicesRead',   // history of past generations
  'AIServicesWrite',  // submit generations / spend Buzz on orchestrator
]);
```

The full list and what each does is in [`packages/civitai-app-sdk/src/scopes/index.ts`](./packages/civitai-app-sdk/src/scopes/index.ts). Pick the minimum your app needs — users see this on the consent screen.

---

## Step 3 — Build the four auth routes

The SDK is framework-agnostic; you write a thin adapter for whatever HTTP layer you have (Express, Hono, Next.js Route Handlers, SvelteKit `+server.ts`, Fastify, Astro endpoints, …). The shape is identical everywhere.

The example below is pseudocode. See the starter for your framework for the real thing:

| Framework | Look at |
|---|---|
| Next.js App Router | [`starters/next-app/src/app/api/auth/**`](./starters/next-app/src/app/api/auth) |
| SvelteKit | [`starters/sveltekit-app/src/routes/api/auth/**`](./starters/sveltekit-app/src/routes/api/auth) |
| Vite + React (Hono BFF) | [`starters/react-pwa/server/**`](./starters/react-pwa/server) |
| Vite + Svelte (Hono BFF) | [`starters/svelte-pwa/server/**`](./starters/svelte-pwa/server) |

### 3a. `POST /api/auth/login` — kick off

```ts
import { buildAuthorizeUrl, generatePkce, generateState, sealCookie, buildSetCookieHeader } from '@civitai/app-sdk';

const pkce = generatePkce();
const state = generateState();

// Seal {state, verifier, scope} into a short-lived (10 min) httpOnly cookie.
// This is what the callback handler reads back to verify the round-trip.
const stateCookie = sealCookie(
  JSON.stringify({ state, verifier: pkce.verifier, scope: REQUESTED_SCOPES }),
  process.env.SESSION_SECRET!,
);
setResponseCookie('civ_oauth_state', stateCookie, { httpOnly: true, maxAge: 600, secure: true, sameSite: 'lax' });

const authorizeUrl = buildAuthorizeUrl({
  baseUrl: process.env.CIVITAI_AUTH_URL ?? 'https://auth.civitai.com',
  clientId: process.env.CIVITAI_CLIENT_ID!,
  redirectUri: `${process.env.APP_URL}/api/auth/callback/civitai`,
  scope: REQUESTED_SCOPES,
  state,
  codeChallenge: pkce.challenge,
});

return redirect(303, authorizeUrl);
```

### 3b. `GET /api/auth/callback/civitai` — exchange the code

```ts
import { exchangeCode, OAuthError, sealCookie, unsealCookie } from '@civitai/app-sdk';

const code = url.searchParams.get('code');
const state = url.searchParams.get('state');

// Read + consume (delete) the short-lived state cookie set in 3a.
const sealed = readCookie('civ_oauth_state');
deleteCookie('civ_oauth_state');
const expected = JSON.parse(unsealCookie(sealed, process.env.SESSION_SECRET!));

if (expected.state !== state) return redirect('/?error=state_mismatch');

try {
  const tokens = await exchangeCode({
    baseUrl: process.env.CIVITAI_AUTH_URL,
    clientId: process.env.CIVITAI_CLIENT_ID!,
    clientSecret: process.env.CIVITAI_CLIENT_SECRET, // omit for public clients
    redirectUri: `${process.env.APP_URL}/api/auth/callback/civitai`,
    code,
    codeVerifier: expected.verifier,
  });

  // Tokens now go into the long-lived session cookie. See Step 4.
  writeSession({ tokens });

  return redirect('/');
} catch (err) {
  if (err instanceof OAuthError) return redirect(`/?error=token_exchange:${err.status}`);
  return redirect('/?error=token_exchange_failed');
}
```

### 3c. `POST /api/auth/logout` — local-only sign-out

```ts
deleteCookie('civ_session');
return json({ ok: true });
```

This only clears the local cookie. The Civitai token is still valid until it expires or you call revoke (3d).

### 3d. `POST /api/auth/revoke` — true disconnect

```ts
import { revokeToken } from '@civitai/app-sdk';

// The cookie AS STORED (unseal + parse, no expiry check, no refresh).
const session = parseSessionCookie();
if (session?.tokens) {
  // Best-effort: revoke both. If revoke fails, we still clear locally.
  await revokeToken({ ...civitaiOpts, token: session.tokens.access_token }).catch(() => {});
  await revokeToken({ ...civitaiOpts, token: session.tokens.refresh_token }).catch(() => {});
}
deleteCookie('civ_session');
return json({ ok: true });
```

Read the tokens from the stored cookie, not from the session reader that refreshes (Step 4). That reader answers "signed out" for a request whose refresh failed for a transient reason, so revoking what it returns skips the upstream revoke while the cookie is still cleared, and the refresh token stays live at Civitai. Do not refresh on the sign-out routes at all: a refresh there mints tokens only to throw them away. The starters skip them in the code that refreshes (`SIGN_OUT_PATHS`).

---

## Step 4 — Session storage

The encrypted-cookie pattern is the *only* thing every starter does for sessions. No Redis, no Postgres-session-table, no JWT-with-your-own-secret.

The session has two halves, and they run in different places:

- **`readSession()` only reads.** It never sets or deletes a cookie, so it is safe anywhere — including a Next.js Server Component, where any cookie write throws.
- **`refreshSession()` refreshes an expiring access token and writes the result.** It sets or deletes the cookie, so run it only where your framework lets you write response cookies, once per request, before anything calls `readSession()`.

`getCookie` / `setCookie` / `deleteCookie` stand for your framework's cookie functions.

```ts
import {
  sealCookie,
  unsealCookie,
  refreshToken as oauthRefresh,
  OAuthError,
  type OAuthTokens,
} from '@civitai/app-sdk';

interface Session {
  tokens: OAuthTokens;
  // Add your own fields here if you want, e.g. user-prefs read from /api/v1/me
}

const SESSION_COOKIE = 'civ_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function writeSession(session: Session) {
  const sealed = sealCookie(JSON.stringify(session), process.env.SESSION_SECRET!);
  setCookie(SESSION_COOKIE, sealed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  });
}

/** Decode the cookie. Null if absent, tampered, sealed with another key, or not JSON. */
function parseSession(): Session | null {
  const sealed = getCookie(SESSION_COOKIE);
  if (!sealed) return null;
  const raw = unsealCookie(sealed, process.env.SESSION_SECRET!);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

/** True when the access token is within 30s of expiring. */
function needsRefresh(session: Session): boolean {
  return session.tokens.expires_at <= Date.now() + 30_000;
}

/**
 * READ-ONLY: never writes a cookie, never calls the network. Returns null when
 * signed out, or when the token still needs a refresh that `refreshSession()`
 * did not complete (treat that as signed out for this request).
 */
export function readSession(): Session | null {
  const session = parseSession();
  if (!session || needsRefresh(session)) return null;
  return session;
}

/**
 * WRITES COOKIES. Call only where response cookies may be set (see the wiring
 * list below), before any `readSession()` in the same request.
 */
export async function refreshSession(): Promise<void> {
  const session = parseSession();
  // Nothing to refresh. An unreadable cookie is left alone on purpose, so a
  // secret rotation does not emit a Set-Cookie on every request.
  if (!session || !needsRefresh(session)) return;

  if (!session.tokens.refresh_token) {
    deleteCookie(SESSION_COOKIE); // expired, and nothing can renew it
    return;
  }

  try {
    const tokens = await oauthRefresh({
      baseUrl: process.env.CIVITAI_AUTH_URL,
      clientId: process.env.CIVITAI_CLIENT_ID!,
      clientSecret: process.env.CIVITAI_CLIENT_SECRET,
      refreshToken: session.tokens.refresh_token,
      // The refreshed tokens REPLACE the stored ones. A token response may omit
      // `scope` (RFC 6749 §6), and without this it would be stored as 0.
      fallbackScope: session.tokens.scope,
    });
    writeSession({ ...session, tokens });
  } catch (err) {
    // Clear only when the auth server rejected the REFRESH TOKEN itself: an
    // RFC 6749 error body whose `error` is `invalid_grant` (unknown, expired,
    // revoked or already spent). Read the body, not the status. A 5xx, a 429 or
    // a network error says nothing about the credential, and `invalid_client`
    // (a 400 or a 401) means YOUR client id or secret was refused, which would
    // sign out every user at once. Keep the cookie for all of those so the next
    // request retries.
    if (isDefiniteRejection(err)) deleteCookie(SESSION_COOKIE);
  }
}

/** True only for an `invalid_grant` answer from the token endpoint. */
function isDefiniteRejection(err: unknown): boolean {
  return (
    err instanceof OAuthError &&
    typeof err.body === 'object' &&
    err.body !== null &&
    (err.body as { error?: unknown }).error === 'invalid_grant'
  );
}
```

Call `refreshSession()` from a hook that runs before your handlers and may set response cookies, then read with `readSession()` everywhere else:

- **Next.js** → refresh in `proxy.ts` (Next.js 16's name for `middleware.ts`), never in a Server Component. There, the cookie functions are the request's and response's cookies: a refresh must update **both** `request.cookies` (what this render reads) and the response's cookies (what the browser keeps). [`starters/next-app/src/proxy.ts`](./starters/next-app/src/proxy.ts) shows that request-and-response pairing in full. Server Components and route handlers then call `readSession()`. `cookies()` is async in Next.js 16, so resolve the store first (`const jar = await cookies()`) and back `getCookie` with `jar.get(name)?.value`, or make your read helper async the way `getSession()` in [`starters/next-app/src/lib/session.ts`](./starters/next-app/src/lib/session.ts) is.
- **SvelteKit** → `hooks.server.ts`: in `handle`, refresh through `event.cookies`, then set `event.locals.session = readSession()`. ([`starters/sveltekit-app/src/hooks.server.ts`](./starters/sveltekit-app/src/hooks.server.ts) does both in one call, `readSession(event.cookies, …)`, which refreshes in place; that is legal there because `handle` may set cookies.)
- **Hono / Express** → a middleware that refreshes first, then sets `c.set('session', …)` / `req.session`.

See the starter for your framework for the exact cookie wiring. The four standalone starters (`next-app`, `sveltekit-app`, `react-pwa`, `svelte-pwa`) follow the same rule, and add what the recipe above leaves out. Each carries the same `refresh-tokens.ts` (`src/lib/` in next-app and sveltekit-app, `server/` in the PWAs), which adds four things:

- **Single flight.** Concurrent requests with one cookie share one refresh call.
- **A 60 s reuse window.** A request that still carries the pre-rotation cookie gets the rotated tokens instead of replaying a refresh token the server already spent. Signing out forgets it (`forgetRefreshesFor`), and a request still waiting on a refresh when its session signs out gets a `SessionEndedError` (which clears its cookie) instead of the refreshed tokens.
- **A 5 s backoff.** After a failure that keeps the cookie, the rate-limited token endpoint is not called on every request.
- **A 10 s cap** on how long a request waits for a refresh.

If your auth server rotates refresh tokens and your pages make parallel requests, copy that file rather than calling `refreshToken()` directly. It dedupes within one server process only; several instances can still race, and closing that needs a shared store or a replay grace period on the auth server.

### Mode A note (additive auth)

If you're keeping your existing auth, attach the Civitai session blob *to your existing user row* rather than replacing the session cookie:

```ts
// e.g. in your `users` table:
ALTER TABLE users ADD COLUMN civitai_tokens TEXT; // sealed JSON

// On callback:
await db.update(users)
  .set({ civitai_tokens: sealCookie(JSON.stringify(tokens), SESSION_SECRET) })
  .where(eq(users.id, currentUser.id));

// On orchestrator call:
const sealed = await loadUser(id).then(u => u.civitai_tokens);
const session: Session = JSON.parse(unsealCookie(sealed, SESSION_SECRET));
```

Refresh the same way as `refreshSession()` above (pass `fallbackScope`, clear only on an `invalid_grant` `OAuthError`), but write the refreshed blob back to the DB instead of setting a cookie. A DB write is not a cookie write, so this one may run wherever you load the user.

---

## Step 5 — Call the orchestrator

```ts
import {
  createOrchestratorClient,
  buildTextToImageBody,
  estimateWorkflow,
  submitWorkflow,
  pollWorkflow,
  extractImageUrls,
  isTerminal,
  OrchestratorError,
} from '@civitai/app-sdk/orchestrator';

const client = createOrchestratorClient({
  accessToken: session.tokens.access_token,
  baseUrl: process.env.ORCHESTRATOR_URL,
});

const body = buildTextToImageBody(
  { prompt: 'a fox in a red hat', width: 1024, height: 1024 },
  { tags: ['my-app'] },
);

// 1. Cost preview — runs validation + pricing, debits no Buzz.
const estimate = await estimateWorkflow(client, body);
const buzzCost = estimate.cost?.total ?? 0;
// Render `buzzCost` to the user. Let them confirm.

// 2. Submit — debits the user's Buzz.
const submitted = await submitWorkflow(client, body);

// 3. Poll. Either block in the handler (long-poll) or return the workflowId
//    to the client and let them poll a `GET /api/workflow/[id]` endpoint.
const finished = await pollWorkflow(client, submitted.id, { timeoutMs: 30_000 });

if (isTerminal(finished) && finished.status === 'succeeded') {
  const urls = extractImageUrls(finished);
  // Return URLs to client or proxy/cache them.
}
```

### When `buildTextToImageBody` isn't enough

`textToImage` is the diffusion-checkpoint (SDXL / Flux.1 / Pony / SD1.5) path. For closed-source image-gen APIs (Nano Banana, Gemini, GPT-Image, Flux.1 Kontext, Flux.2, Seedream, …) use `buildImageGenBody`:

```ts
import { buildImageGenBody, estimateWorkflow, submitWorkflow } from '@civitai/app-sdk/orchestrator';

// Nano Banana 2 with a reference image — what Gemini-based apps usually want.
const body = buildImageGenBody({
  engine: 'google',
  model: 'nano-banana-2',
  prompt: 'turn this into a cartoon sticker',
  images: ['data:image/png;base64,...'],
  aspectRatio: '1:1',
  numImages: 1,
  resolution: '1K',
}, { tags: ['my-app'] });

const estimate = await estimateWorkflow(client, body);
const submitted = await submitWorkflow(client, body);
```

`IMAGE_GEN_ENGINES` lists every accepted engine; per-engine input fields come from the OpenAPI spec. The input is intentionally pass-through — new fields work without an SDK release.

For other step types (`videoGen`, `comfy`, `textToSpeech`, `transcription`, `imageUpscaler`, …) use `buildWorkflowBody`:

```ts
import { buildWorkflowBody } from '@civitai/app-sdk/orchestrator';

const body = buildWorkflowBody({
  $type: 'videoGen',
  input: { engine: 'veo3', prompt: 'a fox jumping', duration: 8 },
}, { tags: ['my-app'] });
```

`WORKFLOW_STEP_TYPES` is the in-code catalog of every step type with one-line descriptions — start there to find the right step before reaching for the OpenAPI spec at <https://orchestration.civitai.com/openapi/v2-consumers.json>. It is machine-checked against that spec (`pnpm check:catalogs` in CI plus an offline unit test), so a `$type` it lists is one the orchestrator accepts.

### Buzz mechanics (always read this)

When your app submits an orchestrator workflow with a user's OAuth access token, the orchestrator debits **the user's Buzz**, not yours. This is the right tenant model for a third-party app, but it has consequences:

1. **Request `AIServicesWrite` scope at consent time.** Without it the user can't grant their Buzz for generation.
2. **Show cost before spending.** Always call `estimateWorkflow` first.
3. **Show the running balance — from the BUZZ endpoint, not `/api/v1/me`.** 🔴 `/api/v1/me` does **not** return a balance and never has; reading `balance` off it yields `undefined`, which is exactly how all four starters shipped a permanent `Buzz balance: —`. Use the SDK's `fetchBuzzAccount()` (`buzz.getUserAccount`, needs `BuzzRead`) **server-side** — that tRPC route sets no CORS headers, so a browser fetch cannot reach it. And note the decoy: `/api/v1/me` *does* return `buzzLimit`, but that is the per-token **spend cap** chosen at consent, **not** a balance. 🔴 `BuzzRead` is not guaranteed to a third-party client: treat a **403 as an ordinary outcome** and hide the balance row entirely — never a dash, never an error banner. Don't surprise users.
4. **Handle the cap-denial case.** Per-app spending caps (set by the user at consent and again at Account → Connected Apps) can cause a successful `whatif` to be rejected at real submit time with a generic `BAD_REQUEST`. Treat that as "insufficient or denied" in your UI — surface clearly, link the user to their connected-apps page.
5. **Don't hoard tokens.** Refreshing once per request in a hook (Step 4's `refreshSession()`) keeps the user's session warm without you treating their access_token like a resource to optimize. Revoke on disconnect.

---

## Step 6 — Replace your existing image-gen calls

If you're swapping from a non-Civitai provider (Gemini, OpenAI Images, Replicate, fal, …), the typical mapping looks like this:

| Your existing code | Civitai replacement |
|---|---|
| Single function `generateImage(prompt, refs?)` that returns base64 | `createOrchestratorClient` → `submitWorkflow` → `pollWorkflow` → `extractImageUrls`. Two-step (submit then poll) instead of one-shot. |
| API key in `.env` (`OPENAI_API_KEY`, `GEMINI_API_KEY`) | Per-user OAuth `access_token` from session. **Different tenant model.** |
| You pay per image | The user pays in Buzz. **Cost preview is mandatory UX.** |
| Inline base64 image bytes | URLs from `extractImageUrls`. Download/cache server-side if you need persistence. |
| Reference images via `inlineData` parts (Gemini) or `image_url` (OpenAI) | `buildImageGenBody({ engine: 'google', model: 'nano-banana-2', images: [...] })` for Nano Banana / Gemini-style. `flux1-kontext` for Flux-based image editing. `comfy` step for full graph control. |
| Single model identifier (`gemini-3.1-flash-image-preview`) | AIR URN (`urn:air:sdxl:checkpoint:civitai:101055@128078`). Use `DEFAULT_MODEL_AIR` for SDXL base, or browse <https://civitai.com/models> and grab the URN. |

The two big shape differences:

- **Async, not sync.** Civitai's orchestrator returns a workflow id immediately and you poll. Either block your handler (`pollWorkflow` with a timeout) or return the workflowId to the client and let it poll a `GET /api/workflow/[id]` endpoint. The starters do the latter.
- **Per-user Buzz.** Plan the UX. If your previous provider was free-to-the-user (you ate the cost), you now need a balance display (via `fetchBuzzAccount()`, and degrading to no display when `BuzzRead` is absent), cost preview, and graceful insufficient-Buzz handling. If your previous provider already had user-visible cost (credits / tokens), the lift is smaller.

---

## Step 7 — Verify

There's no single "is it ported correctly" check, but the smoke test that every starter passes end-to-end is:

1. Click "Sign in with Civitai" → consent screen → redirected back logged in.
2. `/api/v1/me` returns your username. (🔴 It returns **no balance** — the balance comes from `fetchBuzzAccount()` / `buzz.getUserAccount`, and is absent by design if `BuzzRead` was not granted.)
3. Submit a prompt → estimate shows non-zero Buzz cost.
4. Confirm submit → workflow returns id → polling reaches `succeeded` → image renders.
5. Sign out → session cookie cleared.
6. Re-sign in (no consent prompt the second time) → tokens refresh transparently after their expiry.

Replicating this flow against your dev OAuth app and a live `https://orchestration.civitai.com` is the integration test. The starters all ship a Playwright spec — see [`starters/sveltekit-app/e2e/`](./starters/sveltekit-app/e2e) for an end-to-end reference.

---

## Common pitfalls

- **`client_secret` leaked to the browser.** Most common via `next.config.js`'s `env` block or Vite's non-prefixed envs being inlined accidentally. Check your built bundle. The secret must only exist on the server.
- **`access_token` in localStorage.** Don't. XSS-readable; defeats the encrypted-cookie design. The token never crosses the BFF boundary.
- **Long-poll timeouts on serverless.** Vercel + Cloudflare have hard request budgets. Cap `pollWorkflow`'s `timeoutMs` below the platform limit (10–25s is safe), and let the *client* poll a `GET /api/workflow/[id]` endpoint until terminal.
- **State-mismatch errors on first login.** Usually `secure: true` on the OAuth-state cookie in a non-HTTPS dev environment — the browser silently drops the cookie. Set `secure: false` in dev.
- **`expires_at` math.** The SDK stores `expires_at` as a JS millisecond timestamp (`Date.now() + expires_in * 1000`). Don't compare against `Date.now() / 1000` like a Unix timestamp.
- **Refreshing dead tokens.** If `refresh_token` itself has been revoked, expired or already spent, `refreshToken()` throws an `OAuthError` whose `body.error` is `invalid_grant`. Clear the session and re-prompt the user to sign in. Nothing else signs the user out. A 5xx, a 429 or a network error is transient: keep the session so the next request retries. An `invalid_client` (as a 400 or a 401) means your app's client id or secret was refused. That is a deploy fault, so fix the credentials; clearing on it would sign out every user, for good. Step 4's `refreshSession()` does exactly this, keyed on the body rather than the status.
- **Mode A: forgetting to encrypt the per-user token blob.** Storing raw `OAuthTokens` JSON in your DB is the same mistake as storing it in localStorage — if your DB leaks, every user's Civitai account is exposed. Always seal with `sealCookie` before persisting; unseal on read.

---

## See also

- [`README.md`](./README.md) — repo overview, pick a starter for fresh apps.
- [`AGENTS.md`](./AGENTS.md) — patterns to keep / avoid (also useful for humans).
- [`packages/civitai-app-sdk/README.md`](./packages/civitai-app-sdk/README.md) — full SDK reference.
- [Civitai OAuth docs](https://developer.civitai.com/site/oauth/quickstart) — official upstream documentation.
- [`starters/sveltekit-app`](./starters/sveltekit-app) — closest reference if your existing app is SvelteKit or any SSR framework.
- [`starters/next-app`](./starters/next-app) — closest reference for Next.js / React Server Components.
- [`starters/react-pwa`](./starters/react-pwa) / [`starters/svelte-pwa`](./starters/svelte-pwa) — closest reference if your app is a Vite SPA / PWA with a small BFF.
