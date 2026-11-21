# Agent Guide — `next-app`

> **If you only read one thing:** this is a Next.js 16 App Router app whose
> only persistent state is an encrypted session cookie. OAuth tokens never
> leave the server. The demo: login → balance + scopes → cost preview →
> submit one generation → display.

You're inside the Next.js 16 App Router starter for Civitai apps. The user
cloned this via `npx tiged` to bootstrap their own app — there is **no
monorepo around you**; `@civitai/app-sdk` is an npm dependency, not a
sibling workspace. Help them extend it.

## Stack

- Next.js 16, App Router, TypeScript strict
- React 19
- Tailwind 4 (via `@tailwindcss/postcss`)
- `@civitai/app-sdk` for all OAuth + orchestrator glue
- No DB, no Redis, no external session store — encrypted-cookie sessions only

## File layout

```
src/
├── app/
│   ├── layout.tsx          # root layout, Tailwind import
│   ├── page.tsx            # the demo home page
│   ├── globals.css
│   └── api/
│       ├── auth/
│       │   ├── login/route.ts            # POST → start OAuth
│       │   ├── callback/civitai/route.ts # GET  → exchange code
│       │   ├── logout/route.ts           # POST → clear session
│       │   └── revoke/route.ts           # POST → revoke + clear
│       ├── generate/
│       │   ├── estimate/route.ts         # POST → whatif=true
│       │   └── route.ts                  # POST → submit
│       └── workflow/[id]/route.ts        # GET  → snapshot
├── components/             # client components (login button, prompt form, etc.)
├── proxy.ts                # THE ONLY PLACE THE SESSION IS REFRESHED. Next 16's
│                           #   rename of middleware.ts; always nodejs runtime
└── lib/
    ├── env.ts              # validated env access
    ├── session-cookie.ts   # cookie names + pure parse/expiry helpers (no next/headers)
    ├── session.ts          # read the sealed session cookie; write it from routes only
    ├── estimate.ts         # pure Buzz-estimate decisions (cost or null, quote per prompt, stale replies)
    └── civitai.ts          # @civitai/app-sdk wiring (createOrchestratorClient, fetchMe, etc.)
```

## Patterns to keep

- **OAuth + tokens stay server-side.** Never expose `access_token`, `refresh_token`, or `CIVITAI_CLIENT_SECRET` to the browser. The client only ever sees an opaque `httpOnly` `civ_session` cookie.
- **Session = sealed cookie.** Read via `getSession()` in `src/lib/session.ts`. If `null`, the user is logged out. Don't reach into the cookie store directly elsewhere.
- 🔴 **`getSession()` is READ-ONLY, and must stay that way.** Next.js allows cookie writes in Route Handlers, Server Actions and `proxy.ts` — **not** in a Server Component, which is `getSession()`'s primary caller. It used to refresh in place; both arms (`setSession` on success, `clearSession` on failure) called `cookies().set()`, so an expired session threw `Cookies can only be modified in a Server Action or Route Handler` and took the whole page render down. Refresh lives in `src/proxy.ts` now. If you add a write to `getSession()`, `pnpm probe:expired-session` will catch it.
- 🔴 **Only a definite rejection signs the user out.** When the refresh in `src/proxy.ts` fails, the cookie is cleared only for an `OAuthError` whose body says `invalid_grant` (`isDefiniteRejection` in `src/lib/refresh-tokens.ts`). A 5xx, a 429, a network error or a refused client secret (`invalid_client`) keeps the browser's cookie so a later request retries (after a 5 s per-session backoff, since the token endpoint is rate-limited); that one render is signed out. A request waits at most 10 s for a refresh. Concurrent requests with the same refresh token share one refresh call, and a success is reused for 60 s so a straggling request with the old cookie does not replay a rotated-away refresh token; signing out (`clearSession` in `src/lib/session.ts`) forgets that reuse at once. That dedupe is **per server process**: several instances can still race, which needs a shared store or a replay grace period on the auth server.
- **All Civitai API calls happen in route handlers**, not React server components. RSCs can trigger route handlers via `fetch('/api/…')` or read session via `getSession()` and call helpers in `lib/civitai.ts` directly.
- **Buzz cost preview before submission.** Always call `/api/generate/estimate` and show the cost before submitting. Users blame the app, not Civitai, when they're surprised by Buzz spend. The estimate belongs to the exact prompt it priced: Generate stays disabled until the current prompt has an estimate with a numeric cost, and an absent cost is `null` ("Estimate unavailable"), never `0` — see `src/lib/estimate.ts`.

## Patterns to avoid

- ❌ Storing tokens in `localStorage`, cookies-without-httpOnly, or in rendered HTML.
- ❌ Writing a cookie from a Server Component — including indirectly, via a helper that looks like a read. That is the exact shape of the bug `src/proxy.ts` exists to fix.
- ❌ Using the `next-auth` / `@auth/core` patterns from older Next.js tutorials — this starter intentionally does not use those.
- ❌ Hard-coding orchestrator base URLs — use the SDK defaults or env override.
- ❌ Adding new env vars without putting them in `.env.example` and validating them in `src/lib/env.ts`.
- ❌ Adding a database for "just storing some stuff" — make the user actively opt into infra. Suggest Vercel KV or Cloudflare D1 if they ask.

## Extending

| Task | How |
|---|---|
| Add a new Civitai API call | Add a function to `src/lib/civitai.ts` taking the session, returning typed result. Use `createOrchestratorClient` from `@civitai/app-sdk/orchestrator`. |
| Request more OAuth scopes | Edit `src/lib/scopes.ts` (`REQUESTED_SCOPES`). User will need to re-consent on next login. |
| Add a generation engine option | Edit the workflow body builder. Don't ship 30 engine configs — pick one or two that exemplify the pattern. |
| Persist generation history | This is **net-new infra** — flag it. Recommend Vercel KV for simple list/get, Postgres for richer queries. Don't silently add Prisma. |
| Add another OAuth provider | Don't — this is a Civitai-focused starter. Suggest the user pull a different starter or wire `better-auth` themselves. |

## Demo flow (read this before changing the home page)

1. Logged out → `<LoginButton>` → `POST /api/auth/login` → 302 to Civitai → user consents → `GET /api/auth/callback/civitai` → session sealed → 302 to `/`.
2. Logged in → `getSession()` on server → `getMe()` (username) **and** `getBuzzBalance()` (balance — a separate endpoint, `null` without `BuzzRead`) → render the profile card, scope summary, prompt form.
3. **Preview Buzz cost** → client `POST /api/generate/estimate` → display the Buzz cost for that prompt → user confirms with **Generate**. Generate is disabled until the current prompt has an estimate; editing the prompt, Reset, a failed submit or a failed workflow wait discards it (a failed submit may still have started a paid workflow, so Generate stays locked until a new Preview), a reply to a discarded estimate is ignored, and an estimate without a cost shows "Estimate unavailable". Each Generate sends an `idempotencyKey` (`src/lib/attempt-key.ts`) that the generate route checks (`^[A-Za-z0-9_-]{1,64}$`, else 400) and puts on the real submit, never the estimate, as the workflow's `externalId`; the orchestrator returns the existing workflow for a repeat key. The form keeps the key across a failed submit, a failed wait and the re-Preview they force, so the retry cannot pay twice, and drops it when the workflow finishes, on Reset and when the prompt is edited. Never reuse a key for a different input: a repeat key returns the old workflow even if the body differs.
4. Client `POST /api/generate` → returns workflow ID → client long-polls `GET /api/workflow/[id]?wait=…` (the server holds each request open) until the workflow is done.
5. On terminal status → display image(s) or error.

## Verifying changes

After any meaningful change, run the matching check before declaring done:

| You touched | Run |
|---|---|
| Anything in `src/` | `pnpm typecheck` |
| `src/lib/estimate.ts`, `src/lib/refresh-tokens.ts`, the estimate route, `src/lib/attempt-key.ts`, `src/lib/submit-key.ts` | `pnpm test` (needs Node ≥ 22.18: it imports the `.ts` module with Node's built-in type stripping, which is newer than the README's minimum for running the app) |
| `src/components/GenerateForm.tsx` | `pnpm test`: `tests/GenerateForm.test.ts` renders the real form in happy-dom (Vitest) with `fetch` stubbed, and checks what it shows and what it sends |
| `next.config.mjs`, env wiring, security headers | `pnpm build` |
| `src/lib/session.ts`, `src/proxy.ts`, anything touching the session cookie | `pnpm probe:expired-session` |
| Auth flow (`src/app/api/auth/**`), session helpers | `pnpm test:e2e -- auth-flow` |
| Generation flow (`src/app/api/generate/**`, workflow polling) | `pnpm test:e2e -- generation` |

`pnpm test:e2e` needs a Civitai dev server with the `testing-login` provider
and matching OAuth app — see [README › End-to-end tests](./README.md#end-to-end-tests).
